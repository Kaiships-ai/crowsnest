import path from "node:path";
import { config } from "@/server/config";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const workspace = () => path.join(config.WORKSPACE_ROOT);

export function sandboxDir(slug: string): string {
  return path.join(workspace(), "videos", slug);
}

export function rendersDir(dateISO: string, slug: string): string {
  return path.join(workspace(), "renders", `${dateISO}-${slug}`);
}

export function rendersRoot(): string {
  return path.join(workspace(), "renders");
}
