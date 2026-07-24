import type { SocialProvider } from "./types";

// Providers self-register at module init (see apify.ts / hikerapi.ts bottom-of-file
// side effects) — something in the real module graph must import those files for that
// side effect to ever run (see sync-engine.ts's top-of-file side-effect imports).
// This file deliberately does NOT import them itself: `import "./apify"` here would
// create a circular import (registry -> apify -> registry), and ESM hoists that import
// ahead of this file's own `const providers = new Map()` below, crashing at module
// load with "Cannot access 'providers' before initialization." Import the provider
// modules from a *consumer* of this registry instead (a leaf, not something this file
// itself depends on) — that also keeps registry.test.ts free to register pure fakes
// without pulling in real provider implementations.
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
