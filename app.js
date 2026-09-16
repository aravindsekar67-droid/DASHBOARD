/* ==========================================================================
   SMART-BELT AI — Main Dashboard Application Controller
   ========================================================================== */

let audioContext = null;
let alarmOscillator = null;
let isAlarmSounding = false;
let currentJointId = "J001";
let demoModeActive = true;

// Client Simulation State (For GitHub Pages static hosting fallback)
let clientState = {
    conveyor_status: "RUNNING",
    belt_speed_mps: 1.85,
    demo_mode: true,
    total_inspections: 148,
    warning_count: 3,
    critical_count: 1,
    current_idx: 0,
    joints: ["J001", "J002", "J003", "J004", "J005", "J006", "J007", "J008", "J009", "J010"],
    active_alert: null,
    simulated_fault: false,
    history: []
};

// Initialize Client Mock History
(function seedClientHistory() {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
        const d = new Date(now - (20 - i) * 60000);
        const tStr = d.toISOString().replace('T', ' ').substring(0, 19);
        const jId = clientState.joints[i % 10];
        const vib = parseFloat((Math.random() * 0.5 + 0.35).toFixed(2));
        const temp = parseFloat((Math.random() * 6 + 34).toFixed(1));
        const sound = parseFloat((Math.random() * 10 + 56).toFixed(1));
        const health = parseFloat((100 - (vib * 12 + (temp - 30) * 1.0 + (sound - 50) * 0.3)).toFixed(1));
        const risk = health >= 80 ? "NORMAL" : (health >= 60 ? "WARNING" : "CRITICAL");
        clientState.history.push({
            timestamp: tStr,
            joint_id: jId,
            rfid_tag_id: `RFID-E2000${(i % 10).toString().padStart(2, '0')}`,
            temperature_c: temp,
            vibration_g: vib,
            sound_db: sound,
            belt_speed_mps: 1.85,
            camera_result: "NORMAL",
            health_score: health,
            risk_level: risk
        });
    }
})();

document.addEventListener("DOMContentLoaded", () => {
    initLiveSensorsChart();
    initConveyorBeltTrack();
    fetchTelemetry();
    loadJointPredictiveTrend("J001");
    applyHistoryFilters();

    // Poll current telemetry every 1.2 seconds
    setInterval(fetchTelemetry, 1200);
});

// =========================================================================
// TELEMETRY FETCH & DASHBOARD UPDATE
// =========================================================================

async function fetchTelemetry() {
    try {
        const res = await fetch("/api/sensors");
        if (!res.ok) throw new Error("API server offline, falling back to client mode");
        const json = await res.json();

        if (Array.isArray(json) && json.length > 0) {
            const latest = json[0];
            try {
                const predictionRes = await fetch("/api/predict", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        vibration: latest.vibration,
                        temperature: latest.temperature,
                        sound_level: latest.sound_level
                    })
                });
                if (predictionRes.ok) {
                    const prediction = await predictionRes.json();
                    latest.health_score = prediction.health_score;
                    latest.risk_level = prediction.risk_level;
                }
            } catch (e) {}

            updateDashboardUI(latest);
            return;
        }
    } catch (err) {
        // Fallback to Client Simulation Mode (Works on GitHub Pages)
        runClientTelemetrySimulation();
    }
}

