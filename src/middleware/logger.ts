import crypto from 'node:crypto';
import type { Context, Next } from 'hono';

export async function logger(c: Context, next: Next): Promise<void> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  c.header('X-Request-ID', requestId);

  console.log(`[${requestId}] --> ${method} ${path}`);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const cache = c.res.headers.get('X-Cache') ?? '-';

  console.log(`[${requestId}] <-- ${method} ${path} ${status} ${duration}ms cache=${cache}`);
}
