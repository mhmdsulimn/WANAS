import { GoogleGenAI } from '@google/genai';

// Model IDs verified against the Gemini API docs (Nov 2026).
// Override the first one with GEMINI_MODEL in the environment variables.
// If a model is missing (404), overloaded (503) or out of quota (429),
// the next one in the list is tried automatically.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

export interface VitalSnapshot {
  bpm?: number;
  spo2?: number;
  resp?: number;
  temp?: number;
  bpSys?: number;
  bpDia?: number;
  accel?: number;
  caffeine?: number;
  cortisol?: number;
  hydration?: number;
  elec?: number;
  co2?: number;
}

export interface ReportItem {
  level: string;
  name: string;
  msg: string;
}

export interface ChatHistoryMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ChatRequestPayload {
  message?: string;
  history?: ChatHistoryMessage[];
  vitals?: VitalSnapshot | null;
  reportItems?: ReportItem[] | null;
  lang?: string;
  stream?: boolean;
}

export function buildSystemInstruction(
  lang: string,
  vitals?: VitalSnapshot | null,
  reportItems?: ReportItem[] | null
): string {
  const vitalsBlock = vitals
    ? JSON.stringify(vitals, null, 2)
    : 'No readings have been entered yet in the Chest Belt dashboard.';

  const reportBlock =
    reportItems && reportItems.length > 0
      ? reportItems.map((i) => `- [${i.level.toUpperCase()}] ${i.name}: ${i.msg}`).join('\n')
      : 'No generated report yet.';

  return `You are "ونس" (Wanas), an intelligent, empathetic, and medically knowledgeable AI companion built into the WANAS (ونس) deep-space astronaut health ecosystem.

Your core duties:
1. Monitor and interpret the astronaut's physiological and environmental readings entered in the WANAS Chest Belt dashboard.
2. Give clear, practical medical, psychological, nutritional (healthy eating in space), and operational advice to help the astronaut reduce any detected health issues and handle real-world challenges during the mission.
3. Prepare clear periodic health status reports to be transmitted to Earth Mission Control whenever internet connectivity is available.
4. Answer all astronaut questions—whether health-related, psychological, nutritional, or practical day-to-day problem solving—warmly, concisely, and accurately.

Exact WANAS Reference Ranges (Green = Normal, Yellow = Warning, Red = Emergency):
- Heart Rate (نبضات القلب): Normal 60–100 BPM | Warning 50–59 or 101–120 BPM | Emergency <50 or >120 BPM.
- Oxygen Saturation SpO2 (تشبع الأكسجين): Normal 95%–100% | Warning 90%–94.9% | Emergency <90%.
- Respiration Rate (معدل التنفس): Normal 12–20 RPM | Warning 8–11 or 21–28 RPM | Emergency <8 or >28 RPM.
- Body Temperature (درجة الحرارة): Normal 36.5–37.5 °C | Warning 35.5–36.4 or 37.6–38.5 °C | Emergency <35.5 or >38.5 °C.
- Blood Pressure (ضغط الدم): Normal around 120/80 (SYS 100–125 / DIA 65–85) | Warning outside normal bounds | Emergency Low (<90/60) or High (>=160/100).
- Body Acceleration (التسارع الحركي): Normal 0–1 g | Warning 1.01–2 g | Emergency >2 g (indicates sudden impact or astronaut fall).
- Cortisol (الكورتيزول): Normal 10–20 μg/dL | Warning 7–9.9 or 20.1–26 μg/dL | Emergency <7 or >26 μg/dL.
- Daily Caffeine (الكافيين اليومي): Normal 100–200 mg | Warning >200–399 mg or <100 mg (too low) | Emergency >=400 mg (excessive).
- Daily Water Intake / Hydration (شرب المياه): Normal 2–2.5 L/day | Warning 1–1.9 L or 2.6–5 L | Emergency <1 L (dehydration) or >5 L (excessive water intake).
- Electrolytes (الأملاح): Normal 135–145 mmol/L | Warning 130–134 or 146–150 mmol/L | Emergency <130 or >150 mmol/L.
- CO2 Level (نسبة ثاني أكسيد الكربون): Normal <0.5% | Warning 0.5%–0.6% | Emergency >0.6%.

Current Astronaut Readings from WANAS Dashboard:
${vitalsBlock}

Latest Evaluated Statuses:
${reportBlock}

Guidelines:
- Respond primarily in ${lang === 'en' ? 'English' : 'Arabic'} (unless the user writes in another language, then match their language naturally).
- Format your responses using clean Markdown (use ### headings, **bold** highlights for key numbers and actions, and bullet/numbered lists) so the astronaut can scan advice quickly.
- Be supportive, calm, structured, and practical.
- Remind the astronaut gently when a reading is in the Yellow or Red zone and give concrete steps (breathing exercises, hydration/electrolyte balance, CO2 scrubber check, fall check, rest, or Earth control alert).
- Never invent readings that were not provided; if readings are missing, mention that politely and invite them to enter values in the Chest Belt page or share them here.`;
}

