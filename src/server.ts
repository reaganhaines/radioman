import express from "express";
import 'dotenv/config';
import OpenAI from "openai";
import basicAuth from "express-basic-auth";


const client = new OpenAI();
const app = express();

// An endpoint which would work with the client code above - it returns
// the contents of a REST API request to this protected endpoint
app.get("/session", async (req, res) => {
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
    }),
  });
  const data = await r.json();

  // Send back the JSON we received from the OpenAI REST API
  res.send(data);
});

app.get("/web", async (req, res) => {
  const query = req.query.q as string;
  console.log(query)

  const response = await client.responses.create({
    model: "gpt-4.1",
    tools: [ { type: "web_search_preview" } ],
    input: query
  });

  // Extract the assistant's reply
  const web_reply = response.output_text;
  console.log(web_reply)
  res.json({ web_reply });
});

app.use(express.static("public"));
app.use(basicAuth({
  users: {
    [process.env.BASIC_AUTH_USER!]: process.env.BASIC_AUTH_PASSWORD!
  },
  challenge: true
}));


app.listen(3000)