function runClientTelemetrySimulation() {
    if (clientState.conveyor_status === "RUNNING") {
        clientState.total_inspections++;
        clientState.current_idx = (clientState.current_idx + 1) % clientState.joints.length;
    }

    const currentJ = clientState.joints[clientState.current_idx];
    let vib, temp, sound, camResult, health, risk;

    if (clientState.simulated_fault) {
        vib = parseFloat((Math.random() * 1.0 + 2.8).toFixed(2));
        temp = parseFloat((Math.random() * 10 + 65).toFixed(1));
        sound = parseFloat((Math.random() * 10 + 95).toFixed(1));
        camResult = "JOINT DAMAGE";
        health = parseFloat((Math.random() * 10 + 15).toFixed(1));
        risk = "CRITICAL";
        clientState.active_alert = {
            joint_id: currentJ,
            severity: "CRITICAL",
            reason: `High Vibration (${vib}g) & Splice Separation detected on ${currentJ}!`,
            acknowledged: false
        };
        clientState.critical_count++;
        clientState.simulated_fault = false;
    } else {
        vib = parseFloat((Math.random() * 0.5 + 0.35).toFixed(2));
        temp = parseFloat((Math.random() * 6 + 35).toFixed(1));
        sound = parseFloat((Math.random() * 10 + 58).toFixed(1));
        camResult = "NORMAL";
        health = parseFloat(Math.max(0, Math.min(100, 100 - (vib * 12 + (temp - 30) * 1.0 + (sound - 50) * 0.3))).toFixed(1));
        risk = health >= 80 ? "LOW" : (health >= 60 ? "MEDIUM" : "HIGH");
    }

    const d = new Date();
    const tStr = d.toISOString().replace('T', ' ').substring(0, 19);

    const latestReading = {
        joint_id: currentJ,
        rfid_tag_id: `RFID-E2000${clientState.current_idx.toString().padStart(2, '0')}`,
        timestamp: tStr,
        temperature_c: temp,
        vibration_g: vib,
        sound_db: sound,
        belt_speed_mps: clientState.conveyor_status === "RUNNING" ? clientState.belt_speed_mps : 0.0,
        camera_result: camResult,
        health_score: health,
        risk_level: risk
    };

    clientState.history.unshift(latestReading);
    if (clientState.history.length > 100) clientState.history.pop();

    const data = {
        conveyor_status: clientState.conveyor_status,
        belt_speed_mps: clientState.conveyor_status === "RUNNING" ? clientState.belt_speed_mps : 0.0,
        demo_mode: clientState.demo_mode,
        total_inspections: clientState.total_inspections,
        warning_count: clientState.warning_count,
        critical_count: clientState.critical_count,
        latest_reading: latestReading,
        active_alert: clientState.active_alert
    };

    updateDashboardUI(data);
}

