// stressTest.js

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-stresstest');
    if (btn) {
        btn.addEventListener('click', startStressTest);
    } else {
        console.error('Stresstest button not found!');
    }
});

// == Global State ==
let stressTestActive = false;
const stressTestPhases = [
    { workers: 8, pickers: 10, label: "Low" },
    { workers: 8, pickers: 8, label: "Medium" },
    { workers: 10, pickers: 10, label: "Busy" },
    { workers: 10, pickers: 5, label: "High" }
];

let currentPickerIndex = 0;
let zones = ['fixed', 'chaos', 'hybrid'];
let zoneStates = {};

const levelMap = {
    10: "Low",
    7: "Medium",
    4: "Busy",
    1: "High"
};

function simulateSliderInput(id, value) {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// == Entry Point ==
function startStressTest() {
    if (stressTestActive) return;

    stressTestActive = true;
    currentPickerIndex = 0;

    // Enable stress mode UI state
    document.body.classList.add('stress-active');

    // Hide all visual entities
    document.getElementById('vis-workers').checked = false;
    document.getElementById('vis-pickers').checked = false;
    document.getElementById('vis-surveyor').checked = false;
    document.querySelectorAll('.worker, .picker, .surveyor').forEach(el => el.classList.add('hidden'));

    // Set fastest tick speed
    document.getElementById('tick-speed').value = 2;
    document.getElementById('tick-display').innerText = '2 ms';
    spawnInterval = 2;
    clearInterval(intervalId);
    intervalId = setInterval(tick, spawnInterval);

    // Initialize zone states
    zoneStates = {};
    for (const z of zones) {
        zoneStates[z] = {
            failed: false,
            completed: false,
            startTime: performance.now(),
            survivalTimeout: null
        };
    }

    // Clean existing overlays if present
    if (window.zoneOverlays) {
        for (const ov of Object.values(window.zoneOverlays)) {
            if (ov?.parentNode) ov.parentNode.removeChild(ov);
        }
        window.zoneOverlays = {};
    }

    // ✅ Begin round 0: starts countdown bar, label, zone logic
    proceedNextRound();

}




function startAllZones(roundDurationMs) {
    const { workers, pickers } = stressTestPhases[currentPickerIndex];
    for (const z of zones) {
        startZone(z, workers, pickers, roundDurationMs);
    }
}




function startZone(zone, workerCount, pickerCount, roundDurationMs) {
    document.getElementById(`cnt-${zone}`).value = workerCount;
    document.getElementById(`cnt-${zone}-label`).innerText = workerCount;
    document.getElementById(`cnt-picker-${zone}`).value = pickerCount;
    document.getElementById(`cnt-picker-${zone}-label`).innerText = pickerCount;

    simulateSliderInput(`cnt-${zone}`, workerCount);
    simulateSliderInput(`cnt-picker-${zone}`, pickerCount);

    if (zone === 'fixed' && typeof spawnSurveyor === 'function') {
        if (window.surveyor?.el?.parentNode) window.surveyor.el.remove();
        window.surveyor = null;

        // 🧠 Always spawn during stress test, regardless of UI toggle
        spawnSurveyor();

        // 🔇 Hide it if the toggle is off (optional)
        if (!document.getElementById('vis-surveyor').checked) {
            window.surveyor?.el?.classList.add('hidden');
        }
    }


    if (typeof startSimulation === 'function') startSimulation(zone);
}
function spawnSurveyor(){
    initSurveyor();
}





function stopZone(zone) {
    if (typeof stopSimulation === 'function') stopSimulation(zone);
    clearTimeout(zoneStates[zone].survivalTimeout);
    zoneStates[zone].failed = true;

    // ✅ Dim the grid cells visually to mark failure
    document.querySelectorAll(`.grid-cell.zone-${zone}`).forEach(el => {
        el.style.opacity = 0.3;
    });

    // ✅ Show overlay *before* clearing any KPI or chart data
    if (!window.zoneOverlays) window.zoneOverlays = {};
    if (!window.zoneOverlays[zone]) {
        const { workers, pickers } = stressTestPhases[currentPickerIndex];
        showOverlay(zone, 'Lager überlastet!', 'red', 30000, workers, pickers);
    }

    // 🧠 Do NOT reset KPI UI or simulation state yet —
    // This is now handled in the *next round* in proceedNextRound()
}


function proceedNextRound() {

    if (window.zoneOverlays) {
        for (const ov of Object.values(window.zoneOverlays)) {
            if (ov?.parentNode) ov.parentNode.removeChild(ov);
        }
        window.zoneOverlays = {};
    }

    const totalSeconds = 30;
    const roundDurationMs = totalSeconds * 1000;
    const { pickers, label } = stressTestPhases[currentPickerIndex];


    startAllZones(roundDurationMs);
    setTimeout(() => {
        for (const z of zones) {
            if (!zoneStates[z].failed) {
                zoneStates[z].completed = true;
                const { workers, pickers } = stressTestPhases[currentPickerIndex];
                showOverlay(z, 'Lagerperformance', 'white', 5000, workers, pickers);

            }
        }
    }, roundDurationMs - 5000);




    // Show countdown UI
    const wrapper = document.getElementById('stress-bar-wrapper');
    const heading = document.getElementById('stress-test-heading');
    const bar = document.getElementById('countdown-bar');

    wrapper.style.display = 'flex';
    wrapper.style.zIndex = 9999;
    heading.textContent = `Stresstest: ${label} (${pickers} Picker)`;


    bar.style.width = '100%';
    bar.style.backgroundColor = 'limegreen';

    document.querySelectorAll('.stress-seconds').forEach(el => el.remove());
    const secondsFloat = document.createElement('div');
    secondsFloat.className = 'stress-seconds';
    secondsFloat.textContent = `${totalSeconds}s`;
    bar.appendChild(secondsFloat);

    const monitorInterval = setInterval(() => {
        for (const z of zones) {
            const overflow = parseInt(document.getElementById(`overflow-${z}`).innerText, 10);
            if (!zoneStates[z].failed && !zoneStates[z].completed && overflow >= 100) {
                stopZone(z);
                zoneStates[z].failed = true;
                const { workers, pickers } = stressTestPhases[currentPickerIndex];
                showOverlay(z, 'Lagerperformance', 'red', 5000, workers, pickers);

            }
        }
    }, 250);

    const startTime = performance.now();
    const endTime = startTime + roundDurationMs;
    let lastRenderedSecond = totalSeconds;

    const countdownInterval = setInterval(() => {
        const now = performance.now();
        const remainingMs = Math.max(0, endTime - now);
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        const pct = (remainingMs / roundDurationMs) * 100;

        if (remainingSeconds !== lastRenderedSecond) {
            lastRenderedSecond = remainingSeconds;
            secondsFloat.textContent = `${remainingSeconds}s`;
        }

        bar.style.width = `${pct}%`;
        if (pct <= 50) bar.style.backgroundColor = 'orange';
        if (pct <= 20) bar.style.backgroundColor = 'red';

        if (remainingMs <= 0) {
            clearInterval(countdownInterval);
            clearInterval(monitorInterval);
            secondsFloat.remove();

            const allFailed = zones.every(z => zoneStates[z].failed);
            currentPickerIndex++;

            if (currentPickerIndex >= stressTestPhases.length || allFailed) {
                if (allFailed) {
                    zones.forEach(z => {
                        if (!window.zoneOverlays[z]) {
                            const { workers, pickers } = stressTestPhases[currentPickerIndex];
                            showOverlay(z, 'Lagerperformance', 'red', 5000, workers, pickers);

                        }
                    });
                }
                endStressTest();
                return;
            }

            for (const z of zones) {
                zoneStates[z].completed = false;
                zoneStates[z].failed = false;
                zoneStates[z].startTime = performance.now();

                document.getElementById(`log-${z}`).textContent = '';
                document.getElementById(`load-${z}`).textContent = '0/160';
                document.getElementById(`avg-picktime-${z}`).textContent = '0';
                document.getElementById(`shadow-${z}`).textContent = '0';
                document.getElementById(`survey-shadow-${z}`).textContent = '0';
                document.getElementById(`shadow-mistakes-${z}`).textContent = '0';
                document.getElementById(`access-count-${z}`).textContent = '0';
                document.getElementById(`overflow-${z}`).textContent = '0';
                document.getElementById(`pick-${z}`).textContent = '0';
                document.getElementById(`put-${z}`).textContent = '0';

                const canvas = document.getElementById(`chart-${z}`);
                if (canvas?.getContext) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }

                resetZoneSimulationState(z);
                document.querySelectorAll(`.grid-cell.zone-${z}`).forEach(el => {
                    el.style.opacity = 1;
                });
            }

            proceedNextRound();
        }
    }, 100);
}




