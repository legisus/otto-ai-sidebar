// Settings persistence in chrome.storage.local. Guards for Node so it imports in tests.
import { DEFAULT } from "./providers/registry.js";
export const KEYS = { settings: "otto.settings" };
const hasChrome = typeof chrome !== "undefined" && chrome.storage?.local;

export async function getSettings() {
  const base = { provider: DEFAULT.provider, endpoint: DEFAULT.endpoint, model: DEFAULT.model, apiKeys: {} };
  if (!hasChrome) return base;
  const got = await chrome.storage.local.get(KEYS.settings);
  const s = got[KEYS.settings] || {};
  return { ...base, ...s, apiKeys: { ...base.apiKeys, ...(s.apiKeys || {}) } };
}

export async function setSettings(patch) {
  if (!hasChrome) return;
  const cur = await getSettings();
  const next = { ...cur, ...patch, apiKeys: { ...cur.apiKeys, ...(patch.apiKeys || {}) } };
  await chrome.storage.local.set({ [KEYS.settings]: next });
}
