@echo off
title NEXUS Platform Launcher
color 0B

echo ===================================================
echo        NEXUS PLATFORM LAUNCHER
echo ===================================================
echo.
echo [1/2] Starting the NEXUS Node Server on Port 3001...
start "NEXUS Server" cmd /k "npm run dev"

echo Waiting 5 seconds for the server to securely boot...
timeout /t 5 /nobreak > NUL

echo.
echo [2/2] Starting the Ngrok Webhook Tunnel...
start "NEXUS Ngrok Tunnel" cmd /k "ngrok http 3001"

echo.
echo ===================================================
echo ✅ LAUNCH COMPLETE!
echo.
echo Two new terminal windows are now running in the background.
echo.
echo ⚠️  IMPORTANT WHATSAPP NOTE:
echo Because you are using the free version of Ngrok, 
echo your webhook URL changes EVERY TIME you run this file!
echo.
echo You must look at the Ngrok window, copy the new URL
echo (e.g., https://1234abcd.ngrok-free.app), and paste it
echo into the Meta WhatsApp Developer Portal!
echo ===================================================
echo.
pause
