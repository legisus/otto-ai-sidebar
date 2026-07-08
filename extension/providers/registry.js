// Single edit-point for providers/endpoints/models. Pure data (no chrome.*).
export const PROVIDERS = [
  {
    id: "claude", label: "Claude (Anthropic)", adapter: "claude",
    keyPrefixHint: "sk-ant-", keyUrl: "https://console.anthropic.com/settings/keys",
    endpoints: [{
      id: "anthropic", label: "Anthropic API", baseURL: "https://api.anthropic.com/v1",
      models: [
        { id: "claude-sonnet-5", label: "Sonnet 5 (default)", vision: true, priceHint: "$3/$15" },
        { id: "claude-opus-4-8", label: "Opus 4.8", vision: true, priceHint: "$5/$25" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5 (cheap)", vision: true, priceHint: "$1/$5" },
        { id: "claude-fable-5", label: "Fable 5 (max)", vision: true, priceHint: "$10/$50" },
      ],
    }],
  },
  {
    id: "gemini", label: "Gemini (Google)", adapter: "gemini",
    keyPrefixHint: "AIza", keyUrl: "https://aistudio.google.com/apikey",
    endpoints: [{
      id: "gemini", label: "Gemini API", baseURL: "https://generativelanguage.googleapis.com/v1beta",
      models: [
        { id: "gemini-3.5-flash", label: "3.5 Flash", vision: true, priceHint: "$1.50/$9" },
        { id: "gemini-3.1-flash-lite", label: "3.1 Flash-Lite (free tier)", vision: true, priceHint: "$0.25/$1.50" },
        { id: "gemini-2.5-flash", label: "2.5 Flash (cheap)", vision: true, priceHint: "$0.15/$0.60" },
        { id: "gemini-3.1-pro", label: "3.1 Pro", vision: true, priceHint: "$2/$12" },
      ],
    }],
  },
  {
    id: "openai", label: "OpenAI-compatible", adapter: "openai-compat",
    keyPrefixHint: "", keyUrl: "https://platform.openai.com/api-keys",
    endpoints: [
      { id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1",
        models: [
          { id: "gpt-5.1", label: "GPT-5.1", vision: true, priceHint: "varies" },
          { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (cheap)", vision: true, priceHint: "~$0.10/$0.40" },
        ] },
      { id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com/v1",
        models: [
          { id: "deepseek-chat", label: "DeepSeek V4 Flash (cheapest, text-only)", vision: false, priceHint: "$0.14/$0.28" },
        ] },
      { id: "mistral", label: "Mistral", baseURL: "https://api.mistral.ai/v1",
        models: [
          { id: "pixtral-large-latest", label: "Pixtral (vision, cheap)", vision: true, priceHint: "~$0.15/$0.60" },
          { id: "mistral-small-latest", label: "Mistral Small (text-only)", vision: false, priceHint: "~$0.10/$0.30" },
        ] },
      { id: "groq", label: "Groq (fast, free tier)", baseURL: "https://api.groq.com/openai/v1",
        models: [
          { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (text-only)", vision: false, priceHint: "free tier" },
        ] },
    ],
  },
];

export const DEFAULT = { provider: "claude", endpoint: "anthropic", model: "claude-sonnet-5" };

export function findModel(providerId, endpointId, modelId) {
  const provider = PROVIDERS.find(p => p.id === providerId);
  const endpoint = provider?.endpoints.find(e => e.id === endpointId);
  const model = endpoint?.models.find(m => m.id === modelId);
  return model ? { provider, endpoint, model } : null;
}
