import { USAGE_CODES, type UsageCode } from './model';

export interface UsageColorSettings {
  enabled: boolean;
  colors: Record<UsageCode, string>;
}

export const DEFAULT_USAGE_COLORS: UsageColorSettings = {
  enabled: false,
  colors: { COM: '#5caa86', EST: '#8594ab', PRIV: '#dca568', VAGAS: '#d6c45b', REP: '#9c91b8' },
};

export function isUsageColorSettings(value: unknown): value is UsageColorSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as UsageColorSettings;
  return typeof settings.enabled === 'boolean' && !!settings.colors
    && USAGE_CODES.every(code => typeof settings.colors[code] === 'string' && /^#[0-9a-f]{6}$/i.test(settings.colors[code]));
}
