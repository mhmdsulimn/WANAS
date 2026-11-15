import { generateWanasReply, streamWanasReply, type ChatRequestPayload } from '../lib/wanasAi.ts';

export const config = {
  runtime: 'nodejs',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => ({}))) as ChatRequestPayload;

    if (payload.stream) {
      const stream = streamWanasReply(payload);
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      const encoder = new TextEncoder();

      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            if (!first.done && first.value) {
              controller.enqueue(encoder.encode(first.value));
            }
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              if (next.value) {
                controller.enqueue(encoder.encode(next.value));
              }
            }
            controller.close();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Stream interrupted';
            controller.enqueue(encoder.encode(`\n\n[خطأ: ${msg}]`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const reply = await generateWanasReply(payload);
    return jsonResponse({ reply }, 200);
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string };
    const statusCode =
      typeof errorObj?.status === 'number' && errorObj.status >= 400 && errorObj.status < 600
        ? errorObj.status
        : 500;
    const errMessage = errorObj?.message || 'Failed to generate response from Wanas AI.';
    console.error('Vercel /api/chat error:', errMessage);
    return jsonResponse({ error: errMessage }, statusCode);
  }
}
