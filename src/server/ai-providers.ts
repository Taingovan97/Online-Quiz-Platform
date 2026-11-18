import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { buildUserMessage, suggestionResponseSchema, SYSTEM_PROMPT, type AiItem } from "@/lib/ai/suggest";

/** Returns the provider's raw structured answer for one batch (validated by the caller). */
export type AnswerSuggester = {
  provider: string;
  model: string;
  suggest(items: AiItem[]): Promise<unknown>;
};

export class AiProviderError extends Error {}

const envSchema = z.object({
  AI_PROVIDER: z.enum(["anthropic", "openai-compatible"]).optional().or(z.literal("")),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(20),
});

export function aiConfig() {
  const env = envSchema.parse(process.env);
  const enabled = Boolean(env.AI_PROVIDER && env.AI_API_KEY);
  const model = env.AI_MODEL || (env.AI_PROVIDER === "anthropic" ? "claude-opus-5-5" : "gpt-4o-mini");
  return { ...env, enabled, model };
}

/** Anthropic via the official SDK: structured JSON output + server-side refusal fallbacks. */
function anthropicSuggester(apiKey: string, model: string): AnswerSuggester {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    provider: "anthropic",
    model,
    async suggest(items) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(items) }],
        output_config: { effort: "medium", format: betaZodOutputFormat(suggestionResponseSchema) },
      });
      if (response.stop_reason === "refusal") throw new AiProviderError("refusal");
      if (response.stop_reason === "max_tokens") throw new AiProviderError("max_tokens");
      return response.parsed_output;
    },
  };
}

/** Generic OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Groq, Gemini compat…). */
function openAiCompatibleSuggester(
  apiKey: string,
  model: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): AnswerSuggester {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    provider: "openai-compatible",
    model,
    async suggest(items) {
      const body = JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(items) },
        ],
      });
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body,
            signal: AbortSignal.timeout(120_000),
          });
        } catch (err) {
          if (attempt === 0) continue; // one retry on network errors
          throw new AiProviderError(`network: ${(err as Error).message}`);
        }
        if (res.status >= 500 && attempt === 0) continue; // one retry on 5xx, never on 4xx
        if (!res.ok) throw new AiProviderError(`http ${res.status}`);
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content;
        try {
          return content ? JSON.parse(content) : null;
        } catch {
          return null; // validated (and rejected) by the caller
        }
      }
    },
  };
}

/** The configured suggester, or null when AI is disabled. Never exposes the key. */
export function getSuggester(): AnswerSuggester | null {
  const cfg = aiConfig();
  if (!cfg.enabled) return null;
  if (cfg.AI_PROVIDER === "anthropic") return anthropicSuggester(cfg.AI_API_KEY!, cfg.model);
  return openAiCompatibleSuggester(cfg.AI_API_KEY!, cfg.model, cfg.AI_BASE_URL || "https://api.openai.com/v1");
}
