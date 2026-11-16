import axios from 'axios';
import {
  GROQ_API_KEY,
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  GEMINI_API_KEY,
  GOOGLE_API_KEY,
  OPENROUTER_API_KEY,
  getNvidiaApiKey,
  getGroqApiKey,
  getGeminiApiKey,
  getOpenRouterApiKey,
} from '../config';

export interface ProviderHealthResult {
  provider: string;
  success: boolean;
  model: string;
  latencyMs: number;
  error?: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  chat(prompt: string, systemPrompt?: string, apiKey?: string, apiBase?: string): Promise<string>;
  testConnection(apiKey?: string, apiBase?: string): Promise<ProviderHealthResult>;
}

export class NVIDIAProvider implements LLMProvider {
  id = 'nvidia';
  name = 'NVIDIA NIM API';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string, apiBase?: string): Promise<string> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('nvidia') || getNvidiaApiKey();
    if (!key) throw new Error('NVIDIA API Key is not configured (NVIDIA_API_KEY). Provide it in backend/.env or enter it in the AI Providers Studio.');

    const base = apiBase || NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    const modelsToTry = [
      'nvidia/nemotron-3.5-bolt-e4b',
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-70b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
    ];

    let lastError: any = null;
    for (const model of modelsToTry) {
      try {
        const response = await axios.post(
          `${base}/chat/completions`,
          {
            model,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2048,
          },
          {
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            timeout: 25000,
          }
        );
        const content = response.data.choices[0]?.message?.content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        console.warn(`[NVIDIAProvider] Model ${model} failed (${status}): ${msg}`);
        if (status === 401 || status === 403) {
          throw new Error(`NVIDIA Authentication failed (${status}): ${msg}. Please check your NVIDIA API key.`);
        }
      }
    }
    throw new Error(`NVIDIA API failed: ${lastError?.response?.data?.error?.message || lastError?.message}`);
  }

  async testConnection(apiKey?: string, apiBase?: string): Promise<ProviderHealthResult> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('nvidia') || getNvidiaApiKey();
    if (!key) {
      return { provider: this.id, success: false, model: 'nvidia', latencyMs: 0, error: 'NVIDIA API Key is not configured (NVIDIA_API_KEY)' };
    }
    const base = apiBase || NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    const start = Date.now();
    const candidateModels = [
      'nvidia/nemotron-3.5-bolt-e4b',
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-70b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
    ];
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        await axios.post(
          `${base}/chat/completions`,
          {
            model,
            messages: [{ role: 'user', content: 'Say OK' }],
            temperature: 1,
            top_p: 0.95,
            max_tokens: 32,
          },
          {
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          }
        );

        return {
          provider: this.id,
          success: true,
          model,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        console.warn(`[NVIDIAProvider] Model ${model} test failed (${status}): ${msg}`);
        if (status === 401 || status === 403) {
          break;
        }
      }
    }

    const status = lastError?.response?.status;
    const msg = lastError?.response?.data?.error?.message || lastError?.response?.data?.message || lastError?.message;
    return {
      provider: this.id,
      success: false,
      model: 'nvidia/nemotron-3.5-bolt-e4b',
      latencyMs: Date.now() - start,
      error: status === 410
        ? 'NVIDIA API returned 410 Gone. The organization for this API key requires "Public API Endpoints" enabled in build.nvidia.com.'
        : `NVIDIA error (${status || 'network'}): ${msg}`,
    };
  }
}

export class GroqProvider implements LLMProvider {
  id = 'groq';
  name = 'Groq LPU Inference';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('groq') || getGroqApiKey();
    if (!key) throw new Error('Groq API Key is not configured (GROQ_API_KEY). Provide it in backend/.env or enter it in the AI Providers Studio.');

    const modelsToTry = [
      'llama-3.3-70b-versatile',
      'llama-3.2-3b-preview',
      'llama-3.2-1b-preview',
    ];
    let lastError: any = null;

    const sysPrompt = systemPrompt 
      ? (systemPrompt.toLowerCase().includes('json') ? systemPrompt : `${systemPrompt}\nOutput valid JSON.`)
      : 'You are an AI assistant. Output valid JSON.';

