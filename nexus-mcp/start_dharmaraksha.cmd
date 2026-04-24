@echo off
echo ===============================================
echo ⚖️  Starting DHARMARAKSHA Integration Services
echo ===============================================

echo [1/4] Starting NEXUS Express Server (Port 3001)...
start "NEXUS Server" cmd /c "npm run dev"

echo [2/4] Starting React Dashboard (Port 5173)...
start "React Dashboard" cmd /c "cd dashboard-react && npm run dev"

echo [3/4] Starting Sensor Listener (Polling Firebase)...
start "Sensor Listener" cmd /c "python sensor_listener.py"

echo [4/5] Starting Vision Listener (YOLOv8 + IP Webcam)...
start "Vision Listener" cmd /c "python vision_listener.py"

echo [5/5] Starting Ngrok Tunnel (Port 5173)...
start "Ngrok Tunnel" cmd /c "ngrok http 5173"

echo ===============================================
echo ✅ All DHARMARAKSHA services are starting in separate windows!
echo 🌐 Look at the new "Ngrok Tunnel" window to find your public URL (e.g., https://xxxx.ngrok.io)
echo 📱 On your phone, open: https://[YOUR_NGROK_URL]/dashboard/#/nfc-voice
echo 💻 On your laptop, open: http://localhost:5173/dashboard
echo Close the popup windows to stop the services.
echo ===============================================
pause
