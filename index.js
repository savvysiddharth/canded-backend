// Express.js Initialization
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// DDoS protection
const rateLimit = require("express-rate-limit");
app.set('trust proxy', 1);
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 100 // limit each IP to 20 requests per windowMs
});
app.use(limiter);

// for static files in public folder
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');

const mime = {
    html: 'text/html',
    txt: 'text/plain',
    css: 'text/css',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    js: 'application/javascript',
    vcf: 'text/x-vcard'
};

app.get('*', function (req, res) {
    var file = path.join(dir, req.path.replace(/\/$/, '/index.html'));
    if (file.indexOf(dir + path.sep) !== 0) {
        return res.status(403).end('Forbidden');
    }
    var type = mime[path.extname(file).slice(1)] || 'text/plain';
    var s = fs.createReadStream(file);
    s.on('open', function () {
        res.set('Content-Type', type);
        if(type == mime['vcf']) {
          res.set({
            'Cache-Control': 'no-cache',
            'Content-Disposition': 'inline; filename="Canded.vcf"'
          });
        }
        s.pipe(res);
    });
    s.on('error', function () {
        res.set('Content-Type', 'text/plain');
        res.status(404).end('Not found');
    });
});

// Google Cloud Firestore Initialization
const admin = require('firebase-admin');
const serviceAccount = require('./servicekey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

//Twilio API Initialization
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const msgServiceSid = process.env.msgServiceSid;
const accountSid = process.env.accountSid;
const authToken = process.env.authToken;
const twilioNumber = process.env.twilioNumber;

const twilioClient = require('twilio')(accountSid, authToken);

// Nodemailer Initialization
const nodemailer = require('nodemailer');
const SMTPservice = process.env.SMTPservice;
const adminSMTPemail = process.env.adminSMTPemail;
const adminSMTPpass = process.env.adminSMTPpass;

// ----------------------------------
// ESSENTIAL ENDPOINTS AND FUNCTIONS:
// ----------------------------------


// app.get('/', (req,res) => {
//   res.send('canded api is up and running...');
// });

// Handles incoming SMS
app.post('/sms', (req, res) => {
  console.log('SMS handler called..');
  const userMessage = req.body.Body.trim(); // trim() used to remove any spaces from both ends
  const userMobNum = req.body.From;

  const emptyResponse = '<Response></Response>';

  const userDocRef = db.collection('users').doc(userMobNum);

  userDocRef.get().then((userdoc) => {
    if(userdoc.exists) { //check if user exists
      console.log('name: '+userdoc.data().name);
      console.log('number '+userMobNum+' exists.');

      const msgLowerCase = userMessage.toLowerCase();

      if(msgLowerCase == 'unsubscribe') { // Delete this user
        console.log('number '+userMobNum+' wants to unsubscribe');
        const twiml = new MessagingResponse();
        twiml.message('We are sorry to see you go! Help us make Canded better by filling out this brief survey https://forms.gle/MKBdqYKsBrE42rUk9');
        // see if user has answer collection
        const ansDocRef = db.collection('users').doc(userMobNum).collection('answers').get();
        ansDocRef.then(snapshot => {
          if(snapshot.empty) { // if user has no answer collection, then simply delete user document
            db.collection('users').doc(userMobNum).delete()
            .then(() => {
              res.writeHead(200, {'Content-Type': 'text/xml'});
              res.end(twiml.toString());
              console.log('successfully deleted the user '+userMobNum);
            });
          } else { // if user has, then delete all answer documents, then delete user document
            const ansDeleteRequests = [];
            snapshot.forEach(ansdoc => {
              const deleteReq = db.collection('users').doc(userMobNum).collection('answers').doc(ansdoc.id).delete();
              ansDeleteRequests.push(deleteReq);
            });
            Promise.all(ansDeleteRequests)
            .then(() => {
              db.collection('users').doc(userMobNum).delete()
              .then(() => {
                res.writeHead(200, {'Content-Type': 'text/xml'});
                res.end(twiml.toString());
                console.log('successfully deleted the user '+userMobNum);
              }).catch(err => {
                res.sendStatus(500);
                console.log(err);
              });
            }).catch(err => {
              res.sendStatus(500);
              console.log(err);
            });
          }
        }).catch(err => {
          res.sendStatus(500);
          console.log(err);
        });
      } else if(msgLowerCase == 'help' || msgLowerCase == 'info' || msgLowerCase == 'start' || msgLowerCase == 'stop' || msgLowerCase == 'unstop') { // ignore this one
        res.writeHead(200, {'Content-Type': 'text/xml'});
        res.end(emptyResponse);
        console.log(userMobNum+' has entered reserved twilio opt-out management code');
      } else { // user wants to add this as answer
        console.log('number '+userMobNum+' wants to add an answer');
        let questionCount = userdoc.data().question_count;
        if(questionCount == 0) { // No questions asked yet
          console.log('but, no question has been asked yet for '+userMobNum);
          res.writeHead(200, {'Content-Type': 'text/xml'});
          res.end(emptyResponse);
          return;
        }
        // check their current_answer_count
        const currentAnsCount = userdoc.data().current_answer_count;

        if(currentAnsCount < 4) { // proceed if answer count is below CAP
          db.collection('users').doc(userMobNum).set({
              current_answer_count: currentAnsCount+1 // increment current_answer_count
            }, {merge: true}).then(() => {
              // adding new answer
              const ansDocRef = db.collection('users').doc(userMobNum).collection('answers').doc(questionCount.toString());
              ansDocRef.get()
              .then((ansdoc) => {
                if(ansdoc.exists) { // append to existing answer
                  const userAnswerBody = ansdoc.data().body;
                  let updatedAnswerBody = userAnswerBody + ', ' + userMessage;

                  ansDocRef.set({
                    body: updatedAnswerBody
                  }, {merge : true})
                  .then(() => {
                    console.log('answer updated from ' + userMobNum);
                    res.writeHead(200, {'Content-Type': 'text/xml'});
                    res.end(emptyResponse);
                  })
                  .catch(err => {
                    console.log(err);
                    console.log('failed to update answer from '+ userMobNum);
                    res.sendStatus(500);
                  });

                } else { // create document and set answer

                  ansDocRef.set({
                    body: userMessage,
                    id: questionCount
                  })
                  .then(() => {
                    console.log('new answer uploaded from ' + userMobNum);
                    res.writeHead(200, {'Content-Type': 'text/xml'});
                    res.end(emptyResponse);
                  })
                  .catch(err => {
                    console.log(err);
                    console.log('failed to new answer from user.')
                    res.sendStatus(500);
                  });

                }
              })
              .catch(err => {
                console.log(err);
                console.log('failed to query user answer doc');
                res.sendStatus(500);
              });
            }).catch(err => {
              console.log(err);
              console.log('failed to fetch current answer count');
              res.sendStatus(500);
            });    
        } else { // user exceeded max answer cap for this question
          console.log(userMobNum+' exceeded max answer cap');
          res.writeHead(200, {'Content-Type': 'text/xml'});
          res.end(emptyResponse);
        }
      }
    } else { // user has not registered yet
      console.log(userMobNum+' has not registered.');
      res.writeHead(200, {'Content-Type': 'text/xml'});
      res.end(emptyResponse);
    }
  });
});

// Works only if system provides UTC time
function getUSAtimeToday() {
  const today = new Date(); // Assuming UTC time
  today.setHours(today.getHours() - 4); // USA Timezone (GMT-4)
  return today;
}

// User signs up at this endpoint
app.post('/signup', (req, res) => {
  // console.log(req.body);
  const userName = req.body.name;
  const userMobNum = '+1' + req.body.number; //prepending (+1) USA country code
  const userEmail = req.body.email;
  const userPreference = req.body.choice;

  console.log(userName +' wants to sign up with '+userMobNum+ ' and '+userEmail);

  const userDocRef = db.collection('users').doc(userMobNum);

  const todayDate = getUSAtimeToday();

  userDocRef.get()
  .then(userdoc => {
    if(userdoc.exists) { //user has already registered (confirmed through their mobile number)
      console.log('User mobile already registered');
      res.status(400).send('User mobile already registered.'); return;
    } else {
      db.collection('users').where('email', '==', userEmail).get()
      .then(snapshot => {
        if(!snapshot.empty) { //user has already registered (confirmed through their email)
          console.log('User email already registered');
          res.status(400).send('User email already registered.'); return;
        } else { // new user
          userDocRef.set({
            name: userName,
            email: userEmail,
            preference: userPreference,
            question_count: 0,
            last_question_date: todayDate.toDateString()
          })
          .then(() => {
            console.log('user successfully registered');
            res.status(200).send('User registered.');
            
            // preparing welcome message
            let customFrequency = '';
            if(userPreference == '1') customFrequency += 'daily';
            else if(userPreference == '2') customFrequency += 'every other day';
            else if(userPreference == '3') customFrequency += 'each week';
            let welcomeMsg = `Hi ${userName}, welcome to Canded!\n\nHere’s how it works: Our team comes up with thought provoking questions that you will be receiving ${customFrequency}. You respond to this number with your reflection and then at the end of the month you will get a report with all your responses. You can unsubscribe at any time by texting “unsubscribe.” To kick us off, just add us to your contacts with the handy contact card below!\n\nQuestions? Email us at today@canded.me`;

            // sending welcome message
            twilioClient.messages
              .create({body: welcomeMsg, messagingServiceSid: msgServiceSid, to: userMobNum})
                .then(message => {
                  console.log(message.sid);
                  console.log('welcome message sent');
                  
                  // sending contact card
                  const cardUrl = 'https://canded-api.herokuapp.com/newcard2.vcf';
                  twilioClient.messages
                    .create({mediaUrl: [cardUrl], messagingServiceSid: msgServiceSid, to: userMobNum})
                      .then(message => {
                        console.log('contact card sent');
                        console.log(message.sid);
                      }).catch(err => {
                        console.log('failed to send contact card');
                        console.log(err);
                      });
                }).catch(err => {
                  console.log('failed to send welcome message');
                  console.log(err);
                });
          })
          .catch((err) => {
            res.status(500).send('failed to add user.');
            console.log(err); // failed to find userDoc
          });
        }
      }).catch(err => {
        res.sendStatus(500);
        console.log(err);
      });
    }
  }).catch(err => {
    res.status(500).send('failed to fetch user details from database');
    console.log(err);
  });
});

// builds html code customized for user based on their user profile and their set of quesAns
function buildReportHtmlBody(quesAns, userProfile) {
  const header = `<div style="font-family: sans-serif; color:#3d3d3d; padding: 5px">
                    <h1>Monthly Report</h1>
                    <hr>

                    <p>
                      Hi ${userProfile.name}!
                    </p>
                    <p>
                      Here is your monthly report of the survey.
                    </p>
                    <br>`;
  let qnaList = '';
  for(qna of quesAns) {
    const qnaString = `<b>Q. ${qna[0]}?</b>
                       <br>
                       <p><b>Ans:</b> ${qna[1]}</p>
                       <br>`;
    qnaList += qnaString;
  }

  const msgHtmlBody = header + qnaList + '</div>';
  return msgHtmlBody;
}

// usersList is list of userdocs who will get monthly report today
function sendMonthlyReport(usersList) {
  if(usersList.length == 0) return;

  // cache users in hashmap, stored with their mobile number as key
  const usersMap = {};
  for(let i=0; i<usersList.length; i++) { // adding user's question count and  preference in userMap
    usersMap[usersList[i].id] = {
      name: usersList[i].data().name,
      email: usersList[i].data().email,
      question_count: usersList[i].data().question_count,
      preference: usersList[i].data().preference,
      answers: {} //empty array for answers
    }
  }

  //now fetch all answers of each users, and add it to userMap (for each users)
  const usersAnswerQueries = []; //list of answers (at index usersAnswerQueries[i], we have answers query of usersList[i])
  for(let i=0; i<usersList.length; i++) {
    const ansQry = db.collection('users').doc(usersList[i].id).collection('answers').get();
    usersAnswerQueries[i] = ansQry;
  }

  Promise.all(usersAnswerQueries)
  .then(userAnswerSnapshots => {
    let usersArrayIndex = 0;
    userAnswerSnapshots.forEach(userAnswers => {
      userAnswers.forEach(answerdoc => {
        usersMap[usersList[usersArrayIndex].id].answers[answerdoc.id] = answerdoc.data().body;
        // .push({id:answerdoc.id, body:answerdoc.data().body});
      });
      usersArrayIndex++;
    });
    // At this point we have all user details and thier respective answers list in userMap
    // console.log(usersMap);

    // now, building questions map
    const questionsMap = {}; // cache required questions, stored with their question number as key
    const questionRequests = [];
    for(let i=0; i<usersList.length; i++) {
      const userQuestionCount = usersMap[usersList[i].id].question_count;
      const userPreference = usersMap[usersList[i].id].preference;

      let questionCountOffset;
      if(userPreference == '1') { // daily user
        questionCountOffset = 29; // get last 30 questions
      } else if(userPreference == '2') { // every other day user
        questionCountOffset = 14; // get last 15 questions
      } else { // weekly user
        questionCountOffset = 3; // get last 4 questions
      }
      const fromQues = userQuestionCount - questionCountOffset;
      const toQues = userQuestionCount;
      usersMap[usersList[i].id].fromQues = fromQues;
      usersMap[usersList[i].id].toQues = toQues;

      for(let j=fromQues; j<=toQues; j++) {
        if(!questionsMap[j]) { // if this question has not been requested yet
          const questionReq = db.collection('questions').doc(j.toString()).get();
          questionRequests.push(questionReq);
          questionsMap[j] = true; // temporarily just putting true here so we know this request is under process
        }
      }
    }

    Promise.all(questionRequests)
    .then(questionSnapshots => {
      questionSnapshots.forEach(questiondoc => {
        questionsMap[questiondoc.id] = questiondoc.data().body;
      });

      // At this point we probably have all required questions and also required user details who will get monthly report today

      // console.log('--------------');
      // console.log(questionsMap);
      // console.log('--------------');
      // console.log(usersMap);
      // console.log('--------------');

      // compile each user's questions and answers and start sending emails
      const transporter = nodemailer.createTransport({
        service: SMTPservice,
        auth: {
          user: adminSMTPemail,
          pass: adminSMTPpass
        },
        pool : true
      });
      for(let i=0; i<usersList.length; i++) {
        const userid = usersList[i].id;
        const fromQues = usersMap[userid].fromQues;
        const toQues = usersMap[userid].toQues;

        const quesAns = [];

        for(let j=fromQues; j<=toQues; j++) {
          const question = questionsMap[j];
          let answer;
          if(usersMap[userid].answers[j]) {
            answer = usersMap[userid].answers[j];
          } else {
            answer = '---No answer received---';
          }
          quesAns.push([question, answer]);
        }

        // compiled 2D array of questions and answers
        // console.log('----------'+ userid +'------------');
        // console.log(quesAns);
        // console.log('----------------------------------');

        const userEmail = usersMap[userid].email;

        let mailOptions = {
          from: adminSMTPemail,
          to: userEmail,
          subject: 'Monthly Report from Canded',
          html: buildReportHtmlBody(quesAns, usersMap[userid])
        };

        transporter.sendMail(mailOptions, function(error, info){
          if (error) {
            console.log(error);
          } else {
            console.log(userid+' - Email sent: ' + info.response);
          }
        });
      }

    }).catch(err => console.log(err));

  }).catch(err => console.log(err));
}

// Triggered daily by some cronjob to run at specific time
app.post('/dailysms', (req, res) => {
  console.log('----------------\nCALL AT dailysms\n----------------');
  const usersCollection = db.collection('users');

  usersCollection.get().then(querySnapshot => {
      const userDocSnapshots = []; // list of users who will be getting question today (variable naming is bad here)
      const allUsers = []; // list of all users
      querySnapshot.forEach(userdoc => {
          const mobileNum = userdoc.id;
          const questionCount = userdoc.data().question_count;

          const todayDate = getUSAtimeToday();

          const userPreference = userdoc.data().preference;
          const userLastQuestionDate = new Date(userdoc.data().last_question_date);

          const dayDifference = (todayDate.getTime() - userLastQuestionDate.getTime())/(1000*3600*24);

          let pushFlag = false;
          if(questionCount == 0) {
            if(dayDifference >= 1) { // new users will start getting questions the very next day of their registeration
              pushFlag = true;
              console.log('first question for '+mobileNum);
            } else {console.log(mobileNum+' is new user but dayDifference is '+dayDifference+' so no question today')}
          } else {
            //Compare user's last questioned date, compare it with today, check thier preference,..
            //..if it satisfies then only push to userDocSnapshots array
            
            console.log('day difference for '+mobileNum+' is '+dayDifference+' days');

            if(userPreference == '1' && dayDifference >= 1) { // Daily
              pushFlag = true;
            } else if(userPreference == '2' && dayDifference >= 2) { // Every other day
              pushFlag = true;
            } else if(userPreference == '3' && dayDifference >= 7) { // Every week
              pushFlag = true;
            }

            if(!pushFlag) console.log(mobileNum + " won't be getting any question today");
          }

          
          //making cache of user docs
          if(pushFlag) {
            console.log(mobileNum+' will get a question today');
            // update question count of selected user and also store the date
            // add today's date as user's lastquestion date
            // set current_answer_count to 0
            db.collection('users').doc(mobileNum).set({
              question_count: questionCount+1,
              last_question_date: todayDate.toDateString(),
              current_answer_count: 0
            }, {merge: true});

            // these users will receive new question today
            userDocSnapshots.push(userdoc);
          }
          allUsers.push(userdoc);
      });

      // check if we should send monthly report for this user
      const monthlyReportUsers = []; // list of user docs, who will be getting monthly report today
      for(let i=0; i<allUsers.length; i++) {
        const questionCount = allUsers[i].data().question_count; // this is the count before incrementing today(if incremented)
        if(questionCount > 0) {
          const userPreference = allUsers[i].data().preference;
          let readyForMonthlyReport = false;
          if(userPreference == '1' && questionCount % 30 == 0) {readyForMonthlyReport = true;} // daily user
          else if(userPreference == '2' && questionCount % 15 == 0) {readyForMonthlyReport = true;} // every other day user
          else if(userPreference == '3' && questionCount % 4 == 0) {readyForMonthlyReport = true;} // weekly user
          if(readyForMonthlyReport) {
            console.log(allUsers[i].id+' will get monthly report today');
            monthlyReportUsers.push(allUsers[i]);
          }
        }
      }
      sendMonthlyReport(monthlyReportUsers);


      const questionPromises = [];
      for(let i=0; i<userDocSnapshots.length; i++) {
        // let mobileNum = userDocSnapshots[i].id;
        const newQuestionCount = userDocSnapshots[i].data().question_count + 1;
        // console.log(mobileNum, newQuestionCount);

        const questionDocRef = db.collection('questions').doc(newQuestionCount.toString());
        questionPromises.push(questionDocRef.get());
      }

      Promise.all(questionPromises)
      .then((questionDocSnapshots) => {
        const smsRequests = [];
        for(let i=0; i<questionDocSnapshots.length; i++) {
          const mobileNum = userDocSnapshots[i].id;
          const question = questionDocSnapshots[i].data().body;
          const smsReq = twilioClient.messages.create({body: question, messagingServiceSid: msgServiceSid, to: mobileNum});
          smsRequests.push(smsReq);
        }
        Promise.all(smsRequests)
        .then((responses) => {
          for(const response of responses) {
            console.log('sent SMS to '+response.to+': '+response.sid);
          }
        }).catch(err => console.log(err));

      }).catch((err) => {
        console.log(err);
        console.log('failed to fetch questions');
        res.sendStatus(500);
      });

  }).catch(err => {
    console.log(err);
  });
});

// -------------------------------
// DEVELOPMENT SPECIFIC ENDPOINTS:
// -------------------------------

app.post('/testapi', (req,res) => {
  console.log(req.body);
  const userName = req.body.name;
  const userMobNum = '+1' + req.body.number; // prepending US country code to 10 digit mobile number
  const userEmail = req.body.email;
  const userChoice = req.body.choice;

  console.log('name: '+userName);
  console.log('mob: '+userMobNum);
  console.log('email: '+userEmail);
  console.log('pref: '+userChoice);

  res.status(200).send('this is ok');
});

// In case heroku dyno was sleeping, Twilio will call this one
// who will redirect to original handler (in hope that the dyno will wake up until this point)
// NOT NEEDED if server never sleeps
app.post('/sms_backup', (req, res) => {
  console.log('backup sms handler called..');
  res.redirect(307, '/sms'); // redirects to sms endpoint while maintaining request parameters
});

// Made just to add dummy questions in database
app.post('/addquestions', (req,res) => {
  for(let i=1000; i<=1100; i++) {
    db.collection('questions').doc(i.toString()).set({
      body: "Question number "+i+" ?",
      id: i
    }).catch(err => console.log(err));
    console.log('adding question ' + i);
  }
  res.end();
});

app.post('/testemail', (req,res) => {

  console.log('mailing...');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'developertester98@gmail.com',
      pass: '798tokyo897walter'
    },
    pool : true
  });

  let mailOptions = {
    from: 'developertester98@gmail.com',
    to: 'siddharth21805@gmail.com',
    subject: 'Sending Email using Node.js',
    text: 'That was easy, email-1',
    html: ``
  };

  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });

  res.end();
});

app.post('/testmonthly', (req,res) => {
  db.collection('users').get()
  .then(querySnapshot => {
    const usersForMonthlyReport = [];
    querySnapshot.forEach(userdoc => {
      usersForMonthlyReport.push(userdoc);
    });
    // console.log(usersForMonthlyReport);
    res.end();
    sendMonthlyReport(usersForMonthlyReport);
  }).catch(err => console.log(err));
});

app.post('/dailytest', (req,res) => {
  twilioClient.messages.create({body: 'messge from daily test', from: twilioNumber, to: '+12566637903'})
  .then(msg => {
    console.log(msg.sid);
    res.send('ok');
  })
  .catch(err => {
    console.log(err);
    res.status(500).send('could not send sms');
  });
});

const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log('Express server listening on port '+port);
});