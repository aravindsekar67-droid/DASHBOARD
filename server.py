import os
import random
import time
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, Response
import importlib.util

spec = importlib.util.spec_from_file_location("vision_pipeline", os.path.join(os.path.dirname(__file__), "vision_pipeline.py.py"))
vision_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision_module)
ConveyorJointVisionInspector = vision_module.ConveyorJointVisionInspector

app = Flask(__name__, static_folder=".")
inspector = ConveyorJointVisionInspector()

# Application State
state = {
    "conveyor_status": "RUNNING",
    "belt_speed_mps": 1.85,
    "demo_mode": True,
    "total_inspections": 150,
    "warning_count": 3,
    "critical_count": 1,
    "current_joint_index": 0,
    "joints": [f"J{i:03d}" for i in range(1, 11)],
    "active_alert": None,
    "simulated_fault_joint": None,
    "inspection_history": []
}

# Seed initial history data
def seed_initial_history():
    now = time.time()
    for i in range(25):
        t_str = datetime.fromtimestamp(now - (25 - i) * 60).strftime("%Y-%m-%d %H:%M:%S")
        j_id = state["joints"][i % len(state["joints"])]
        vib = round(random.uniform(0.3, 0.8), 2)
        temp = round(random.uniform(32.0, 42.0), 1)
        sound = round(random.uniform(55.0, 68.0), 1)
        health = round(100.0 - (vib * 15 + (temp - 30) * 1.2 + (sound - 50) * 0.4), 1)
        health = max(0.0, min(100.0, health))
        risk = "NORMAL" if health >= 80 else ("WARNING" if health >= 60 else "CRITICAL")

        record = {
            "timestamp": t_str,
            "joint_id": j_id,
            "rfid_tag_id": f"RFID-E2000{i%10:02d}",
            "temperature_c": temp,
            "vibration_g": vib,
            "sound_db": sound,
            "belt_speed_mps": 1.85,
            "camera_result": "NORMAL",
            "health_score": health,
            "risk_level": risk
        }
        state["inspection_history"].append(record)

seed_initial_history()

# Serve Frontend Pages & Static Assets
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)

# API Endpoints
@app.route("/api/sensors", methods=["GET"])
def get_sensors():
    if state["conveyor_status"] == "RUNNING":
        state["total_inspections"] += 1
        state["current_joint_index"] = (state["current_joint_index"] + 1) % len(state["joints"])

    current_j = state["joints"][state["current_joint_index"]]

    # Check if fault injected on this joint
    if state["simulated_fault_joint"] == current_j:
        vib = round(random.uniform(2.8, 3.8), 2)
        temp = round(random.uniform(65.0, 78.0), 1)
        sound = round(random.uniform(95.0, 108.0), 1)
        cam_result = "JOINT DAMAGE"
        health = round(random.uniform(15.0, 28.0), 1)
        risk = "CRITICAL"
        state["active_alert"] = {
            "joint_id": current_j,
            "severity": "CRITICAL",
            "reason": f"High Vibration ({vib}g) and Splice Separation on {current_j}",
            "acknowledged": False
        }
        state["critical_count"] += 1
        state["simulated_fault_joint"] = None # Reset after triggering
    else:
        vib = round(random.uniform(0.3, 0.9), 2)
        temp = round(random.uniform(34.0, 43.0), 1)
        sound = round(random.uniform(58.0, 70.0), 1)
        cam_result = "NORMAL"
        health = round(100.0 - (vib * 12 + (temp - 30) * 1.0 + (sound - 50) * 0.3), 1)
        health = max(0.0, min(100.0, health))
        risk = "LOW" if health >= 80 else ("MEDIUM" if health >= 60 else "HIGH")

    t_now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    latest_reading = {
        "joint_id": current_j,
        "rfid_tag_id": f"RFID-E2000{state['current_joint_index']:02d}",
        "timestamp": t_now,
        "temperature_c": temp,
        "vibration_g": vib,
        "sound_db": sound,
        "belt_speed_mps": state["belt_speed_mps"] if state["conveyor_status"] == "RUNNING" else 0.0,
        "camera_result": cam_result,
        "health_score": health,
        "risk_level": risk
    }

    state["inspection_history"].append(latest_reading)
    if len(state["inspection_history"]) > 100:
        state["inspection_history"].pop(0)

    telemetry = {
        "conveyor_status": state["conveyor_status"],
        "belt_speed_mps": state["belt_speed_mps"] if state["conveyor_status"] == "RUNNING" else 0.0,
        "demo_mode": state["demo_mode"],
        "total_inspections": state["total_inspections"],
        "warning_count": state["warning_count"],
        "critical_count": state["critical_count"],
        "latest_reading": latest_reading,
        "vibration": vib,
        "temperature": temp,
        "sound_level": sound,
        "active_alert": state["active_alert"]
    }

    return jsonify([telemetry])

