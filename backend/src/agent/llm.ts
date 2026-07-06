import { config } from '../config.js';

/**
 * Optional LLM assist for the agent's "think" step, via OpenRouter.
 *
 * Env-gated and failure-proof: with no API key it returns null immediately (no
 * network), and any transport / HTTP / parse error also yields null. Callers
 * treat null as "no augmentation" and fall back to the deterministic loop, so a
 * missing or flaky LLM can never break a proposal or throw into the agent.
 */
export async function llmAssess(prompt: string, timeoutMs = 8000): Promise<string | null> {
  if (!config.OPENROUTER_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 220,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether live LLM augmentation is configured. */
export function llmEnabled(): boolean {
  return Boolean(config.OPENROUTER_API_KEY);
}
