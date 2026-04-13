import 'dotenv/config';

export interface AppConfig {
  port: number;
  host: string;
  defaultModel: string;
  fallbackModel: string;
  cache: {
    enabled: boolean;
    ttlMs: number;
    maxSize: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  codebuddy: {
    apiKey?: string;
    environment?: string;
  };
}

function getEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

function getEnvRequired(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val === 'true' || val === '1';
}

export const config: AppConfig = {
  port: getEnvInt('PORT', 3000),
  host: getEnvRequired('HOST', '0.0.0.0'),
  defaultModel: getEnvRequired('DEFAULT_MODEL', 'deepseek-v3.1'),
  fallbackModel: getEnvRequired('FALLBACK_MODEL', 'deepseek-v3.1'),
  cache: {
    enabled: getEnvBool('CACHE_ENABLED', true),
    ttlMs: getEnvInt('CACHE_TTL_MS', 300_000),
    maxSize: getEnvInt('CACHE_MAX_SIZE', 100),
  },
  logLevel: (getEnv('LOG_LEVEL', 'info') as AppConfig['logLevel']),
  codebuddy: {
    apiKey: getEnv('CODEBUDDY_API_KEY'),
    environment: getEnv('CODEBUDDY_INTERNET_ENVIRONMENT'),
  },
};
