"""
DHARMARAKSHA Vision Listener
Captures frames from IP Webcam (Android), runs YOLOv8 person/object detection,
uploads annotated frames to Firebase Storage, and triggers document-vision
pipeline when a document is detected with no persons present.

pip install ultralytics opencv-python firebase-admin requests Pillow
"""

import time
import io
import base64
import json
import requests
import numpy as np
import cv2
from datetime import datetime
from PIL import Image
from ultralytics import YOLO
import firebase_admin
from firebase_admin import credentials, db, storage

# ─── Config — Fill in your phone IP ─────────────────────────────────
PHONE_IP = "192.168.x.x"  # <-- Replace with your IP Webcam address
SNAPSHOT_URL = f"http://{PHONE_IP}:8080/shot.jpg"
VISION_API_URL = "http://localhost:3001/api/document-vision"

# ─── Firebase Init ───────────────────────────────────────────────────
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred, {
        "databaseURL": "https://dharmaraksha-cf449-default-rtdb.asia-southeast1.firebasedatabase.app",
        "storageBucket": "dharmaraksha-cf449.firebasestorage.app",
    })

bucket = storage.bucket()

# ─── YOLO Model ──────────────────────────────────────────────────────
print("  ⏳ Loading YOLOv8 model...")
model = YOLO("yolov8n.pt")
print("  ✅ YOLOv8 ready\n")

# ─── State ───────────────────────────────────────────────────────────
last_doc_trigger = 0

print("  👁️  [DHARMARAKSHA] Vision Listener started")
print(f"  ├─ Camera:   {SNAPSHOT_URL}")
print(f"  ├─ YOLO:     yolov8n.pt")
print(f"  ├─ API:      {VISION_API_URL}")
print(f"  └─ Polling:  every 3s\n")

# ─── Main Loop ───────────────────────────────────────────────────────
try:
    while True:
        try:
            # Fetch frame from IP Webcam
            resp = requests.get(SNAPSHOT_URL, timeout=3)
            if resp.status_code != 200:
                print(f"  ⚠️  Camera returned {resp.status_code}")
                time.sleep(3)
                continue

            # Decode image
            img_array = np.frombuffer(resp.content, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            if img is None:
                print("  ⚠️  Failed to decode image")
                time.sleep(3)
                continue

            frame_h, frame_w = img.shape[:2]
            frame_area = frame_h * frame_w

            # Run YOLOv8 inference
            results = model(img, verbose=False)
            detections = results[0].boxes

            # Count persons
            person_count = 0
            detection_list = []
            largest_non_person_area = 0
            largest_non_person_box = None

            for box in detections:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                cls_name = model.names[cls_id]
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                bbox_area = (x2 - x1) * (y2 - y1)

                if cls_name == "person" and conf > 0.4:
                    person_count += 1

                detection_list.append({
                    "class": cls_name,
                    "confidence": round(conf, 2),
                    "bbox": [x1, y1, x2, y2],
                })

                # Track largest non-person object for document detection
                if cls_name != "person" and bbox_area > largest_non_person_area:
                    largest_non_person_area = bbox_area
                    largest_non_person_box = (x1, y1, x2, y2)

            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] [VISION] {person_count} persons, {len(detection_list)} objects")

            # Draw annotated frame
            annotated = results[0].plot()

            # Encode annotated frame to JPEG
            _, jpeg_buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
            jpeg_bytes = jpeg_buf.tobytes()

            # Upload to Firebase Storage
            try:
                blob = bucket.blob("camera/latest.jpg")
                blob.upload_from_string(jpeg_bytes, content_type="image/jpeg")
                blob.make_public()
                camera_url = blob.public_url
            except Exception as e:
                camera_url = ""
                print(f"  ⚠️  Storage upload failed: {e}")

            # Write sensor data to Firebase RTDB
            try:
                vision_ref = db.reference("/sensors/vision")
                vision_ref.set({
                    "person_count": person_count,
                    "detections": detection_list[:10],  # cap at 10 to avoid huge writes
                    "camera_url": camera_url,
                    "ts": datetime.now().isoformat(),
                })
            except Exception as e:
                print(f"  ⚠️  RTDB write failed: {e}")

            # ─── Document Detection Logic ────────────────────────────
            area_ratio = largest_non_person_area / frame_area if frame_area > 0 else 0
            cooldown_ok = (time.time() - last_doc_trigger) > 10

            if person_count == 0 and area_ratio > 0.20 and cooldown_ok and largest_non_person_box:
                x1, y1, x2, y2 = largest_non_person_box
                cropped = img[y1:y2, x1:x2]

                # Convert crop to base64
                _, crop_buf = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 90])
                b64_image = base64.b64encode(crop_buf.tobytes()).decode("utf-8")

                print(f"  [{ts}] [DOCUMENT] Detected — sending to pipeline")

                try:
                    doc_resp = requests.post(
                        VISION_API_URL,
                        json={
                            "image_base64": b64_image,
                            "timestamp": datetime.now().isoformat(),
                        },
                        timeout=30,
                    )
                    print(f"  [{ts}] [DOCUMENT] Response: {doc_resp.status_code}")
                    if doc_resp.status_code == 200:
                        result = doc_resp.json()
                        text_len = len(result.get("extractedText", ""))
                        print(f"  [{ts}] [DOCUMENT] Extracted {text_len} chars")
                except Exception as e:
                    print(f"  [{ts}] [DOCUMENT] API error: {e}")

                last_doc_trigger = time.time()

        except KeyboardInterrupt:
            raise
        except requests.exceptions.ConnectionError:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] ⚠️  Phone camera offline — retrying...")
            time.sleep(3)
            continue
        except Exception as e:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"  [{ts}] ERROR: {e}")
            time.sleep(3)
            continue

        time.sleep(3)

except KeyboardInterrupt:
    print("\n  [DHARMARAKSHA] Vision Listener stopped.\n")
