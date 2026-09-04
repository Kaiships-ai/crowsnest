import { expect, test } from "vitest";
import { personaIsDirty } from "./persona-dirty";
import type { Persona } from "@/server/services/persona";

const base: Persona = { audience: "a", voice: "v", do: "d", dont: "x" };

test("identical personas are not dirty", () => {
  expect(personaIsDirty(base, { ...base })).toBe(false);
});

test("a changed field is dirty", () => {
  expect(personaIsDirty(base, { ...base, voice: "new" })).toBe(true);
});

test("every field is compared", () => {
  expect(personaIsDirty(base, { ...base, dont: "changed" })).toBe(true);
});
