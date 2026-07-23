import type { SocialProvider } from "./types";

// Providers self-register at module init (see apify.ts / hikerapi.ts bottom-of-file
// side effects). The registry itself never imports a provider module directly —
// that would create a hard dependency and break the key-gated chain / test seams.
const providers = new Map<string, SocialProvider>();

/** Order the sync engine tries providers in, gated by which env keys are present. */
const CHAIN_ORDER: { name: string; envKey: string }[] = [
  { name: "apify-apidojo", envKey: "APIFY_TOKEN" },
  { name: "hikerapi", envKey: "HIKERAPI_KEY" },
];

export function registerProvider(p: SocialProvider): void {
  providers.set(p.name, p);
}

export function clearProviders(): void {
  providers.clear();
}

/**
 * Returns the ordered fallback chain [apify?, hikerapi?] — a provider is included
 * only when both its env key is present AND it has been registered (self-registered
 * via module import in real use; injected via `registerProvider` in tests).
 */
export function getProviderChain(env: NodeJS.ProcessEnv = process.env): SocialProvider[] {
  const chain: SocialProvider[] = [];
  for (const { name, envKey } of CHAIN_ORDER) {
    if (!env[envKey]) continue;
    const provider = providers.get(name);
    if (provider) chain.push(provider);
  }
  return chain;
}
