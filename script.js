const chartInstances = {};
/**
 * Creates or updates a line chart tracking zone utilization.
 * @param {string} canvasId - e.g. "chart-fixed", "chart-chaos", "chart-hybrid"
 * @param {number} value - the current value (e.g. number of bins filled)
 */
function createOrUpdateChart(canvasId, value) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (!chartInstances[canvasId]) {
    chartInstances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: 'Lagerauslastung',
          data: [],
          backgroundColor: 'rgba(100, 149, 237, 0.3)',
          borderColor: 'rgba(100, 149, 237, 1)',
          borderWidth: 2,
          fill: true,
          tension: 0.2,
          pointRadius: 0
        }]
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 160,
            ticks: {
              stepSize: 20
            }
          },
          x: {
            display: false
          }
        }
      }
    });
  }

  const chart = chartInstances[canvasId];
  chart.data.labels.push('');
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > 30) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update();
}


function toggleBlock(header) {
  const content = header.nextElementSibling;
  const open = content.style.display !== 'none';
  content.style.display = open ? 'none' : 'block';
  header.textContent = header.textContent.replace(open ? '⯆' : '⯈', open ? '⯈' : '⯆');
}


const binIndex = {
  hybrid: new Map(), // taskId -> array of { cell, ts, idx }
  chaos: new Map()
};

/**
 * Fügt einen mehrzeiligen Log-Eintrag für zone „fixed“ hinzu.
 * @param {string[]} lines — die einzelnen Zeilen (ohne Zeitstempel).
 */
function logFixed(lines) {
  const prefix = timestamp() + ' – ';
  // alle Zeilen zusammenfügen, und in logs.fixed pushen
  logs.fixed.push(
    prefix + lines.join(`\n${' '.repeat(prefix.length)}`)
  );
  // und direkt in die UI schreiben
  document.getElementById('log-fixed').textContent = logs.fixed.join('\n');
}
// === Setup & Daten ===
const rows = 10, cols = 10, capacity = 10;
let grid = [], intervalId = null, spawnInterval = 500;
const blue = 'blue';
const yellow = 'yellow';


// ↓↓↓ add these two ↓↓↓
const fixedStatus = new Map();
let fixedCells = [];

// 1) Hartkodierte Items mit ABC-Klassen und Gewichtung
const items = [
  { id: 'HaWa', class: 'A', weight: 10 },
  { id: 'Halbleiter', class: 'B', weight: 3 },
  { id: 'Lichtgitter', class: 'C', weight: 1 },
  { id: 'PNOZ', class: 'A', weight: 6 },
  { id: 'PSENbolt', class: 'B', weight: 2 },
  { id: 'ROH', class: 'C', weight: 3 },
];

// 2) Weighted pool entsprechend ABC (A×10, B×3, C×1)
const weightedPool = [];
items.forEach(it => {
  const mult = it.class === 'A' ? 10 : it.class === 'B' ? 3 : 1;
  for (let i = 0; i < it.weight * mult; i++) {
    weightedPool.push(it);
  }
});

function sampleItems(count) {
  return Array.from({ length: count }, () => sampleItem());
}
function sampleItem() {
  const scored = items.map(it => {
    const mult = it.class === 'A' ? 10 : it.class === 'B' ? 3 : 1;
    const baseWeight = it.weight * mult;
    const factor = 1 + (Math.random() * 0.4 - 0.2);
    return { it, weight: baseWeight * factor };
  });
  const total = scored.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const { it, weight } of scored) {
    if (r < weight) return it;
    r -= weight;
  }
  return scored[scored.length - 1].it;
}
// ── Surveyor ───────────────────────────────────────────────────
let surveyor = null;
/**
 * initSurveyor: Bereitet den Surveyor vor, leert alte Daten und erstellt das DOM-Element.
 */
function initSurveyor() {
  // Alte Elemente und Daten zurücksetzen
  surveyorsEl.innerHTML = '';
  surveyData = { fixed: [], chaos: [], hybrid: [] };
  ['fixed', 'chaos', 'hybrid'].forEach(z => stats[z].surveyShadow = 0);
  document.getElementById('survey-shadow-fixed').textContent = '0';
  document.getElementById('survey-shadow-chaos').textContent = '0';
  document.getElementById('survey-shadow-hybrid').textContent = '0';

  // Surveyor-Dot im DOM anlegen
  const el = document.createElement('div');
  el.id = 'surveyor';
  el.className = 'surveyor';
  surveyorsEl.appendChild(el);

  // Weg rund um die Festplatz-Zone definieren
  const path = [];
  for (let x = 0; x < cols; x++)           path.push({ x, y: 0 });
  for (let y = 1; y <= 2; y++)             path.push({ x: cols - 1, y });
  for (let x = cols - 1; x >= 0; x--)      path.push({ x, y: 3 });
  for (let y = 2; y >= 1; y--)             path.push({ x: 0, y });

  surveyor = { path, idx: 0, checking: false, checkTicks: 0, buffer: [] };
}
/**
 * stepSurveyor: Geht den definierten Weg ab, merkt sich bei jedem Regalplatz-Fach alle Bins,
 * die falsch befüllt sind, und pusht jeweils eine Entry pro Bin erst nach Abschluss des Rundgangs.
 */
function stepSurveyor() {
  if (!surveyor) return;

  // Reset + begin new lap
  if (surveyor.idx === 0 && !surveyor.checking) {
    surveyor.buffer = [];
    surveyData.fixed = [];
    fixedCells.forEach(c => c.shadowReservations = 0);
    console.debug('[Surveyor] new lap started, old shadowReservations cleared');
  }

  // Delay check
  if (!surveyor.checking) {
    surveyor.checking = true;
    surveyor.checkTicks = 0;
    return;
  }
  if (++surveyor.checkTicks < 2) return;

  // Check adjacent fixed shelves
  const roadPos = surveyor.path[surveyor.idx];
  const neighbors = grid.filter(c =>
    c.type === 'zone-fixed' &&
    Math.abs(c.x - roadPos.x) + Math.abs(c.y - roadPos.y) === 1 &&
    c.bins > 0
  );

  for (const cell of neighbors) {
    cell.contents.forEach((bin) => {
      if (typeof bin === 'object' && bin.id !== cell.fixedItem) {
        const alreadyIn = surveyor.buffer.some(e => e.cell === cell && e.bin === bin);
        if (!alreadyIn) {
          surveyor.buffer.push({ cell, bin });
          console.debug(`[Surveyor] ⏺️ shadow bin ${bin.id} @(${cell.x},${cell.y})`);
        }
      }
    });
  }

  // Step forward
  surveyor.checking = false;
  surveyor.idx = (surveyor.idx + 1) % surveyor.path.length;

  // After full lap → flush
  if (surveyor.idx === 0 && surveyor.buffer.length > 0) {
    surveyData.fixed = [...surveyor.buffer];
    stats.fixed.surveyShadow = surveyData.fixed.length;
    document.getElementById('survey-shadow-fixed').textContent = stats.fixed.surveyShadow;
    console.debug(`[Surveyor] ✅ flushed ${surveyData.fixed.length} shadow bins`);
    surveyor.buffer = [];
  }
}




/**
 * renderSurveyor: Schiebt das Surveyor-Dot-Element auf die richtige Position im Grid.
 * Berücksichtigt die globale Sichtbarkeit.
 */
function renderSurveyor() {
  if (!surveyor) return;
  if (!visSurveyor.checked) return;  // globaler Toggle

  const el = document.getElementById('surveyor');
  const pos = surveyor.path[surveyor.idx];
  el.style.top = `${(100 / rows) * pos.y}%`;
  el.style.left = `${(100 / cols) * pos.x}%`;
}


// ── Worker & Picker Setup ──────────────────────────────────────
const startX = cols - 1;
const startYs = { fixed: 2, chaos: 5, hybrid: 8 };
let workers = { fixed: [], chaos: [], hybrid: [] };
let pickers = { fixed: [], chaos: [], hybrid: [] };

const stats = {
  fixed: { shadow: 0, surveyShadow: 0, overflow: 0 },
  chaos: { shadow: 0, surveyShadow: 0, overflow: 0 },
  hybrid: { shadow: 0, surveyShadow: 0, overflow: 0 }
};
const counters = {
  fixed: { picks: 0, puts: 0 },
  chaos: { picks: 0, puts: 0 },
  hybrid: { picks: 0, puts: 0 }
};

