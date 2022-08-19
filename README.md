# Canded Backend Server

#### Run the backend:
```
npm install
node index.js
```

#### Heroku Deployment Instructions:

Install heroku CLI with following command for Debian based distributions.

```
curl https://cli-assets.heroku.com/install-ubuntu.sh | sh
```

Checkout official heroku [instructions](https://devcenter.heroku.com/articles/heroku-cli) for CLI installations in different operating systems.

Login with your heroku credentials.
```
heroku login
```

Take a look at [Getting Started](https://devcenter.heroku.com/articles/getting-started-with-nodejs) guide for Node.js on Heroku.


#### Brief:

I wrote this backend server as a freelancing task, for someone who probably was working on this startup. The backend is basically communicating with twilio API and Google Firebase. User registers from a website and the numbers are stored in Firebase database. This backend has an endpoint, which once triggered, sends a question to all users as an SMS. So, there was another server that triggers this endpoint at every 24 hours using a cronjob. When user replies to that SMS, another endpoint of this backend is triggered and their reply is stored as an answer to the question in firebase.
