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
  status: 'lobby'
};

const PALETTE = [
  '#000000','#d32f2f','#1976d2','#388e3c',
  '#fbc02d','#7b1fa2','#5d4037','#455a64','#ffffff'
];

// Palette
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
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,gridSize*cellSize,gridSize*cellSize);
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  for (let i=0;i<=gridSize;i++) {
    const p = i*cellSize + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(gridSize*cellSize, p);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, gridSize*cellSize);
    ctx.stroke();
  }
}

function placePixelLocal(x,y,color) {
  const s = state.cellSize;
  ctx.fillStyle = color;
  ctx.fillRect(x*s+1, y*s+1, s-1, s-1);
}

function canvasXY(evt) {
  const rect = canvas.getBoundingClientRect();
  const pxPerCell = rect.width / state.gridSize;
  const x = Math.floor((evt.clientX - rect.left) / pxPerCell);
  const y = Math.floor((evt.clientY - rect.top) / pxPerCell);
  return { x, y };
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
  sessionLbl.textContent = pin;
  socket.emit('join', { pin, name, team, isHost });
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
  const now = Date.now();
  if (state.lastPlaceAt && now - state.lastPlaceAt < state.cooldownSec*1000) return;

  const { x, y } = canvasXY(evt);
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return;

  state.lastPlaceAt = now;
  placePixelLocal(x,y,state.color);
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
  // WICHTIG: nach jeder (Neu-)Verbindung automatisch wieder joinen
  if (state.pin && state.name) {
    socket.emit('join', {
      pin: state.pin,
      name: state.name,
      team: state.team,
      isHost: state.isHost
    });
  }
});

socket.on('disconnect', () => { conn.textContent = '—'; });

socket.on('snapshot', (data = {}) => {
  const { meta, grid } = data;
  applyMeta(meta);
  computeCellSize();
  drawGridLines();
  if (grid) {
    for (const key in grid) {
      const [xStr,yStr] = key.split('_');
      const cell = grid[key];
      placePixelLocal(parseInt(xStr,10), parseInt(yStr,10), cell.color);
    }
  }
  state.joined = true;
});

socket.on('meta', (meta) => { applyMeta(meta); });
socket.on('gridReset', () => { drawGridLines(); });
socket.on('pixel', ({ key, cell }) => {
  const [xStr,yStr] = key.split('_');
  placePixelLocal(parseInt(xStr,10), parseInt(yStr,10), cell.color);
});

// Meta anwenden
function applyMeta(meta) {
  if (!meta) return;
  if (meta.gridSize && meta.gridSize !== state.gridSize) {
    state.gridSize = meta.gridSize;
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
    lastH = window.innerHeight;
    lastW = window.innerWidth;
  }

  window.addEventListener('resize', () => {
    const dh = Math.abs(window.innerHeight - lastH);
    const dw = Math.abs(window.innerWidth  - lastW);

    // Mini-Resizes (Adressleiste ein/aus) ignorieren
    if (dh < 80 && dw < 30) return;

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyResize, 200);
  }, { passive: true });
})();

// Debug
window.placePixelLocal = placePixelLocal;
