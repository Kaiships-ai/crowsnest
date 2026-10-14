"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import PreviewExample from "@/components/blocks/preview";
import { Button } from "@/components/ui/button";

export default function GalleryPage() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="relative min-h-screen bg-muted dark:bg-background">
      <Button
        variant="outline"
        size="sm"
        className="fixed top-4 right-4 z-50"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        {resolvedTheme === "dark" ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
        {resolvedTheme === "dark" ? "Light" : "Dark"}
      </Button>
      <PreviewExample />
    </div>
  );
}
