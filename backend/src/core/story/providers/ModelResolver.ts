import axios from 'axios';
import { Logger } from '../../../utils/Logger';

export interface ModelListingResponse {
  data: Array<{ id: string; [key: string]: any }>;
}

const blacklistedModels = new Map<string, Set<string>>();

export function blacklistModel(providerName: string, modelId: string, reason: string): void {
  if (!blacklistedModels.has(providerName)) {
    blacklistedModels.set(providerName, new Set());
  }
  blacklistedModels.get(providerName)!.add(modelId);
  Logger.warn(`[${providerName}] Blacklisted model "${modelId}" (Reason: ${reason})`);
}

export function isModelBlacklisted(providerName: string, modelId: string): boolean {
  return blacklistedModels.get(providerName)?.has(modelId) || false;
}

/**
 * Sanitizes and formats provider errors for logs and UI display without exposing secret keys.
 * Extracts status and the first 300 characters of the response body.
 */
export function formatProviderError(providerName: string, model: string, err: any): Error {
  const status = err.response?.status || 'TIMEOUT';
  let rawData = '';
  if (Buffer.isBuffer(err.response?.data) || err.response?.data instanceof ArrayBuffer) {
    rawData = Buffer.from(err.response.data).toString('utf-8');
  } else if (typeof err.response?.data === 'string') {
    rawData = err.response.data;
  } else {
    rawData = JSON.stringify(err.response?.data || {});
  }

  if (rawData.includes('requires terms') || rawData.includes('model_terms_required')) {
    rawData = 'Accept the terms at console.groq.com/playground?model=canopylabs%2Forpheus-v1-english';
  }

  const cleanSnippet = rawData
    .replace(/(bearer\s+[a-zA-Z0-9_\-\.]+)/gi, '[REDACTED]')
    .replace(/(gsk_[a-zA-Z0-9_\-]+)/gi, '[REDACTED]')
    .replace(/(nvapi-[a-zA-Z0-9_\-]+)/gi, '[REDACTED]')
    .slice(0, 300);

  return new Error(`[${providerName}] Model: ${model}, Status: ${status}, Detail: ${cleanSnippet || err.message}`);
}

/**
 * Probes a candidate model with a lightweight 1-token completion.
 * HTTP 410 (or 404/403/retired) = permanent blacklist.
 */
export async function probeModelWithOneToken(
  chatEndpointUrl: string,
  apiKey: string,
  modelId: string,
  providerName: string
): Promise<boolean> {
  if (!apiKey || isModelBlacklisted(providerName, modelId)) return false;

  try {
    await axios.post(
      chatEndpointUrl,
      {
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 6000,
      }
    );
    Logger.info(`[${providerName}] 1-token probe passed for model: ${modelId}`);
    return true;
  } catch (err: any) {
    const status = err.response?.status;
    const rawData = typeof err.response?.data === 'string'
      ? err.response.data
      : JSON.stringify(err.response?.data || {});
    const cleanSnippet = rawData
      .replace(/(bearer\s+[a-zA-Z0-9_\-\.]+)/gi, '[REDACTED]')
      .replace(/(gsk_[a-zA-Z0-9_\-]+)/gi, '[REDACTED]')
      .replace(/(nvapi-[a-zA-Z0-9_\-]+)/gi, '[REDACTED]')
      .slice(0, 300);

    if (status === 410 || status === 404 || status === 403) {
      blacklistModel(providerName, modelId, `HTTP ${status}: ${cleanSnippet}`);
      return false;
    }

    Logger.warn(`[${providerName}] 1-token probe warning for model "${modelId}": HTTP ${status || 'TIMEOUT'} - ${cleanSnippet}`);
    return false;
  }
}

export async function resolveCandidateModels(
  endpointUrl: string,
  apiKey: string,
  preferenceList: string[],
  providerName: string,
  defaultFallback?: string
): Promise<string[]> {
  if (!apiKey) {
    return defaultFallback ? [defaultFallback] : [];
  }

  try {
    const res = await axios.get<ModelListingResponse>(endpointUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    });

    const availableIds = new Set((res.data?.data || []).map(m => m.id));
    const matched: string[] = [];

    // 1. Exact matches in preference order
    for (const pref of preferenceList) {
      if (availableIds.has(pref) && !isModelBlacklisted(providerName, pref)) {
        matched.push(pref);
      }
    }

    // 2. Substring matches
    for (const pref of preferenceList) {
      for (const modelId of availableIds) {
        if (!matched.includes(modelId) && !isModelBlacklisted(providerName, modelId)) {
          if (modelId.toLowerCase().includes(pref.toLowerCase())) {
            matched.push(modelId);
          }
        }
      }
    }

    if (defaultFallback && !matched.includes(defaultFallback) && !isModelBlacklisted(providerName, defaultFallback)) {
      matched.push(defaultFallback);
    }

    return matched;
  } catch (err: any) {
    Logger.warn(`[${providerName}] Error querying models endpoint (${err.message}). Using fallback list.`);
    return defaultFallback ? [defaultFallback] : preferenceList;
  }
}

export async function resolveDynamicModel(
  endpointUrl: string,
  apiKey: string,
  preferenceList: string[],
  providerName: string,
  defaultFallback?: string
): Promise<string> {
  const candidates = await resolveCandidateModels(endpointUrl, apiKey, preferenceList, providerName, defaultFallback);
  const valid = candidates.find(m => !isModelBlacklisted(providerName, m));
  if (valid) {
    Logger.info(`[${providerName}] Resolved active model: ${valid}`);
    return valid;
  }
  if (defaultFallback) {
    return defaultFallback;
  }
  throw new Error(`[${providerName}] No usable, non-blacklisted models available.`);
}
