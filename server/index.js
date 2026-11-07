import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const distPath = fileURLToPath(new URL('../dist/', import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/chat', async (request, response) => {
  const messages = request.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100 ||
      messages.some((message) => !message ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim() ||
        message.content.length > 20000) || messages.at(-1).role !== 'user') {
    return response.status(400).json({ error: 'Envia un historial valido que termine con un mensaje de usuario (maximo 100 mensajes, 20000 caracteres por mensaje).' });
  }

  if (!process.env.GROQ_API_KEY) {
    return response.status(503).json({ error: 'Falta configurar GROQ_API_KEY en el servidor.' });
  }

  try {
    const started = performance.now();
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_completion_tokens: 2048,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      const errors = {
        400: 'Groq rechazo la solicitud. Revisa el tamaño del historial o los limites del modelo.',
        401: 'Groq rechazo la clave del servidor. Revisa GROQ_API_KEY.',
        403: 'La cuenta no tiene permiso para realizar esta solicitud.',
        404: 'El modelo configurado no esta disponible para esta cuenta.',
        429: 'Se alcanzo el limite de uso de Groq. Espera antes de volver a enviar.',
      };
      return response.status(upstream.status === 429 ? 429 : 502).json({
        error: errors[upstream.status] || 'Groq no pudo completar la solicitud.',
      });
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    const usage = data.usage;
    if (typeof content !== 'string' || !content.trim() || typeof data.model !== 'string' ||
        !['prompt_tokens', 'completion_tokens', 'total_tokens'].every((field) =>
          Number.isSafeInteger(usage?.[field]) && usage[field] >= 0)) {
      return response.status(502).json({ error: 'Groq devolvio una respuesta sin texto o sin un consumo de tokens valido.' });
    }

    response.json({
      message: { role: 'assistant', content },
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
      model: data.model,
      responseTimeMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    response.status(error.name === 'TimeoutError' ? 504 : 502).json({
      error: error.name === 'TimeoutError'
        ? 'Groq tardo demasiado en responder. La solicitud puede haber consumido tokens.'
        : 'No se pudo obtener una respuesta valida de Groq.',
    });
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Endpoint no disponible.' });
});

app.use((error, _request, response, _next) => {
  const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
  response.status(status).json({ error: status === 413 ? 'El historial supera el limite de 256 KB.' : 'Solicitud no valida.' });
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (_request, response) => {
    response.sendFile(`${distPath}index.html`);
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor disponible en http://localhost:${port}`);
});