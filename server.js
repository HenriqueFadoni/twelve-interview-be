require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const readline = require("readline");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { OAuth2 } = google.auth;
const app = express();
const PORT = process.env.PORT || 4000;
app.use(cors());
app.use(bodyParser.json());

const client = new MongoClient(process.env.MONGODB_URL, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const credentialsPath = path.join(__dirname, "credentials.json");
const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));

const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new OAuth2(client_id, client_secret, redirect_uris[0]);

const TOKEN_PATH = path.join(__dirname, "token.json");

function getAccessToken(oAuth2Client, resolve, reject) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) {
        console.error("Error retrieving access token", err);
        reject(err);
      }
      oAuth2Client.setCredentials(token);
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      resolve(oAuth2Client);
    });
  });
}

function authorize() {
  return new Promise((resolve, reject) => {
    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) return getAccessToken(oAuth2Client, resolve, reject);
      oAuth2Client.setCredentials(JSON.parse(token));
      resolve(oAuth2Client);
    });
  });
}

async function fetchEmails(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.list({ userId: "me", maxResults: 10 });
  const messages = res.data.messages;
  await client.connect();
  console.log("check");
  const database = client.db(process.env.DB_NAME);
  const collection = database.collection(process.env.COLLECTION_NAME);

  for (const message of messages) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full",
    });
    const emailData = parseEmail(msg.data.snippet);

    if (
      emailData.date === "" ||
      emailData.name === "" ||
      emailData.memo === ""
    ) {
      continue;
    }

    await collection.insertOne(emailData);
  }
}

function parseEmail(snippet) {
  const dateMatch = snippet.match(/Date:\s*([^\n,]+)/);
  const nameMatch = snippet.match(/Name:\s*([^\n,]+)/);
  const memoMatch = snippet.match(/Memo:\s*([^\n,]+)/);
  const valueMatch = snippet.match(/Value:\s*([^\n,]+)/);

  return {
    date: dateMatch ? dateMatch[1].trim() : "",
    name: nameMatch ? nameMatch[1].trim() : "",
    memo: memoMatch ? memoMatch[1].trim() : "",
    value: valueMatch ? valueMatch[1].trim() : "0",
  };
}

async function main() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    app.get("/api/emails", async (req, res) => {
      try {
        const database = client.db(process.env.DB_NAME);
        const collection = database.collection(process.env.COLLECTION_NAME);
        const emails = await collection.find().toArray();
        res.json(emails);
      } catch (error) {
        console.error("Error fetching emails", error);
        res.status(500).send("Error fetching emails");
      }
    });

    app.post("/api/emails", async (req, res) => {
      try {
        const database = client.db(process.env.DB_NAME);
        const collection = database.collection(process.env.COLLECTION_NAME);
        const email = await collection.insertOne(req.body);
        res.status(201).json(email);
      } catch (error) {
        console.error("Error creating emails", error);
        res.status(500).send("Error creating emails");
      }
    });

    app.put("/api/emails/:id", async (req, res) => {
      try {
        const database = client.db(process.env.DB_NAME);
        const collection = database.collection(process.env.COLLECTION_NAME);
        const email = await collection.findOneAndUpdate(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body },
          { returnDocument: "after" }
        );
        res.json(email);
      } catch (error) {
        console.error("Error edditing emails", error);
        res.status(500).send("Error edditing emails");
      }
    });

    app.delete("/api/emails/:id", async (req, res) => {
      try {
        const database = client.db(process.env.DB_NAME);
        const collection = database.collection(process.env.COLLECTION_NAME);
        console.log(req.params.id);
        await collection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting emails", error);
        res.status(500).send("Error deleting emails");
      }
    });

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      authorize().then(fetchEmails).catch(console.error);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1);
  }
}

main().catch(console.error);

process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed");
  process.exit(0);
});
