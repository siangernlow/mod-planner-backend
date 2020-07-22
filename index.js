//import dependencies for forum side
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const jwt = require("express-jwt");
const jwksRsa = require("jwks-rsa");

//import dependencies for planner side
const fetch = require("node-fetch");
const MongoClient = require("mongodb").MongoClient;
const router = express.Router();
const throng = require('throng');

const connectionString =
  "mongodb+srv://pythonSnakes:753951@cluster0-gwy8r.gcp.mongodb.net/mod-planner-users?retryWrites=true&w=majority";

/*----------------Q&A App----------------*/

// define the Express app
const app = express();

// the database
const questions = [];

// enhance your app security with Helmet
app.use(helmet());

// use bodyParser to parse application/json content-type
app.use(bodyParser.json());

// enable all CORS requests
app.use(cors());

// log HTTP requests
app.use(morgan("combined"));

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://dev-h2zijxog.au.auth0.com/.well-known/jwks.json`,
  }),

  // Validate the audience and the issuer.
  audience: "n7CcqtGLtzHjbsN06EoN7WdTMj3vpMPB",
  issuer: `https://dev-h2zijxog.au.auth0.com/`,
  algorithms: ["RS256"],
});

var WORKERS = process.env.WEB_CONCURRENCY || 1;

// Planner side database
throng({
  workers: WORKERS,
  lifetime: Infinity,
}, start);

