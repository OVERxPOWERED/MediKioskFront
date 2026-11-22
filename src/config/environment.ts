import { sanitizeString } from '../utils/validation';

export interface EnvConfig {
  readonly backendUrl: string;
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly ocrModel: string;
  readonly enableVoice: boolean;
  readonly enableOcr: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CONFIG: Partial<EnvConfig> = {
  backendUrl: 'http://localhost:8000',
  geminiModel: 'gemini-2.0-flash-realtime',
  ocrModel: 'gemini-2.0-flash',
  enableVoice: true,
  enableOcr: true,
  logLevel: 'info',
};

const REQUIRED_IN_PRODUCTION = ['geminiApiKey'] as const;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function parseLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  if (!value) return DEFAULT_CONFIG.logLevel!;
  const level = value.toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(level)) {
    return level as 'debug' | 'info' | 'warn' | 'error';
  }
  return DEFAULT_CONFIG.logLevel!;
}

function validateUrl(url: string, fieldName: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`${fieldName} must use http or https protocol`);
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    throw new Error(`Invalid ${fieldName}: ${error instanceof Error ? error.message : 'malformed URL'}`);
  }
}

function parseEnv(): EnvConfig {
  const env = import.meta.env;
  const isProduction = env.PROD === true || env.MODE === 'production';

  const rawBackendUrl = env.VITE_BACKEND_URL as string | undefined;
  const rawGeminiApiKey = env.VITE_GEMINI_API_KEY as string | undefined;
  const rawGeminiModel = env.VITE_GEMINI_MODEL as string | undefined;
  const rawOcrModel = env.VITE_OCR_MODEL as string | undefined;
  const rawEnableVoice = env.VITE_ENABLE_VOICE as string | undefined;
  const rawEnableOcr = env.VITE_ENABLE_OCR as string | undefined;
  const rawLogLevel = env.VITE_LOG_LEVEL as string | undefined;

  const backendUrl = validateUrl(
    sanitizeString(rawBackendUrl ?? DEFAULT_CONFIG.backendUrl!),
    'VITE_BACKEND_URL'
  );

  const geminiApiKey = sanitizeString(rawGeminiApiKey ?? '');

  if (isProduction && !geminiApiKey) {
    throw new Error('VITE_GEMINI_API_KEY is required in production mode');
  }

  const geminiModel = sanitizeString(rawGeminiModel ?? DEFAULT_CONFIG.geminiModel!);
  const ocrModel = sanitizeString(rawOcrModel ?? DEFAULT_CONFIG.ocrModel!);
  const enableVoice = parseBoolean(rawEnableVoice, DEFAULT_CONFIG.enableVoice!);
  const enableOcr = parseBoolean(rawEnableOcr, DEFAULT_CONFIG.enableOcr!);
  const logLevel = parseLogLevel(rawLogLevel);

  return {
    backendUrl,
    geminiApiKey,
    geminiModel,
    ocrModel,
    enableVoice,
    enableOcr,
    logLevel,
  };
}

let envInstance: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!envInstance) {
    envInstance = parseEnv();
  }
  return envInstance;
}

export function validateEnv(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const env = getEnv();
    
    if (!env.geminiApiKey) {
      errors.push('VITE_GEMINI_API_KEY is not configured');
    }
    
    if (!env.backendUrl) {
      errors.push('VITE_BACKEND_URL is not configured');
    }
    
    try {
      new URL(env.backendUrl);
    } catch {
      errors.push('VITE_BACKEND_URL is not a valid URL');
    }
    
    if (!['gemini-2.0-flash-realtime', 'gemini-1.5-pro', 'gemini-1.5-flash'].includes(env.geminiModel)) {
      errors.push(`VITE_GEMINI_MODEL "${env.geminiModel}" may not be supported`);
    }
    
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown environment validation error');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isFeatureEnabled(feature: 'voice' | 'ocr'): boolean {
  const env = getEnv();
  switch (feature) {
    case 'voice':
      return env.enableVoice;
    case 'ocr':
      return env.enableOcr;
    default:
      return false;
  }
}

export { EnvConfig as EnvironmentConfig };