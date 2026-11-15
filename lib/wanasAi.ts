import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-4-hydrogen';
const FALLBACK_FREE_MODEL = 'gemini-3.1-flash-lite';

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

export async function generateWanasReply(payload: ChatRequestPayload): Promise<string> {
  const rawKey = process.env.GEMINI_API_KEY ?? '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured. Please check environment variables.') as Error & {
      status?: number;
    };
    err.status = 500;
    throw err;
  }

  const { message, history = [], vitals = null, reportItems = null, lang = 'ar' } = payload;

  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('Message is required.') as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const useVertexAi = process.env.USE_VERTEX_AI === 'true';

  const ai = new GoogleGenAI({
    apiKey,
    ...(useVertexAi ? { vertexai: true } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const formattedHistory = Array.isArray(history)
    ? history
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
        .slice(-16)
        .map((m) => ({
          role: m.role,
          parts: [{ text: m.text }],
        }))
    : [];

  const systemInstruction = buildSystemInstruction(lang, vitals, reportItems);
  const primaryModel = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const modelsToTry =
    primaryModel !== FALLBACK_FREE_MODEL ? [primaryModel, FALLBACK_FREE_MODEL] : [primaryModel];

  let lastError: unknown = null;

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    try {
      const chat = ai.chats.create({
        model,
        config: { systemInstruction },
        history: formattedHistory,
      });

      const response = await chat.sendMessage({ message: message.trim() });
      return (response.text ?? '').trim();
    } catch (err: unknown) {
      lastError = err;
      const errObj = err as { status?: number; message?: string };
      const msg = errObj?.message || '';
      const isQuotaError =
        errObj?.status === 429 ||
        msg.includes('"code":429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.toLowerCase().includes('quota');

      if (isQuotaError && i < modelsToTry.length - 1) {
        console.warn(`Model ${model} hit 429 quota limit, retrying with ${modelsToTry[i + 1]}...`);
        continue;
      }
      break;
    }
  }

  const errObj = lastError as { status?: number; message?: string };
  const rawMsg = errObj?.message || 'Failed to generate response from Wanas AI.';
  const isQuotaError =
    errObj?.status === 429 ||
    rawMsg.includes('"code":429') ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.toLowerCase().includes('quota');

  if (isQuotaError) {
    const friendly = new Error(
      'تم تجاوز الحد المجاني اليومي لطلبات الذكاء الاصطناعي حالياً (429). يرجى المحاولة بعد قليل أو استخدام مفتاح API جديد / تفعيل الفوترة في Google AI Studio.'
    ) as Error & { status?: number };
    friendly.status = 429;
    throw friendly;
  }

  throw lastError instanceof Error ? lastError : new Error(rawMsg);
}
