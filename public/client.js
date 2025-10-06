// ===== Canvas Wars – Client (für lokal & online) =====

// --- Socket verbinden ---
const socket = io({ transports: ["websocket"] });

const $ = (id) => document.getElementById(id);

// UI refs
const conn = $('conn');
const hostPanel = $('hostPanel');
const sessionLbl = $('session');
const statusLbl = $('status');
const timerLbl = $('timer');
const colorsDiv = $('colors');
const cooldownLabel = $('cooldownLabel');
const overlay = $('overlay');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false; // scharfe Pixel

// === stabile Geräte-ID (für Host-Wiedererkennung) ===
const CLIENT_ID = (() => {
  let id = localStorage.getItem('clientId');
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2);
    localStorage.setItem('clientId', id);
  }
  return id;
})();

// --- Sichtbarkeit des Gitters steuern ---
const SHOW_GRID = false; // false = Gitter unsichtbar

// --- Moderations-UI ---
const btnEraser = $('btnEraser');
const eraseSizeInput = $('eraseSize');

// --- Lokaler Grid-Cache: sorgt dafür, dass wir nach Resize alles neu malen können ---
let localGrid = Object.create(null);

// Overlay helpers
function showOverlay(text) {
  overlay.textContent = text || '';
  overlay.style.display = 'flex';
  overlay.style.pointerEvents = 'auto';
}
function hideOverlay() {
  overlay.style.display = 'none';
  overlay.style.pointerEvents = 'none';
}

// State
let state = {
  pin: '',
  name: '',
  team: 'A',
  isHost: false,
  gridSize: 50,
  cooldownSec: 5,
  endsAt: null,
  color: '#000000',
  cellSize: 16,
  lastPlaceAt: 0,
  joined: false,
  status: 'lobby',
  eraserOn: false,
  eraseSize: 3
};

const PALETTE = [
  '#000000','#d32f2f','#1976d2','#388e3c',
  '#fbc02d','#7b1fa2','#5d4037','#455a64','#ffffff'
];

// Palette + Moderation UI
function buildPalette() {
  colorsDiv.innerHTML = '';
  PALETTE.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'color';
    btn.type = 'button';
    btn.style.background = c;
    btn.addEventListener('click', () => {
      state.color = c;
      [...colorsDiv.children].forEach(el => el.classList.remove('sel'));
      btn.classList.add('sel');
    });
    colorsDiv.appendChild(btn);
  });
  if (colorsDiv.firstChild) {
    colorsDiv.firstChild.classList.add('sel');
    state.color = PALETTE[0];
  }
  cooldownLabel.style.userSelect = 'none';

  if (btnEraser) {
    btnEraser.addEventListener('click', () => {
      if (!state.isHost) { alert('Nur Host darf den Radierer benutzen.'); return; }
      state.eraserOn = !state.eraserOn;
      btnEraser.textContent = state.eraserOn ? 'Eraser: ON' : 'Eraser: OFF';
    });
  }
  if (eraseSizeInput) {
    eraseSizeInput.addEventListener('change', () => {
      const v = Math.max(1, Math.min(50, Number(eraseSizeInput.value) || 1));
      state.eraseSize = v;
      eraseSizeInput.value = String(v);
    });
  }
}

// Canvas dimensionieren
function computeCellSize() {
  const rect = canvas.getBoundingClientRect();
  const pxPerCell = Math.max(1, Math.floor(rect.width / state.gridSize));
  state.cellSize = pxPerCell;

  const targetW = state.gridSize * pxPerCell;
  const targetH = state.gridSize * pxPerCell;

  canvas.style.width = targetW + 'px';
  canvas.style.height = targetH + 'px';

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(targetW * dpr);
  canvas.height = Math.round(targetH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGridLines() {
  const { gridSize, cellSize } = state;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Hintergrund
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,gridSize*cellSize,gridSize*cellSize);

  if (!SHOW_GRID) return;

  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i=0;i<=gridSize;i++) {
    const p = i*cellSize + 0.5;
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(gridSize*cellSize, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, gridSize*cellSize); ctx.stroke();
  }
}

// Nur zeichnen (nicht speichern) – Zelle voll ausfüllen
function paintCell(x,y,color) {
  const s = state.cellSize;
  ctx.fillStyle = color;
  ctx.fillRect(x*s, y*s, s, s);
}

