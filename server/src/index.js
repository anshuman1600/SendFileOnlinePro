import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "url";
import shareRoutes from "./routes/shares.js";
import authRoutes from "./routes/auth.js";
import { setUseMemoryStore } from "./store/shareStore.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/p2p/ice", (_req, res) => {
  const iceServers = [];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  iceServers.push({ urls: "stun:stun.l.google.com:19302" });
  res.json({ iceServers });
});

app.use("/api/auth", authRoutes);

app.use("/api/shares", shareRoutes);

const connectMongo = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    setUseMemoryStore(true);
    console.warn("MONGO_URI not set. Using in-memory store.");
    return;
  }

  try {
    await mongoose.connect(uri);
    setUseMemoryStore(false);
    console.log("MongoDB connected.");
  } catch (error) {
    setUseMemoryStore(true);
    console.warn("MongoDB connection failed. Using in-memory store.");
    console.error(error.message);
  }
};

const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.on("p2p:create", ({ sessionId }) => {
    socket.join(sessionId);
    socket.emit("p2p:created", { sessionId });
  });

  socket.on("p2p:join", ({ sessionId }) => {
    socket.join(sessionId);
    socket.to(sessionId).emit("p2p:peer-joined", { id: socket.id });
  });

  socket.on("p2p:signal", ({ sessionId, data }) => {
    socket.to(sessionId).emit("p2p:signal", { from: socket.id, data });
  });
});

connectMongo().finally(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