type HttpError = Error & { status?: number };

function httpError(message: string, status: number): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  return err;
}

function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const msg = e?.message || '';
  return (
    e?.status === 429 ||
    msg.includes('"code":429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota')
  );
}

// Errors where trying the next model in the list makes sense.
function shouldTryNextModel(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const msg = e?.message || '';
  return (
    isQuotaError(err) ||
    e?.status === 404 ||
    e?.status === 503 ||
    e?.status === 500 ||
    msg.includes('"code":404') ||
    msg.includes('"code":503') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('is not found')
  );
}

function toFriendlyError(err: unknown): Error {
  const e = err as { status?: number; message?: string };
  const rawMsg = e?.message || 'Failed to generate response from Wanas AI.';

  if (isQuotaError(err)) {
    return httpError(
      'تم تجاوز الحد المجاني اليومي لطلبات الذكاء الاصطناعي حالياً (429). يرجى المحاولة بعد قليل أو استخدام مفتاح API جديد / تفعيل الفوترة في Google AI Studio.',
      429
    );
  }
  if (
    e?.status === 400 && /API key|API_KEY_INVALID/i.test(rawMsg) ||
    e?.status === 401 ||
    e?.status === 403
  ) {
    return httpError(
      'مفتاح GEMINI_API_KEY غير صالح أو غير مسموح له. تأكد من المفتاح في إعدادات Vercel ثم اعمل Redeploy.',
      e?.status && e.status >= 400 && e.status < 500 ? e.status : 400
    );
  }
  return err instanceof Error ? (err as Error) : httpError(rawMsg, 500);
}

function prepareRequest(payload: ChatRequestPayload) {
  const rawKey = process.env.GEMINI_API_KEY ?? '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    throw httpError('GEMINI_API_KEY is not configured. Please check environment variables.', 500);
  }

  const { message, history = [], vitals = null, reportItems = null, lang = 'ar' } = payload;

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw httpError('Message is required.', 400);
  }

  const useVertexAi = process.env.USE_VERTEX_AI === 'true';

  const ai = new GoogleGenAI({
    apiKey,
    ...(useVertexAi ? { vertexai: true } : {}),
  });

  // Gemini requires the history to start with a "user" turn and to alternate roles.
  // The welcome message is never sent to the server, but we sanitize anyway.
  const cleaned = Array.isArray(history)
    ? history
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
        .slice(-16)
    : [];
  while (cleaned.length > 0 && cleaned[0].role !== 'user') cleaned.shift();

  const formattedHistory = cleaned.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const primaryModel = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];

  return {
    ai,
    message: message.trim(),
    formattedHistory,
    systemInstruction: buildSystemInstruction(lang, vitals, reportItems),
    modelsToTry,
  };
}

export async function generateWanasReply(payload: ChatRequestPayload): Promise<string> {
  const { ai, message, formattedHistory, systemInstruction, modelsToTry } = prepareRequest(payload);

  let lastError: unknown = null;

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    try {
      const chat = ai.chats.create({
        model,
        config: { systemInstruction },
        history: formattedHistory,
      });
      const response = await chat.sendMessage({ message });
      return (response.text ?? '').trim();
    } catch (err: unknown) {
      lastError = err;
      console.error(`Model ${model} failed:`, (err as Error)?.message);
      if (i < modelsToTry.length - 1 && shouldTryNextModel(err)) continue;
      break;
    }
  }

  throw toFriendlyError(lastError);
}

/**
 * Streams the reply as plain text chunks.
 * Falling back to the next model is only possible BEFORE the first chunk is sent,
 * so errors that happen before any output are thrown to the caller
 * (which turns them into a proper HTTP error status).
 */
export async function* streamWanasReply(payload: ChatRequestPayload): AsyncGenerator<string, void, unknown> {
  const { ai, message, formattedHistory, systemInstruction, modelsToTry } = prepareRequest(payload);

  let lastError: unknown = null;

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    let started = false;
    try {
      const chat = ai.chats.create({
        model,
        config: { systemInstruction },
        history: formattedHistory,
      });
      const stream = await chat.sendMessageStream({ message });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          started = true;
          yield text;
        }
      }
      return;
    } catch (err: unknown) {
      lastError = err;
      console.error(`Model ${model} stream failed:`, (err as Error)?.message);
      // If we already sent text to the user, we cannot silently switch models.
      if (!started && i < modelsToTry.length - 1 && shouldTryNextModel(err)) continue;
      break;
    }
  }

  throw toFriendlyError(lastError);
}