// Zeichnen + im lokalen Cache speichern
function setCellLocal(x, y, color) {
  localGrid[`${x}_${y}`] = color;
  paintCell(x, y, color);
}

// Lokales Löschen eines Bereichs (weiß)
function eraseLocal(cx, cy, size) {
  const n = Math.max(1, Math.floor(size));
  const half = Math.floor(n / 2);
  for (let y = cy - half; y < cy - half + n; y++) {
    for (let x = cx - half; x < cx - half + n; x++) {
      if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) continue;
      delete localGrid[`${x}_${y}`];
      paintCell(x, y, '#ffffff');
    }
  }
}

function canvasXY(evt) {
  const rect = canvas.getBoundingClientRect();
  const pxPerCell = rect.width / state.gridSize;
  const x = Math.floor((evt.clientX - rect.left) / pxPerCell);
  const y = Math.floor((evt.clientY - rect.top) / pxPerCell);
  return { x, y };
}

// Alle Zellen aus dem lokalen Cache neu malen
function drawAllCellsFromCache() {
  for (const key in localGrid) {
    const [xs, ys] = key.split('_');
    const x = parseInt(xs, 10);
    const y = parseInt(ys, 10);
    const color = localGrid[key];
    paintCell(x, y, color);
  }
}

// Cooldown & Timer
function setCooldownLabel() {
  const now = Date.now();
  const left = state.lastPlaceAt ? Math.max(0, state.cooldownSec*1000 - (now - state.lastPlaceAt)) : 0;
  cooldownLabel.textContent = left > 0 ? ('Cooldown: ' + Math.ceil(left/1000) + 's') : 'Cooldown: ready';
}

function tick() {
  setCooldownLabel();
  if (state.endsAt) {
    const left = Math.max(0, state.endsAt - Date.now());
    timerLbl.textContent = left ? Math.ceil(left/1000) + 's' : '—';
    if (left <= 0) showOverlay('Time up!'); else hideOverlay();
  } else {
    timerLbl.textContent = '—';
    hideOverlay();
  }
  requestAnimationFrame(tick);
}

// Join / Host
function join() {
  const pin = $('pin').value.trim();
  const name = $('name').value.trim();
  const team = $('team').value;
  const isHost = $('isHost').checked;
  if (!pin || !name) { alert('Enter PIN and name.'); return; }
  state.pin = pin;
  state.name = name;
  state.team = team;
  state.isHost = isHost;
  hostPanel.hidden = !isHost;
  if (btnEraser) btnEraser.disabled = !isHost;
  sessionLbl.textContent = pin;
  socket.emit('join', { pin, name, team, isHost, clientId: CLIENT_ID });
}

function createSession() {
  socket.emit('createSession', {
    pin: state.pin,
    gridSize: Number($('gridSize').value || '50'),
    cooldownSec: Number($('cooldown').value || '5')
  });
}
function startSession() {
  socket.emit('start', {
    pin: state.pin,
    roundMin: Number($('roundMin').value || '0')
  });
}
function stopSession() { socket.emit('stop', { pin: state.pin }); }
function resetGrid() { socket.emit('resetGrid', { pin: state.pin }); }

// Click handler
canvas.addEventListener('click', (evt) => {
  if (!state.joined) { alert('Join first'); return; }
  if (state.status !== 'running') return;

  const { x, y } = canvasXY(evt);

  if (state.eraserOn && state.isHost) {
    eraseLocal(x, y, state.eraseSize);
    socket.emit('eraseArea', { pin: state.pin, cx: x, cy: y, size: state.eraseSize });
    return;
  }

  const now = Date.now();
  if (state.lastPlaceAt && now - state.lastPlaceAt < state.cooldownSec*1000) return;
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return;

  state.lastPlaceAt = now;
  setCellLocal(x, y, state.color);
  socket.emit('placePixel', {
    pin: state.pin, x, y, color: state.color, team: state.team
  });
});

// Buttons
$('btnJoin').addEventListener('click', join);
$('btnCreate').addEventListener('click', createSession);
$('btnStart').addEventListener('click', startSession);
$('btnStop').addEventListener('click', stopSession);
$('btnReset').addEventListener('click', resetGrid);

