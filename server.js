// server.js (ESM)
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
  perMessageDeflate: false,
  pingInterval: 25000,
  pingTimeout: 60000,
  connectTimeout: 60000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// Healthcheck (für Render)
app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

// Statische Dateien
app.use(express.static("public"));

// --- Spielzustand ---
const sessions = Object.create(null);

// Spieler erst nach Schonfrist wirklich entfernen (mobile Stabilität)
const DISCONNECT_GRACE_MS = 120000;
const pendingRemoval = new Map(); // key: `${pin}:${playerId}` -> timeoutId

io.on("connection", (socket) => {
  socket.data.pin = null;
  socket.data.playerId = null;

  socket.on("join", ({ pin, name, team, isHost, clientId }) => {
    if (!pin || !name || !team) return;
    const p = String(pin);

    const playerId =
      (clientId && String(clientId)) ||
      socket.data.playerId ||
      Math.random().toString(36).slice(2);

    if (!sessions[p]) {
      sessions[p] = {
        status: "lobby",
        gridSize: 50,
        cooldownSec: 5,
        createdAt: Date.now(),
        grid: {},
        players: {},
        hostId: null, // genau 1 Host pro Lobby
      };
    }
    const s = sessions[p];

    // Host-Regel
    if (isHost) {
      if (s.hostId && s.hostId !== playerId) {
        socket.emit("hostDenied", "In dieser Lobby gibt es bereits einen Host.");
        isHost = false;
      } else {
        s.hostId = playerId;
      }
    }

    s.players[playerId] = { name, team, isHost: s.hostId === playerId, updatedAt: Date.now() };

    if (socket.data.pin && socket.data.pin !== p) socket.leave(socket.data.pin);
    socket.join(p);
    socket.data.pin = p;
    socket.data.playerId = playerId;

    const rmKey = `${p}:${playerId}`;
    const t = pendingRemoval.get(rmKey);
    if (t) {
      clearTimeout(t);
      pendingRemoval.delete(rmKey);
    }

    socket.emit("snapshot", snapshot(p));
    io.to(p).emit("players", s.players);
  });

  // --- Host-only Aktionen ---
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
        players: {},
        hostId: null,
      };
    }
    const s = sessions[p];
    if (s.hostId && socket.data.playerId !== s.hostId) {
      socket.emit("hostRequired", "Nur der Host darf die Session ändern.");
      return;
    }
    s.gridSize = Math.max(10, Math.min(150, Number(gridSize) || 50));
    s.cooldownSec = Math.max(1, Math.min(30, Number(cooldownSec) || 5));
    s.status = "lobby";
    io.to(p).emit("meta", meta(p));
  });

  socket.on("start", ({ pin, roundMin }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    if (!s.hostId || socket.data.playerId !== s.hostId) {
      socket.emit("hostRequired", "Nur der Host darf das Spiel starten.");
      return;
    }
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
    if (!s.hostId || socket.data.playerId !== s.hostId) {
      socket.emit("hostRequired", "Nur der Host darf das Spiel stoppen.");
      return;
    }
    s.status = "ended";
    s.endsAt = Date.now();
    io.to(p).emit("meta", meta(p));
  });

  socket.on("resetGrid", ({ pin }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    if (!s.hostId || socket.data.playerId !== s.hostId) {
      socket.emit("hostRequired", "Nur der Host darf das Grid zurücksetzen.");
      return;
    }
    s.grid = {};
    io.to(p).emit("gridReset");
  });

  // --- Radierer: nur Host ---
  socket.on("eraseArea", ({ pin, cx, cy, size }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s) return;
    if (!s.hostId || socket.data.playerId !== s.hostId) {
      socket.emit("hostRequired", "Nur der Host darf den Radierer benutzen.");
      return;
    }
    const n = Math.max(1, Math.min(150, Number(size) || 1));
    const half = Math.floor(n / 2);
    const keys = [];
    const limit = Number(s.gridSize) || 50;

    for (let y = cy - half; y < cy - half + n; y++) {
      for (let x = cx - half; x < cx - half + n; x++) {
        if (x < 0 || y < 0 || x >= limit || y >= limit) continue;
        const k = `${x}_${y}`;
        if (s.grid[k]) {
          delete s.grid[k];     // Zelle wirklich entfernen (weiß wird Hintergrund)
          keys.push(k);
        }
      }
    }
    if (keys.length > 0) {
      io.to(p).emit("erase", { keys });
    }
  });

  // --- Platzieren von Pixeln ---
  socket.on("placePixel", ({ pin, x, y, color, team }) => {
    if (!pin) return;
    const p = String(pin);
    const s = sessions[p];
    if (!s || s.status !== "running") return;
    if (socket.data.pin !== p) return;

    const size = Number(s.gridSize) || 50;
    if (x < 0 || y < 0 || x >= size || y >= size) return;

    const key = `${x}_${y}`;
    s.grid[key] = { color, team, updatedAt: Date.now() };
    io.to(p).emit("pixel", { key, cell: s.grid[key] });
  });

  socket.on("disconnect", () => {
    const p = socket.data.pin;
    const playerId = socket.data.playerId;
    if (!p || !playerId) return;
    const s = sessions[p];
    if (!s) return;

    const rmKey = `${p}:${playerId}`;
    if (pendingRemoval.has(rmKey)) return;

    const timeoutId = setTimeout(() => {
      const sess = sessions[p];
      if (!sess) return;

      if (sess.hostId === playerId) {
        sess.hostId = null; // Host-Platz wird frei
      }
      delete sess.players[playerId];
      pendingRemoval.delete(rmKey);
      io.to(p).emit("players", sess.players);
    }, DISCONNECT_GRACE_MS);

    pendingRemoval.set(rmKey, timeoutId);
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
    endsAt: s.endsAt || null,
  };
}

function snapshot(pin) {
  const s = sessions[pin];
  if (!s) return null;
  return {
    meta: meta(pin),
    grid: s.grid,
    players: s.players || {},
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Canvas Wars server listening on port ${PORT}`);
});
