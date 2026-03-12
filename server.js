import express from "express";
import WebSocket from "ws";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const XI_API_KEY = process.env.XI_API_KEY;
const AGENT_ID = process.env.AGENT_ID;

async function getSignedUrl() {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT_ID)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "xi-api-key": XI_API_KEY,
      Accept: "application/json",
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Error obteniendo signed_url: ${response.status} ${raw}`);
  }

  const data = JSON.parse(raw);

  if (!data.signed_url) {
    throw new Error(`No vino signed_url: ${raw}`);
  }

  return data.signed_url;
}

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "elevenlabs-agent-bridge",
    status: "running",
  });
});

app.post("/eleven-agent-chat", async (req, res) => {
  const { text, lead_id = null, phone = null } = req.body || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({
      ok: false,
      error: "El campo text es requerido",
    });
  }

  let ws;
  let replied = false;
  let finalText = "";
  let rawEvents = [];
  let initDone = false;

  const safeReply = (status, payload) => {
    if (replied) return;
    replied = true;

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {}

    return res.status(status).json(payload);
  };

  const timeout = setTimeout(() => {
    safeReply(504, {
      ok: false,
      error: "Timeout esperando respuesta del agente",
      partial_text: finalText || "",
      events_seen: rawEvents.slice(-20),
    });
  }, 25000);

  try {
    const signedUrl = await getSignedUrl();
    ws = new WebSocket(signedUrl);

    ws.on("open", () => {
      console.log("WS abierto");

      const initPayload = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: {
            text_only: true,
          },
        },
        custom_llm_extra_body: {
          lead_id,
          phone,
        },
      };

      console.log("Enviando init:", JSON.stringify(initPayload));
      ws.send(JSON.stringify(initPayload));
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      rawEvents.push(raw);
      console.log("WS raw:", raw);

      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      // Responder pong a cada ping
      if (event.type === "ping" && event.ping_event?.event_id) {
        const pong = {
          type: "pong",
          event_id: event.ping_event.event_id,
        };
        console.log("Enviando pong:", pong);
        ws.send(JSON.stringify(pong));
        return;
      }

      // Cuando llegue metadata de inicio, mandar el texto del usuario
      if (
        !initDone &&
        (
          event.type === "conversation_initiation_metadata" ||
          event.conversation_initiation_metadata
        )
      ) {
        initDone = true;

        const userMessage = {
          type: "user_message",
          text: text,
        };

        console.log("Enviando user_message:", JSON.stringify(userMessage));
        ws.send(JSON.stringify(userMessage));
        return;
      }

      // Capturar respuesta del agente
      if (event.type === "agent_response") {
        const piece =
          event.agent_response_event?.agent_response ||
          event.agent_response ||
          event.text ||
          "";

        if (piece) {
          finalText += piece;
        }

        // En chat mode, si ya llegó texto útil, devolvemos
        if (finalText.trim()) {
          clearTimeout(timeout);
          return safeReply(200, {
            ok: true,
            reply: finalText.trim(),
            text: finalText.trim(),
            lead_id,
            phone,
            debug_last_event: event,
          });
        }
      }

      // Algunas implementaciones mandan transcript o otros eventos intermedios
      if (event.type === "user_transcript" || event.type === "agent_response_correction") {
        return;
      }
    });

    ws.on("error", (error) => {
      console.error("WS error:", error);
      clearTimeout(timeout);
      return safeReply(500, {
        ok: false,
        error: `WebSocket error: ${error.message}`,
        events_seen: rawEvents.slice(-20),
      });
    });

    ws.on("close", (code, reason) => {
      console.log("WS close:", code, reason?.toString?.() || "");

      if (!replied) {
        clearTimeout(timeout);
        return safeReply(200, {
          ok: true,
          reply: finalText || "",
          text: finalText || "",
          lead_id,
          phone,
          close_code: code,
          close_reason: reason?.toString?.() || "",
          events_seen: rawEvents.slice(-20),
        });
      }
    });
  } catch (error) {
    clearTimeout(timeout);
    return safeReply(500, {
      ok: false,
      error: error.message,
      events_seen: rawEvents.slice(-20),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge activo en puerto ${PORT}`);
});
