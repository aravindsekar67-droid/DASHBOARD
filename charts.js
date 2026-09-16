/* ==========================================================================
   SMART-BELT AI — Dynamic Chart.js Manager
   ========================================================================== */

let liveSensorsChart = null;
let predictiveTrendChart = null;

const chartTimeLabels = [];
const vibData = [];
const tempData = [];
const soundData = [];

function initLiveSensorsChart() {
    const ctx = document.getElementById('liveSensorsChart').getContext('2d');
    
    liveSensorsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartTimeLabels,
            datasets: [
                {
                    label: 'Vibration (g)',
                    data: vibData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yVib',
                    pointRadius: 2
                },
                {
                    label: 'Temperature (°C)',
                    data: tempData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yTemp',
                    pointRadius: 2
                },
                {
                    label: 'Sound (dB)',
                    data: soundData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'ySound',
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            scales: {
                x: {
                    grid: { color: '#1e293b' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                yVib: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Vibration (g)', color: '#f59e0b', font: { size: 11 } },
                    min: 0,
                    max: 4.0,
                    grid: { color: '#1e293b' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                yTemp: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Temp (°C)', color: '#ef4444', font: { size: 11 } },
                    min: 20,
                    max: 100,
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                ySound: {
                    type: 'linear',
                    position: 'right',
                    title: { display: false },
                    min: 40,
                    max: 120,
                    display: false
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#cbd5e1', font: { size: 11 } }
                }
            }
        }
    });
}

function updateLiveSensorsChart(timestampStr, vibVal, tempVal, soundVal) {
    if (!liveSensorsChart) return;

    const timeShort = timestampStr ? timestampStr.split(' ')[1] || timestampStr : new Date().toLocaleTimeString();

    chartTimeLabels.push(timeShort);
    vibData.push(vibVal);
    tempData.push(tempVal);
    soundData.push(soundVal);

    // Keep max 20 data points
    if (chartTimeLabels.length > 20) {
        chartTimeLabels.shift();
        vibData.shift();
        tempData.shift();
        soundData.shift();
    }

    liveSensorsChart.update();
}

function renderPredictiveTrendChart(historyData) {
    const ctx = document.getElementById('predictiveTrendChart').getContext('2d');
    
    const labels = historyData.map(h => h.timestamp ? h.timestamp.split(' ')[0] : '');
    const healthScores = historyData.map(h => h.health_score);

    if (predictiveTrendChart) {
        predictiveTrendChart.destroy();
    }

    predictiveTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Joint Health (%)',
                    data: healthScores,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    fill: true,
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: '#1e293b' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: '#1e293b' },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    title: { display: true, text: 'Health Score (%)', color: '#10b981' }
                }
            },
            plugins: {
                legend: { labels: { color: '#cbd5e1' } }
            }
        }
    });
}
