import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "elevenlabs-agent-bridge",
    status: "running"
  });
});

app.post("/eleven-agent-chat", async (req, res) => {
  try {

    console.log("Body recibido:", req.body);

    const { text, lead_id, phone } = req.body || {};

    if (!text) {
      return res.status(400).json({
        error: "text es requerido"
      });
    }

    return res.status(200).json({
      ok: true,
      reply: `Mensaje recibido: ${text}`,
      lead_id: lead_id || null,
      phone: phone || null
    });

  } catch (error) {

    console.error("ERROR:", error);

    return res.status(500).json({
      error: "internal_error",
      message: error.message
    });

  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge activo en puerto ${PORT}`);
});