@app.route("/api/predict", methods=["POST"])
def predict_health():
    data = request.json or {}
    vib = data.get("vibration", 0.5)
    temp = data.get("temperature", 35.0)
    sound = data.get("sound_level", 60.0)

    health = 100.0 - (vib * 14.0 + max(0, temp - 30) * 1.1 + max(0, sound - 50) * 0.4)
    health = max(0.0, min(100.0, round(health, 1)))

    if health >= 80:
        risk = "LOW"
    elif health >= 60:
        risk = "MEDIUM"
    elif health >= 35:
        risk = "HIGH"
    else:
        risk = "CRITICAL"

    return jsonify({
        "health_score": health,
        "risk_level": risk
    })

@app.route("/api/joints/<joint_id>/history", methods=["GET"])
def joint_history(joint_id):
    records = [r for r in state["inspection_history"] if r["joint_id"] == joint_id]
    if not records:
        # Generate baseline trend history for joint if empty
        now = time.time()
        for i in range(7):
            t_str = datetime.fromtimestamp(now - (7 - i) * 86400).strftime("%Y-%m-%d %H:%M:%S")
            records.append({
                "timestamp": t_str,
                "joint_id": joint_id,
                "health_score": round(98.0 - i * 1.2 + random.uniform(-1, 1), 1)
            })

    return jsonify({
        "success": True,
        "history": records
    })

@app.route("/api/history", methods=["GET"])
def get_history():
    j_filter = request.args.get("joint_id", "ALL")
    r_filter = request.args.get("risk", "ALL")

    records = list(reversed(state["inspection_history"]))

    if j_filter != "ALL":
        records = [r for r in records if r["joint_id"] == j_filter]

    if r_filter != "ALL":
        records = [r for r in records if r["risk_level"] == r_filter or r.get("risk_level") == r_filter]

    return jsonify({
        "success": True,
        "data": records
    })

@app.route("/api/conveyor/control", methods=["POST"])
def conveyor_control():
    data = request.json or {}
    action = data.get("action", "STOP")

    if action == "START":
        state["conveyor_status"] = "RUNNING"
        state["belt_speed_mps"] = 1.85
    elif action == "STOP":
        state["conveyor_status"] = "STOPPED"
        state["belt_speed_mps"] = 0.0
    elif action == "EMERGENCY_STOP":
        state["conveyor_status"] = "EMERGENCY_STOP"
        state["belt_speed_mps"] = 0.0

    return jsonify({"success": True, "status": state["conveyor_status"]})

@app.route("/api/demo/mode", methods=["POST"])
def demo_mode():
    data = request.json or {}
    state["demo_mode"] = bool(data.get("enable", True))
    return jsonify({"success": True, "demo_mode": state["demo_mode"]})

@app.route("/api/demo/simulate-damage", methods=["POST"])
def simulate_damage():
    data = request.json or {}
    target_joint = data.get("joint_id", "J001")
    state["simulated_fault_joint"] = target_joint
    return jsonify({"success": True, "target_joint": target_joint})

@app.route("/api/alerts/acknowledge", methods=["POST"])
def acknowledge_alert():
    if state["active_alert"]:
        state["active_alert"]["acknowledged"] = True
    return jsonify({"success": True})

if __name__ == "__main__":
    print("=" * 60)
    print("SMART-BELT AI INDUSTRIAL SERVER IS RUNNING!")
    print("Local Access URL: http://127.0.0.1:5000")
    print("Network Access URL: http://localhost:5000")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=False)
