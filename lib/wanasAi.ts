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

let cachedClientKey = '';
let cachedAiClient: GoogleGenAI | null = null;

function getAiClient(apiKey: string, useVertexAi: boolean): GoogleGenAI {
  const cacheKey = `${apiKey}:${useVertexAi}`;
  if (cachedAiClient && cachedClientKey === cacheKey) {
    return cachedAiClient;
  }

  cachedClientKey = cacheKey;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    ...(useVertexAi ? { vertexai: true } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedAiClient;
}

export function buildSystemInstruction(
  lang: string,
  vitals?: VitalSnapshot | null,
  reportItems?: ReportItem[] | null
): string {
  const vitalsBlock = vitals
    ? JSON.stringify(vitals)
    : 'None entered yet.';

  const reportBlock =
    reportItems && reportItems.length > 0
      ? reportItems.map((i) => `${i.name}(${i.level}): ${i.msg}`).join(' | ')
      : 'None yet.';

  return `You are "ونس" (Wanas), a fast, supportive AI health & mission companion for astronauts in WANAS.

WANAS Ranges (Green=Normal | Yellow=Warning | Red=Emergency):
HR 60-100 (Warn 50-59/101-120, Red <50/>120) | SpO2 95-100% (Warn 90-94.9%, Red <90%) | Resp 12-20 (Warn 8-11/21-28, Red <8/>28) | Temp 36.5-37.5°C (Warn 35.5-36.4/37.6-38.5, Red <35.5/>38.5) | BP ~120/80 (Red <90/60 or >=160/100) | Accel 0-1g (Warn 1.01-2g, Red >2g fall) | Cortisol 10-20 (Warn 7-9.9/20.1-26, Red <7/>26) | Caffeine 100-200mg (Warn <100/201-399, Red >=400) | Water 2-2.5L (Warn 1-1.9/2.6-5, Red <1/>5) | Electrolytes 135-145 (Warn 130-134/146-150, Red <130/>150) | CO2 <0.5% (Warn 0.5-0.6%, Red >0.6%).

Live Readings: ${vitalsBlock}
Status: ${reportBlock}

Rules:
- Reply in ${lang === 'en' ? 'English' : 'Arabic'} (match user's language if different).
- Be fast, direct, and concise: 3 to 6 short bullet points or brief sentences by default (only write longer sections when asked for a full report or meal plan).
- Format cleanly with Markdown (**bold**, bullet lists, short ### heading if helpful).
- Give practical health, nutrition, psychological, or operational steps for any Yellow/Red values, and never invent missing readings.`;
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
  const ai = getAiClient(apiKey, useVertexAi);

  const formattedHistory = Array.isArray(history)
    ? history
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
        .slice(-8)
        .map((m) => ({
          role: m.role,
          parts: [{ text: m.text }],
        }))
    : [];

  let thinkingConfig: Record<string, unknown> | undefined;
  if (modelName === 'gemini-3.1-flash-lite') {
    thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  } else if (modelName.startsWith('gemini-4') || modelName.startsWith('gemini-3')) {
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