    for (const model of modelsToTry) {
      try {
        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
          },
          {
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );
        const content = response.data.choices[0]?.message?.content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message || err.message;
        console.warn(`[GroqProvider] Model ${model} failed (${status}): ${msg}`);
        if (status === 401 || status === 403) {
          throw new Error(`Groq Authentication failed (${status}): ${msg}. Please check your GROQ API key.`);
        }
      }
    }

    throw new Error(`Groq API failed: ${lastError?.response?.data?.error?.message || lastError?.message}`);
  }

  async testConnection(apiKey?: string): Promise<ProviderHealthResult> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('groq') || getGroqApiKey();
    if (!key) {
      return { provider: this.id, success: false, model: 'groq', latencyMs: 0, error: 'Groq API Key is not configured (GROQ_API_KEY)' };
    }
    const start = Date.now();
    try {
      let targetModel = 'llama-3.3-70b-versatile';
      try {
        const modelsRes = await axios.get('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 10000,
        });
        const available: string[] = (modelsRes.data?.data || []).map((m: any) => m.id);
        const preferred = ['llama-3.3-70b-versatile', 'llama-3.2-3b-preview', 'llama-3.2-1b-preview', 'llama3-70b-8192'];
        const match = preferred.find((m) => available.includes(m)) || available[0];
        if (match) targetModel = match;
      } catch {
        // Fallback to default
      }

      await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: targetModel,
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 10,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      return {
        provider: this.id,
        success: true,
        model: targetModel,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      return {
        provider: this.id,
        success: false,
        model: 'groq',
        latencyMs: Date.now() - start,
        error: `Groq error (${status || 'network'}): ${msg}`,
      };
    }
  }
}

export class GeminiProvider implements LLMProvider {
  id = 'gemini';
  name = 'Google Gemini API';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('gemini') || getGeminiApiKey();
    if (!key) throw new Error('Gemini API Key is not configured (GEMINI_API_KEY or GOOGLE_API_KEY). Provide it in backend/.env or enter it in the AI Providers Studio.');

    const systemInstruction = systemPrompt ? `System instruction: ${systemPrompt}\n` : '';
    const models = [
      'gemini-3.8-flash',
      'gemini-3-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
    ];
    let lastError: any = null;

    for (const model of models) {
      for (const apiVer of ['v1beta', 'v1']) {
        try {
          const response = await axios.post(
            `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${key}`,
            {
              contents: [
                {
                  parts: [
                    {
                      text: `${systemInstruction}User prompt: ${prompt}\nReturn your response as raw JSON conforming to the requested schema.`,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            },
            {
              headers: {
                'x-goog-api-key': key,
                'Content-Type': 'application/json',
              },
              timeout: 20000,
            }
          );
          const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) return content;
        } catch (err: any) {
          lastError = err;
          const status = err.response?.status;
          const msg = err.response?.data?.error?.message || err.message;
          console.warn(`[GeminiProvider] Model ${model} (${apiVer}) failed (${status}): ${msg}`);
          if (status === 400 && msg.toLowerCase().includes('api key')) {
            throw new Error(`Google Gemini API key invalid: ${msg}`);
          }
          if (status === 401 || status === 403) {
            throw new Error(`Google Gemini Authentication failed (${status}): ${msg}`);
          }
        }
      }
    }

    throw new Error(`Gemini API failed: ${lastError?.response?.data?.error?.message || lastError?.message}`);
  }

  async testConnection(apiKey?: string): Promise<ProviderHealthResult> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('gemini') || getGeminiApiKey();
    if (!key) {
      return { provider: this.id, success: false, model: 'gemini', latencyMs: 0, error: 'Gemini API Key is not configured (GEMINI_API_KEY or GOOGLE_API_KEY)' };
    }
    const start = Date.now();
    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-3-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ];
    let lastError: any = null;

    for (const model of candidateModels) {
      for (const apiVer of ['v1beta', 'v1']) {
        try {
          await axios.post(
            `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${key}`,
            {
              contents: [{ parts: [{ text: 'Respond with OK' }] }],
            },
            {
              headers: {
                'x-goog-api-key': key,
                'Content-Type': 'application/json',
              },
              timeout: 15000,
            }
          );

          return {
            provider: this.id,
            success: true,
            model,
            latencyMs: Date.now() - start,
          };
        } catch (err: any) {
          lastError = err;
          const status = err.response?.status;
          const msg = err.response?.data?.error?.message || err.message;
          console.warn(`[GeminiProvider] Model ${model} (${apiVer}) test failed (${status}): ${msg}`);
          if (status === 400 && msg.toLowerCase().includes('api key')) {
            return {
              provider: this.id,
              success: false,
              model,
              latencyMs: Date.now() - start,
              error: `Google Gemini API key invalid: ${msg}`,
            };
          }
          if (status === 401 || status === 403) {
            return {
              provider: this.id,
              success: false,
              model,
              latencyMs: Date.now() - start,
              error: `Google Gemini Authentication failed (${status}): ${msg}`,
            };
          }
        }
      }
    }

    const status = lastError?.response?.status;
    const msg = lastError?.response?.data?.error?.message || lastError?.message;
    return {
      provider: this.id,
      success: false,
      model: 'gemini',
      latencyMs: Date.now() - start,
      error: `Gemini error (${status || 'network'}): ${msg}`,
    };
  }
}

