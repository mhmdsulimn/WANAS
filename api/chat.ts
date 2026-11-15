import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateWanasReply, type ChatRequestPayload } from '../lib/wanasAi.ts';

interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req: VercelRequest): Promise<ChatRequestPayload> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body || '{}') as ChatRequestPayload;
    }
    if (typeof req.body === 'object') {
      return req.body as ChatRequestPayload;
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? (JSON.parse(raw) as ChatRequestPayload) : {};
}

export default async function handler(req: VercelRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const payload = await readBody(req);
    const reply = await generateWanasReply(payload);
    return sendJson(res, 200, { reply });
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string };
    const statusCode =
      typeof errorObj?.status === 'number' && errorObj.status >= 400 && errorObj.status < 600
        ? errorObj.status
        : 500;
    const errMessage = errorObj?.message || 'Failed to generate response from Wanas AI.';
    console.error('Vercel /api/chat error:', errMessage);
    return sendJson(res, statusCode, { error: errMessage });
  }
}