function updateUICounters(zone) {
  document.getElementById(`pick-${zone}`).textContent = counters[zone].picks;
  document.getElementById(`put-${zone}`).textContent = counters[zone].puts;
}
function updateAveragePickTime(zone) {
  const durations = pickers[zone].flatMap(p => p.pickDurations || []);
  const avg = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const el = document.getElementById(`avg-picktime-${zone}`);
  if (el) el.textContent = avg;
}

const logs = { fixed: [], chaos: [], hybrid: [] };
let surveyData = { fixed: [], chaos: [], hybrid: [] };

// === Controls ===

// globale Sichtbarkeits-Checkboxen
const visWorkers = document.getElementById('vis-workers');
const visPickers = document.getElementById('vis-pickers');
const visSurveyor = document.getElementById('vis-surveyor');

// Anzahl-Selects
const cnt = {
  fixed: document.getElementById('cnt-fixed'),
  chaos: document.getElementById('cnt-chaos'),
  hybrid: document.getElementById('cnt-hybrid'),
  pickerFixed: document.getElementById('cnt-picker-fixed'),
  pickerChaos: document.getElementById('cnt-picker-chaos'),
  pickerHybrid: document.getElementById('cnt-picker-hybrid'),
};

// Tick-Speed
const tickSlider = document.getElementById('tick-speed');
const tickDisplay = document.getElementById('tick-display');

// initiale Anzeige der Counts und des Sliders
tickDisplay.textContent = `${tickSlider.value} ms`;
Object.values(cnt).forEach(sel => sel.value = sel.value || 10);

// Globale Worker-Sichtbarkeit
visWorkers.addEventListener('change', () => {
  document.querySelectorAll('.worker')
    .forEach(el => el.classList.toggle('hidden', !visWorkers.checked));
});
// Globale Picker-Sichtbarkeit
visPickers.addEventListener('change', () => {
  document.querySelectorAll('.picker')
    .forEach(el => el.classList.toggle('hidden', !visPickers.checked));
});
// Globale Surveyor-Sichtbarkeit
visSurveyor.addEventListener('change', () => {
  const dot = document.getElementById('surveyor');
  if (dot) dot.classList.toggle('hidden', !visSurveyor.checked);
});

// dynamische Tick-Anzeige
tickSlider.addEventListener('input', () => {
  tickDisplay.textContent = `${tickSlider.value} ms`;
  spawnInterval = +tickSlider.value;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(tick, spawnInterval);
  }
});

// Hilfsfunktion für Zeitstempel
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
}

// === Grid initialisieren ===
function initGrid() {
  grid = [];

  // Reset shadow counters
  ['fixed', 'chaos', 'hybrid'].forEach(z => stats[z].shadow = 0);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const isRoad = [0, 3, 6, 9].includes(y) || x === 0 || x === cols - 1;

      const type = isRoad
        ? 'road'
        : y <= 2 ? 'zone-fixed'
          : y <= 5 ? 'zone-chaos'
            : 'zone-hybrid';

      const baseCell = {
        x, y,
        type,
        bins: 0,
        fixedItem: null,
        contents: [],
        correctFilled: false,
        correctBins: 0,
        wrongBins: 0,
        justPulsed: false,
        reserved: [] // chaos/hybrid
      };

      if (type === 'zone-fixed') {
        baseCell.workerReservations = 0;      // 👷 Worker reservations
        baseCell.shadowReservations = 0;      // 🧹 Surveyor shadow reservations
        baseCell.correctFilled = true;
      }

      grid.push(baseCell);
    }
  }

  // Fixed shelves → sort and assign quotas
  fixedCells = grid
    .filter(c => c.type === 'zone-fixed')
    .sort((a, b) => a.x - b.x || a.y - b.y);

  fixedStatus.clear();
  fixedCells.forEach((cell, idx) => {
    fixedStatus.set(idx, true);
  });

  console.debug(`[initGrid] initialized ${fixedCells.length} fixed shelves`);

  // Assign items based on ABC quota
  const totalWeight = items.reduce((sum, it) => sum + it.weight, 0);
  let quotas = items.map(it => ({
    id: it.id,
    exact: (it.weight / totalWeight) * 16
  }));

  quotas.forEach(q => {
    q.floor = Math.floor(q.exact);
    q.rem = q.exact - q.floor;
  });

  let totalFloor = quotas.reduce((sum, q) => sum + q.floor, 0);
  let remainder = 16 - totalFloor;

  quotas.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < remainder; i++) {
    quotas[i].floor++;
  }

  quotas.sort((a, b) => {
    const c1 = items.find(it => it.id === a.id).class;
    const c2 = items.find(it => it.id === b.id).class;
    const order = { A: 0, B: 1, C: 2 };
    return order[c1] - order[c2];
  });

  let idx = 0;
  quotas.forEach(q => {
    for (let i = 0; i < q.floor; i++) {
      if (fixedCells[idx]) {
        fixedCells[idx].fixedItem = q.id;
        idx++;
      }
    }
  });

  drawGrid();
}



// === Draw Grid, KPIs & Logs ===
const gridEl = document.getElementById('grid');
const workersEl = document.getElementById('workers');
const pickersEl = document.getElementById('pickers');
const surveyorsEl = document.getElementById('surveyors');

function pulseCell(cell, color) {
  cell.justPulsed = color;
  const idx = grid.indexOf(cell);
  if (idx >= 0) grid[idx].justPulsed = color;
}
/**
 * Temporär animiert eine Zelle durch visuelles „Pulsieren“.
 * @param {HTMLElement} el — das DOM-Element der Zelle
 * @param {string} color — 'blue' oder 'yellow'
 */
function triggerPulse(el, color) {
  if (!el || !color) return;
  const className = `pulse-${color}`;
  el.classList.add(className);
  setTimeout(() => {
    el.classList.remove(className);
  }, 400); // Dauer des Effekts in ms
}

/**
 * drawGrid: Zeichnet das Grid neu, aktualisiert KPIs und führt Debug-Logs für Schattenbestände.
 */
function initGridDOM() {
  gridEl.innerHTML = '';
  for (const c of grid) {
    const d = document.createElement('div');
    d.className = 'cell ' + c.type;
    d.dataset.x = c.x;
    d.dataset.y = c.y;

    // 🔍 Only non-road cells get tooltips
    if (c.type !== 'road') {
      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';

      for (let i = 0; i < capacity; i++) {
        const bin = document.createElement('div');
        bin.className = 'bin empty'; // default state
        tooltip.appendChild(bin);
      }

      d.appendChild(tooltip);
    }

    gridEl.appendChild(d);
  }
}
function updateWorkerCount(zone) {
  const desired = +document.getElementById(`cnt-${zone}`).value;
  const current = workers[zone].length;
  const y = startYs[zone];

  if (desired > current) {
    for (let i = current; i < desired; i++) {
      const w = {
        name: `${zone}_${i}`,
        pos: { x: startX, y },
        target: null,
        returning: false,
        path: [],
        step: 0
      };
      workers[zone].push(w);
      renderWorker(w, zone);
    }
  } else if (desired < current) {
    for (let i = current - 1; i >= desired; i--) {
      const w = workers[zone].pop();
      const el = document.getElementById(w.name);
      if (el) el.remove();
    }
  }
}

function updatePickerCount(zone) {
  const desired = +document.getElementById(`cnt-picker-${zone}`).value;
  const current = pickers[zone].length;

  if (desired > current) {
    for (let i = current; i < desired; i++) {
      const p = {
        name: `picker_${zone}_${i}`,
        pos: { x: 0, y: startYs[zone] },
        startPos: { x: 0, y: startYs[zone] },
        tasks: sampleItems(1).map(it => ({ id: it.id, class: it.class })),
        target: null,
        path: [],
        step: 0,
        returning: false,
        relocations: 0,
        inPick: false,
        remainingFromShelf: []
      };
      if (zone !== 'fixed') {
        const cnt = 1 + Math.floor(Math.random() * 3);
        p.tasks = sampleItems(cnt).map(it => ({ id: it.id, class: it.class }));
      }
      pickers[zone].push(p);
      renderPicker(p, zone);
    }
  } else if (desired < current) {
    for (let i = current - 1; i >= desired; i--) {
      const p = pickers[zone].pop();
      const el = document.getElementById(p.name);
      if (el) el.remove();
    }
  }
}



