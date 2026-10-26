import { CONNECTORS } from "./registry";
import { readSecret } from "./secrets";

const MIN_SCRUBBED_SECRET = 8;

export function scrubSecrets(text: string): string {
  const names = CONNECTORS.flatMap(({ manifest }) => manifest.secrets.map((s) => [manifest, s.name] as const));
  return names.reduce((out, [manifest, name]) => {
    const value = readSecret(manifest, name);
    if (!value || value.length < MIN_SCRUBBED_SECRET) return out;
    return out.replaceAll(value, "[redacted]").replaceAll(JSON.stringify(value).slice(1, -1), "[redacted]");
  }, text);
}
