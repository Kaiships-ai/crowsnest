const fetchIn = (page, url, range) =>
  page.evaluate(
    async ([url, range]) => {
      const res = await fetch(url, range ? { headers: { range } } : undefined);
      return { status: res.status, bytes: (await res.arrayBuffer()).byteLength, type: res.headers.get("content-type") };
    },
    [url, range],
  );

export default async function media01({ page, step }) {
  await step("missing asset is 404", async () => {
    const res = await fetchIn(page, "cn-media://asset/no-such-asset");
    if (res.status !== 404) throw new Error(`status ${res.status}`);
  });
  const id = process.env.CN_MEDIA_ASSET;
  if (!id) return;
  await step("asset 200", async () => {
    const res = await fetchIn(page, `cn-media://asset/${id}`);
    if (res.status !== 200 || res.bytes === 0) throw new Error(JSON.stringify(res));
    console.log(`asset: ${JSON.stringify(res)}`);
  });
  await step("asset range 206", async () => {
    const res = await fetchIn(page, `cn-media://asset/${id}`, "bytes=0-9");
    if (res.status !== 206 || res.bytes !== 10) throw new Error(JSON.stringify(res));
  });
}
