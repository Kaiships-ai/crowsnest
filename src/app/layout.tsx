import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Archivo carries everything that is words. IBM Plex Mono carries everything that is a
// number, an id, a timestamp or a system state, per the design system's hard rule.
const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Crowsnest",
  description: "Local-first outlier tracking and remix workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${archivo.variable} ${plexMono.variable} font-sans antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster theme="dark" />
      </body>
    </html>
  );
}
