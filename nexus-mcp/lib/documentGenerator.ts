/**
 * NEXUS Legal Document Generator — Word (.docx)
 *
 * Generates a professional Indian legal analysis report matching the style of
 * Legal_Analysis_Report_Final.pdf:
 *
 *   Page 1: Title + metadata table
 *   Page 2: Table of contents (auto)
 *   Page 3+: Numbered sections — Executive Summary, Risk Assessment,
 *            Research Findings, Legal Analysis, Debate, Verdict,
 *            Tribunal Notes, Disclaimer
 *
 * Output: .docx file saved to generated_documents/
 * Uses only as many pages as necessary (content-driven, no padding).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface DocumentData {
  sessionId: string;
  topic: string;
  inputType: string;
  confidence: number;
  riskLevel: string;
  riskScore: number;
  agentCount: number;
  durationMs: number;
  judgeVerdict: string;
  researchSummary: string;
  legalSummary: string;
  debateSummary: string;
  telegramUser?: string;
  timestamp: string;
}

/**
 * Simple language detection based on script/character ranges in the verdict text.
 */
function detectLanguage(text: string): string {
  // Count characters from different scripts
  const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
  const kannada = (text.match(/[\u0C80-\u0CFF]/g) || []).length;
  const telugu = (text.match(/[\u0C00-\u0C7F]/g) || []).length;
  const tamil = (text.match(/[\u0B80-\u0BFF]/g) || []).length;

  const max = Math.max(devanagari, kannada, telugu, tamil);
  if (max < 20) return 'en'; // too few non-latin characters → English
  
  if (max === devanagari) return 'hi';
  if (max === kannada) return 'kn';
  if (max === telugu) return 'te';
  if (max === tamil) return 'ta';
  return 'en';
}

/**
 * Generate and save the .pdf to disk using Python (PyMuPDF), return file path
 */
export async function saveDocumentToFile(data: DocumentData): Promise<string> {
  const dir = path.join(process.cwd(), 'generated_documents');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `NEXUS_Report_${data.sessionId.substring(0, 8)}_${Date.now()}.pdf`;
  const filePath = path.join(dir, filename);

  // Detect language from verdict text
  const language = detectLanguage(data.judgeVerdict || data.topic || '');

  const payload = {
    sessionId: data.sessionId,
    verdict: data.judgeVerdict,
    confidence: data.confidence,
    riskLevel: data.riskLevel,
    outputPath: filePath,
    language: language
  };

  const scriptPath = path.join(process.cwd(), 'lib', 'pdf_generator.py');

  try {
    const output = execSync(`python "${scriptPath}"`, {
      input: JSON.stringify(payload),
      encoding: 'utf-8'
    });
    
    console.log(`📄 [DOCUMENT] Saved .pdf (lang: ${language}) to: ${filePath}`);
    console.log(output.trim());
    return filePath;
  } catch (error: any) {
    console.error("❌ Failed to generate PDF:", error.message || error);
    // fallback if python fails for some reason
    fs.writeFileSync(filePath + '.txt', JSON.stringify(payload, null, 2));
    return filePath + '.txt';
  }
}