function resetZoneSimulationState(zone) {
    // Remove DOM entities
    document.querySelectorAll(`.worker.${zone}, .picker.${zone}, .surveyor.${zone}`).forEach(el => el.remove());

    if (zone === 'fixed') {
        // Remove surveyor element if present
        if (window.surveyor?.el?.parentNode) {
            window.surveyor.el.remove();
        }
        window.surveyor = null;

        // Clean container
        if (surveyorsEl) surveyorsEl.innerHTML = '';
    }

    // Reset logic structures
    workers[zone] = [];
    pickers[zone] = [];

    // Reset shelves
    const shelves = window[`${zone}Shelves`] || grid.filter(c => c.type === `zone-${zone}`);
    for (const shelf of shelves) {
        shelf.contents = [];
        shelf.bins = 0;
        shelf.correctBins = 0;
        shelf.wrongBins = 0;
        shelf.reserved = [];
        if (zone === 'fixed') shelf.reservedBins = 0;
    }

    // Reset bin index
    if (binIndex[zone]) binIndex[zone].clear();

    // Reset survey data
    if (surveyData[zone]) surveyData[zone] = [];

    // Clear chart
    const chart = chartInstances[`chart-${zone}`];
    if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update();
    }

    // KPI + counter resets
    stats[zone] = { shadow: 0, surveyShadow: 0, overflow: 0 };
    counters[zone] = { picks: 0, puts: 0 };
    logs[zone] = [];

    // KPI UI values
    document.getElementById(`pick-${zone}`).textContent = '0';
    document.getElementById(`put-${zone}`).textContent = '0';
    document.getElementById(`shadow-${zone}`).textContent = '0';
    document.getElementById(`survey-shadow-${zone}`).textContent = '0';
    document.getElementById(`overflow-${zone}`).textContent = '0';
    document.getElementById(`log-${zone}`).textContent = '';
    document.getElementById(`load-${zone}`).textContent = '0/160';

    // Re-initialize
    updateWorkerCount(zone);
    updatePickerCount(zone);
    drawGrid();
}






