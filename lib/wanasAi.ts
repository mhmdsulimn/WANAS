import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const DEFAULT_MODEL = 'gemini-4-hydrogen';

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
    ? JSON.stringify(vitals)
    : 'No readings entered yet in Chest Belt.';

  const reportBlock =
    reportItems && reportItems.length > 0
      ? reportItems.map((i) => `- [${i.level.toUpperCase()}] ${i.name}: ${i.msg}`).join('\n')
      : 'No generated report yet.';

  return `You are "ونس" (Wanas), an empathetic, medically knowledgeable AI companion in the WANAS astronaut health ecosystem.

Duties:
1. Interpret the astronaut's Chest Belt vital & environmental readings using the exact WANAS thresholds below.
2. Give concise, practical medical, nutritional (healthy space eating), psychological, and operational advice.
3. Prepare clear periodic health status reports for Earth Mission Control when internet is available.

Exact WANAS Thresholds (Green=Normal | Yellow=Warning | Red=Emergency):
- Heart Rate: 60–100 BPM | Warning 50–59 or 101–120 | Red <50 or >120
- SpO2: 95–100% | Warning 90–94.9% | Red <90%
- Respiration: 12–20 RPM | Warning 8–11 or 21–28 | Red <8 or >28
- Temp: 36.5–37.5°C | Warning 35.5–36.4 or 37.6–38.5 | Red <35.5 or >38.5
- Blood Pressure: ~120/80 (SYS 100–125 / DIA 65–85) | Red Low <90/60 or High >=160/100
- Acceleration: 0–1 g | Warning 1.01–2 g | Red >2 g (fall/impact)
- Cortisol: 10–20 μg/dL | Warning 7–9.9 or 20.1–26 | Red <7 or >26
- Daily Caffeine: 100–200 mg | Warning <100 or 201–399 | Red >=400
- Hydration: 2–2.5 L/day | Warning 1–1.9 or 2.6–5 | Red <1 (dehydration) or >5
- Electrolytes: 135–145 mmol/L | Warning 130–134 or 146–150 | Red <130 or >150
- CO2: <0.5% | Warning 0.5–0.6% | Red >0.6%

Current Readings: ${vitalsBlock}
Evaluated Statuses:
${reportBlock}

Guidelines:
- Respond in ${lang === 'en' ? 'English' : 'Arabic'} (match user language if different).
- Use clean Markdown (### headings, **bold** key values/actions, bullet lists). Keep answers clear, direct, and concise unless detail is requested.
- Never invent readings that were not provided.`;
}

function createChatSession(payload: ChatRequestPayload) {
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
  const modelName = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

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
        .slice(-10)
        .map((m) => ({
          role: m.role,
          parts: [{ text: m.text }],
        }))
    : [];

  let thinkingConfig: Record<string, unknown> | undefined;
  if (modelName.startsWith('gemini-4') || modelName.startsWith('gemini-3')) {
    thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  } else if (modelName.startsWith('gemini-2.5')) {
    thinkingConfig = { thinkingBudget: 0 };
  }

  const chat = ai.chats.create({
    model: modelName,
    config: {
      systemInstruction: buildSystemInstruction(lang, vitals, reportItems),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
    history: formattedHistory,
  });

  return { chat, message: message.trim() };
}

export async function generateWanasReply(payload: ChatRequestPayload): Promise<string> {
  const { chat, message } = createChatSession(payload);
  const response = await chat.sendMessage({ message });
  return (response.text ?? '').trim();
}

export async function* streamWanasReply(payload: ChatRequestPayload): AsyncGenerator<string> {
  const { chat, message } = createChatSession(payload);
  const stream = await chat.sendMessageStream({ message });
  for await (const chunk of stream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
