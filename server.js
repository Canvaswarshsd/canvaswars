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
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],        // stabil auf Render; bei Bedarf "polling" ergänzen
  perMessageDeflate: false,

  // WICHTIG: Mobile-Toleranz deutlich erhöhen
  pingInterval: 25000,              // 25s Ping
  pingTimeout: 60000,               // 60s Toleranz (vorher 20s)
  connectTimeout: 60000,            // 60s Verbindungsaufbau

  // Auto-Recovery (Socket.IO v4)
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 Minuten
    skipMiddlewares: true,
  },
});

// Healthcheck (für Render)
app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

// Statische Dateien (Frontend)
app.use(express.static("public"));

// --- Spielzustand ---
const sessions = Object.create(null);

// Optional: Schonfrist beim Disconnect, damit Mobile-User nicht sofort „rausfliegen“
const DISCONNECT_GRACE_MS = 120000; // 2 Minuten
const pendingRemoval = new Map();   // key: `${pin}:${playerId}` -> timeoutId

io.on("connection", (socket) => {
  // Wir speichern Pin & Player auf dem Socket (für sichere Prüfungen)
  socket.data.pin = null;
  socket.data.playerId = null;

  socket.on("join", ({ pin, name, team, clientId }) => {
    if (!pin || !name || !team) return;

    const p = String(pin);
    // stabiler PlayerId: clientId vom Client bevorzugen, sonst neu erzeugen
    const playerId = (clientId && String(clientId)) || socket.data.playerId || Math.random().toString(36).slice(2);

    // Session anlegen, falls sie nicht existiert
    if (!sessions[p]) {
      sessions[p] = {
        status: "lobby",
        gridSize: 50,
        cooldownSec: 5,
        createdAt: Date.now(),
        grid: {},
        players: {},
      };
    }

    // Spieler registrieren/aktualisieren
    sessions[p].players[playerId] = { name, team, updatedAt: Date.now() };

    // Socket dem Raum zuordnen & Metadaten merken
    if (socket.data.pin && socket.data.pin !== p) {
      socket.leave(socket.data.pin);
    }
    socket.join(p);
    socket.data.pin = p;
    socket.data.playerId = playerId;

    // Falls für diesen Spieler eine „geplante Entfernung“ existiert: abbrechen
    const rmKey = `${p}:${playerId}`;
    const t = pendingRemoval.get(rmKey);
    if (t) {
      clearTimeout(t);
      pendingRemoval.delete(rmKey);
    }

    // Snapshot an den Spieler + Spielerliste an alle
    socket.emit("snapshot", snapshot(p));
    io.to(p).emit("players", sessions[p].players);
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
        players: {},
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

    // Sicherheitscheck: Nur der eigene Raum darf beschrieben werden
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

    // NICHT sofort entfernen: erst nach Schonfrist, falls kein Rejoin kommt
    const rmKey = `${p}:${playerId}`;
    if (pendingRemoval.has(rmKey)) return; // schon geplant

    const timeoutId = setTimeout(() => {
      const sess = sessions[p];
      if (!sess) return;
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
