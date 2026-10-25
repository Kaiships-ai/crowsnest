import { randomBytes } from "node:crypto";
import { readSecret, writeSecret } from "../secrets";
import { igSidecar } from "./manifest";

export function getOrCreateServiceToken(): string {
  const existing = readSecret(igSidecar, "IG_SERVICE_TOKEN");
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  writeSecret(igSidecar, "IG_SERVICE_TOKEN", token);
  return token;
}