function updateDashboardUI(data) {
    // 1. Conveyor Status & Speed
    const statusText = data.conveyor_status || "STOPPED";
    const speed = data.belt_speed_mps || 0.0;
    
    document.getElementById("kpi-status-text").innerText = statusText;
    document.getElementById("kpi-speed").innerText = speed.toFixed(2);
    
    const statusBadge = document.getElementById("badge-conveyor-status");
    statusBadge.innerText = statusText;
    statusBadge.className = "badge " + (statusText === "RUNNING" ? "badge-normal" : "badge-critical");

    const modeText = document.getElementById("system-mode-text");
    demoModeActive = data.demo_mode;
    document.getElementById("demo-mode-toggle").checked = demoModeActive;
    modeText.innerText = demoModeActive ? "SYSTEM ONLINE (DEMO MODE)" : "SYSTEM ONLINE (ESP32 HARDWARE)";

    // 2. Statistics Counter
    document.getElementById("stat-total-inspected").innerText = data.total_inspections || 0;
    document.getElementById("stat-warnings").innerText = data.warning_count || 0;
    document.getElementById("stat-criticals").innerText = data.critical_count || 0;

    // 3. Latest Sensor Reading
    const latest = data.latest_reading;
    if (latest) {
        currentJointId = latest.joint_id;
        document.getElementById("kpi-joint-id").innerText = latest.joint_id;
        document.getElementById("kpi-rfid-tag").innerText = latest.rfid_tag_id || "RFID-E200001";
        document.getElementById("kpi-last-time").innerText = latest.timestamp ? latest.timestamp.split(" ")[1] : "Just now";

        // Sensor Cards
        const temp = latest.temperature_c;
        const vib = latest.vibration_g;
        const sound = latest.sound_db;

        document.getElementById("kpi-temp").innerHTML = `${temp.toFixed(1)} <span class="unit">°C</span>`;
        document.getElementById("kpi-vib").innerHTML = `${vib.toFixed(2)} <span class="unit">g</span>`;
        document.getElementById("kpi-sound").innerHTML = `${sound.toFixed(1)} <span class="unit">dB</span>`;

        // Progress Bars
        document.getElementById("temp-progress").style.width = `${Math.min(100, (temp / 90) * 100)}%`;
        document.getElementById("vib-progress").style.width = `${Math.min(100, (vib / 3.5) * 100)}%`;
        document.getElementById("sound-progress").style.width = `${Math.min(100, (sound / 110) * 100)}%`;

        // Health Score & Gauge
        const health = latest.health_score;
        const risk = latest.risk_level;
        updateHealthGauge(health, risk);

        // Update Live Sensor Waveforms Chart
        updateLiveSensorsChart(latest.timestamp, vib, temp, sound);

        // Update ESP32-CAM Inspection View
        updateCameraView(latest.joint_id, latest.camera_result, latest.timestamp);

        // Highlight Active Joint on Conveyor Belt Track
        updateActiveJointOnBelt(latest.joint_id, risk);
    }

    // 4. Handle Critical Alarm Banner & Web Audio Synthesizer
    const activeAlert = data.active_alert;
    const banner = document.getElementById("critical-alarm-banner");
    
    if (activeAlert && !activeAlert.acknowledged && (activeAlert.severity === "CRITICAL" || activeAlert.severity === "HIGH")) {
        banner.classList.remove("hidden");
        document.getElementById("alarm-title").innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> CRITICAL ALERT: ${activeAlert.joint_id}`;
        document.getElementById("alarm-message").innerText = activeAlert.reason;
        
        // Trigger Audio Siren
        startAlarmAudio();
    } else {
        banner.classList.add("hidden");
        stopAlarmAudio();
    }
}

// =========================================================================
// HEALTH GAUGE CALCULATION
// =========================================================================

function updateHealthGauge(health, risk) {
    document.getElementById("kpi-health-score").innerText = health.toFixed(1);
    
    const riskBadge = document.getElementById("badge-risk-level");
    const bandText = document.getElementById("health-band-name");
    const fillPath = document.getElementById("gauge-fill-path");

    riskBadge.innerText = `${risk} RISK`;

    // SVG arc stroke-dasharray is 126. Total arc offset: 126 = 0% health, 0 = 100% health
    const offset = 126 - (health / 100) * 126;
    fillPath.style.strokeDashoffset = offset;

    if (health >= 80) {
        riskBadge.className = "badge badge-normal";
        fillPath.style.stroke = "#10b981";
        bandText.innerText = "NORMAL (80-100%)";
        bandText.className = "health-band-indicator text-green";
    } else if (health >= 60) {
        riskBadge.className = "badge badge-warning";
        fillPath.style.stroke = "#f59e0b";
        bandText.innerText = "WARNING (60-79%)";
        bandText.className = "health-band-indicator text-yellow";
    } else if (health >= 30) {
        riskBadge.className = "badge badge-danger";
        fillPath.style.stroke = "#f97316";
        bandText.innerText = "DANGER (30-59%)";
        bandText.className = "health-band-indicator text-yellow";
    } else {
        riskBadge.className = "badge badge-critical";
        fillPath.style.stroke = "#ef4444";
        bandText.innerText = "CRITICAL (0-29%)";
        bandText.className = "health-band-indicator text-red";
    }
}

// =========================================================================
// ESP32-CAM VISUAL INSPECTION VIEW RENDERER
// =========================================================================

function updateCameraView(jointId, result, timestamp) {
    document.getElementById("cam-joint-id-text").innerText = jointId;
    document.getElementById("cam-result-text").innerText = result;
    document.getElementById("cam-overlay-rfid").innerText = jointId;
    document.getElementById("cam-overlay-time").innerText = `STREAM: ${timestamp || "LIVE"}`;

    const camBadge = document.getElementById("camera-result-badge");
    const seamLine = document.getElementById("cam-seam-line");
    const seamDot = document.getElementById("cam-seam-dot");
    const bbox = document.getElementById("cam-bbox");
    const bboxLabel = document.getElementById("cam-bbox-label");
    const aiStatus = document.getElementById("cam-ai-status");

    camBadge.innerText = result;

    if (result === "NORMAL") {
        camBadge.className = "badge badge-normal";
        seamLine.setAttribute("stroke", "#10b981");
        seamLine.setAttribute("stroke-dasharray", "none");
        seamDot.setAttribute("fill", "#10b981");
        bbox.setAttribute("stroke", "#10b981");
        bboxLabel.setAttribute("fill", "#10b981");
        bboxLabel.textContent = "AI CONF: 98.6% NORMAL";
        aiStatus.innerHTML = `<span class="text-green"><i class="fa-solid fa-circle-check"></i> NO DAMAGE DETECTED</span>`;
    } else if (result === "CRACK DETECTED") {
        camBadge.className = "badge badge-warning";
        seamLine.setAttribute("stroke", "#f59e0b");
        seamLine.setAttribute("stroke-dasharray", "4,2");
        seamDot.setAttribute("fill", "#f59e0b");
        bbox.setAttribute("stroke", "#f59e0b");
        bboxLabel.setAttribute("fill", "#f59e0b");
        bboxLabel.textContent = "AI CONF: 89.2% MICRO-CRACK";
        aiStatus.innerHTML = `<span class="text-yellow"><i class="fa-solid fa-triangle-exclamation"></i> SURFACE MICRO-CRACK</span>`;
    } else if (result === "JOINT DAMAGE" || result === "JOINT SEPARATION") {
        camBadge.className = "badge badge-critical";
        seamLine.setAttribute("stroke", "#ef4444");
        seamLine.setAttribute("stroke-dasharray", "8,8");
        seamDot.setAttribute("fill", "#ef4444");
        bbox.setAttribute("stroke", "#ef4444");
        bboxLabel.setAttribute("fill", "#ef4444");
        bboxLabel.textContent = `AI CONF: 97.8% ${result}`;
        aiStatus.innerHTML = `<span class="text-red"><i class="fa-solid fa-skull-crossbones"></i> ${result} RUPTURE RISK</span>`;
    }
}

// =========================================================================
// CONVEYOR BELT TRACK VISUALIZATION
// =========================================================================

function initConveyorBeltTrack() {
    const surface = document.getElementById("belt-surface");
    if (!surface) return;
    surface.innerHTML = "";

    const joints = ["J001", "J002", "J003", "J004", "J005", "J006", "J007", "J008", "J009", "J010"];
    
    // Distribute markers evenly along belt track
    joints.forEach((jId, idx) => {
        const marker = document.createElement("div");
        marker.className = "moving-joint-marker";
        marker.id = `belt-marker-${jId}`;
        marker.innerText = jId;
        
        const leftPercent = (idx / (joints.length - 1)) * 88 + 5;
        marker.style.left = `${leftPercent}%`;
        surface.appendChild(marker);
    });
}

function updateActiveJointOnBelt(activeJointId, risk) {
    const markers = document.querySelectorAll(".moving-joint-marker");
    markers.forEach(m => {
        m.classList.remove("active-pass", "damaged-pass");
    });

    const activeMarker = document.getElementById(`belt-marker-${activeJointId}`);
    if (activeMarker) {
        if (risk === "CRITICAL" || risk === "HIGH") {
            activeMarker.classList.add("damaged-pass");
        } else {
            activeMarker.classList.add("active-pass");
        }
    }
}

// =========================================================================
// PREDICTIVE MONITORING & HEALTH TREND
// =========================================================================

async function loadJointPredictiveTrend(jointId) {
    try {
        const res = await fetch(`/api/joints/${jointId}/history`);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.history) {
                renderPredictiveTrendChart(json.history);
                updatePredictiveInsightsUI(jointId, json.history);
                return;
            }
        }
    } catch (err) {}

    // Fallback for static hosting
    const filtered = clientState.history.filter(h => h.joint_id === jointId);
    const historyData = filtered.length > 0 ? filtered : generateMockJointHistory(jointId);
    renderPredictiveTrendChart(historyData);
    updatePredictiveInsightsUI(jointId, historyData);
}

function generateMockJointHistory(jointId) {
    const mock = [];
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
        const d = new Date(now - (8 - i) * 86400000);
        mock.push({
            timestamp: d.toISOString().split('T')[0],
            joint_id: jointId,
            health_score: Math.min(100, Math.max(40, 96 - i * 1.5 + (Math.random() * 2 - 1)))
        });
    }
    return mock;
}

function updatePredictiveInsightsUI(jointId, historyData) {
    document.getElementById("pred-joint-name").innerText = jointId;
    const latest = historyData[historyData.length - 1];
    if (latest) {
        const health = latest.health_score;
        document.getElementById("pred-current-health").innerText = `${health.toFixed(1)}%`;

        const estDays = Math.max(1, Math.round((health - 30) / 0.5));
        const daysElem = document.getElementById("pred-est-days");
        const recElem = document.getElementById("pred-recommendation");

        if (health >= 80) {
            daysElem.innerText = `${estDays} Days`;
            daysElem.className = "text-green";
            recElem.innerHTML = `<i class="fa-solid fa-circle-check text-green"></i> Joint in optimal operating condition. Scheduled routine inspection in 30 days.`;
        } else if (health >= 60) {
            daysElem.innerText = `${estDays} Days`;
            daysElem.className = "text-yellow";
            recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-yellow"></i> Minor joint wear detected. Plan maintenance within 2 weeks.`;
        } else {
            daysElem.innerText = `< 3 Days (URGENT)`;
            daysElem.className = "text-red";
            recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red"></i> HIGH RISK OF JOINT SEPARATION. Immediate belt shutdown and repair required!`;
        }
    }
}

