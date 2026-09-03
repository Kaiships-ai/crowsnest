"use client";

// Replaces the whole document when even the root layout throws. It renders outside the
// app's providers and token CSS, so it is intentionally self-contained with inline styles
// — no shared components, no Tailwind assumptions. Destructive red, one neutral retry,
// never amber.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0c",
          color: "#f2f2f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 440, padding: 24, border: "1px solid rgba(217,80,63,0.4)" }}>
          <span style={{ fontFamily: "monospace", fontSize: 13, letterSpacing: "0.06em", color: "#d9503f" }}>ERROR</span>
          <h1 style={{ margin: "12px 0 0", fontSize: 20, fontWeight: 600 }}>Crowsnest failed to start this page.</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "#9a9a96" }}>
            Reload to try again. If it persists, restart the app from the terminal.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "9px 17px",
              background: "transparent",
              color: "#f2f2f0",
              border: "1px solid #3e3e46",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
