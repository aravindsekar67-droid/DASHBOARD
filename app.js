/* ==========================================================================
   SMART-BELT AI — Main Dashboard Application Controller
   ========================================================================== */

let audioContext = null;
let alarmOscillator = null;
let isAlarmSounding = false;
let currentJointId = "J001";
let demoModeActive = true;

// Chart references
let liveSensorsChart = null;
let predictiveTrendChart = null;

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
    loadJointPredictiveTrend("J001", false); // Do not pop up modal automatically on initial load
    applyHistoryFilters();

    // Poll current telemetry every 1.2 seconds
    setInterval(fetchTelemetry, 1200);
});

// =========================================================================
// TELEMETRY FETCH & DASHBOARD UPDATE
// =========================================================================

async function fetchTelemetry() {
    // If running on GitHub Pages or local static file, directly bypass API server
    if (window.location.hostname.includes("github.io") || window.location.protocol === "file:") {
        runClientTelemetrySimulation();
        return;
    }

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
    
    const kpiStatus = document.getElementById("kpi-status-text");
    if (kpiStatus) kpiStatus.innerText = statusText;

    const kpiSpeed = document.getElementById("kpi-speed");
    if (kpiSpeed) kpiSpeed.innerText = speed.toFixed(2);
    
    const statusBadge = document.getElementById("badge-conveyor-status");
    if (statusBadge) {
        statusBadge.innerText = statusText;
        statusBadge.className = "badge " + (statusText === "RUNNING" ? "badge-normal" : "badge-critical");
    }

    const modeText = document.getElementById("system-mode-text");
    demoModeActive = data.demo_mode ?? true;
    const modeToggle = document.getElementById("demo-mode-toggle");
    if (modeToggle) modeToggle.checked = demoModeActive;
    if (modeText) modeText.innerText = demoModeActive ? "SYSTEM ONLINE (DEMO MODE)" : "SYSTEM ONLINE (ESP32 HARDWARE)";

    // 2. Statistics Counter
    const statTotal = document.getElementById("stat-total-inspected");
    if (statTotal) statTotal.innerText = data.total_inspections || 0;
    const statWarn = document.getElementById("stat-warnings");
    if (statWarn) statWarn.innerText = data.warning_count || 0;
    const statCrit = document.getElementById("stat-criticals");
    if (statCrit) statCrit.innerText = data.critical_count || 0;

    // 3. Latest Sensor Reading
    const latest = data.latest_reading;
    if (latest) {
        currentJointId = latest.joint_id;
        const jIdElem = document.getElementById("kpi-joint-id");
        if (jIdElem) jIdElem.innerText = latest.joint_id;

        const rfidElem = document.getElementById("kpi-rfid-tag");
        if (rfidElem) rfidElem.innerText = latest.rfid_tag_id || "RFID-E200001";

        const timeElem = document.getElementById("kpi-last-time");
        if (timeElem) timeElem.innerText = latest.timestamp ? latest.timestamp.split(" ")[1] : "Just now";

        // Sensor Cards
        const temp = latest.temperature_c;
        const vib = latest.vibration_g;
        const sound = latest.sound_db;

        const kTemp = document.getElementById("kpi-temp");
        if (kTemp) kTemp.innerHTML = `${temp.toFixed(1)} <span class="unit">°C</span>`;

        const kVib = document.getElementById("kpi-vib");
        if (kVib) kVib.innerHTML = `${vib.toFixed(2)} <span class="unit">g</span>`;

        const kSound = document.getElementById("kpi-sound");
        if (kSound) kSound.innerHTML = `${sound.toFixed(1)} <span class="unit">dB</span>`;

        // Progress Bars
        const tProg = document.getElementById("temp-progress");
        if (tProg) tProg.style.width = `${Math.min(100, (temp / 90) * 100)}%`;

        const vProg = document.getElementById("vib-progress");
        if (vProg) vProg.style.width = `${Math.min(100, (vib / 3.5) * 100)}%`;

        const sProg = document.getElementById("sound-progress");
        if (sProg) sProg.style.width = `${Math.min(100, (sound / 110) * 100)}%`;

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
    const banner = document.getElementById("critical-alarm-banner") || document.getElementById("alarm-banner");
    
    if (banner) {
        if (activeAlert && !activeAlert.acknowledged && (activeAlert.severity === "CRITICAL" || activeAlert.severity === "HIGH")) {
            banner.classList.remove("hidden");
            const aTitle = document.getElementById("alarm-title");
            if (aTitle) aTitle.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> CRITICAL ALERT: ${activeAlert.joint_id}`;
            
            const aMsg = document.getElementById("alarm-message") || document.getElementById("alarm-desc");
            if (aMsg) aMsg.innerText = activeAlert.reason;
            
            // Trigger Audio Siren
            startAlarmAudio();
        } else {
            banner.classList.add("hidden");
            stopAlarmAudio();
        }
    }
}

// =========================================================================
// HEALTH GAUGE CALCULATION
// =========================================================================

function updateHealthGauge(health, risk) {
    const kHealth = document.getElementById("kpi-health-score") || document.getElementById("kpi-health-number");
    if (kHealth) kHealth.innerText = health.toFixed(1);
    
    const riskBadge = document.getElementById("badge-risk-level") || document.getElementById("joint-status-badge");
    const bandText = document.getElementById("health-band-name") || document.getElementById("kpi-health-band");
    const fillPath = document.getElementById("gauge-fill-path") || document.getElementById("gauge-arc");

    if (riskBadge) riskBadge.innerText = `${risk} RISK`;

    // SVG arc stroke-dasharray is 126. Total arc offset: 126 = 0% health, 0 = 100% health
    const offset = 126 - (health / 100) * 126;
    if (fillPath) fillPath.style.strokeDashoffset = offset;

    if (health >= 80) {
        if (riskBadge) riskBadge.className = "badge badge-normal";
        if (fillPath) fillPath.style.stroke = "#10b981";
        if (bandText) {
            bandText.innerText = "NORMAL (80-100%)";
            bandText.className = "health-band-indicator text-green";
        }
    } else if (health >= 60) {
        if (riskBadge) riskBadge.className = "badge badge-warning";
        if (fillPath) fillPath.style.stroke = "#f59e0b";
        if (bandText) {
            bandText.innerText = "WARNING (60-79%)";
            bandText.className = "health-band-indicator text-yellow";
        }
    } else if (health >= 30) {
        if (riskBadge) riskBadge.className = "badge badge-danger";
        if (fillPath) fillPath.style.stroke = "#f97316";
        if (bandText) {
            bandText.innerText = "DANGER (30-59%)";
            bandText.className = "health-band-indicator text-yellow";
        }
    } else {
        if (riskBadge) riskBadge.className = "badge badge-critical";
        if (fillPath) fillPath.style.stroke = "#ef4444";
        if (bandText) {
            bandText.innerText = "CRITICAL (0-29%)";
            bandText.className = "health-band-indicator text-red";
        }
    }
}

// =========================================================================
// ESP32-CAM VISUAL INSPECTION VIEW RENDERER
// =========================================================================

function updateCameraView(jointId, result, timestamp) {
    const cId = document.getElementById("cam-joint-id-text");
    if (cId) cId.innerText = jointId;

    const cRes = document.getElementById("cam-result-text");
    if (cRes) cRes.innerText = result;

    const cRfid = document.getElementById("cam-overlay-rfid");
    if (cRfid) cRfid.innerText = jointId;

    const cTime = document.getElementById("cam-overlay-time");
    if (cTime) cTime.innerText = `STREAM: ${timestamp || "LIVE"}`;

    const camBadge = document.getElementById("camera-result-badge");
    const seamLine = document.getElementById("cam-seam-line");
    const seamDot = document.getElementById("cam-seam-dot");
    const bbox = document.getElementById("cam-bbox") || document.getElementById("cam-bounding-box");
    const bboxLabel = document.getElementById("cam-bbox-label") || document.getElementById("cam-bounding-text");
    const aiStatus = document.getElementById("cam-ai-status");

    if (camBadge) camBadge.innerText = result;

    if (result === "NORMAL") {
        if (camBadge) camBadge.className = "badge badge-normal";
        if (seamLine) {
            seamLine.setAttribute("stroke", "#10b981");
            seamLine.setAttribute("stroke-dasharray", "none");
        }
        if (seamDot) seamDot.setAttribute("fill", "#10b981");
        if (bbox) bbox.setAttribute("stroke", "#10b981");
        if (bboxLabel) {
            bboxLabel.setAttribute("fill", "#10b981");
            bboxLabel.textContent = "AI CONF: 98.6% NORMAL";
        }
        if (aiStatus) aiStatus.innerHTML = `<span class="text-green"><i class="fa-solid fa-circle-check"></i> NO DAMAGE DETECTED</span>`;
    } else if (result === "CRACK DETECTED") {
        if (camBadge) camBadge.className = "badge badge-warning";
        if (seamLine) {
            seamLine.setAttribute("stroke", "#f59e0b");
            seamLine.setAttribute("stroke-dasharray", "4,2");
        }
        if (seamDot) seamDot.setAttribute("fill", "#f59e0b");
        if (bbox) bbox.setAttribute("stroke", "#f59e0b");
        if (bboxLabel) {
            bboxLabel.setAttribute("fill", "#f59e0b");
            bboxLabel.textContent = "AI CONF: 89.2% MICRO-CRACK";
        }
        if (aiStatus) aiStatus.innerHTML = `<span class="text-yellow"><i class="fa-solid fa-triangle-exclamation"></i> SURFACE MICRO-CRACK</span>`;
    } else if (result === "JOINT DAMAGE" || result === "JOINT SEPARATION") {
        if (camBadge) camBadge.className = "badge badge-critical";
        if (seamLine) {
            seamLine.setAttribute("stroke", "#ef4444");
            seamLine.setAttribute("stroke-dasharray", "8,8");
        }
        if (seamDot) seamDot.setAttribute("fill", "#ef4444");
        if (bbox) bbox.setAttribute("stroke", "#ef4444");
        if (bboxLabel) {
            bboxLabel.setAttribute("fill", "#ef4444");
            bboxLabel.textContent = `AI CONF: 97.8% ${result}`;
        }
        if (aiStatus) aiStatus.innerHTML = `<span class="text-red"><i class="fa-solid fa-skull-crossbones"></i> ${result} RUPTURE RISK</span>`;
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
// CHARTS (CHART.JS IMPLEMENTATION)
// =========================================================================

function initLiveSensorsChart() {
    const canvas = document.getElementById("liveSensorsChart") || document.getElementById("telemetryChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    liveSensorsChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Vibration (g x 100)",
                    borderColor: "#06b6d4",
                    backgroundColor: "rgba(6, 182, 212, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                },
                {
                    label: "Temperature (°C)",
                    borderColor: "#f59e0b",
                    backgroundColor: "rgba(245, 158, 11, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                },
                {
                    label: "Sound (dB)",
                    borderColor: "#8b5cf6",
                    backgroundColor: "rgba(139, 92, 246, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    grid: { color: "#1e293b" },
                    ticks: { color: "#64748b", font: { size: 10 } }
                },
                y: {
                    grid: { color: "#1e293b" },
                    ticks: { color: "#94a3b8", font: { size: 10 } },
                    suggestedMin: 20,
                    suggestedMax: 100
                }
            },
            plugins: {
                legend: {
                    labels: { color: "#94a3b8", font: { size: 11 } }
                }
            }
        }
    });
}

function updateLiveSensorsChart(timestamp, vib, temp, sound) {
    if (!liveSensorsChart) return;
    const timeLabel = timestamp ? timestamp.split(" ")[1] : new Date().toLocaleTimeString();

    if (liveSensorsChart.data.labels.length > 15) {
        liveSensorsChart.data.labels.shift();
        liveSensorsChart.data.datasets[0].data.shift();
        liveSensorsChart.data.datasets[1].data.shift();
        liveSensorsChart.data.datasets[2].data.shift();
    }

    liveSensorsChart.data.labels.push(timeLabel);
    liveSensorsChart.data.datasets[0].data.push(vib * 100);
    liveSensorsChart.data.datasets[1].data.push(temp);
    liveSensorsChart.data.datasets[2].data.push(sound);
    liveSensorsChart.update();
}

function renderPredictiveTrendChart(historyData) {
    const canvas = document.getElementById("predictiveTrendChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const labels = historyData.map(h => h.timestamp.split(" ")[0]);
    const dataPoints = historyData.map(h => h.health_score);

    if (predictiveTrendChart) {
        predictiveTrendChart.data.labels = labels;
        predictiveTrendChart.data.datasets[0].data = dataPoints;
        predictiveTrendChart.update();
        return;
    }

    predictiveTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Health Score Trend (%)",
                data: dataPoints,
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                fill: true,
                tension: 0.3,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: "#1e293b" }, ticks: { color: "#64748b" } },
                y: { min: 0, max: 100, grid: { color: "#1e293b" }, ticks: { color: "#94a3b8" } }
            },
            plugins: {
                legend: { labels: { color: "#94a3b8" } }
            }
        }
    });
}

// =========================================================================
// PREDICTIVE MONITORING & 30-DAY AI TREND ANALYSIS
// =========================================================================

async function loadJointPredictiveTrend(jointId, showReportModal = true) {
    try {
        const res = await fetch(`/api/joints/${jointId}/history`);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.history) {
                renderPredictiveTrendChart(json.history);
                updatePredictiveInsightsUI(jointId, json.history, showReportModal);
                return;
            }
        }
    } catch (err) {}

    // Fallback for static hosting using 30-day periodic intervals
    const historyData = generateMockJointHistory(jointId);
    renderPredictiveTrendChart(historyData);
    updatePredictiveInsightsUI(jointId, historyData, showReportModal);
}

// Generates periodic historical inspections sampled every 30 days (6 intervals)
function generateMockJointHistory(jointId) {
    const mock = [];
    const now = Date.now();
    const thirtyDaysMs = 30 * 86400000;
    
    // Seed slight offset variance based on joint number
    const jNum = parseInt(jointId.replace("J", ""), 10) || 1;
    const baseHealth = 98 - (jNum % 4) * 1.5;

    for (let i = 0; i < 6; i++) {
        // Step back in 30-day blocks
        const d = new Date(now - (5 - i) * thirtyDaysMs);
        const degradation = (i * 2.8) + (Math.random() * 1.2 - 0.6);
        const score = parseFloat(Math.min(100, Math.max(35, baseHealth - degradation)).toFixed(1));

        mock.push({
            timestamp: d.toISOString().split('T')[0],
            joint_id: jointId,
            health_score: score
        });
    }
    return mock;
}

function updatePredictiveInsightsUI(jointId, historyData, showReportModal = true) {
    const pName = document.getElementById("pred-joint-name");
    if (pName) pName.innerText = jointId;

    if (!historyData || historyData.length < 2) return;

    const latest = historyData[historyData.length - 1];
    const previous = historyData[historyData.length - 2];
    const health = latest.health_score;

    // Calculate wear degradation across the 30-day interval
    const wear30Day = parseFloat((previous.health_score - health).toFixed(1));
    const curH = document.getElementById("pred-current-health");
    if (curH) curH.innerText = `${health.toFixed(1)}%`;

    const estDays = Math.max(1, Math.round((health - 30) / (wear30Day > 0 ? wear30Day / 30 : 0.1)));
    const daysElem = document.getElementById("pred-est-days");
    const recElem = document.getElementById("pred-recommendation");

    if (health >= 80) {
        if (daysElem) {
            daysElem.innerText = `${estDays} Days`;
            daysElem.className = "text-green";
        }
        if (recElem) recElem.innerHTML = `<i class="fa-solid fa-circle-check text-green"></i> 30-Day Trend Normal: Steady ${wear30Day}% wear per 30-day cycle. Scheduled routine scan in 30 days.`;
    } else if (health >= 60) {
        if (daysElem) {
            daysElem.innerText = `${estDays} Days`;
            daysElem.className = "text-yellow";
        }
        if (recElem) recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-yellow"></i> 30-Day Trend Warning: Splice degradation accelerated by ${wear30Day}%. Schedule vulcanization audit.`;
    } else {
        if (daysElem) {
            daysElem.innerText = `< 3 Days (URGENT)`;
            daysElem.className = "text-red";
        }
        if (recElem) recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red"></i> 30-Day Critical Trip: Fatigue degradation breached safe limits. Immediate interlock shutdown!`;
    }

    // Trigger AI notification report for this joint if user selected it
    if (showReportModal) {
        trigger30DayAIReport(jointId, health, wear30Day, estDays);
    }
}

function trigger30DayAIReport(jointId, currentHealth, wearRate, remainingDays) {
    const modal = document.getElementById("trendReportModal");
    if (!modal) return;

    const title = document.getElementById("reportModalTitle");
    const badge = document.getElementById("reportSummaryBadge");
    const text = document.getElementById("reportSummaryText");
    const wearVal = document.getElementById("reportWearRate");
    const estVal = document.getElementById("reportEstDays");

    if (title) title.innerText = `30-Day AI Trend Audit: ${jointId}`;
    if (wearVal) wearVal.innerText = `-${wearRate}% / cycle`;
    if (estVal) estVal.innerText = `${remainingDays} Days`;

    if (currentHealth >= 80) {
        badge.className = "report-alert-badge";
        badge.style.borderColor = "#10b981";
        badge.style.color = "#10b981";
        badge.innerText = "NORMAL 30-DAY WEAR RATE";
        text.innerText = `AI Analysis: Joint ${jointId} degradation over the last 30 days is consistent with nominal mechanical wear (${wearRate}% reduction). Core vulcanized splice layers remain intact. Routine continuous monitoring remains active.`;
    } else if (currentHealth >= 60) {
        badge.className = "report-alert-badge";
        badge.style.borderColor = "#f59e0b";
        badge.style.color = "#f59e0b";
        badge.innerText = "ACCELERATED SPLICE FATIGUE";
        text.innerText = `AI Advisory: Joint ${jointId} is exhibiting accelerated splice fatigue. Vibration and micro-fissure expansion rates have increased by ${wearRate}% across the 30-day baseline. Re-inspection recommended within 14 days.`;
    } else {
        badge.className = "report-alert-badge";
        badge.style.borderColor = "#ef4444";
        badge.style.color = "#ef4444";
        badge.innerText = "CRITICAL SEPARATION HAZARD";
        text.innerText = `AI Urgent Dispatch: Joint ${jointId} has degraded by ${wearRate}% over the cycle and breached the 30% structural threshold. Risk of catastrophic conveyor belt tear is elevated. Belt speed should be reduced immediately.`;
    }

    modal.classList.remove("hidden");
}

function closeTrendReport() {
    const modal = document.getElementById("trendReportModal");
    if (modal) modal.classList.add("hidden");
}

// =========================================================================
// HISTORY TABLE & FILTERS
// =========================================================================

async function applyHistoryFilters() {
    const jFilterElem = document.getElementById("filter-joint");
    const rFilterElem = document.getElementById("filter-risk");
    const jFilter = jFilterElem ? jFilterElem.value : "ALL";
    const rFilter = rFilterElem ? rFilterElem.value : "ALL";

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
    const tbody = document.getElementById("history-table-body") || document.getElementById("master-joints-tbody");
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
    let csvContent = "data:text/csv;charset=utf-8,Timestamp,Joint_ID,Temp_C,Vib_g,Sound_dB,Speed_mps,Camera,Health_Score,Risk\n";
    clientState.history.forEach(r => {
        csvContent += `${r.timestamp},${r.joint_id},${r.temperature_c},${r.vibration_g},${r.sound_db},${r.belt_speed_mps},${r.camera_result},${r.health_score},${r.risk_level}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `smart_belt_inspection_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