function drawGrid() {
  updateKPIs();

  for (const c of grid) {
    const d = [...gridEl.children].find(e => +e.dataset.x === c.x && +e.dataset.y === c.y);
    if (!d) continue;

    // 🟡 Pulse effect
    if (c.justPulsed) {
      triggerPulse(d, c.justPulsed);
      c.justPulsed = false;
    }

    // 🟢 Background fill (bins / capacity)
    if (c.type !== 'road') {
      const ratio = c.bins / capacity;
      const r = Math.round(255 * ratio);
      const g = Math.round(255 * (1 - ratio));
      d.style.background = `rgb(${r},${g},0)`;
    }

    // 🔠 Fixed label anzeigen
    let label = d.querySelector('.cell-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'cell-label';
      d.insertBefore(label, d.firstChild);
    }

    if (c.type === 'zone-fixed' && c.fixedItem) {
      label.textContent = c.fixedItem;
    } else {
      label.textContent = '';
    }

    // 🧠 Tooltip: Bins anzeigen (wenn nicht road)
    const tooltip = d.querySelector('.tooltip');
    if (tooltip) {
      const bins = tooltip.querySelectorAll('.bin');
      for (let i = 0; i < capacity; i++) {
        const bin = bins[i];
        const item = c.contents[i];

        if (item) {
          const id = typeof item === 'object' ? item.id : item;
          const isWrong = c.type === 'zone-fixed' && c.fixedItem && id !== c.fixedItem;

          bin.className = 'bin filled' + (isWrong ? ' wrong' : '');
          bin.textContent = id;
        } else {
          bin.className = 'bin empty';
          bin.textContent = '';
        }
      }
    }

    // 🚫 Road-Zellen: keine Tooltips
    if (c.type === 'road') {
      d.querySelector('.tooltip')?.classList.add('hidden');
    }
  }

  // 🧮 Update Worker- und Picker-Labelanzeigen neben Slidern
  ['fixed', 'chaos', 'hybrid'].forEach(zone => {
    const workerSlider = document.getElementById(`cnt-${zone}`);
    const workerLabel = document.getElementById(`cnt-${zone}-label`);
    if (workerSlider && workerLabel) {
      workerLabel.textContent = workerSlider.value;
    }

    const pickerSlider = document.getElementById(`cnt-picker-${zone}`);
    const pickerLabel = document.getElementById(`cnt-picker-${zone}-label`);
    if (pickerSlider && pickerLabel) {
      pickerLabel.textContent = pickerSlider.value;
    }
  });
}

function updateKPIs() {
  const zones = ['fixed', 'chaos', 'hybrid'];

  zones.forEach(zone => {
    const zoneCells = grid.filter(c => c.type === `zone-${zone}`);
    const load = zoneCells.reduce((sum, c) => sum + c.bins, 0);
    const loadText = `${load}/160`;

    // 📦 Lagerauslastung (Text & Chart)
    const loadEl = document.getElementById(`load-${zone}`);
    if (loadEl) loadEl.textContent = loadText;

    createOrUpdateChart(`chart-${zone}`, load);

    // ⚠️ Schattenbestände (Lieferungen)
    const shadowEl = document.getElementById(`shadow-${zone}`);
    if (shadowEl) shadowEl.textContent = stats[zone].shadow;

    // 👁️ Erkannte Schattenbestände (Surveyor)
    const surveyEl = document.getElementById(`survey-shadow-${zone}`);
    if (surveyEl) surveyEl.textContent = stats[zone].surveyShadow;

    // 💧 Überlauf
    const overflowEl = document.getElementById(`overflow-${zone}`);
    if (overflowEl) overflowEl.textContent = stats[zone].overflow;

    // 📜 Log-Ausgabe
    const logEl = document.getElementById(`log-${zone}`);
    if (logEl) logEl.textContent = logs[zone].join('\n');

    // 🔍 Nur für Festplatz: tatsächliche Schatten-Bins
    if (zone === 'fixed') {
      const wrong = zoneCells.reduce((sum, c) => sum + (c.wrongBins || 0), 0);
      const wrongEl = document.getElementById('shadow-fixed');
      if (wrongEl) wrongEl.textContent = wrong;
    }
  });
}

const bfsCache = new Map();

/**
 * Cached BFS lookup
 * @param {Object} from - { x, y }
 * @param {Object} to - { x, y }
 */
function bfsCached(from, to) {
  const key = `${from.x},${from.y}->${to.x},${to.y}`;
  if (bfsCache.has(key)) return bfsCache.get(key);
  const path = bfs(from, to);
  bfsCache.set(key, path);
  return path;
}


// === BFS nur auf Straßen ===
function bfs(start, target) {
  const q = [[start, []]], vis = new Set();
  while (q.length) {
    const [pos, path] = q.shift(),
      key = `${pos.x},${pos.y}`;
    if (vis.has(key)) continue;
    vis.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = pos.x + dx, ny = pos.y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const c = grid.find(cc => cc.x === nx && cc.y === ny);
      if (c.type === 'road' || (nx === target.x && ny === target.y)) {
        const np = path.concat(pos);
        if (nx === target.x && ny === target.y) {
          return np.concat({ x: nx, y: ny });
        }
        q.push([{ x: nx, y: ny }, np]);
      }
    }
  }
  return [];
}

// Hilfs­funktion: Straßen­nachbar finden
function debugShelfUsage() {
  if (!Array.isArray(grid)) {
    console.warn('[debugShelfUsage] grid is not initialized');
    return;
  }

  fixedCells.forEach((cell, idx) => {
    const used = cell.bins;
    const reserved = cell.reservedBins || 0;
    const cap = capacity;
    const wrong = cell.wrongBins || 0;
    const correct = cell.correctBins || 0;
    console.log(
      `[Debug] Slot ${idx} (${cell.x},${cell.y}): ` +
      `used=${used}, reserved=${reserved}, cap=${cap}, ` +
      `correct=${correct}, wrong=${wrong}, item=${cell.fixedItem}`
    );
  });
}
function debugReservedBinsDetailed() {
  console.group('[Debug] Reserved Bin Check (Fixed Slots)');
  let overfilled = 0;

  fixedCells.forEach((cell, idx) => {
    const total = cell.bins + cell.reservedBins;
    const over = total > capacity;
    const tag = `${cell.fixedItem || '—'}`.padEnd(10);

    console.log(
      `%cSlot ${idx.toString().padStart(2)} @ (${cell.x},${cell.y}) – ${tag} | ` +
      `bins=${cell.bins}, reserved=${cell.reservedBins}, total=${total}, cap=${capacity}` +
      (over ? '  ⚠️ OVER' : ''),
      `color: ${over ? 'red' : 'black'}`
    );

    if (over) overfilled++;
  });

  console.log(`==> Total overfilled slots: ${overfilled}`);
  console.groupEnd();
}



function findRoadAdjacent(cell) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy }))
    .find(p =>
      p.x >= 0 && p.x < cols && p.y >= 0 && p.y < rows &&
      grid.find(c => c.x === p.x && c.y === p.y).type === 'road'
    );
}
// === Strategy-Selektion kapseln ===
function selectShelfFixed(it) {
  const allFree = fixedCells
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell }) => (cell.bins + cell.workerReservations < capacity));

  const intended = allFree.filter(({ cell }) =>
    cell.fixedItem === it.id &&
    cell.workerReservations === 0
  );

  const candidates = intended.length > 0
    ? intended
    : allFree.filter(({ cell }) => cell.workerReservations === 0);

  if (candidates.length > 0) {
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    choice.cell.workerReservations++;
    return choice.cell;
  }

  return null;
}





