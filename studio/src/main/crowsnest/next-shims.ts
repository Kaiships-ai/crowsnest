// The main build aliases `next/cache` and `next/server` to this file
// (electron.vite.config.ts). The app has no Next page cache to revalidate and no
// request scope for `after` to extend, so both calls do nothing here.
export function revalidatePath(): void {}

export function after(): void {}
