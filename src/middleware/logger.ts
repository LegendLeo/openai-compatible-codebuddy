import crypto from 'node:crypto';
import type { Context, Next } from 'hono';
import { config } from '../config.js';

/** Max length for base64 data or very long string values in debug output. */
const MAX_VALUE_LEN = 200;

/**
 * Deep-clone a JSON-serialisable value, truncating any string that looks like
 * base64-encoded data (or is simply very long) to keep debug output readable.
 *
 * Detection heuristic: a string longer than `MAX_VALUE_LEN` that either
 *   - starts with "data:" (data-URI)
 *   - or consists entirely of base64-alphabet characters (A-Z, a-z, 0-9, +, /, =)
 * is truncated to `MAX_VALUE_LEN` chars + an ellipsis with the original length.
 */
function truncateDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length <= MAX_VALUE_LEN) return value;

    const isDataUri = value.startsWith('data:');
    const isBase64 = /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 500));

    if (isDataUri || isBase64 || value.length > MAX_VALUE_LEN * 5) {
      return `${value.slice(0, MAX_VALUE_LEN)}... [truncated, total ${value.length} chars]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(truncateDeep);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = truncateDeep(v);
    }
    return result;
  }

  return value;
}

export async function logger(c: Context, next: Next): Promise<void> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  c.header('X-Request-ID', requestId);

  // Basic request log line
  console.log(`[${requestId}] --> ${method} ${path}`);

  // Debug mode: print full request body (with base64 truncation)
  if (config.debug && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    try {
      // Clone the request so the body can still be read downstream
      const clonedBody = await c.req.raw.clone().json();
      const sanitised = truncateDeep(clonedBody);
      console.log(`[${requestId}] 📦 Request body:\n${JSON.stringify(sanitised, null, 2)}`);
    } catch {
      // Body is not JSON or empty — that's fine, skip
      console.log(`[${requestId}] 📦 Request body: (non-JSON or empty)`);
    }
  }

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const cache = c.res.headers.get('X-Cache') ?? '-';

  console.log(`[${requestId}] <-- ${method} ${path} ${status} ${duration}ms cache=${cache}`);

  // Debug mode: print response summary for non-streaming responses
  if (config.debug && !c.res.headers.get('content-type')?.includes('text/event-stream')) {
    try {
      const clonedRes = c.res.clone();
      const resBody = await clonedRes.json();
      const sanitised = truncateDeep(resBody);
      console.log(`[${requestId}] 📤 Response body:\n${JSON.stringify(sanitised, null, 2)}`);
    } catch {
      // Not JSON response — skip
    }
  }
}
