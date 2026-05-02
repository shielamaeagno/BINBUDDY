import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import apiRoutes from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..", "..");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.use("/api", apiRoutes);

app.use(express.static(rootDir, { index: "index.html", extensions: ["html"] }));

app.get("*", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`BinBuddy API + static app at http://localhost:${PORT}`);
});
