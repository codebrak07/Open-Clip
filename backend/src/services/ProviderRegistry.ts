import axios from 'axios';
import { GROQ_API_KEY } from '../config';

export interface LLMProvider {
  chat(prompt: string, systemPrompt?: string, apiKey?: string, apiBase?: string): Promise<string>;
}

export class GroqProvider implements LLMProvider {
  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    const key = apiKey || GROQ_API_KEY;
    if (!key) throw new Error('Groq API Key is not configured.');

    // Try current Groq models (llama-3.1-8b-instant, llama-3.3-70b-versatile, llama3-8b-8192)
    const modelsToTry = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'llama3-8b-8192', 'mixtral-8x7b-32768'];
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );
        return JSON.stringify(response.data.choices[0].message.content);
      } catch (err: any) {
        lastError = err;
        console.warn(`[GroqProvider] Model ${model} failed: ${err.response?.data?.error?.message || err.message}. Trying next model...`);
      }
    }

    throw new Error(`Groq API request failed across all models: ${lastError?.response?.data?.error?.message || lastError?.message}`);
  }
}

export class OpenAIProvider implements LLMProvider {
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
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return JSON.stringify(response.data.choices[0].message.content);
  }
}

export class GeminiProvider implements LLMProvider {
  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    if (!apiKey) throw new Error('Gemini API Key is required.');

    const systemInstruction = systemPrompt ? `System instruction: ${systemPrompt}\n` : '';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: `${systemInstruction}User prompt: ${prompt}\nReturn your response as raw JSON conforming to the requested schema.` }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      }
    );
    const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error(`Failed to generate content from Gemini API: ${JSON.stringify(response.data)}`);
    }
    return content;
  }
}

export class AnthropicProvider implements LLMProvider {
  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    if (!apiKey) throw new Error('Anthropic API Key is required.');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.content[0].text;
  }
}

export class OllamaProvider implements LLMProvider {
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
        options: {
          temperature: 0.1
        }
      }
    );
    return response.data.response;
  }
}

export class OpenRouterProvider implements LLMProvider {
  async chat(prompt: string, systemPrompt?: string, apiKey?: string): Promise<string> {
    if (!apiKey) throw new Error('OpenRouter API Key is required.');

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3-8b-instruct:free',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return JSON.stringify(response.data.choices[0].message.content);
  }
}

export class ProviderRegistry {
  private static providers: Record<string, LLMProvider> = {
    groq: new GroqProvider(),
    openrouter: new OpenRouterProvider(),
    gemini: new GeminiProvider(),
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

  static async chatWithFailover(prompt: string, systemPrompt?: string, primaryProvider: string = 'groq', apiKey?: string): Promise<string> {
    const priorityOrder = [primaryProvider, 'groq', 'openrouter', 'gemini', 'openai', 'anthropic', 'ollama'];
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
        console.warn(`[ProviderRegistry] Failover triggered: Provider '${name}' failed: ${err.message}. Retrying next in chain...`);
      }
    }

    throw new Error('All AI LLM providers in the failover chain failed to respond.');
  }
}

