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

console.log("Starting server...");
console.log("PORT:", process.env.PORT || 5000);
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "Set" : "Missing");
console.log("CLIENT_URL:", process.env.CLIENT_URL || "Not set");

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  console.log("Health check called");
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      supabase: process.env.SUPABASE_URL ? "Set" : "Missing",
      port: process.env.PORT || 5000
    }
  });
});

// Routes
console.log("Registering routes...");
app.use("/api/channels", channelsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/dm", dmRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/search", searchRouter);
app.use("/api/notifications", notificationsRouter);
console.log("Routes registered");

// Error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});