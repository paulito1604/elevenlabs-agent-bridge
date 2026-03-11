import express from "express";
import fetch from "node-fetch";
import WebSocket from "ws";

const app = express();
app.use(express.json());

const XI_API_KEY = process.env.XI_API_KEY;
const AGENT_ID = process.env.AGENT_ID;

async function getSignedUrl() {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`,
    {
      headers: {
        "xi-api-key": XI_API_KEY
      }
    }
  );

  const data = await res.json();
  return data.signed_url;
}

app.post("/eleven-agent-chat", async (req, res) => {

  const { text } = req.body;

  const signedUrl = await getSignedUrl();
  const ws = new WebSocket(signedUrl);

  let finalText = "";

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "user_message",
      text: text
    }));
  });

  ws.on("message", (msg) => {

    const data = JSON.parse(msg.toString());

    if(data.type === "agent_response"){
      finalText += data.text
    }

    if(data.type === "conversation_end"){
      ws.close()

      res.json({
        text: finalText
      })
    }

  })

});
 
app.listen(3000, ()=>{
  console.log("Bridge running")
})
