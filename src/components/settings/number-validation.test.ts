import { expect, test } from "vitest";
import { numberFieldError } from "./number-validation";

test("empty is an error", () => {
  expect(numberFieldError("", { min: 1 })).toBe("Enter a number");
});
test("below min", () => {
  expect(numberFieldError("0", { min: 1 })).toBe("Must be at least 1");
});
test("above max", () => {
  expect(numberFieldError("50", { max: 30 })).toBe("Must be at most 30");
});
test("non-integer when integer required", () => {
  expect(numberFieldError("1.5", { min: 1, integer: true })).toBe("Must be a whole number");
});
test("valid returns null", () => {
  expect(numberFieldError("12", { min: 1, max: 30, integer: true })).toBeNull();
});
