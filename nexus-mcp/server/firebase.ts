import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

if (!admin.apps.length) {
  try {
    const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
    
    if (!fs.existsSync(serviceAccountPath)) {
      console.warn(`[Firebase] Warning: serviceAccountKey.json not found at ${serviceAccountPath}`);
    } else {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw error;
  }
}

export const rtdb = admin.database();
export const bucket = admin.storage().bucket();

export async function uploadPDFToFirebase(buffer: Buffer, fileName: string): Promise<string> {
  try {
    const file = bucket.file(`pdfs/${fileName}`);
    
    await file.save(buffer, {
      metadata: {
        contentType: 'application/pdf',
      },
    });
    
    await file.makePublic();
    return file.publicUrl();
  } catch (error) {
    console.error('Error in uploadPDFToFirebase:', error);
    throw new Error(`Failed to upload PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function actuateHardware(level: 0 | 1 | 2): Promise<void> {
  try {
    const ref = rtdb.ref('/actuators');
    await ref.set({ alert_level: level });
  } catch (error) {
    console.error('Error in actuateHardware:', error);
    throw new Error(`Failed to actuate hardware: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function setVoiceOutput(text: string): Promise<void> {
  try {
    const ref = rtdb.ref('/voice_output');
    await ref.set({
      text,
      status: 'pending',
      ts: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in setVoiceOutput:', error);
    throw new Error(`Failed to set voice output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeSensorVerdict(verdict: object): Promise<string> {
  try {
    const ref = rtdb.ref('/verdicts');
    const newVerdictRef = ref.push();
    
    await newVerdictRef.set(verdict);
    
    if (!newVerdictRef.key) {
      throw new Error('Firebase returned an empty key for the new verdict.');
    }
    
    return newVerdictRef.key;
  } catch (error) {
    console.error('Error in writeSensorVerdict:', error);
    throw new Error(`Failed to write sensor verdict: ${error instanceof Error ? error.message : String(error)}`);
  }
}