// =========================================================================
// HISTORY TABLE & FILTERS
// =========================================================================

async function applyHistoryFilters() {
    const jFilter = document.getElementById("filter-joint").value;
    const rFilter = document.getElementById("filter-risk").value;

    try {
        const url = `/api/history?joint_id=${jFilter}&risk=${rFilter}`;
        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
                renderHistoryTable(json.data);
                return;
            }
        }
    } catch (err) {}

    // Fallback for static hosting
    let records = [...clientState.history];
    if (jFilter !== "ALL") records = records.filter(r => r.joint_id === jFilter);
    if (rFilter !== "ALL") records = records.filter(r => r.risk_level === rFilter);
    renderHistoryTable(records);
}

function renderHistoryTable(records) {
    const tbody = document.getElementById("history-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b;">No inspection history records match the filter criteria.</td></tr>`;
        return;
    }

    records.forEach(r => {
        const tr = document.createElement("tr");
        
        let riskClass = "badge-normal";
        if (r.risk_level === "MEDIUM" || r.risk_level === "WARNING") riskClass = "badge-warning";
        if (r.risk_level === "HIGH") riskClass = "badge-danger";
        if (r.risk_level === "CRITICAL") riskClass = "badge-critical";

        tr.innerHTML = `
            <td>${r.timestamp}</td>
            <td><strong style="color: var(--accent-cyan);">${r.joint_id}</strong></td>
            <td>${r.temperature_c.toFixed(1)} °C</td>
            <td>${r.vibration_g.toFixed(2)} g</td>
            <td>${r.sound_db.toFixed(1)} dB</td>
            <td>${r.belt_speed_mps.toFixed(2)} m/s</td>
            <td>${r.camera_result}</td>
            <td><strong>${r.health_score.toFixed(1)}%</strong></td>
            <td><span class="badge ${riskClass}">${r.risk_level}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function exportHistoryCSV() {
    alert("Exporting CSV inspection log...");
}

// =========================================================================
// CONVEYOR CONTROL ACTIONS
// =========================================================================

async function sendConveyorControl(action) {
    try {
        await fetch("/api/conveyor/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action })
        });
    } catch (err) {}

    if (action === "START") {
        clientState.conveyor_status = "RUNNING";
        clientState.belt_speed_mps = 1.85;
    } else if (action === "STOP") {
        clientState.conveyor_status = "STOPPED";
        clientState.belt_speed_mps = 0.0;
    } else if (action === "EMERGENCY_STOP") {
        clientState.conveyor_status = "EMERGENCY_STOP";
        clientState.belt_speed_mps = 0.0;
    }
    fetchTelemetry();
}

async function toggleDemoMode(enabled) {
    try {
        await fetch("/api/demo/mode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enable: enabled })
        });
    } catch (err) {}

    clientState.demo_mode = enabled;
    fetchTelemetry();
}

