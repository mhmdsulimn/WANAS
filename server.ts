import 'dotenv/config';
import path from 'path';
import express from 'express';
import { generateWanasReply, streamWanasReply, type ChatRequestPayload } from './lib/wanasAi.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  app.post('/api/chat', async (req, res) => {
    let headersSentForStream = false;
    try {
      const payload = (req.body || {}) as ChatRequestPayload;

      if (payload.stream) {
        const stream = streamWanasReply(payload);
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();

        res.status(200);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        headersSentForStream = true;

        if (!first.done && first.value) {
          res.write(first.value);
        }

        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          if (next.value) res.write(next.value);
        }

        return res.end();
      }

      const reply = await generateWanasReply(payload);
      return res.json({ reply });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const statusCode =
        typeof errorObj?.status === 'number' && errorObj.status >= 400 && errorObj.status < 600
          ? errorObj.status
          : 500;
      const errMessage = errorObj?.message || 'Failed to generate response from Wanas AI.';
      console.error('/api/chat error:', errMessage);

      if (headersSentForStream) {
        res.write(`\n\n[خطأ: ${errMessage}]`);
        return res.end();
      }
      return res.status(statusCode).json({ error: errMessage });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/chat', (_req, res) => {
      res.sendFile(path.join(distPath, 'chat.html'));
    });
    app.get('/chat.html', (_req, res) => {
      res.sendFile(path.join(distPath, 'chat.html'));
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WANAS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
