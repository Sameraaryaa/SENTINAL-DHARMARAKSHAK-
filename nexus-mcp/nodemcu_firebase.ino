#include <ESP8266WiFi.h>
#include <FirebaseESP8266.h>

// 1. WiFi Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// 2. Firebase Configuration
#define FIREBASE_HOST "dharmaraksha-cf449-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "9iMhlG02bA1AQaGUwXrpZeWc8qnEYl0ec77Bbsi5"

// 3. Define Hardware Pins
#define ALERT_LED_PIN D1 // Connect an LED to D1 to show alert levels
#define SENSOR_PIN A0    // Connect your sensor here

// Firebase Objects
FirebaseData firebaseData;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long sendDataPrevMillis = 0;
int count = 0;

void setup() {
  Serial.begin(115200);
  pinMode(ALERT_LED_PIN, OUTPUT);
  digitalWrite(ALERT_LED_PIN, LOW);

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println();
  Serial.print("Connected with IP: ");
  Serial.println(WiFi.localIP());
  Serial.println();

  // Configure Firebase
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;

  // Initialize Firebase
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
}

void loop() {
  // Read Actuator Commands coming from the NEXUS backend
  if (Firebase.getInt(firebaseData, "/actuators/alert_level")) {
    if (firebaseData.dataType() == "int") {
      int alertLevel = firebaseData.intData();
      Serial.print("Received Alert Level: ");
      Serial.println(alertLevel);
      
      // Hardware Actuation Logic
      if (alertLevel == 0) {
        digitalWrite(ALERT_LED_PIN, LOW); // All safe
      } else if (alertLevel == 1) {
        // Warning - Blink
        digitalWrite(ALERT_LED_PIN, HIGH);
        delay(200);
        digitalWrite(ALERT_LED_PIN, LOW);
      } else if (alertLevel == 2) {
        digitalWrite(ALERT_LED_PIN, HIGH); // Critical Alert
      }
    }
  } else {
    Serial.println(firebaseData.errorReason());
  }

  // Send Sensor Data to NEXUS every 10 seconds
  if (millis() - sendDataPrevMillis > 10000 || sendDataPrevMillis == 0) {
    sendDataPrevMillis = millis();
    
    // Read your physical sensor
    int sensorValue = analogRead(SENSOR_PIN); 
    
    // Push the new sensor reading (this triggers the writeSensorVerdict logic on backend if needed)
    // We create a JSON object for the Firebase RTDB
    FirebaseJson json;
    json.set("value", sensorValue);
    json.set("timestamp", "sensor_reading");
    
    Serial.print("Pushing Sensor Verdict... ");
    if (Firebase.pushJSON(firebaseData, "/verdicts", json)) {
      Serial.println("Success! Key: " + firebaseData.pushName());
    } else {
      Serial.println("Failed: " + firebaseData.errorReason());
    }
  }
}