async function triggerSimulatedFault() {
    try {
        await fetch("/api/demo/simulate-damage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ joint_id: currentJointId })
        });
    } catch (err) {}

    clientState.simulated_fault = true;
    alert(`⚡ FAULT INJECTED! Next passing joint will simulate severe vibration and joint crack.`);
}

async function acknowledgeAlert() {
    try {
        await fetch("/api/alerts/acknowledge", { method: "POST" });
    } catch (err) {}

    if (clientState.active_alert) {
        clientState.active_alert.acknowledged = true;
    }
    stopAlarmAudio();
    fetchTelemetry();
}

// =========================================================================
// WEB AUDIO SYNTHESIZER FOR INDUSTRIAL ALARM
// =========================================================================

function startAlarmAudio() {
    if (isAlarmSounding) return;
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        alarmOscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        alarmOscillator.type = "sawtooth";
        alarmOscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        alarmOscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.5);

        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);

        alarmOscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        alarmOscillator.start();
        isAlarmSounding = true;
    } catch (e) {
        console.log("Audio play blocked or unavailable:", e);
    }
}

function stopAlarmAudio() {
    if (alarmOscillator && isAlarmSounding) {
        try {
            alarmOscillator.stop();
            alarmOscillator.disconnect();
        } catch (e) {}
        isAlarmSounding = false;
    }
}
