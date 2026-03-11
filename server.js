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

app.post("/eleven-agent-chat", (req, res) => {
  const { text } = req.body;

  console.log("Mensaje recibido:", text);

  res.json({
    ok: true,
    reply: `Mensaje recibido: ${text}`
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