function start() {
  MongoClient.connect(connectionString, { useUnifiedTopology: true }).then(
    (client) => {
      const db = client.db("mod-planner-users");
      const users = db.collection("users");
      const modules = db.collection("modules");

      //new
      const data = db.collection("data");

      app.use(bodyParser.urlencoded({ extended: true }));
      app.use(bodyParser.json());
      app.use("/", router);
      app.use(express.static(__dirname + "/public"));

      /*----------------Forums----------------*/
      // retrieve questions
      app.get("/Forum", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            //if database is not initialised yet
            if (!results) {
              const questions = { questions: [] };
              db.collection("data").insertOne(questions);
              res.send(questions.question);
            }
            const data = results.questions;
            res.send(data);
          })
          .catch((err) => console.error(err));
      });

      // get a specific question using indexing based on id
      app.get("/Forum/:id", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            if (req.params.id < 0 || req.params.id > questions.length - 1) {
              res.status(500).send();
            }
            res.send(questions[req.params.id]);
          });
      });

      // insert a new question
      app.post("/Forum", checkJwt, (req, res) => {
        const { title, description, hasName, username } = req.body;
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const newQuestion = {
              id: questions.length,
              title,
              description,
              answers: [],
              author: username,
              name: hasName ? username : "Anonymous",
              tags: req.body.tags,
              //  upvotes: 0,
              //  downvotes: 0,
              upvoted: [],
              downvoted: [],
            };
            questions.push(newQuestion);
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
            res.send(newQuestion);
          });
        // .then(res.status(200).send())
        // .catch((err) => console.error(err));
      });

      // insert a new answer to a question
      app.post("/Forum/answer/:id", checkJwt, (req, res) => {
        const { answer, hasName, username } = req.body;
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            if (req.params.id < 0 || req.params.id > questions.length - 1) {
              res.status(500).send();
            }
            const answers = questions[req.params.id].answers;
            answers.push({
              id: answers.length,
              answer,
              author: username,
              name: hasName ? username : "Anonymous",
              //  upvotes: 0,
              //  downvotes: 0,
              upvoted: [],
              downvoted: [],
            });
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
            res.send();
          });
        // .then(res.status(200).send());
      });

      //-------- new code, upvote and downvote for question ------//
      // req format: {name: upvoted: downvoted:}
      app.post("/Forum/upvote/:username", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const curr_user = req.params.username;
            const question = questions[req.body.id];
            //logic of upvoting
            const upvoted = question.upvoted;
            const downvoted = question.downvoted;

            //if user has previously upvoted
            if (upvoted.includes(curr_user)) {
              //  question.upvotes = question.upvotes - 1;
              question.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else if (downvoted.includes(curr_user)) {
              //  question.upvotes = question.upvotes + 1;
              //  question.downvotes = question.downvotes - 1;
              question.upvoted.push(curr_user);
              question.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              //  question.upvotes = question.upvotes + 1;
              question.upvoted.push(curr_user);
            }

            questions[req.body.name] = question;
            results.questions = questions;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: results.questions } }
            );
            res.send();
          });
        /* No need to redirect
          .then((ignore) => {
            res.redirect(`/reviews/${req.body.name}`);
          });
          */
      });

      // req format: {name: upvoted: downvoted:}
      app.post("/Forum/downvote/:username", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const curr_user = req.params.username;
            const question = questions[req.body.id];

            //logic of downvoting
            const upvoted = req.body.upvoted;
            const downvoted = req.body.downvoted;

            if (downvoted.includes(curr_user)) {
              //  question.downvotes = question.downvotes - 1;
              question.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else if (upvoted.includes(curr_user)) {
              //  question.downvotes = question.downvotes + 1;
              //  question.upvotes = question.upvotes - 1;
              question.downvoted.push(curr_user);
              question.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              //  question.downvotes = question.downvotes + 1;
              question.downvoted.push(curr_user);
            }
            questions[req.body.name] = question;
            results.questions = questions;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: results.questions } }
            );
            res.send();
          });
      });

      //Edits question
      app.post("/Forum/edit/:questionId", (req, res) => {
        const { title, description, hasName, tags } = req.body;
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const question = questions[req.params.questionId];

            //editing the question
            question.title = title;
            question.description = description;
            question.name = hasName ? question.author : "Anonymous";
            question.tags = tags;

            questions[req.params.id] = question;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
            res.send();
          });
        // .then(res.status(200).send())
        // .catch((err) => console.error(err));
      });

      //Edits answer
      app.post("/Forum/editAns/:questionId", (req, res) => {
        const { newAnswer, answerId, hasName } = req.body;
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const question = questions[req.params.questionId];
            const answer = question.answers[answerId];
            //editing the question
            answer.answer = newAnswer;
            answer.name = hasName ? question.author : "Anonymous";
            question.answers[req.body.answerId] = answer;
            questions[req.params.id] = question;

            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
            res.send();
          });
        // .then(res.status(200).send())
        // .catch((err) => console.error(err));
      });

      //---------- upvote downvote for ans ----------//
      // req format: {name: upvoted: downvoted:}
      app.post("/Forum/upvoteAns/:username", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const curr_user = req.params.username;
            const question = questions[req.body.questionId];
            const answer = question.answers[req.body.answerId];
            //logic of upvoting
            const upvoted = answer.upvoted;
            const downvoted = answer.downvoted;

            //if user has previously upvoted
            if (upvoted.includes(curr_user)) {
              //answer.upvotes = answer.upvotes - 1;
              answer.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else if (downvoted.includes(curr_user)) {
              //answer.upvotes = answer.upvotes + 1;
              //answer.downvotes = answer.downvotes - 1;
              answer.upvoted.push(curr_user);
              answer.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              //answer.upvotes = answer.upvotes + 1;
              answer.upvoted.push(curr_user);
            }
            question.answers[req.body.answerId] = answer;
            questions[req.body.name] = question;
            results.questions = questions;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: results.questions } }
            );
            res.send();
          });
        /* No need to redirect
          .then((ignore) => {
            res.redirect(`/reviews/${req.body.name}`);
          });
          */
      });

      // req format: {name: upvoted: downvoted:}
      app.post("/Forum/downvoteAns/:username", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const curr_user = req.params.username;
            const question = questions[req.body.questionId];
            const answer = question.answers[req.body.answerId];
            //logic of downvoting
            const upvoted = req.body.upvoted;
            const downvoted = req.body.downvoted;

            if (downvoted.includes(curr_user)) {
              // answer.downvotes = answer.downvotes - 1;
              answer.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else if (upvoted.includes(curr_user)) {
              // answer.downvotes = answer.downvotes + 1;
              // answer.upvotes = answer.upvotes - 1;
              answer.downvoted.push(curr_user);
              answer.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              // answer.downvotes = answer.downvotes + 1;
              answer.downvoted.push(curr_user);
            }

            question.answers[req.body.answerId] = answer;
            questions[req.body.name] = question;
            results.questions = questions;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: results.questions } }
            );
            res.send();
          });
      });

      //-------------- Deleting ----------------//
      //Deleting question
      app.post("/Forum/delete/:questionId", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            questions.map((qn, index) => {
              if (index > req.params.questionId) {
                qn.id = qn.id - 1;
              }
            });

            questions.splice(req.params.questionId, 1);
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
          })
          .then(res.status(200).send())
          .catch((err) => console.error(err));
      });

      //Deleting answer from question
      app.post("/Forum/deleteAns/:questionId", (req, res) => {
        db.collection("data")
          .findOne({ questions: { $exists: true } })
          .then((results) => {
            const questions = results.questions;
            const question = questions[req.params.questionId];
            const answers = question.answers;

            answers.map((ans, index) => {
              if (ans.id > req.body.answerId) {
                ans.id = ans.id - 1;
              }
            });
            answers.splice(req.body.answerId, 1);
            question.answers = answers;
            questions[req.params.questionId] = question;
            db.collection("data").updateOne(
              { questions: { $exists: true } },
              { $set: { questions: questions } }
            );
            res.send();
          });
        // .then(res.status(200).send())
        // .catch((err) => console.error(err));
      });

      // //---------- Deleting tag from question ------------//
      // app.post("/Forum/deleteTag/:questionId", (req, res) => {
      //   db.collection("data")
      //     .findOne({ questions: { $exists: true } })
      //     .then((results) => {
      //       const { tagId } = req.body;
      //       const questions = results.questions;
      //       const question = questions[req.params.questionId];
      //       const tags = question.tags;

      //       tags.splice(tagId, 1);

      //       question.tags = tags;
      //       questions[req.params.questionId] = question;
      //       console.log(questions);
      //       db.collection("data").updateOne(
      //         { questions: { $exists: true } },
      //         { $set: { questions: questions } }
      //       );
      //     })
      //     .then(res.status(200).send())
      //     .catch((err) => console.error(err));
      // });

      /*----------------Planner----------------*/

      // Gets information about a specific module
      app.get("/Planner/module/:acadYear/:moduleCode", (req, res) => {
        fetch(
          `https://api.nusmods.com/v2/${req.params.acadYear}/modules/${req.params.moduleCode}.json`
        )
          .then((response) => response.json())
          .then((data) => res.send(data.moduleCredit));
      });

      //helper function to send module data
      function sendModuleData(moduleList) {
        const allModules = {
          sem1: Object.values(moduleList[1]).map((module) => {
            return {
              moduleCode: module.moduleCode,
              moduleTitle: module.title,
              moduleCredits: module.moduleCredit,
            };
          }),

          sem2: Object.values(moduleList[2]).map((module) => {
            return {
              moduleCode: module.moduleCode,
              moduleTitle: module.title,
              moduleCredits: module.moduleCredit,
            };
          }),

          st1: Object.values(moduleList[3]).map((module) => {
            return {
              moduleCode: module.moduleCode,
              moduleTitle: module.title,
              moduleCredits: module.moduleCredit,
            };
          }),

          st2: Object.values(moduleList[4]).map((module) => {
            return {
              moduleCode: module.moduleCode,
              moduleTitle: module.title,
              moduleCredits: module.moduleCredit,
            };
          }),
        };
        return allModules;
      }

      // Gets all the modules available in the given AY
      //acad year is in the format 19/20 for AY 2019-2020, so on.
      app.get("/Planner/modules/:acadYear", (req, res) => {
        db.collection("data")
          .findOne({ modules: { $exists: true } })
          .then((results) => {
            let moduleList = results.modules[req.params.acadYear];
            if (moduleList) {
              res.send(sendModuleData(moduleList));
            } else {
              const year = "20" + req.params.acadYear.slice(0, 2) + "-20" + req.params.acadYear.slice(3, 5)
              fetch(
                `https://api.nusmods.com/v2/${year}/moduleInfo.json`
              )
                .then((response) => response.json())
                .then((data) => {
                  const newModuleList = {
                    1: {},
                    2: {},
                    3: {},
                    4: {},
                  };

                  data.map((module) => {
                    const semesterData = module.semesterData;
                    const newModule = {
                      moduleCode: module.moduleCode,
                      title: module.title,
                      moduleCredit: module.moduleCredit,
                    }
                    for (sem of semesterData) {
                      if (sem.semester == 1) {
                        newModuleList[1][module.moduleCode] = newModule;
                      }
                      if (sem.semester == 2) {
                        newModuleList[2][module.moduleCode] = newModule;
                      }
                      if (sem.semester == 3) {
                        newModuleList[3][module.moduleCode] = newModule;
                      }
                      if (sem.semester == 4) {
                        newModuleList[4][module.moduleCode] = newModule;
                      }
                    }
                  })
                  return newModuleList;
                })
                .then((newModuleList) => {
                  results.modules[req.params.acadYear] = newModuleList;
                  db.collection("data").updateOne(
                    { modules: { $exists: true } },
                    { $set: { modules: results.modules } }
                  );
                  res.send(sendModuleData(newModuleList));
                })
            }
          })
          .catch((err) => console.error(err));
      });

      //Gets the list of all possible degree options from the database
      app.get("/degrees", (req, res) => {
        db.collection("data")
          .findOne({ degrees: { $exists: true } })
          .then((results) => {
            res.send(results);
          })
          .catch((err) => console.error(err));
      });

      /*
            const modulesInfo = moduleList.map((module) => ({
              moduleCode: module.moduleCode,
              moduleTitle: module.title,
              moduleCredits: module.credit,
            }));
            res.send(modulesInfo);
          });
      });
      */

      // Gets data of a user
      // req format =  {name: "Ziyang Lim"} etc
      // res format = {name: "Ziyang Lim", moduleList : []} etc
      app.get("/Planner/users/:name", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            const user = results.users[req.params.name];
            const moduleList = user.moduleList;
            const userInfo = {
              name: user.name,
              moduleList: moduleList,
            };
            res.send(userInfo);
          });
      });

      // Initialize data based on user, then redirects to get the data from user
      // req format =  {name: "Ziyang Lim"} etc
      app.post("/Planner/name", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            //if database is not initialised yet
            if (!results) {
              const users = { users: {} };
              const user = {
                name: req.body.name,
                moduleList: {},
              };
              users.users[req.body.name] = user;
              db.collection("data").insertOne(users);
              res.send();
            } else if (!results["users"].hasOwnProperty(req.body.name)) {
              //the user does not exist in users
              const user = {
                name: req.body.name,
                moduleList: {},
              };
              results["users"][req.body.name] = user;
              db.collection("data").updateOne(
                { users: { $exists: true } },
                { $set: results }
              );
            }
          })
          res.send();
      });

      //Adds a AY to the moduleList
      // req format =  {name: "Ziyang Lim", AY: "19/20"} etc
      app.post("/Planner/users/moduleList", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            const user = results.users[req.body.name];
            const AY = req.body.AY;
            const moduleList = user.moduleList;
            //User input validation
            if (
              AY.length === 7 &&
              !isNaN(AY.slice(2, 4)) &&
              !isNaN(AY.slice(5))
            ) {
              if (!moduleList.hasOwnProperty(AY + "1")) {
                for (i = 1; i < 5; i++) {
                  const id = AY + i.toString();
                  moduleList[id] = [];
                }
                results.users[req.body.name] = user;
              }
              db.collection("data").updateOne(
                { users: { $exists: true } },
                { $set: { users: results.users } }
              );

              res.send();
            } else {
              res.status(400).send();
            }
          });
      });

      // Adds module to moduleList
      // req format = {AY: , semester: , module: }
      // module format = {moduleCode: , moduleTitle: , moduleCredits, }
      app.post("/Planner/users/:name/", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            const user = results.users[req.params.name];
            const moduleList = user.moduleList;
            const id = req.body.AY + req.body.semester;
            const module = req.body.module;
            const isIncluded = (module, moduleList) => {
              const result = false;
              const moduleArr = Object.values(moduleList);
              for (var i = 0; i < moduleArr.length; i++) {
                for (var j = 0; j < moduleArr[i].length; j++) {
                  if (moduleArr[i][j].moduleCode === module.moduleCode) {
                    result = true;
                    break;
                  }
                }
                if (result) {
                  break;
                }
              }
              return result;
            };
            //Asuming that moduleList has that year (should be taken cared by frontend)

            if (
              moduleList.hasOwnProperty(id) &&
              !isIncluded(module, moduleList)
            ) {
              moduleList[id].push(module);

              moduleList[id].sort((mod1, mod2) =>
                mod1.moduleCode > mod2.moduleCode ? 1 : -1
              );
            }
            results.users[req.params.name] = user;
            db.collection("data").updateOne(
              { users: { $exists: true } },
              { $set: { users: results.users } }
            );
            res.send();
          })
          .catch((err) => console.error(err));
      });

      // Delete academic year from the current list of module of a user
      // req format: {name: , AY }
      app.post("/Planner/deleteYear", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            const user = results.users[req.body.name];
            const oldModuleList = user.moduleList;
            const newModuleList = {};
            const year = req.body.AY;
            const predicate = (id, AY) => {
              return id.slice(0, 7) === AY;
            };
            // Arbitrary id to check if year is in moduleList,
            // assuming each year always has only 4 semesters
            const id = req.body.AY + "1";
            // First condition checks if year is in modulelist
            if (oldModuleList.hasOwnProperty(id)) {
              // Adds the rest of year, while unwanted year is not added
              for (key in oldModuleList) {
                if (oldModuleList.hasOwnProperty(key) && !predicate(key, year)) {
                  newModuleList[key] = oldModuleList[key];
                }
              }
              user.moduleList = newModuleList;
            }
            results.users[req.body.name] = user;
            db.collection("data").updateOne(
              { users: { $exists: true } },
              { $set: { users: results.users } }
            );
            res.send();
          })
          .catch((err) => console.error(err));
      });

      // Delete modules from the current list of module of a user
      // req format: {name , AY, semester , module, }
      app.post("/Planner/deleteModule", (req, res) => {
        db.collection("data")
          .findOne({ users: { $exists: true } })
          .then((results) => {
            //this block checks if user has a moduleList for current AY/sem
            //and does nothing if the current sem does not exist
            const user = results.users[req.body.name];
            const moduleList = user.moduleList;
            const id = req.body.AY + req.body.semester;
            const module = req.body.module;
            if (moduleList.hasOwnProperty(id)) {
              moduleList[id] = moduleList[id].filter((curr, index, arr) => {
                return (
                  curr.moduleCode !== module.moduleCode ||
                  curr.moduleTitle !== module.moduleTitle
                );
              });
              results.users[req.body.name] = user;
              db.collection("data").updateOne(
                { users: { $exists: true } },
                { $set: { users: results.users } }
              );
            }
            res.send();
          })
          .catch((err) => console.error(err));
      });

      /*----------------Edit Guide----------------*/
      // Checks if person has a guide and returns  a boolean value
      app.get("/editGuide/hasGuide/:name", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const review = reviews[req.params.name];
            const hasReview = !(review == null);
            res.send({
              hasReview: hasReview,
            });
          });
      });

      // Deletes guide
      app.post("/editGuide/delete/:name", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            delete reviews[req.params.name];
            results.reviews = reviews;

            db.collection("data").updateOne(
              { reviews: { $exists: true } },
              { $set: { reviews: results.reviews } }
            );
            res.send();
          });
      });

      // Updates guide
      // req format: {moduleList: , title: , description: }
      app.post("/editGuide/update/:name", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const review = reviews[req.params.name];
            review.moduleList = req.body.moduleList;
            review.title = req.body.title;
            review.description = req.body.description;
            reviews[req.params.name] = review;
            results.reviews = reviews;
            db.collection("data").updateOne(
              { reviews: { $exists: true } },
              { $set: { reviews: results.reviews } }
            );
            res.send("updated");
          });
      });

      /*----------------Reviews and Guides----------------*/
      // Get all the reviews to put on the front page
      app.get("/reviews", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            res.send({
              reviews: results.reviews,
            });
          });
      });

      // Get a review of a specific user
      app.get("/reviews/:name", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const review = reviews[req.params.name];
            res.send({
              name: review.name,
              moduleList: review.moduleList,
              title: review.title,
              major: review.major,
              description: review.description,
              tags: review.tags,
              upvotes: review.upvotes,
              downvotes: review.downvotes,
              upvoted: review.upvoted,
              downvoted: review.downvoted,
            });
          });
      });

      // Exporting guide on to the database
      // req format: {moduleList: , title: , major: , description:}
      app.post("/reviews/:name", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const review = {
              name: req.params.name,
              moduleList: req.body.moduleList,
              title: req.body.title,
              major: req.body.major,
              description: req.body.description,
              tags: req.body.tags,
              //  upvotes: 0,
              //  downvotes: 0,
              upvoted: [],
              downvoted: [],
            };
            reviews[req.params.name] = review;
            results.reviews = reviews;
            db.collection("data").updateOne(
              { reviews: { $exists: true } },
              { $set: { reviews: results.reviews } }
            );
            res.send(review);
          });

        /* No need to redirect
          .then((ignore) => {
            res.redirect("/reviews");
          });
          */
      });

      // req format: {name: upvoted: downvoted:}
      app.post("/reviews/upvote/:username", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const curr_user = req.params.username;
            const review = reviews[req.body.name];

            //logic of upvoting
            const upvoted = review.upvoted;
            const downvoted = review.downvoted;

            //if user has previously upvoted
            if (upvoted.includes(curr_user)) {
              //review.upvotes = review.upvotes - 1;
              review.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else if (downvoted.includes(curr_user)) {
              // review.upvotes = review.upvotes + 1;
              //review.downvotes = review.downvotes - 1;
              review.upvoted.push(curr_user);
              review.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              //  review.upvotes = review.upvotes + 1;
              review.upvoted.push(curr_user);
            }

            reviews[req.body.name] = review;
            results.reviews = reviews;
            db.collection("data").updateOne(
              { reviews: { $exists: true } },
              { $set: { reviews: results.reviews } }
            );
            res.send();
          });
        /* No need to redirect
          .then((ignore) => {
            res.redirect(`/reviews/${req.body.name}`);
          });
          */
      });

      // req format: {name: upvoted: downvoted:}
      app.post("/reviews/downvote/:username", (req, res) => {
        db.collection("data")
          .findOne({ reviews: { $exists: true } })
          .then((results) => {
            reviews = results.reviews;
            const curr_user = req.params.username;
            const review = reviews[req.body.name];

            //logic of downvoting
            const upvoted = review.upvoted;
            const downvoted = review.downvoted;

            if (downvoted.includes(curr_user)) {
              //  review.downvotes = review.downvotes - 1;
              review.downvoted = req.body.downvoted.filter(
                (user) => user !== curr_user
              );
            } else if (upvoted.includes(curr_user)) {
              //  review.downvotes = review.downvotes + 1;
              //  review.upvotes = review.upvotes - 1;
              review.downvoted.push(curr_user);
              review.upvoted = req.body.upvoted.filter(
                (user) => user !== curr_user
              );
            } else {
              //  review.downvotes = review.downvotes + 1;
              review.downvoted.push(curr_user);
            }
            reviews[req.body.name] = review;
            results.reviews = reviews;
            db.collection("data").updateOne(
              { reviews: { $exists: true } },
              { $set: { reviews: results.reviews } }
            );
            res.send();
          });
      });
    }
  );

  // start the server
  let port = process.env.PORT;
  if (port == null || port == "") {
    port = 8000;
  }
  app.listen(port);
  console.log("listening on port " + port);
}