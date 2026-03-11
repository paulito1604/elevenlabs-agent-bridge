import express from "express";
import fetch from "node-fetch";
import WebSocket from "ws";

const app = express();
app.use(express.json());

const XI_API_KEY = process.env.XI_API_KEY;
const AGENT_ID = process.env.AGENT_ID;
const PORT = process.env.PORT || 3000;

async function getSignedUrl() {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`,
    {
      method: "GET",
      headers: {
        "xi-api-key": XI_API_KEY,
      },
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error getting signed URL: ${txt}`);
  }

  const data = await res.json();
  if (!data.signed_url) {
    throw new Error("No signed_url returned by ElevenLabs");
  }

  return data.signed_url;
}

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Bridge activo" });
});

app.post("/eleven-agent-chat", async (req, res) => {
  const { text, lead_id, phone } = req.body;

  if (!text) {
    return res.status(400).json({ ok: false, error: "Falta el campo text" });
  }

  let ws;
  let answered = false;
  let finalText = "";

  const safeReply = (status, payload) => {
    if (answered) return;
    answered = true;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {}
    return res.status(status).json(payload);
  };

  const timeout = setTimeout(() => {
    safeReply(504, {
      ok: false,
      error: "Timeout esperando respuesta del agente",
      partial_text: finalText || "",
    });
  }, 20000);

  try {
    const signedUrl = await getSignedUrl();
    ws = new WebSocket(signedUrl);

    ws.on("open", () => {
      try {
        ws.send(
          JSON.stringify({
            type: "user_message",
            text,
            metadata: {
              lead_id: lead_id || null,
              phone: phone || null,
            },
          })
        );
      } catch (err) {
        clearTimeout(timeout);
        safeReply(500, { ok: false, error: `Error enviando mensaje: ${err.message}` });
      }
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        console.log("WS EVENT:", msg);

        if (msg.type === "agent_response" && msg.text) {
          finalText += msg.text;
        }

        if (msg.type === "audio" && msg.text) {
          finalText += msg.text;
        }

        if (
          msg.type === "conversation_end" ||
          msg.type === "conversation_ended" ||
          msg.isFinal === true
        ) {
          clearTimeout(timeout);
          return safeReply(200, {
            ok: true,
            text: finalText || "Sin respuesta del agente",
          });
        }
      } catch (err) {
        console.error("Error parsing WS message:", err.message);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      return safeReply(500, {
        ok: false,
        error: `WebSocket error: ${err.message}`,
        partial_text: finalText || "",
      });
    });

    ws.on("close", () => {
      if (!answered) {
        clearTimeout(timeout);
        return safeReply(200, {
          ok: true,
          text: finalText || "Sin respuesta del agente",
        });
      }
    });
  } catch (err) {
    clearTimeout(timeout);
    return safeReply(500, {
      ok: false,
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Bridge corriendo en puerto ${PORT}`);
});
