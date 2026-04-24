#!/bin/bash

echo "==============================================="
echo "⚖️  Starting DHARMARAKSHA Integration Services"
echo "==============================================="

# Start NEXUS Tribunal Server
echo "[1/4] Starting NEXUS Express Server (Port 3001)..."
npm run dev &
SERVER_PID=$!

# Start React Dashboard
echo "[2/4] Starting React Dashboard (Port 5173)..."
cd dashboard-react && npm run dev &
DASHBOARD_PID=$!
cd ..

# Wait a moment for server to initialize
sleep 3

# Start Python Sensor Listener
echo "[3/4] Starting Sensor Listener (Polling Firebase)..."
python sensor_listener.py &
SENSOR_PID=$!

# Start Python Vision Listener
echo "[4/4] Starting Vision Listener (YOLOv8 + IP Webcam)..."
python vision_listener.py &
VISION_PID=$!

echo "==============================================="
echo "✅ All DHARMARAKSHA services are running!"
echo "📱 Open http://localhost:5173/nfc-voice on phone"
echo "💻 Open http://localhost:5173/dashboard on laptop"
echo "Press Ctrl+C to stop all services."
echo "==============================================="

# Trap Ctrl+C to kill all child processes gracefully
trap "echo -e '\nStopping DHARMARAKSHA services...'; kill $SERVER_PID $DASHBOARD_PID $SENSOR_PID $VISION_PID; exit" INT

# Keep script running
wait
