import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  telegram: {
    token: string;
    adminIds: number[];
  };
  ai: {
    provider: 'gemini' | 'openai';
    geminiApiKey: string;
    geminiModel: string;
    openaiApiKey: string;
    openaiModel: string;
    customPrompt?: string;
  };
  wordpress: {
    url: string;
    username: string;
    appPassword: string;
    defaultStatus: 'draft' | 'publish';
    defaultAuthorId?: number;
  };
}

function parseAdminIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export const config: AppConfig = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminIds: parseAdminIds(process.env.TELEGRAM_ADMIN_IDS),
  },
  ai: {
    provider: (process.env.AI_PROVIDER as 'gemini' | 'openai') || 'gemini',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    customPrompt: process.env.AI_CUSTOM_PROMPT,
  },
  wordpress: {
    url: (process.env.WP_URL || '').replace(/\/+$/, ''),
    username: process.env.WP_USERNAME || '',
    appPassword: process.env.WP_APP_PASSWORD || '',
    defaultStatus: (process.env.WP_DEFAULT_STATUS as 'draft' | 'publish') || 'draft',
    defaultAuthorId: process.env.WP_AUTHOR_ID ? parseInt(process.env.WP_AUTHOR_ID, 10) : undefined,
  },
};

export function validateConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!config.telegram.token) missing.push('TELEGRAM_BOT_TOKEN');
  if (config.telegram.adminIds.length === 0) missing.push('TELEGRAM_ADMIN_IDS');

  if (config.ai.provider === 'gemini' && !config.ai.geminiApiKey) {
    missing.push('GEMINI_API_KEY');
  } else if (config.ai.provider === 'openai' && !config.ai.openaiApiKey) {
    missing.push('OPENAI_API_KEY');
  }

  if (!config.wordpress.url) missing.push('WP_URL');
  if (!config.wordpress.username) missing.push('WP_USERNAME');
  if (!config.wordpress.appPassword) missing.push('WP_APP_PASSWORD');

  return {
    valid: missing.length === 0,
    missing,
  };
}
