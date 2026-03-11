import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Bridge activo"
  });
});

app.post("/eleven-agent-chat", async (req, res) => {
  try {
    console.log("POST recibido:", req.body);

    const { text, lead_id, phone } = req.body;

    return res.json({
      ok: true,
      received: true,
      text: text || null,
      lead_id: lead_id || null,
      phone: phone || null,
      reply: `Mensaje recibido: ${text || ""}`
    });
  } catch (error) {
    console.error("ERROR EN /eleven-agent-chat:", error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge corriendo en puerto ${PORT}`);
});
