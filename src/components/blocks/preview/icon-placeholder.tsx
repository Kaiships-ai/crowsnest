"use client"

import * as Lucide from "lucide-react"

// Website's IconPlaceholder is a multi-library dynamic renderer. crowsnest uses
// lucide only, so this resolves the `lucide` prop (PascalCase, optional "Icon"
// suffix) against lucide's icon record and falls back to a square.
export function IconPlaceholder({
  lucide,
  tabler,
  hugeicons,
  phosphor,
  remixicon,
  ...props
}: {
  lucide?: string
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
} & React.ComponentProps<"svg">) {
  const key = (lucide ?? "").replace(/Icon$/, "")
  const Icon = (Lucide.icons as Record<string, React.ComponentType<React.ComponentProps<"svg">>>)[key] ?? Lucide.SquareIcon
  return <Icon {...props} />
}
