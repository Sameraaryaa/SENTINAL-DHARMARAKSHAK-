/**
 * NEXUS Document Analyzer
 * Uses Gemini flash-lite to quickly classify uploaded documents.
 * Returns document type + summary. Options are fixed (not AI-generated).
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface DocAnalysisResult {
  documentType: string;
  summary: string;
}

// ─── Fixed Investigation Options ────────────────────────────────────
// These are the 3 button options shown to users after document upload.
// The 4th option (free-text) is handled by the bot's text fallback.
export const DOC_OPTIONS = [
  { id: "full_analysis",     label: "📋 Full Analysis" },
  { id: "brief_explanation", label: "💡 Brief Explanation" },
  { id: "key_references",    label: "📚 Key References" },
] as const;

// Human-readable descriptions for each option (used in pipeline input)
export const DOC_OPTION_DESCRIPTIONS: Record<string, string> = {
  "full_analysis":     "Perform a complete deep legal analysis of this document — examine all clauses, risks, obligations, and legal implications.",
  "brief_explanation": "Explain this document in simple, human-understandable language — what it means, what the user should know, and key takeaways.",
  "key_references":    "List all relevant laws, acts, sections, court precedents, and references the user needs to know about based on this document.",
};

const FALLBACK: DocAnalysisResult = {
  documentType: "Legal Document",
  summary: "Document uploaded for analysis",
};

/**
 * Analyze a document and return its type + summary.
 * Uses a fast Gemini model to keep latency under ~3 seconds.
 */
export async function analyzeDocument(documentText: string): Promise<DocAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ [DOC ANALYZER] No GEMINI_API_KEY — using fallback");
    return FALLBACK;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const preview = documentText.substring(0, 2000);

    const prompt = `You are a legal document classifier. Analyze this document preview and respond in EXACT JSON format only. No markdown, no explanation.

Document preview:
"""
${preview}
"""

Respond with this exact JSON structure:
{
  "documentType": "<type like Rental Agreement, NDA, Legal Notice, Contract, Complaint, FIR, Court Order, Will, Partnership Deed, etc>",
  "summary": "<1 clear sentence summary of what this document is about>"
}

Return ONLY the JSON, nothing else.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Parse JSON (handle markdown code blocks if present)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);

    if (!parsed.documentType || !parsed.summary) {
      console.warn("⚠️ [DOC ANALYZER] Invalid response, using fallback");
      return FALLBACK;
    }

    console.log(`📋 [DOC ANALYZER] Detected: "${parsed.documentType}" — ${parsed.summary}`);

    return {
      documentType: String(parsed.documentType),
      summary: String(parsed.summary),
    };
  } catch (err: any) {
    console.error(`❌ [DOC ANALYZER] Error: ${err.message}. Using fallback.`);
    return FALLBACK;
  }
}
