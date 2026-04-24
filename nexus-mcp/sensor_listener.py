"""
DHARMARAKSHA Sensor Listener
Polls Firebase RTDB /events/latest for new sensor events,
forwards them to the NEXUS Tribunal sensor-event API endpoint.

pip install firebase-admin requests
"""

import time
import json
import requests
import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime

# ─── Firebase Init ───────────────────────────────────────────────────
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    "databaseURL": "https://dharmaraksha-cf449-default-rtdb.asia-southeast1.firebasedatabase.app"
})

# ─── Config ──────────────────────────────────────────────────────────
SERVER_URL = "http://localhost:3001/api/sensor-event"
last_status = None
poll_count = 0

print("\n  ⚖️  [DHARMARAKSHA] Listening...")
print(f"  ├─ Firebase: connected")
print(f"  ├─ Server:   {SERVER_URL}")
print(f"  └─ Polling:  every 1.5s\n")

# ─── Main Loop ───────────────────────────────────────────────────────
try:
    while True:
        try:
            # Read latest event from Firebase
            ref = db.reference("/events/latest")
            event = ref.get()

            if event:
                status = event.get("status", "")
                
                if status == "pending" and last_status != "pending":
                    event_type = event.get("type", "unknown")
                    ts = datetime.now().strftime("%H:%M:%S")
                    
                    print(f"  [{ts}] EVENT: {event_type}")
                    
                    # Mark as processing
                    ref.update({"status": "processing"})
                    
                    # Build payload for NEXUS API
                    payload = {
                        "type": event.get("type", ""),
                        "desc": event.get("desc", ""),
                        "temp": event.get("temp", 0),
                        "motion": event.get("motion", 0),
                        "vib": event.get("vib", 0),
                        "timestamp": event.get("timestamp", datetime.now().isoformat()),
                    }
                    
                    # POST to NEXUS server
                    resp = requests.post(SERVER_URL, json=payload, timeout=30)
                    print(f"  [{ts}] RESPONSE: {resp.status_code}")
                    
                    if resp.status_code == 200:
                        result = resp.json()
                        verdict_id = result.get("verdictId", "")
                        print(f"  [{ts}] VERDICT: {verdict_id}")
                    
                    # Mark as resolved
                    ref.update({"status": "resolved"})
                
                last_status = status
            
            # Every 20 polls — print current sensor values
            poll_count += 1
            if poll_count % 20 == 0:
                sensors = db.reference("/sensors").get()
                if sensors:
                    ts = datetime.now().strftime("%H:%M:%S")
                    print(f"  [{ts}] SENSORS: {json.dumps(sensors)}")

        except KeyboardInterrupt:
            raise
        except Exception as e:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] ERROR: {e}")
            time.sleep(3)
            continue

        time.sleep(1.5)

except KeyboardInterrupt:
    print("\n  [DHARMARAKSHA] Stopped.\n")