function endStressTest() {

    if (window.zoneOverlays) {
        for (const ov of Object.values(window.zoneOverlays)) {
            if (ov?.parentNode) ov.parentNode.removeChild(ov);
        }
        window.zoneOverlays = {};
    }

    stressTestActive = false;
    document.body.classList.remove('stress-active');
    console.log('Stress test finished.');

    // 🧹 Hide countdown bar at end
    const stressWrapper = document.getElementById('stress-bar-wrapper');
    stressWrapper.style.display = 'none';
    document.getElementById('countdown-bar').style.width = '100%';
}


function showOverlay(zone, title, bgColor, persistentDurationMs = null, workersOverride = null, pickersOverride = null) {
    if (!window.zoneOverlays) window.zoneOverlays = {};
    if (window.zoneOverlays[zone]) return;

    const container = document.getElementById('grid');
    const overlay = document.createElement('div');
    overlay.className = 'stress-overlay';

    const zoneNames = {
        fixed: 'Festplatzlager',
        chaos: 'Chaotisches Lager',
        hybrid: 'Hybrides Zonenlager'
    };

    const workerCount = workersOverride ?? document.getElementById(`cnt-${zone}`).value;
    const pickerCount = pickersOverride ?? document.getElementById(`cnt-picker-${zone}`).value;


    overlay.innerHTML = `
        <h2>${title}</h2>
        <p><strong>${zoneNames[zone]}</strong></p>
        <p><i class="fas fa-users"></i> ${workerCount} Workers, ${pickerCount} Picker</p>
        <p><i class="fas fa-clock"></i> Ø Pickzeit: ${document.getElementById(`avg-picktime-${zone}`).innerText} Ticks</p>
        <p><i class="fas fa-exclamation-triangle"></i> Schattenbestände: ${document.getElementById(`shadow-${zone}`).innerText}</p>
        <p><i class="fas fa-hand-paper"></i> Picks: ${document.getElementById(`pick-${zone}`).innerText}</p>
        <p><i class="fas fa-box"></i> Puts: ${document.getElementById(`put-${zone}`).innerText}</p>
    `;

    const top = getZoneTopPercent(zone);
    Object.assign(overlay.style, {
        position: 'absolute',
        left: '0',
        width: '100%',
        height: `${100 / 3}%`,
        top: `${top}%`,
        backgroundColor: bgColor,
        color: '#000',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: '1.2rem',
        zIndex: '1000',
        opacity: '0.95',
        textAlign: 'center',
        padding: '1rem'
    });

    container.appendChild(overlay);
    window.zoneOverlays[zone] = overlay;

    if (typeof persistentDurationMs === 'number' && persistentDurationMs > 0) {
        setTimeout(() => {
            if (overlay?.parentNode) {
                overlay.parentNode.removeChild(overlay);
                delete window.zoneOverlays[zone];
            }
        }, persistentDurationMs);
    }
}


function getZoneTopPercent(zone) {
    switch (zone) {
        case 'fixed': return 0;
        case 'chaos': return 33.33;
        case 'hybrid': return 66.66;
        default: return 0;
    }
}