$('btnExport').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `canvaswars_${state.pin}.png`;
  a.click();
});

// Socket handlers
socket.on('connect', () => {
  conn.textContent = 'OK';
  // Auto-Rejoin (mit derselben clientId)
  if (state.pin && state.name) {
    socket.emit('join', {
      pin: state.pin,
      name: state.name,
      team: state.team,
      isHost: state.isHost,
      clientId: CLIENT_ID
    });
  }
});
socket.on('disconnect', () => { conn.textContent = '—'; });

// Host-Rückmeldungen
socket.on('hostDenied', (msg) => {
  state.isHost = false;
  const isHostChk = document.getElementById('isHost');
  if (isHostChk) isHostChk.checked = false;
  if (hostPanel) hostPanel.hidden = true;
  if (btnEraser) {
    btnEraser.disabled = true;
    state.eraserOn = false;
    btnEraser.textContent = 'Eraser: OFF';
  }
  alert(msg || 'In dieser Lobby gibt es bereits einen Host.');
});
socket.on('hostRequired', (msg) => {
  alert(msg || 'Nur der Host darf diese Aktion ausführen.');
});
socket.on('hostGranted', () => {
  state.isHost = true;
  if (hostPanel) hostPanel.hidden = false;
  if (btnEraser) btnEraser.disabled = false;
});

socket.on('snapshot', (data = {}) => {
  const { meta, grid } = data;
  applyMeta(meta);

  // Cache neu aus Snapshot
  localGrid = Object.create(null);
  if (grid) {
    for (const key in grid) {
      const cell = grid[key];
      localGrid[key] = cell.color;
    }
  }

  computeCellSize();
  drawGridLines();
  drawAllCellsFromCache();

  state.joined = true;
});

socket.on('meta', (meta) => { applyMeta(meta); });

// Bei Grid-Reset: Cache leeren + neu zeichnen
socket.on('gridReset', () => {
  localGrid = Object.create(null);
  drawGridLines();
});

// Pixel & Erase vom Server
socket.on('pixel', ({ key, cell }) => {
  const [xStr,yStr] = key.split('_');
  const x = parseInt(xStr,10);
  const y = parseInt(yStr,10);
  localGrid[key] = cell.color;
  paintCell(x, y, cell.color);
});
socket.on('erase', ({ keys = [] }) => {
  for (const k of keys) {
    const [xs, ys] = k.split('_');
    const x = parseInt(xs, 10);
    const y = parseInt(ys, 10);
    delete localGrid[k];
    paintCell(x, y, '#ffffff');
  }
});

// Meta anwenden
function applyMeta(meta) {
  if (!meta) return;
  if (meta.gridSize && meta.gridSize !== state.gridSize) {
    state.gridSize = meta.gridSize;
    localGrid = Object.create(null); // Cache invalid
    computeCellSize();
    drawGridLines();
  }
  if (typeof meta.cooldownSec === 'number') state.cooldownSec = meta.cooldownSec;
  state.endsAt = meta.endsAt || null;
  state.status = meta.status || 'lobby';
  statusLbl.textContent = state.status;
  if (state.status === 'running') hideOverlay();
  if (state.status === 'ended')   showOverlay('Time up!');
}

// init
buildPalette();
computeCellSize();
drawGridLines();
hideOverlay();
requestAnimationFrame(tick);

// --- Mobile-friendly resize: Debounce + Mini-Resizes ignorieren ---
(() => {
  let resizeTimer = null;
  let lastH = window.innerHeight;
  let lastW = window.innerWidth;

  function applyResize() {
    computeCellSize();
    drawGridLines();
    drawAllCellsFromCache();
    lastH = window.innerHeight;
    lastW = window.innerWidth;
  }

  window.addEventListener('resize', () => {
    const dh = Math.abs(window.innerHeight - lastH);
    const dw = Math.abs(window.innerWidth  - lastW);
    if (dh < 80 && dw < 30) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyResize, 200);
  }, { passive: true });
})();

// Optional: Beim Tab-Wechsel zurück -> sicherheitshalber neu malen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    drawGridLines();
    drawAllCellsFromCache();
  }
});

// Debug
window.placePixelLocal = setCellLocal;
