import express from "express";
import WebSocket from "ws";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const XI_API_KEY = process.env.XI_API_KEY;
const AGENT_ID = process.env.AGENT_ID;

if (!XI_API_KEY || !AGENT_ID) {
  console.error("Faltan variables XI_API_KEY o AGENT_ID");
}

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

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Respuesta inválida al obtener signed_url: ${raw}`);
  }

  if (!data.signed_url) {
    throw new Error(`No vino signed_url en la respuesta: ${raw}`);
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
    console.error("Timeout esperando respuesta del agente");
    safeReply(504, {
      ok: false,
      error: "Timeout esperando respuesta del agente",
      partial_text: finalText || "",
      events_seen: rawEvents.slice(-10),
    });
  }, 20000);

  try {
    const signedUrl = await getSignedUrl();
    console.log("signed_url obtenida");

    ws = new WebSocket(signedUrl);

    ws.on("open", () => {
      console.log("WebSocket abierto");

      // Este payload puede variar si ElevenLabs cambia eventos;
      // por eso también guardamos eventos crudos para depurar.
      const payload = {
        type: "user_message",
        text: text
      };

      console.log("Enviando al agente:", payload);
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      console.log("WS raw:", raw);

      rawEvents.push(raw);

      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      // Intentamos capturar varias formas posibles de texto
      if (typeof event.text === "string" && event.text.trim()) {
        finalText += `${event.text}`;
      }

      if (typeof event.message === "string" && event.message.trim()) {
        finalText += `${event.message}`;
      }

      if (typeof event.response === "string" && event.response.trim()) {
        finalText += `${event.response}`;
      }

      // Si el evento marca finalización, respondemos
      if (
        event.isFinal === true ||
        event.type === "conversation_end" ||
        event.type === "conversation_ended" ||
        event.type === "agent_response_end"
      ) {
        clearTimeout(timeout);

        return safeReply(200, {
          ok: true,
          text: finalText || "",
          reply: finalText || "",
          lead_id,
          phone,
          debug_last_event: event,
        });
      }

      // Si detectamos algo que parece respuesta útil, devolvemos sin esperar más
      if (
        (event.type === "agent_response" || event.type === "message") &&
        finalText.trim()
      ) {
        clearTimeout(timeout);

        return safeReply(200, {
          ok: true,
          text: finalText.trim(),
          reply: finalText.trim(),
          lead_id,
          phone,
          debug_last_event: event,
        });
      }
    });

    ws.on("error", (error) => {
      console.error("WS error:", error);
      clearTimeout(timeout);

      return safeReply(500, {
        ok: false,
        error: `WebSocket error: ${error.message}`,
        partial_text: finalText || "",
        events_seen: rawEvents.slice(-10),
      });
    });

    ws.on("close", (code, reason) => {
      console.log("WS close:", code, reason?.toString?.() || "");

      if (!replied) {
        clearTimeout(timeout);

        return safeReply(200, {
          ok: true,
          text: finalText || "",
          reply: finalText || "",
          lead_id,
          phone,
          close_code: code,
          close_reason: reason?.toString?.() || "",
          events_seen: rawEvents.slice(-10),
        });
      }
    });
  } catch (error) {
    console.error("Error en /eleven-agent-chat:", error);
    clearTimeout(timeout);

    return safeReply(500, {
      ok: false,
      error: error.message,
      partial_text: finalText || "",
      events_seen: rawEvents.slice(-10),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge activo en puerto ${PORT}`);
});
