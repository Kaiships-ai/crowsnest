// Preloaded into the e2e server (NODE_OPTIONS=--import, scripts/e2e/run.sh). Every
// graph.instagram.com request is answered here with a rejected-token error, so the
// fixture's junk Graph token renders the "configured but rejected" state with no network
// call to Instagram. Every other request goes through untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).host === "graph.instagram.com") {
    const body = { error: { message: "Invalid OAuth access token (e2e offline)", type: "OAuthException", code: 190 } };
    return new Response(JSON.stringify(body), { status: 400, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
