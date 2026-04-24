/**
 * Supabase Integration — persistent backend for NEXUS session data.
 * Replaces Notion as the primary database layer.
 * Auto-creates the `nexus_sessions` table if it doesn't exist.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { uploadPDFToFirebase } from '../server/firebase';

dotenv.config();

// ─── Initialize ─────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️ [SUPABASE] SUPABASE_URL or SUPABASE_KEY not set — disabled');
    return null;
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

// ─── Types ──────────────────────────────────────────────────────────
export interface SupabaseSessionData {
  session_id: string;
  topic: string;
  input_type: string;
  confidence: number;
  risk_level: string;
  risk_score: number;
  verdict: string;
  shield_blocked: boolean;
  risk_gate_triggered: boolean;
  user_name: string;
  user_email: string;
  drive_link?: string;
  document_path?: string;
  language?: string;
}

// ─── Auto-create table ──────────────────────────────────────────────
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;

  const client = getClient();
  if (!client) return;

  try {
    // Try to query the table — if it exists, we're good
    const { error } = await client.from('nexus_sessions').select('id').limit(1);

    if (error && error.message.includes('does not exist')) {
      console.log('🔧 [SUPABASE] Table "nexus_sessions" not found — creating...');

      // Use the REST API to execute SQL via RPC
      // NOTE: This requires the `pg_execute` or raw SQL function.
      // Since Supabase doesn't allow raw CREATE TABLE from client SDK,
      // we'll use the SQL Editor approach: create via the REST endpoint
      const createSQL = `
        CREATE TABLE IF NOT EXISTS nexus_sessions (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          session_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          topic TEXT,
          input_type TEXT,
          confidence INTEGER DEFAULT 0,
          risk_level TEXT DEFAULT 'low',
          risk_score INTEGER DEFAULT 0,
          verdict TEXT,
          shield_blocked BOOLEAN DEFAULT FALSE,
          risk_gate_triggered BOOLEAN DEFAULT FALSE,
          user_name TEXT,
          user_email TEXT,
          drive_link TEXT,
          document_path TEXT,
          language TEXT DEFAULT 'en'
        );
      `;

      // Try RPC call if available
      const { error: rpcError } = await client.rpc('exec_sql', { query: createSQL });
      if (rpcError) {
        console.warn(`⚠️ [SUPABASE] Could not auto-create table via RPC: ${rpcError.message}`);
        console.log('📋 [SUPABASE] Please create the table manually using this SQL:');
        console.log(createSQL);
        // Still mark as ensured so we don't spam logs
      } else {
        console.log('✅ [SUPABASE] Table "nexus_sessions" created successfully');
      }
    } else if (error) {
      console.warn(`⚠️ [SUPABASE] Table check error: ${error.message}`);
    } else {
      console.log('✅ [SUPABASE] Table "nexus_sessions" exists');
    }
  } catch (err: any) {
    console.warn(`⚠️ [SUPABASE] ensureTable error: ${err.message}`);
  }

  tableEnsured = true;
}

// ─── Save session data ──────────────────────────────────────────────
export async function saveToSupabase(data: SupabaseSessionData): Promise<void> {
  const client = getClient();
  if (!client) return;

  await ensureTable();

  console.log(`💾 [SUPABASE] Saving session: ${data.session_id.slice(0, 8)}`);

  try {
    const { error } = await client.from('nexus_sessions').insert({
      session_id: data.session_id,
      topic: data.topic?.substring(0, 2000),
      input_type: data.input_type,
      confidence: data.confidence,
      risk_level: data.risk_level,
      risk_score: data.risk_score,
      verdict: data.verdict?.substring(0, 10000),
      shield_blocked: data.shield_blocked,
      risk_gate_triggered: data.risk_gate_triggered,
      user_name: data.user_name,
      user_email: data.user_email,
      drive_link: data.drive_link || null,
      document_path: data.document_path || null,
      language: data.language || 'en',
    });

    if (error) {
      console.error(`❌ [SUPABASE] Insert failed: ${error.message}`);
    } else {
      console.log(`✅ [SUPABASE] Session saved successfully`);
    }
  } catch (err: any) {
    console.error(`❌ [SUPABASE] Save error: ${err.message}`);
  }
}

// ─── Retrieve sessions (for dashboard) ──────────────────────────────
export async function getRecentSessions(limit = 20): Promise<any[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('nexus_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`❌ [SUPABASE] Query error: ${error.message}`);
      return [];
    }

    return data || [];
  } catch (err: any) {
    console.error(`❌ [SUPABASE] getRecentSessions error: ${err.message}`);
    return [];
  }
}

// ─── Upload PDF to Storage ──────────────────────────────────────────
export async function uploadPdfToSupabase(pdfPath: string, filename: string): Promise<string> {
  const client = getClient();
  if (!client) {
    console.warn('⚠️ [SUPABASE] Client not initialized, skipping PDF upload.');
    return '';
  }

  if (!fs.existsSync(pdfPath)) {
    console.warn(`⚠️ [SUPABASE] PDF file not found at: ${pdfPath}`);
    return '';
  }

  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    // Use a unique filename to prevent clashing (e.g. "report_sessionid.pdf")
    const uniqueFilename = `${Date.now()}_${filename}`;

    try {
      const publicUrl = await uploadPDFToFirebase(fileBuffer, uniqueFilename);
      console.log(`✅ [FIREBASE] PDF uploaded to storage successfully: ${uniqueFilename}`);
      return publicUrl;
    } catch (firebaseError: any) {
      console.error(`❌ [FIREBASE] Storage upload failed: ${firebaseError.message}`);
      return '';
    }
  } catch (err: any) {
    console.error(`❌ [SUPABASE] Unexpected error during PDF upload: ${err.message}`);
    return '';
  }
}
