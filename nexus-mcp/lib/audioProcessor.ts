import { GoogleGenerativeAI } from '@google/generative-ai';

export async function processVoiceNote(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    
    const audioPart = {
        inlineData: {
            data: audioBuffer.toString("base64"),
            mimeType: mimeType
        }
    };
    
    const prompt = "You are a highly precise legal polyglot transcriber. Listen to the following audio note. " +
                   "First, identify the language. Then, transcribe it accurately. " +
                   "Finally, if the language is NOT English, provide a clear, professional English translation. \n\n" +
                   "Return ONLY the final English translation text if it was translated, OR the direct English transcription if it was already in English. " +
                   "Do not include any pleasantries or '[English Translation]:' prefixes, just the pure text to be analyzed by the legal system.";
    
    const result = await model.generateContent([prompt, audioPart]);
    const response = await result.response;
    return response.text().trim();
}
