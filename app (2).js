/* ==========================================================================
   SMART-BELT AI — Main Dashboard Application Controller
   ========================================================================== */

let audioContext = null;
let alarmOscillator = null;
let isAlarmSounding = false;
let currentJointId = "J001";
let demoModeActive = true;

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
        const json = await res.json();

        if (Array.isArray(json) && json.length > 0) {
            const latest = json[0];
            const predictionRes = await fetch("/api/predict", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    vibration: latest.vibration,
                    temperature: latest.temperature,
                    sound_level: latest.sound_level
                })
            });

            const prediction = await predictionRes.json();

            latest.health_score = prediction.health_score;
            latest.risk_level = prediction.risk_level;

            updateDashboardUI(latest);
        }
    } catch (err) {
        console.error("Telemetry fetch error:", err);
    }
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

    // SVG arc stroke-dasharray is 126. Total arc offset:
    // 126 = 0% health, 0 = 100% health
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
        const json = await res.json();

        if (json.success && json.history) {
            renderPredictiveTrendChart(json.history);

            document.getElementById("pred-joint-name").innerText = jointId;
            
            const latest = json.history[json.history.length - 1];
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
    } catch (err) {
        console.error("Predictive trend load error:", err);
    }
}

// =========================================================================
// HISTORY TABLE & FILTERS
// =========================================================================

async function applyHistoryFilters() {
    const jFilter = document.getElementById("filter-joint").value;
    const rFilter = document.getElementById("filter-risk").value;
    const dFilter = document.getElementById("filter-date").value;

    try {
        const url = `/api/history?joint_id=${jFilter}&risk=${rFilter}&date=${dFilter}`;
        const res = await fetch(url);
        const json = await res.json();

        if (json.success && json.data) {
            renderHistoryTable(json.data);
        }
    } catch (err) {
        console.error("History filter error:", err);
    }
}

function renderHistoryTable(records) {
    const tbody = document.getElementById("history-table-body");
    tbody.innerHTML = "";

    if (records.length === 0) {
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
    window.open("/api/history?joint_id=ALL&risk=ALL", "_blank");
}

// =========================================================================
// CONVEYOR CONTROL ACTIONS
// =========================================================================

async function sendConveyorControl(action) {
    try {
        const res = await fetch("/api/conveyor/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action })
        });
        const json = await res.json();
        if (json.success) {
            fetchTelemetry();
        }
    } catch (err) {
        console.error("Conveyor control error:", err);
    }
}

async function toggleDemoMode(enabled) {
    try {
        await fetch("/api/demo/mode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enable: enabled })
        });
        fetchTelemetry();
    } catch (err) {
        console.error("Demo mode toggle error:", err);
    }
}

async function triggerSimulatedFault() {
    try {
        const res = await fetch("/api/demo/simulate-damage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ joint_id: currentJointId })
        });
        const json = await res.json();
        alert(`⚡ FAULT INJECTED! Next passing joint will simulate severe vibration and joint crack.`);
    } catch (err) {
        console.error("Fault simulation error:", err);
    }
}

async function acknowledgeAlert() {
    try {
        await fetch("/api/alerts/acknowledge", { method: "POST" });
        stopAlarmAudio();
        fetchTelemetry();
    } catch (err) {
        console.error("Alert acknowledge error:", err);
    }
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
        alarmOscillator.frequency.setValueAtTime(880, audioContext.currentTime); // 880 Hz
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
