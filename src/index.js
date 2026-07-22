import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import channelsRouter from "./routes/channels.js";
import messagesRouter from "./routes/messages.js";
import dmRouter from "./routes/dm.js";
import profilesRouter from "./routes/profiles.js";
import uploadRouter from "./routes/upload.js";
import searchRouter from "./routes/search.js";
import notificationsRouter from "./routes/notifications.js";
dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/channels", channelsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/dm", dmRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/search", searchRouter);
app.use("/api/notifications", notificationsRouter);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});