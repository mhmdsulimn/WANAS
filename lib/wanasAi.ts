// AI provider: OpenRouter (OpenAI-compatible API). No SDK needed, only fetch.
// Environment variables (set them in Vercel -> Settings -> Environment Variables):
//   OPENROUTER_API_KEY   (required)  your key from https://openrouter.ai/keys
//   OPENROUTER_MODEL     (optional)  default: "openrouter/free" (auto-picks a free model)
//   OPENROUTER_FALLBACK_MODELS (optional) comma-separated list tried if the first fails
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free';

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

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function prepareRequest(payload: ChatRequestPayload) {
  const rawKey = process.env.OPENROUTER_API_KEY ?? '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    throw httpError('OPENROUTER_API_KEY is not configured. Please check environment variables.', 500);
  }

  const { message, history = [], vitals = null, reportItems = null, lang = 'ar' } = payload;

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw httpError('Message is required.', 400);
  }

  const cleaned = Array.isArray(history)
    ? history
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
        .slice(-16)
    : [];

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemInstruction(lang, vitals, reportItems) },
    ...cleaned.map((m) => ({
      role: (m.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.text,
    })),
    { role: 'user', content: message.trim() },
  ];

  const primary = (process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
  const extra = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const modelsToTry = [primary, ...extra.filter((m) => m !== primary)];

  return { apiKey, messages, modelsToTry };
}

async function friendlyHttpError(res: Response): Promise<HttpError> {
  let detail = '';
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    detail = data?.error?.message || '';
  } catch {
    /* ignore */
  }
  console.error(`OpenRouter HTTP ${res.status}:`, detail);

  if (res.status === 401 || res.status === 403) {
    return httpError(
      'مفتاح OPENROUTER_API_KEY غير صالح أو تم إيقافه. أنشئ مفتاحاً جديداً من openrouter.ai/keys وحدّثه في إعدادات Vercel ثم اعمل Redeploy.',
      res.status
    );
  }
  if (res.status === 402) {
    return httpError('رصيد OpenRouter غير كافٍ لهذا الموديل. استخدم موديلاً مجانياً (openrouter/free) أو اشحن الرصيد.', 402);
  }
  if (res.status === 429) {
    return httpError('تم الوصول للحد المسموح من الطلبات حالياً (429). يرجى المحاولة بعد قليل.', 429);
  }
  return httpError(detail || `OpenRouter request failed (${res.status}).`, res.status >= 400 ? res.status : 500);
}

function shouldTryNextModel(err: unknown): boolean {
  const status = (err as HttpError)?.status;
  return status === 404 || status === 408 || status === 429 || status === 502 || status === 503 || status === 500;
}

function openRouterFetch(apiKey: string, model: string, messages: ChatMessage[], stream: boolean) {
  return fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://wanas-team.vercel.app',
      'X-Title': 'WANAS',
    },
    body: JSON.stringify({ model, messages, stream, max_tokens: 1500 }),
  });
}

export async function generateWanasReply(payload: ChatRequestPayload): Promise<string> {
  const { apiKey, messages, modelsToTry } = prepareRequest(payload);
  let lastError: unknown = null;

  for (let i = 0; i < modelsToTry.length; i += 1) {
    try {
      const res = await openRouterFetch(apiKey, modelsToTry[i], messages, false);
      if (!res.ok) throw await friendlyHttpError(res);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (data.error) throw httpError(data.error.message || 'Model error', 502);
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw httpError('وصل رد فارغ من الموديل، حاول مرة أخرى.', 502);
      return text;
    } catch (err) {
      lastError = err;
      console.error(`Model ${modelsToTry[i]} failed:`, (err as Error)?.message);
      if (i < modelsToTry.length - 1 && shouldTryNextModel(err)) continue;
      break;
    }
  }
  throw lastError instanceof Error ? lastError : httpError('Failed to generate response.', 500);
}

/**
 * Streams the reply as plain text chunks (parsed from OpenRouter's SSE stream).
 * Errors before the first chunk are thrown, so the API route can return a proper HTTP status.
 */
export async function* streamWanasReply(payload: ChatRequestPayload): AsyncGenerator<string, void, unknown> {
  const { apiKey, messages, modelsToTry } = prepareRequest(payload);
  let lastError: unknown = null;

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    let started = false;
    try {
      const res = await openRouterFetch(apiKey, model, messages, true);
      if (!res.ok) throw await friendlyHttpError(res);
      if (!res.body) throw httpError('OpenRouter returned an empty stream.', 502);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          // Lines starting with ":" are SSE comments (e.g. ": OPENROUTER PROCESSING")
          if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          let json: {
            error?: { message?: string };
            choices?: { delta?: { content?: string | null } }[];
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }

          if (json.error) throw httpError(json.error.message || 'Model stream error', 502);

          const text = json.choices?.[0]?.delta?.content;
          if (text) {
            started = true;
            yield text;
          }
        }
      }

      if (!started) throw httpError('وصل رد فارغ من الموديل، حاول مرة أخرى.', 502);
      return;
    } catch (err) {
      lastError = err;
      console.error(`Model ${model} stream failed:`, (err as Error)?.message);
      if (!started && i < modelsToTry.length - 1 && shouldTryNextModel(err)) continue;
      break;
    }
  }

  throw lastError instanceof Error ? lastError : httpError('Failed to generate response.', 500);
}
