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

// retrieve all questions
app.get("/Forum", (req, res) => {
  const qs = questions.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description,
    answers: q.answers.length,
  }));
  res.send(qs);
});

// get a specific question
app.get("/Forum/:id", (req, res) => {
  const question = questions.filter((q) => q.id === parseInt(req.params.id));
  if (question.length > 1) return res.status(500).send();
  if (question.length === 0) return res.status(404).send();
  res.send(question[0]);
});

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

// insert a new question
app.post("/Forum", checkJwt, (req, res) => {
  const { title, description } = req.body;
  const newQuestion = {
    id: questions.length + 1,
    title,
    description,
    answers: [],
    author: req.user.name,
  };
  questions.push(newQuestion);
  res.status(200).send();
});

// insert a new answer to a question
app.post("/Forum/answer/:id", checkJwt, (req, res) => {
  const { answer } = req.body;

  const question = questions.filter((q) => q.id === parseInt(req.params.id));
  if (question.length > 1) return res.status(500).send();
  if (question.length === 0) return res.status(404).send();

  question[0].answers.push({
    answer,
    author: req.user.name,
  });

  res.status(200).send();
});

// Planner side database
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

    /*----------------Planner----------------*/

    // Fetches list of all the modules from  NUSMods API
    app.get("/Planner/module/:acadYear/:moduleCode", (req, res) => {
      fetch(
        `https://api.nusmods.com/v2/${req.params.acadYear}/modules/${req.params.moduleCode}.json`
      )
        .then((response) => response.json())
        .then((data) => res.send(data.moduleCredit));
    });

    // Gets all the modules available in AY19/20
    app.get("/Planner/modules", (req, res) => {
      db.collection("data")
        .findOne({ modules: { $exists: true } })
        .then((results) => {
          const allModules = {
            sem1: Object.values(results.modules["19/20"][1]).map((module) => {
              return {
                moduleCode: module.moduleCode,
                moduleTitle: module.title,
                moduleCredits: module.moduleCredit,
              };
            }),

            sem2: Object.values(results.modules["19/20"][2]).map((module) => {
              return {
                moduleCode: module.moduleCode,
                moduleTitle: module.title,
                moduleCredits: module.moduleCredit,
              };
            }),

            st1: Object.values(results.modules["19/20"][3]).map((module) => {
              return {
                moduleCode: module.moduleCode,
                moduleTitle: module.title,
                moduleCredits: module.moduleCredit,
              };
            }),

            st2: Object.values(results.modules["19/20"][4]).map((module) => {
              return {
                moduleCode: module.moduleCode,
                moduleTitle: module.title,
                moduleCredits: module.moduleCredit,
              };
            }),
          };

          res.send(allModules);
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

    // Gets data from user when the user first logins
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
        .then(res.send())
        .catch((err) => console.error(err));
    });

    //Adds a AY to the moduleList
    // req format =  {name: "Ziyang Lim", AY: "AY19/20"} etc
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
            AY.slice(0, 2) === "AY" &&
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
            upvotes: 0,
            downvotes: 0,
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
          const upvoted = req.body.upvoted;
          const downvoted = req.body.downvoted;

          //if user has previously upvoted
          if (upvoted.includes(curr_user)) {
            review.upvotes = review.upvotes - 1;
            review.upvoted = req.body.upvoted.filter(
              (user) => user !== curr_user
            );
          } else if (downvoted.includes(curr_user)) {
            review.upvotes = review.upvotes + 1;
            review.downvotes = review.downvotes - 1;
            review.upvoted.push(curr_user);
            review.downvoted = req.body.downvoted.filter(
              (user) => user !== curr_user
            );
          } else {
            review.upvotes = review.upvotes + 1;
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
          const upvoted = req.body.upvoted;
          const downvoted = req.body.downvoted;

          if (downvoted.includes(curr_user)) {
            review.downvotes = review.downvotes - 1;
            review.downvoted = req.body.downvoted.filter(
              (user) => user !== curr_user
            );
          } else if (upvoted.includes(curr_user)) {
            review.downvotes = review.downvotes + 1;
            review.upvotes = review.upvotes - 1;
            review.downvoted.push(curr_user);
            review.upvoted = req.body.upvoted.filter(
              (user) => user !== curr_user
            );
          } else {
            review.downvotes = review.downvotes + 1;
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
app.listen(8081, () => {
  console.log("listening on port 8081");
});