function selectShelfHybrid(it) {
  const hybridShelves = grid.filter(c =>
    c.type === 'zone-hybrid' &&
    (c.bins + (Array.isArray(c.reserved) ? c.reserved.length : 0)) < capacity
  );

  if (hybridShelves.length === 0) return null;

  const hybridLoad = computeZoneLoad('hybrid');
  const useFullRange = hybridLoad >= 0.5;

  // Step 1: If over 50% full, allow full range (random fallback)
  if (useFullRange) {
    const fallback = hybridShelves[Math.floor(Math.random() * hybridShelves.length)];
    if (!fallback.reserved) fallback.reserved = [];
    fallback.reserved.push(it.id);
    return fallback;
  }

  // Step 2: If under 50%, restrict to leftmost 75% of shelves (by x)
  const sorted = [...hybridShelves].sort((a, b) => a.x - b.x);
  const cutoff = Math.floor(sorted.length * 0.75);
  const primary = sorted.slice(0, cutoff);

  // Step 3: Weighted quotas: A = 62.5%, B = 31.25%, C = 6.25%
  const total = primary.length;
  const quotas = {
    A: Math.floor(total * 0.625),
    B: Math.floor(total * 0.3125),
    C: total // catch-all fallback, trimmed below
  };
  quotas.C = total - quotas.A - quotas.B; // remaining

  const segments = {
    A: primary.slice(0, quotas.A),
    B: primary.slice(quotas.A, quotas.A + quotas.B),
    C: primary.slice(quotas.A + quotas.B)
  };

  const candidateSegment = segments[it.class] || primary;
  const valid = candidateSegment.filter(s =>
    (s.bins + (Array.isArray(s.reserved) ? s.reserved.length : 0)) < capacity
  );

  const chosen = valid.length > 0
    ? valid[Math.floor(Math.random() * valid.length)]
    : hybridShelves[Math.floor(Math.random() * hybridShelves.length)];

  if (!chosen.reserved) chosen.reserved = [];
  chosen.reserved.push(it.id);
  return chosen;
}


function selectShelfChaos(it, who) {
  const candidates = grid.filter(c =>
    c.type === 'zone-chaos' &&
    ((c.bins + c.reserved.length) < capacity)
  );

  if (candidates.length === 0) return null;

  const xs = Array.from(new Set(candidates.map(c => c.x))).sort((a, b) => b - a);

  for (const x of xs) {
    const group = candidates.filter(c => c.x === x);

    for (const shelf of group) {
      if (!Array.isArray(shelf.reserved)) shelf.reserved = [];

      // 💡 Ensure bin not already reserved
      const alreadyReserved = shelf.reserved.includes(it.id);
      const total = shelf.bins + shelf.reserved.length;

      if (total < capacity && !alreadyReserved) {
        shelf.reserved.push(it.id); // ✅ Reserve by item
        return shelf;
      }
    }
  }

  return null;
}




function getTotalReservations(shelf) {
  return (shelf.putReserved?.length || 0) + (shelf.pickReserved?.length || 0);
}

// === Worker init & step ===
function initWorkers() {
  workers = { fixed: [], chaos: [], hybrid: [] };
  ['fixed', 'chaos', 'hybrid'].forEach(z => {
    const n = +cnt[z].value;
    for (let i = 0; i < n; i++) {
      workers[z].push({
        name: `${z}_${i}`,
        pos: { x: startX, y: startYs[z] },
        target: null,
        returning: false,
        path: [],
        step: 0
      });
    }
  });
}
function isCorrectlyFilled(cell) {
  return cell.wrongBins === 0 && cell.bins > 0;
}


