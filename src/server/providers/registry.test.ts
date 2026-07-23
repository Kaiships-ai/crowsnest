import { beforeEach, describe, expect, test } from "vitest";
import { clearProviders, getProviderChain, registerProvider } from "./registry";
import type { ProviderCapabilities, SocialProvider } from "./types";

const STUB_CAPS: ProviderCapabilities = {
  supportsThirdPartyMedia: true,
  supportsPlayCounts: true,
  requiresAccountLogin: false,
  requiresAppReview: false,
  maxRecentVideos: 30,
};

function fakeProvider(name: string): SocialProvider {
  return {
    name,
    capabilities: STUB_CAPS,
    getProfile: () => {
      throw new Error("not used");
    },
    getRecentVideos: () => {
      throw new Error("not used");
    },
  };
}

beforeEach(() => {
  clearProviders();
});

describe("getProviderChain", () => {
  test("empty when no keys present in passed-in fake env", () => {
    expect(getProviderChain({})).toEqual([]);
  });

  test("includes apify-apidojo when env has APIFY_TOKEN", () => {
    const apify = fakeProvider("apify-apidojo");
    registerProvider(apify);
    const chain = getProviderChain({ APIFY_TOKEN: "x" });
    expect(chain).toEqual([apify]);
  });

  test("orders apify before hikerapi when both keys present", () => {
    const apify = fakeProvider("apify-apidojo");
    const hiker = fakeProvider("hikerapi");
    registerProvider(hiker); // register out of order to prove chain ordering, not registration order
    registerProvider(apify);
    const chain = getProviderChain({ APIFY_TOKEN: "x", HIKERAPI_KEY: "y" });
    expect(chain).toEqual([apify, hiker]);
  });

  test("clearProviders empties the registry", () => {
    registerProvider(fakeProvider("apify-apidojo"));
    clearProviders();
    const chain = getProviderChain({ APIFY_TOKEN: "x" });
    expect(chain).toEqual([]);
  });
});