export class OpenAIProvider implements LLMProvider {
  id = 'openai';
  name = 'OpenAI API';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    if (!apiKey) throw new Error('OpenAI API Key is required.');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
    const content = response.data.choices[0]?.message?.content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  async testConnection(apiKey?: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.chat('{"ping": "pong"}', 'Return json', apiKey);
      return { provider: this.id, success: true, model: 'gpt-4o-mini', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { provider: this.id, success: false, model: 'gpt-4o-mini', latencyMs: Date.now() - start, error: err.message };
    }
  }
}

export class OpenRouterProvider implements LLMProvider {
  id = 'openrouter';
  name = 'OpenRouter Multi-Model';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    const key = apiKey || ProviderRegistry.getRuntimeKey('openrouter') || getOpenRouterApiKey();
    if (!key) throw new Error('OpenRouter API Key is required.');

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
    const content = response.data.choices[0]?.message?.content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  async testConnection(apiKey?: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.chat('{"ping": "pong"}', 'Return json', apiKey);
      return { provider: this.id, success: true, model: 'llama-3.3-70b', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { provider: this.id, success: false, model: 'llama-3.3-70b', latencyMs: Date.now() - start, error: err.message };
    }
  }
}

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic Claude';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    if (!apiKey) throw new Error('Anthropic API Key is required.');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 25000,
      }
    );
    return response.data.content[0].text;
  }

  async testConnection(apiKey?: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.chat('{"ping": "pong"}', 'Return json', apiKey);
      return { provider: this.id, success: true, model: 'claude-3-5-sonnet', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { provider: this.id, success: false, model: 'claude-3-5-sonnet', latencyMs: Date.now() - start, error: err.message };
    }
  }
}

export class OllamaProvider implements LLMProvider {
  id = 'ollama';
  name = 'Local Ollama';

  async chat(prompt: string, systemPrompt?: string, apiKey?: string, apiBase?: string): Promise<string> {
    const base = apiBase || 'http://localhost:11434';
    const response = await axios.post(
      `${base}/api/generate`,
      {
        model: 'llama3',
        system: systemPrompt,
        prompt: prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
      },
      { timeout: 30000 }
    );
    return response.data.response;
  }

  async testConnection(apiKey?: string, apiBase?: string): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await this.chat('{"ping": "pong"}', 'Return json', apiKey, apiBase);
      return { provider: this.id, success: true, model: 'llama3', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { provider: this.id, success: false, model: 'llama3', latencyMs: Date.now() - start, error: err.message };
    }
  }
}

export class ProviderRegistry {
  private static runtimeKeys: Record<string, string> = {};

  static setRuntimeKey(provider: string, key: string) {
    if (provider && key) {
      this.runtimeKeys[provider.toLowerCase()] = key.trim();
    }
  }

  static getRuntimeKey(provider: string): string | undefined {
    return this.runtimeKeys[provider.toLowerCase()];
  }

  private static providers: Record<string, LLMProvider> = {
    nvidia: new NVIDIAProvider(),
    groq: new GroqProvider(),
    gemini: new GeminiProvider(),
    openrouter: new OpenRouterProvider(),
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    ollama: new OllamaProvider(),
  };

  static getProvider(name: string): LLMProvider {
    const provider = this.providers[name.toLowerCase()];
    if (!provider) {
      throw new Error(`LLM Provider '${name}' is not registered in ProviderRegistry.`);
    }
    return provider;
  }

  static getAvailableProviders(): Array<{ id: string; name: string }> {
    return Object.values(this.providers).map((p) => ({ id: p.id, name: p.name }));
  }

  static async testProvider(name: string, apiKey?: string, apiBase?: string): Promise<ProviderHealthResult> {
    const provider = this.getProvider(name);
    return await provider.testConnection(apiKey, apiBase);
  }

  static async testAll(): Promise<ProviderHealthResult[]> {
    const results: ProviderHealthResult[] = [];
    for (const p of Object.values(this.providers)) {
      try {
        const res = await p.testConnection();
        results.push(res);
      } catch (err: any) {
        results.push({ provider: p.id, success: false, model: 'default', latencyMs: 0, error: err.message });
      }
    }
    return results;
  }

  static async chatWithFailover(
    prompt: string,
    systemPrompt?: string,
    primaryProvider: string = 'nvidia',
    apiKey?: string
  ): Promise<string> {
    const priorityOrder = [primaryProvider, 'nvidia', 'groq', 'gemini', 'openrouter', 'openai', 'anthropic', 'ollama'];
    const tried = new Set<string>();

    for (const name of priorityOrder) {
      if (tried.has(name)) continue;
      tried.add(name);

      const provider = this.providers[name];
      if (!provider) continue;

      try {
        console.log(`[ProviderRegistry] Attempting LLM chat with provider: ${name}`);
        const res = await provider.chat(prompt, systemPrompt, apiKey);
        return res;
      } catch (err: any) {
        console.warn(`[ProviderRegistry] Failover: Provider '${name}' failed: ${err.message}. Retrying next in chain...`);
      }
    }

    throw new Error('All AI LLM providers in the failover chain failed to respond.');
  }
}
