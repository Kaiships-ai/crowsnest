import { randomBytes } from "node:crypto";
import { hasSecretStore } from "../../../shared/secret-store";
import { readSecret, writeSecret } from "../secrets";
import { igSidecar } from "./manifest";

export function getOrCreateServiceToken(): string {
  const existing = readSecret(igSidecar, "IG_SERVICE_TOKEN");
  if (existing) return existing;
  if (!hasSecretStore()) throw new Error("No sidecar token yet: open Lead Studio once, or set IG_SERVICE_TOKEN in the environment.");
  const token = randomBytes(32).toString("hex");
  writeSecret(igSidecar, "IG_SERVICE_TOKEN", token);
  return token;
}
