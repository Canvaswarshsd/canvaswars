// server.js (ESM)
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

// --- Socket.IO robuster konfigurieren ---
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Reine WebSocket-Transporte funktionieren auf Render gut.
  // (Wenn du irgendwo hinter Proxies Probleme hast, kannst du "polling" ergänzen.)
  transports: ["websocket"],

  // Performance & Stabilität
  perMessageDeflate: false,

  // WICHTIG: Großzügigere Toleranzen für Mobile (Scroll/Tab-Wechsel/Adressleiste)
  pingInterval: 25000,          // Standard: 25s Ping
  pingTimeout: 60000,           // 60s Toleranz statt 20s
  connectTimeout: 60000,        // 60s Verbindungsaufbau-Toleranz

  // Automatische Verbindungs-Wiederherstellung (Socket.IO v4)
  connectionStateRecovery: {
    // Zeitfenster, in dem ein Client „nahtlos“ wieder andocken darf
    maxDisconnectionDuration: 2 * 60 * 1000,
    // beschleunigt Recovery, da wir keine Middlewares nutzen
    skipMiddlewares: true
  }
});

// Healthcheck (für Render)
app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

// Statische Dateien (Frontend)
app.use(express.static("public"));

// --- Spielzustand ---
const sessions = Object.create(null);

io.on("connection", (socket) => {
  let joinedPin = null;
  let playerId = null;

  socket.on("join", ({ pin, name, team }) => {
    if (!pin || !name || !team) return;
    joinedPin = String(pin);
    playerId = playerId || Math.random().toString(36).slice(2);

    if (!sessions[joinedPin]) {
      sessions[joinedPin] = {
        status: "lobby",
        gridSize: 50,
        cooldownSec: 5,
        createdAt: Date.now(),
        grid: {},
        players: {}
      };
    }
    sessions[joinedPin].players[playerId] = { name, team };

    socket.join(joinedPin);
    socket.emit("snapshot", snapshot(joinedPin));
    io.to(joinedPin).emit("players", sessions[joinedPin].players);
  });

  socket.on("createSession", ({ pin, gridSize, cooldownSec }) => {
    if (!pin) return;
    const p = String(pin);
    if (!sessions[p]) {
      sessions[p] = {
        status: "lobby",
        gridSize: 50,
        cooldownSec: 5,
        createdAt: Date.now(),
        grid: {},
        players: {}
      };
    }
    sessions[p].gridSize = Math.max(10, Math.min(150, Number(gridSize) || 50));
    sessions[p].cooldownSec = Math.max(1, Math.min(30, Number(cooldownSec) || 5));
    sessions[p].status = "lobby";
    io.to(p).emit("meta", meta(p));
  });

  socket.on("start", ({ pin, roundMin }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    s.status = "running";
    s.startedAt = Date.now();
    s.endsAt = (Number(roundMin) || 0) > 0 ? (Date.now() + Number(roundMin) * 60 * 1000) : null;
    io.to(p).emit("meta", meta(p));
  });

  socket.on("stop", ({ pin }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    s.status = "ended";
    s.endsAt = Date.now();
    io.to(p).emit("meta", meta(p));
  });

  socket.on("resetGrid", ({ pin }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    s.grid = {};
    io.to(p).emit("gridReset");
  });

  socket.on("placePixel", ({ pin, x, y, color, team }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s || s.status !== "running") return;

    const size = Number(s.gridSize) || 50;
    if (x < 0 || y < 0 || x >= size || y >= size) return;

    const key = `${x}_${y}`;
    s.grid[key] = { color, team, updatedAt: Date.now() };
    io.to(p).emit("pixel", { key, cell: s.grid[key] });
  });

  socket.on("disconnect", () => {
    // Bei echter Trennung Spieler austragen:
    if (joinedPin && playerId && sessions[joinedPin]) {
      delete sessions[joinedPin].players[playerId];
      io.to(joinedPin).emit("players", sessions[joinedPin].players);
    }
  });
});

// --- Helper ---
function meta(pin) {
  const s = sessions[pin];
  if (!s) return null;
  return {
    status: s.status,
    gridSize: s.gridSize,
    cooldownSec: s.cooldownSec,
    startedAt: s.startedAt || null,
    endsAt: s.endsAt || null
  };
}

function snapshot(pin) {
  const s = sessions[pin];
  if (!s) return null;
  return {
    meta: meta(pin),
    grid: s.grid,
    players: s.players || {}
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Canvas Wars server listening on port ${PORT}`);
});
