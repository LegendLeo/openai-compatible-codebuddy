import type { Context, Next } from 'hono';
import { formatError } from '../services/response-formatter.js';

export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (error) {
    console.error('[error]', error);

    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = (error as { status?: number }).status ?? 500;

    return c.json(
      formatError(message, 'server_error', String(status)),
      status as 400 | 401 | 403 | 404 | 500
    );
  }
}
