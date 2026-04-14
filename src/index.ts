import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { logger } from './middleware/logger.js';
import { chatRoutes } from './routes/chat.js';
import { modelsRoutes } from './routes/models.js';
import { healthRoutes } from './routes/health.js';

const app = new Hono();

// Global middleware
app.use('*', cors());
app.use('*', errorHandler);
app.use('*', logger);

// Routes
app.route('/', healthRoutes);
app.route('/', modelsRoutes);
app.route('/', chatRoutes);

// 404 fallback
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Not Found: ${c.req.method} ${c.req.path}`,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    },
    404
  );
});

// Start server
console.log(`
╔══════════════════════════════════════════╗
║  OpenAI Compatible API Server            ║
║  Powered by CodeBuddy Agent SDK          ║
╚══════════════════════════════════════════╝

  → Listening on http://${config.host}:${config.port}
  → Default model: ${config.defaultModel}
  → Cache: ${config.cache.enabled ? `enabled (TTL=${config.cache.ttlMs}ms, max=${config.cache.maxSize})` : 'disabled'}
  → Log level: ${config.logLevel}${config.debug ? ' (🐛 debug mode ON — verbose request/response logging)' : ''}

  Endpoints:
    POST /v1/chat/completions
    GET  /v1/models
    GET  /v1/models/:model
    GET  /health
`);

serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

export { app };