function stepWorker(w, z) {
  if (z === 'fixed') return stepWorkerFixed(w);
  if (z === 'chaos') return stepWorkerChaos(w);
  if (z === 'hybrid') return stepWorkerHybrid(w);
}
function stepWorkerFixed(w) {
  if (!w.target && !w.returning) {
    const it = sampleItem();
    const shelf = selectShelfFixed(it);

    if (!shelf) {
      stats.fixed.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    const roadAdj = findRoadAdjacent(shelf);
    if (!roadAdj) {
      console.error(`[Worker][${w.name}] no road adjacent to shelf (${shelf.x},${shelf.y})`);
      return;
    }

    w.target = { shelf, road: roadAdj, item: it };
    w.path = bfs(w.pos, roadAdj);
    w.step = 0;
    return;
  }

  if (w.path[w.step]) {
    w.pos = w.path[w.step++];
    renderWorker(w, 'fixed');
    return;
  }

  if (!w.returning && w.target &&
    w.pos.x === w.target.road.x && w.pos.y === w.target.road.y) {

    const shelf = w.target.shelf;
    const itId = w.target.item.id;

    if ((shelf.bins + 1) > capacity) {
      shelf.workerReservations = Math.max(0, shelf.workerReservations - 1);
      stats.fixed.shadow++;
      stats.fixed.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    const bin = { id: itId, ts: tickCount };     // ✅ Always store as object
    shelf.contents.push(bin);                    // ✅ Consistent with chaos/hybrid
    shelf.bins++;
    shelf.workerReservations = Math.max(0, shelf.workerReservations - 1);

    counters.fixed.puts++;
    updateUICounters('fixed');
    pulseCell(shelf, yellow);

    if (itId === shelf.fixedItem) {
      shelf.correctBins = (shelf.correctBins || 0) + 1;
    } else {
      shelf.wrongBins = (shelf.wrongBins || 0) + 1;
    }

    w.path = bfs(w.pos, { x: startX, y: w.pos.y });
    w.step = 0;
    w.returning = true;
    return;
  }

  if (w.returning) {
    if (w.path[w.step]) {
      w.pos = w.path[w.step++];
      renderWorker(w, 'fixed');
      return;
    }

    w.returning = false;
    w.target = null;
    stepWorkerFixed(w); // Continue with next task
  }
}





function tryReserveChaosBin(it, by) {
  const candidates = grid.filter(c =>
    c.type === 'zone-chaos' &&
    (c.bins + (c.reserved?.length || 0)) < capacity
  );

  if (candidates.length === 0) return null;

  const xs = [...new Set(candidates.map(c => c.x))].sort((a, b) => b - a);

  for (const x of xs) {
    for (const shelf of candidates.filter(c => c.x === x)) {
      if (!Array.isArray(shelf.reserved)) shelf.reserved = [];

      const total = shelf.bins + shelf.reserved.length;
      if (total >= capacity) continue;

      // ❗ Prevent double-reservation by same actor
      const alreadyReserved = shelf.reserved.some(r => r.id === it.id && r.by === by);
      if (alreadyReserved) continue;

      // ✅ Reserve
      shelf.reserved.push({ id: it.id, by });
      return shelf;
    }
  }

  return null;
}

function stepWorkerChaos(w) {
  // 1. No target yet? → Select item + shelf
  if (!w.target && !w.returning) {
    const it = sampleItem();

    // 🔐 Select + reserve atomically
    const shelf = selectShelfChaos(it, w.name);

    if (!shelf) {
      stats.chaos.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    const roadAdj = findRoadAdjacent(shelf);
    if (!roadAdj) {
      console.error(`[Worker][${w.name}] ❌ No road next to chaos shelf (${shelf.x},${shelf.y})`);
      return;
    }

    // 📦 Assign work
    w.target = { shelf, road: roadAdj, item: it };
    w.path = bfs(w.pos, roadAdj);
    w.step = 0;
    return;
  }

  // 2. Walking to shelf
  if (w.path[w.step]) {
    w.pos = w.path[w.step++];
    renderWorker(w, 'chaos');
    return;
  }

  // 3. At target shelf
  if (
    !w.returning &&
    w.target &&
    w.pos.x === w.target.road.x &&
    w.pos.y === w.target.road.y
  ) {
    const { shelf, item } = w.target;
    const itId = item.id;

    // Ensure reservation exists
    if (!Array.isArray(shelf.reserved)) shelf.reserved = [];
    const idx = shelf.reserved.indexOf(itId);
    const total = shelf.bins + shelf.reserved.length;

    if (idx === -1) {
      console.warn(`[Worker][${w.name}] ❌ No reservation for ${itId} @(${shelf.x},${shelf.y})`);
      stats.chaos.shadow++;
      stats.chaos.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    if (total > capacity) {
      console.warn(`[Worker][${w.name}] ❌ Overfilled despite reservation for ${itId} @(${shelf.x},${shelf.y})`);
      shelf.reserved.splice(idx, 1); // clean up
      stats.chaos.shadow++;
      stats.chaos.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    // ✅ Success: deliver bin
    const bin = { id: itId, ts: tickCount };
    shelf.contents.push(bin);
    shelf.bins++;

    if (!binIndex.chaos.has(itId)) binIndex.chaos.set(itId, []);
    binIndex.chaos.get(itId).push({ cell: shelf, bin, ts: tickCount });

    shelf.reserved.splice(idx, 1); // remove reservation

    counters.chaos.puts++;
    updateUICounters('chaos');
    pulseCell(shelf, yellow);
    console.debug(`[Worker][${w.name}] ✅ Delivered ${itId} → (${shelf.x},${shelf.y})`);

    // Go home
    w.path = bfs(w.pos, { x: startX, y: w.pos.y });
    w.step = 0;
    w.returning = true;
    return;
  }

  // 4. Returning to start
  if (w.returning) {
    if (w.path[w.step]) {
      w.pos = w.path[w.step++];
      renderWorker(w, 'chaos');
      return;
    }

    // Return complete → reset
    w.returning = false;
    w.target = null;
    stepWorkerChaos(w); // 🧠 Start new task immediately
  }
}


function stepWorkerHybrid(w) {
  if (!w.target && !w.returning) {
    const it = sampleItem();
    const shelf = selectShelfHybrid(it);

    if (!shelf) {
      stats.hybrid.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    const roadAdj = findRoadAdjacent(shelf);
    if (!roadAdj) {
      console.error(`[Worker][${w.name}] no road adjacent to shelf (${shelf.x},${shelf.y})`);
      return;
    }

    w.target = { shelf, road: roadAdj, item: it };
    w.path = bfs(w.pos, roadAdj);
    w.step = 0;
    return;
  }

  if (w.path[w.step]) {
    w.pos = w.path[w.step++];
    renderWorker(w, 'hybrid');
    return;
  }

  if (!w.returning && w.target &&
    w.pos.x === w.target.road.x && w.pos.y === w.target.road.y) {

    const shelf = w.target.shelf;
    const itId = w.target.item.id;

    if ((shelf.bins + 1) > capacity) {
      const idx = shelf.reserved.indexOf(itId);
      if (idx >= 0) shelf.reserved.splice(idx, 1);
      stats.hybrid.shadow++;
      stats.hybrid.overflow++;
      w.path = bfs(w.pos, { x: startX, y: w.pos.y });
      w.step = 0;
      w.returning = true;
      return;
    }

    const bin = { id: itId, ts: tickCount };
    shelf.contents.push(bin);
    shelf.bins++;

    if (!binIndex.hybrid.has(itId)) binIndex.hybrid.set(itId, []);
    binIndex.hybrid.get(itId).push({ cell: shelf, bin, ts: tickCount });

    const idx = shelf.reserved.indexOf(itId);
    if (idx >= 0) shelf.reserved.splice(idx, 1);

    counters.hybrid.puts++;
    updateUICounters('hybrid');

    pulseCell(shelf, yellow);
    console.debug(`[Worker][${w.name}] delivered ${itId} to (${shelf.x},${shelf.y}) @tick=${tickCount}`);

    w.path = bfs(w.pos, { x: startX, y: w.pos.y });
    w.step = 0;
    w.returning = true;
    return;
  }

  if (w.returning) {
    if (w.path[w.step]) {
      w.pos = w.path[w.step++];
      renderWorker(w, 'hybrid');
      return;
    }

    w.returning = false;
    w.target = null;
    stepWorkerHybrid(w);
  }
}




// === Worker zeichnen (top/left) ===
function renderWorker(w, z) {
  // statt: if (!vis[z].checked) return;
  if (!visWorkers.checked) return;

  let el = document.getElementById(w.name);
  if (!el) {
    el = document.createElement('div');
    el.id = w.name;
    el.className = `worker ${z}`;
    workersEl.appendChild(el);
  }
  el.style.top = `${(100 / rows) * w.pos.y}%`;
  el.style.left = `${(100 / cols) * w.pos.x}%`;
  el.classList.toggle('hidden', !visWorkers.checked);
}
/**
 * Initialize pickers: spawn them at column 0 on their zone’s road-row,
 * give each exactly one task to start, and remember their spawn position.
 */
/**
 * Initialize pickers: spawn them at column 0 on their zone’s road-row,
 * give each exactly one task to start, and remember their spawn position.
 */
function initPickers() {
  // Clear any existing pickers
  pickers = { fixed: [], chaos: [], hybrid: [] };
  pickersEl.innerHTML = '';

  ['fixed', 'chaos', 'hybrid'].forEach(zone => {
    const key = `picker${zone.charAt(0).toUpperCase()}${zone.slice(1)}`;
    const n = +cnt[key].value;

    for (let i = 0; i < n; i++) {
      const p = {
        name: `picker_${zone}_${i}`,
        pos: { x: 0, y: startYs[zone] },
        startPos: { x: 0, y: startYs[zone] },
        tasks: sampleItems(1).map(it => ({ id: it.id, class: it.class })),
        target: null,
        path: [],
        step: 0,
        returning: false,
        relocations: 0,
        inPick: false,
        remainingFromShelf: [] // 👈 important for hybrid
      };

      // Hybrid and chaos: more initial tasks
      if (zone !== 'fixed') {
        const cnt = 1 + Math.floor(Math.random() * 3); // 1–3 tasks
        p.tasks = sampleItems(cnt).map(it => ({ id: it.id, class: it.class }));
      }

      pickers[zone].push(p);
      renderPicker(p, zone);
    }
  });
}


// === Picker zeichnen ===
function renderPicker(p, zone) {
  // statt: if (!vis[zone].checked) return;
  if (!visPickers || !visPickers.checked) return;


  let el = document.getElementById(p.name);
  if (!el) {
    el = document.createElement('div');
    el.id = p.name;
    el.className = 'picker';
    pickersEl.appendChild(el);
  }
  el.style.top = `${(100 / rows) * p.pos.y}%`;
  el.style.left = `${(100 / cols) * p.pos.x}%`;
}
/**
 * Entscheidet, ob ein Picker seine aktuelle Route umplanen sollte,
 * wenn er statt Ziel A zu beliefern über Ziel B zurückkehrt.
 *
 * @param {{path: Array, pos: Object}} picker   Aktueller Picker mit position und bisheriger Rückweg-Route
 * @param {{x,y}} newShelfRoadPos               Die Straßen-Position des alternativen Regals
 * @returns {boolean}                           true, wenn Umweg ≥ 2 Felder einspart
 */
function shouldRelocate(picker, newShelfRoadPos) {
  const currentReturnPath = picker.path.slice(picker.step);
  // Länge des bisherigen Rückwegs
  const lenCurrent = currentReturnPath.length;

  // Berechne neuen Rückweg von aktueller Position über BFS:
  const newReturnPath = bfs(picker.pos, newShelfRoadPos);
  const lenNew = newReturnPath.length;

  // Spare mindestens 2 Felder ein?
  return (lenCurrent - lenNew) >= 2;
}
const SPoT = {
  getPath: (from, to) => bfs(from, to)
};

/**
 * Berechnet aktuelle Auslastung einer Zone (0–1).
 * @param {string} zone – 'fixed' | 'chaos' | 'hybrid'
 */
function computeZoneLoad(zone) {
  const cells = grid.filter(c => c.type === `zone-${zone}`);
  const totalBins = cells.reduce((sum, c) => sum + c.bins, 0);
  const maxBins = cells.length * capacity;
  return totalBins / maxBins;
}


// ── Fixed-Helper ──────────────────────────────────────────────────

/**
 * Liefert ein Regalfach, das falsch befüllt ist und noch Bins hat.
 */
function findFixedWrongShelf() {
  return grid.find(c =>
    c.type === 'zone-fixed' &&
    !c.correctFilled &&
    c.bins > 0
  );
}

/**
 * Liefert ein Regalfach, das korrekt ist, das gesuchte Item enthält und noch Bins hat.
 */
function findFixedCorrectShelf(itemId) {
  return grid.find(c =>
    c.type === 'zone-fixed' &&
    c.correctFilled &&
    c.fixedItem === itemId &&
    c.bins > 0
  );
}

/**
 * Bearbeitet das Abholen (Pick) für einen Fixed-Task.
 * @param {Object} p – Picker
 * @param {Object} task – Aktueller Pickauftrag (inkl. itemId, ggf. isSurvey)
 * @param {Object} shelf – Zielregal (cell)
 * @returns {boolean} true, wenn Pick erfolgreich
 */
function handleFixedPick(p, task, shelf) {
  const zone = 'fixed';
  const logsArr = logs[zone];
  const label = `${timestamp()} – ${p.name}`;

  logsArr.push(`${label} startet Pick für ${task.id}`);

  if (task.isSurvey) {
    // Bin-Referenz statt Index
    const binRef = task.bin;
    const idx = shelf.contents.findIndex(b => b === binRef);
    if (idx === -1) {
      logsArr.push(`${label} ❌ Bin-Referenz nicht mehr vorhanden – Pick abgebrochen.`);
      return false;
    }

    const actual = shelf.contents[idx];
    if (actual.id !== task.id) {
      logsArr.push(`${label} ❌ Bin-ID stimmt nicht mehr – gefunden=${actual.id}, erwartet=${task.id}`);
      return false;
    }

    shelf.contents.splice(idx, 1);
    shelf.bins = Math.max(0, shelf.bins - 1);
    shelf.wrongBins = Math.max(0, shelf.wrongBins - 1);
    shelf.shadowReservations = Math.max(0, shelf.shadowReservations - 1);

    pulseCell(shelf, blue);
    logsArr.push(`${label} korrigiert falsches Bin → wrongBins=${shelf.wrongBins}`);
    logsArr.push(`${label} liefert ${task.id} aus Fach (${shelf.x},${shelf.y})`);
    return true;
  }

  // Normale Pick-Aufgabe
  const removeIdx = shelf.contents.findIndex(b =>
    (typeof b === 'object' && b.id === task.id) || b === task.id
  );
  if (removeIdx >= 0) {
    const bin = shelf.contents[removeIdx];
    shelf.contents.splice(removeIdx, 1);
    shelf.bins = Math.max(0, shelf.bins - 1);
    shelf.workerReservations = Math.max(0, shelf.workerReservations - 1);

    const pickedId = typeof bin === 'object' ? bin.id : bin;
    const isCorrect = pickedId === shelf.fixedItem;

    if (isCorrect) {
      shelf.correctBins = Math.max(0, shelf.correctBins - 1);
      logsArr.push(`${label} pickt korrektes Bin → correctBins=${shelf.correctBins}`);
    } else {
      shelf.wrongBins = Math.max(0, shelf.wrongBins - 1);
      logsArr.push(`${label} pickt falsches Bin → wrongBins=${shelf.wrongBins}`);
    }

    pulseCell(shelf, blue);
    logsArr.push(`${label} liefert ${task.id} aus Fach (${shelf.x},${shelf.y})`);
    return true;
  }

  logsArr.push(`${label} ❌ Kein passendes Bin gefunden – Pick fehlgeschlagen.`);
  return false;
}





// ── stepPicker ──────────────────────────────────────────────────
function stepPicker(p, zone) {
  if (zone === 'fixed') {
    stepPickerFixed(p, zone);
  }
  else if (zone === 'chaos') {
    stepPickerChaos(p, zone);
  }
  else if (zone === 'hybrid') {
    stepPickerHybrid(p, zone);
  }
}

function assignNextTask(p, zone) {
  if (zone === 'fixed' && surveyData.fixed.length > 0) {
    const entry = surveyData.fixed.shift();
    stats.fixed.surveyShadow = surveyData.fixed.length;
    document.getElementById(`survey-shadow-fixed`).textContent = stats.fixed.surveyShadow;
    p.tasks = [{
      id: entry.bin.id,
      isSurvey: true,
      cell: entry.cell,
      bin: entry.bin // reference instead of idx
    }];
    logs[zone].push(`${p.name} bearbeitet Survey-Auftrag: ${entry.bin.id}`);
  } else {
    const itemCount = 2 + Math.floor(Math.random() * 3);
    const tasks = sampleItems(itemCount).map(it => ({ id: it.id, isSurvey: false }));
    p.tasks = tasks;
    logs[zone].push(`${p.name} bearbeitet neuen Auftrag mit ${tasks.length} Items:`);
    tasks.forEach((t, i) => logs[zone].push(`- ${t.id}`));
  }
}

function stepPickerChaos(p, zone) {
  if (p.returning) {
    if (p.path[p.step]) {
      p.pos = p.path[p.step++];
      renderPicker(p, zone);
      return;
    }

    // ⏱️ Order finished
    if (p.orderStartTick !== undefined) {
      const duration = tickCount - p.orderStartTick;
      p.orderStartTick = undefined;

      if (!p.orderDurations) p.orderDurations = [];
      p.orderDurations.push(duration);
      if (p.orderDurations.length > 50) p.orderDurations.shift();

      const avg = Math.round(p.orderDurations.reduce((a, b) => a + b, 0) / p.orderDurations.length);
      document.getElementById(`avg-picktime-${zone}`).textContent = avg;
    }

    // Start new order
    p.returning = false;
    const cnt = 2 + Math.floor(Math.random() * 3);
    p.tasks = sampleItems(cnt).map(it => ({ id: it.id, class: it.class }));
    p.orderStartTick = tickCount;
    p.target = null;
    p.path = [];
    p.step = 0;
    return;
  }

  if (p.path[p.step]) {
    p.pos = p.path[p.step++];
    renderPicker(p, zone);
    return;
  }

  // Plan new route if needed
  if (!p.target && p.tasks.length > 0) {
    const route = findSmartChaosRoute(p, p.tasks);
    if (!route) {
      logs[zone].push(`${p.name} findet keine passenden Bins – gibt auf.`);
      clearAllReservations(p.name);
      p.tasks = [];
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
      return;
    }

    p.target = {
      shelf: route.shelf,
      road: route.road
    };
    p.remainingFromShelf = route.remaining || [];
    p.path = bfs(p.pos, route.road);
    p.step = 0;
    return;
  }

  // At shelf → pick
  if (
    p.target &&
    Math.abs(p.pos.x - p.target.shelf.x) + Math.abs(p.pos.y - p.target.shelf.y) === 1 &&
    !p.inPick
  ) {
    p.inPick = true;
    const shelf = p.target.shelf;
    const picked = [];

    for (const task of [...p.tasks]) {
      const idx = shelf.contents.findIndex(b => typeof b === 'object' && b.id === task.id);
      const hasReservation = shelf.pickReserved?.some(
        r => r.id === task.id && r.by === p.name
      );

      if (idx >= 0 && hasReservation) {
        const bin = shelf.contents[idx];
        shelf.contents.splice(idx, 1);
        shelf.bins = Math.max(0, shelf.bins - 1);

        const list = binIndex.chaos.get(task.id);
        if (list) {
          const i = list.findIndex(entry => entry.bin === bin);
          if (i >= 0) list.splice(i, 1);
        }

        shelf.pickReserved = shelf.pickReserved.filter(
          r => !(r.id === task.id && r.by === p.name)
        );

        counters.chaos.picks++;
        picked.push(task.id);
        pulseCell(shelf, blue);
        logs[zone].push(`${p.name} ✅ pickt ${task.id} mit ts=${bin.ts} aus (${shelf.x},${shelf.y})`);
      } else {
        // ❗ Bin missing or stolen — cleanup reservation anyway
        shelf.pickReserved = shelf.pickReserved.filter(
          r => !(r.id === task.id && r.by === p.name)
        );
      }
    }

    p.tasks = p.tasks.filter(t => !picked.includes(t.id));
    updateUICounters(zone);
    p.inPick = false;

    if (p.tasks.length > 0) {
      p.target = null; // next leg
    } else {
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
    }

    return;
  }

  // Unexpected fallback
  clearAllReservations(p.name);
  p.returning = true;
  p.path = bfs(p.pos, p.startPos);
  p.step = 0;
  p.tasks = [];
}




function stepPickerFixed(p, zone) {
  // 1) Returning
  if (p.returning) {
    if (p.path[p.step]) {
      p.pos = p.path[p.step++];
      renderPicker(p, zone);
      return;
    }

    // ⏱️ Order finished → record pick duration
    if (p.orderStartTick !== undefined) {
      const duration = tickCount - p.orderStartTick;
      p.orderStartTick = undefined;

      if (!p.orderDurations) p.orderDurations = [];
      p.orderDurations.push(duration);
      if (p.orderDurations.length > 50) p.orderDurations.shift();

      const avg = Math.round(p.orderDurations.reduce((a, b) => a + b, 0) / p.orderDurations.length);
      document.getElementById(`avg-picktime-${zone}`).textContent = avg;
    }

    p.returning = false;
    p.target = null;

    assignNextTask(p, zone);        // 🧠 assign new (survey prioritized!)
    p.orderStartTick = tickCount;   // ⏱️ start new order timer
    return;
  }

  // 2) No target? Plan route
  if (!p.target) {
    // No tasks? Go back to base and wait
    if (p.tasks.length === 0) {
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
      return;
    }

    const task = p.tasks[0];

    // === Surveyor task ===
    if (task.isSurvey && task.cell) {
      const shelf = task.cell;
      if (shelf.bins === 0 || shelf.wrongBins === 0) {
        logs[zone].push(`${p.name} kann Survey-Ziel ${task.id} nicht mehr picken – überspringt.`);
        p.tasks.shift();
        assignNextTask(p, zone);
        return;
      }

      const road = findRoadAdjacent(shelf);
      if (!road) {
        logs[zone].push(`${p.name} kein Zugang zu Survey-Ziel – überspringt.`);
        p.tasks.shift();
        assignNextTask(p, zone);
        return;
      }

      p.target = { shelf, road };
      p.path = bfs(p.pos, road);
      p.step = 0;
      return;
    }

    // === Normal task: search shelf list (no knowledge) ===
    if (!p.shelfSearchQueue || p.shelfSearchQueue.length === 0) {
      p.shelfSearchQueue = shuffle(grid.filter(c =>
        c.type === 'zone-fixed' &&
        c.fixedItem === task.id
      ));
    }

    while (p.shelfSearchQueue.length > 0) {
      const candidate = p.shelfSearchQueue.shift();
      const road = findRoadAdjacent(candidate);
      if (!road) continue;

      p.target = { shelf: candidate, road };
      p.path = bfs(p.pos, road);
      p.step = 0;
      return;
    }

    // No shelves left to try → give up on task
    logs[zone].push(`${p.name} konnte ${task.id} nicht finden – abgebrochen.`);
    p.tasks.shift();
    p.shelfSearchQueue = null;

    if (p.tasks.length === 0) {
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
    }
    return;
  }

  // 3) Walking to shelf
  if (p.path[p.step]) {
    p.pos = p.path[p.step++];
    renderPicker(p, zone);
    return;
  }

  // 4) At shelf → try to pick
  if (p.target && p.step === p.path.length) {
    const { shelf } = p.target;
    const task = p.tasks[0];

    const ok = handleFixedPick(p, task, shelf);

    if (ok) {
      counters.fixed.picks++;
      updateUICounters('fixed');
      p.tasks.shift();
      p.target = null;
      p.shelfSearchQueue = null;
    } else {
      // Try next shelf if possible
      p.target = null;
    }

    if (p.tasks.length === 0) {
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
    }
    return;
  }

  // Fallback
  p.returning = true;
  p.path = bfs(p.pos, p.startPos);
  p.step = 0;
}




function findSmartChaosRoute(p, tasks) {
  const entriesByItem = new Map();

  for (const t of tasks) {
    const list = binIndex.chaos.get(t.id);
    if (list && list.length > 0) {
      entriesByItem.set(t.id, list);
    }
  }

  if (entriesByItem.size === 0) return null;

  // Group shelves by how many unique pickable items they contain
  const shelfMap = new Map();
  for (const [itemId, entries] of entriesByItem.entries()) {
    for (const { cell } of entries) {
      if (!shelfMap.has(cell)) shelfMap.set(cell, new Set());
      shelfMap.get(cell).add(itemId);
    }
  }

  const shelves = Array.from(shelfMap.entries()).map(([cell, items]) => ({
    cell,
    items,
    count: items.size
  }));

  shelves.sort((a, b) => b.count - a.count); // more items = better

  for (const target of shelves) {
    const shelf = target.cell;

    if ((shelf.bins + getTotalReservations(shelf)) >= capacity) continue;

    const candidates = [];
    for (const itemId of target.items) {
      const entries = entriesByItem.get(itemId);
      const matching = entries.filter(e => e.cell === shelf);
      if (!matching.length) continue;
      const oldest = matching.reduce((a, b) => (a.ts <= b.ts ? a : b));
      candidates.push({ itemId, bin: oldest.bin, ts: oldest.ts });
    }

    if (!candidates.length) continue;

    // ✅ Reserve with pickReserved
    if (!Array.isArray(shelf.pickReserved)) shelf.pickReserved = [];
    for (const c of candidates) {
      shelf.pickReserved.push({ id: c.itemId, by: p.name });
    }

    return {
      shelf,
      road: findRoadAdjacent(shelf),
      bin: candidates[0].bin,
      ts: candidates[0].ts,
      remaining: candidates.slice(1)
    };
  }

  // Fallback: pick oldest bin for first task
  const fallbackTask = tasks[0];
  const fallbackEntries = binIndex.chaos.get(fallbackTask.id);
  if (!fallbackEntries || !fallbackEntries.length) return null;

  const fallback = fallbackEntries.reduce((a, b) => (a.ts <= b.ts ? a : b));
  const shelf = fallback.cell;

  if (!Array.isArray(shelf.pickReserved)) shelf.pickReserved = [];
  shelf.pickReserved.push({ id: fallbackTask.id, by: p.name });

  return {
    shelf,
    road: findRoadAdjacent(shelf),
    bin: fallback.bin,
    ts: fallback.ts,
    remaining: []
  };
}

function isShelfAvailableForPut(shelf, itemId, who) {
  if ((shelf.bins + getTotalReservations(shelf)) >= capacity) return false;

  // Don't allow worker to reserve if a picker has claimed this bin
  const conflict = shelf.pickReserved?.some(r => r.id === itemId && r.by !== who);
  if (conflict) return false;

  return true;
}
function clearAllReservations(pickerName) {
  grid.forEach(c => {
    if (Array.isArray(c.pickReserved)) {
      c.pickReserved = c.pickReserved.filter(r => r.by !== pickerName);
    }
  });
}




function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}



function findSmartHybridRoute(p, tasks) {
  const entriesByItem = new Map();
  for (const t of tasks) {
    const list = binIndex.hybrid.get(t.id);
    if (list && list.length) {
      entriesByItem.set(t.id, list);
    }
  }

  if (entriesByItem.size === 0) return null;

  // Collect all candidate shelves
  const shelfMap = new Map(); // shelf -> Set of itemIds
  for (const [itemId, entries] of entriesByItem.entries()) {
    for (const { cell } of entries) {
      if (!shelfMap.has(cell)) shelfMap.set(cell, new Set());
      shelfMap.get(cell).add(itemId);
    }
  }

  // Build list of shelves with how many unique items they cover
  const shelves = Array.from(shelfMap.entries()).map(([cell, items]) => ({
    cell,
    items,
    count: items.size
  }));

  // Prioritize by most items covered (3->2->1)
  shelves.sort((a, b) => b.count - a.count);

  // Try to find the best shelf
  for (const target of shelves) {
    const shelf = target.cell;

    // Skip if full
    if (shelf.bins + shelf.reserved.length >= capacity) continue;

    // For all items we can pick here, find the oldest bin
    const candidates = [];
    for (const itemId of target.items) {
      const entries = entriesByItem.get(itemId);
      const matching = entries.filter(e => e.cell === shelf);
      if (matching.length === 0) continue;
      // Pick the oldest bin
      const oldest = matching.reduce((a, b) => (a.ts <= b.ts ? a : b));
      candidates.push({ itemId, bin: oldest.bin, ts: oldest.ts });
    }

    if (candidates.length === 0) continue;

    // Reserve all bins
    for (const c of candidates) {
      if (!shelf.reserved) shelf.reserved = [];
      shelf.reserved.push(c.itemId);
    }

    // Return the first bin as the initial target
    const first = candidates[0];

    return {
      shelf,
      road: findRoadAdjacent(shelf),
      bin: first.bin,
      ts: first.ts,
      remaining: candidates.slice(1)
    };
  }

  // If no multi-item shelf found, fallback to per-item
  // (like findRouteToTaskFast but for the first remaining task)
  const fallbackTask = tasks[0];
  const fallbackEntries = binIndex.hybrid.get(fallbackTask.id);
  if (!fallbackEntries || fallbackEntries.length === 0) return null;

  const fallback = fallbackEntries.reduce((a, b) => (a.ts <= b.ts ? a : b));
  if (!fallback.cell.reserved) fallback.cell.reserved = [];
  fallback.cell.reserved.push(fallbackTask.id);

  return {
    shelf: fallback.cell,
    road: findRoadAdjacent(fallback.cell),
    bin: fallback.bin,
    ts: fallback.ts,
    remaining: []
  };
}


function stepPickerHybrid(p, zone) {
  if (p.returning) {
    if (p.path[p.step]) {
      p.pos = p.path[p.step++];
      renderPicker(p, zone);
      return;
    }

    // ⏱️ Order completed
    if (p.orderStartTick !== undefined) {
      const duration = tickCount - p.orderStartTick;
      p.orderStartTick = undefined;

      if (!p.orderDurations) p.orderDurations = [];
      p.orderDurations.push(duration);
      if (p.orderDurations.length > 50) p.orderDurations.shift();

      const avg = Math.round(p.orderDurations.reduce((a, b) => a + b, 0) / p.orderDurations.length);
      document.getElementById(`avg-picktime-${zone}`).textContent = avg;
    }

    // Start new order
    p.returning = false;
    const cnt = 1 + Math.floor(Math.random() * 3);
    p.tasks = sampleItems(cnt).map(it => ({ id: it.id, class: it.class }));
    p.orderStartTick = tickCount; // ⏱️ mark start
    p.target = null;
    p.path = [];
    p.step = 0;
    return;
  }

  if (p.path[p.step]) {
    p.pos = p.path[p.step++];
    renderPicker(p, zone);
    return;
  }

  if (!p.target && p.tasks.length > 0) {
    const allShelves = grid.filter(c =>
      c.type === 'zone-hybrid' &&
      c.contents.length > 0 &&
      p.tasks.some(t => c.contents.some(b => b.id === t.id))
    );

    if (allShelves.length === 0) {
      logs[zone].push(`${p.name} findet keine passenden Regale für Aufgaben – gibt auf.`);
      p.tasks = [];
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
      return;
    }

    let bestShelf = null, bestScore = -1, bestTs = Infinity;
    const zoneLoad = computeZoneLoad('hybrid');

    for (const shelf of allShelves) {
      const matchingBins = shelf.contents.filter(b =>
        p.tasks.some(t => t.id === b.id)
      );

      const score = matchingBins.length;
      const minTs = Math.min(...matchingBins.map(b => b.ts));

      const isBetter =
        (zoneLoad < 0.5 && (minTs < bestTs || (minTs === bestTs && score > bestScore))) ||
        (zoneLoad >= 0.5 && score > bestScore);

      if (isBetter) {
        bestShelf = shelf;
        bestScore = score;
        bestTs = minTs;
      }
    }

    if (!bestShelf) {
      logs[zone].push(`${p.name} findet keine brauchbaren Regale – Aufgabe abgebrochen.`);
      p.tasks = [];
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
      return;
    }

    const road = findRoadAdjacent(bestShelf);
    if (!road) {
      logs[zone].push(`${p.name} kein Zugang zu Zielregal – abgebrochen.`);
      p.tasks = [];
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
      return;
    }

    p.target = { shelf: bestShelf, road };
    p.path = bfs(p.pos, road);
    p.step = 0;
    return;
  }

  if (p.target &&
    Math.abs(p.pos.x - p.target.shelf.x) + Math.abs(p.pos.y - p.target.shelf.y) === 1 &&
    !p.inPick) {
    p.inPick = true;

    const shelf = p.target.shelf;
    const picked = [];

    for (const task of [...p.tasks]) {
      const idx = shelf.contents.findIndex(b => b.id === task.id);
      if (idx >= 0) {
        const bin = shelf.contents[idx];
        shelf.contents.splice(idx, 1);
        shelf.bins = Math.max(0, shelf.bins - 1);

        const list = binIndex.hybrid.get(task.id);
        if (list) {
          const i = list.findIndex(entry => entry.bin === bin);
          if (i >= 0) list.splice(i, 1);
        }

        counters.hybrid.picks++;
        picked.push(task.id);
        pulseCell(shelf, blue);

        logs[zone].push(`${p.name} pickt ${task.id} mit ts=${bin.ts} aus (${shelf.x},${shelf.y})`);
      }
    }

    p.tasks = p.tasks.filter(t => !picked.includes(t.id));
    updateUICounters('hybrid');
    p.inPick = false;

    if (p.tasks.length > 0) {
      p.target = null;
    } else {
      p.returning = true;
      p.path = bfs(p.pos, p.startPos);
      p.step = 0;
    }
    return;
  }

  // Fallback: unexpected
  p.returning = true;
  p.path = bfs(p.pos, p.startPos);
  p.step = 0;
  p.tasks = [];
}


// ── Tick & Controls ───────────────────────────────────────────
let tickCount = 0;
let surveyorActive = false;

function tick() {
  tickCount++;
  // 1) Surveyor trigger every 100 ticks
  if (!surveyorActive && tickCount % 100 === 0 && typeof surveyor === 'object' && surveyor !== null) {
    surveyorActive = true;
  }

  // 2) Step active surveyor every 2 ticks
  if (surveyorActive && surveyor) {
    if (tickCount % 2 === 0) {
      stepSurveyor();
      renderSurveyor();

      // Stop if back at start
      if (surveyor.idx === 0) {
        surveyorActive = false;
      }
    }
  }

  // 3) Step worker/picker only if zone is not failed
  ['fixed', 'chaos', 'hybrid'].forEach(z => {
    if (zoneStates[z]?.failed) return;

    workers[z].forEach(w => stepWorker(w, z));
    pickers[z].forEach(p => stepPicker(p, z));
  });

  // 4) Draw updated grid
  drawGrid();

  // 5) Debug
  debugReservedBinsDetailed();
}



function startAnim() {
  // ✅ End stress test if active
  if (stressTestActive) endStressTest();

  prepareUI();         // ← Prepares the whole UI and grid
  initWorkers();       // ← Spawns workers
  initPickers();       // ← Spawns pickers
  initSurveyor();      // ← Prepares surveyor

  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tick, spawnInterval);
}


function stopAnim() { clearInterval(intervalId); }

document.getElementById('btn-start').onclick = startAnim;
document.getElementById('btn-stop').onclick = stopAnim;
tickSlider.oninput = () => {
  spawnInterval = +tickSlider.value;
  tickDisplay.textContent = `${spawnInterval} ms`;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(tick, spawnInterval);
  }
};

document.querySelectorAll('.btn-log').forEach(btn => {
  btn.onclick = () => {
    const z = btn.dataset.zone;
    const lb = document.getElementById(`log-${z}`);
    lb.style.display = lb.style.display === 'block' ? 'none' : 'block';
  };
});

function prepareUI() {
  initGrid();
  initGridDOM();
  drawGrid();

  workersEl.innerHTML = '';
  pickersEl.innerHTML = '';
  surveyorsEl.innerHTML = '';

  // Reset logs and KPIs
  ['fixed', 'chaos', 'hybrid'].forEach(z => {
    logs[z] = [];
    counters[z].picks = 0;
    counters[z].puts = 0;
    stats[z].shadow = 0;
    stats[z].overflow = 0;
    stats[z].surveyShadow = 0;

    document.getElementById(`pick-${z}`).textContent = '0';
    document.getElementById(`put-${z}`).textContent = '0';
    document.getElementById(`shadow-${z}`).textContent = '0';
    document.getElementById(`survey-shadow-${z}`).textContent = '0';
    document.getElementById(`overflow-${z}`).textContent = '0';
    document.getElementById(`load-${z}`).textContent = '0/160';
    document.getElementById(`log-${z}`).textContent = '';
  });

  binIndex.hybrid.clear();
  bfsCache.clear();
}

window.onload = () => {
  // 1. Populate dropdowns
  Object.values(cnt).forEach(sel => {
    for (let i = 1; i <= 10; i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = i;
      sel.appendChild(o);
    }
    sel.value = 1;
  });

  // 2. Expand KPI blocks
  document.querySelectorAll('.kpi-content').forEach(c => {
    c.style.display = 'block';
  });

  // 3. Sync sliders with labels
  ['fixed', 'chaos', 'hybrid'].forEach(zone => {
    const workerSlider = document.getElementById(`cnt-${zone}`);
    const pickerSlider = document.getElementById(`cnt-picker-${zone}`);
    const workerLabel = document.getElementById(`cnt-${zone}-label`);
    const pickerLabel = document.getElementById(`cnt-picker-${zone}-label`);

    workerSlider.addEventListener('input', () => {
      workerLabel.textContent = workerSlider.value;
      updateWorkerCount(zone);
    });

    pickerSlider.addEventListener('input', () => {
      pickerLabel.textContent = pickerSlider.value;
      updatePickerCount(zone);
    });
  });

  // ✅ Preload grid/UI without ticking
  prepareUI();
};


