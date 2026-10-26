import { CONNECTORS } from "./registry";
import { readSecret, SecretLockedError } from "./secrets";

const MIN_SCRUBBED_SECRET = 8;

function readable(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch (err) {
    if (err instanceof SecretLockedError) return undefined;
    throw err;
  }
}

export function scrubSecrets(text: string): string {
  const names = CONNECTORS.flatMap(({ manifest }) => manifest.secrets.map((s) => [manifest, s.name] as const));
  return names.reduce((out, [manifest, name]) => {
    const value = readable(() => readSecret(manifest, name));
    return value && value.length >= MIN_SCRUBBED_SECRET ? out.replaceAll(value, "[redacted]") : out;
  }, text);
}
