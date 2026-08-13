"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  send: (text: string) => void;
}

interface TerminalPaneProps {
  postId: string;
  onRender?: (payload: { assetId: string; url: string }) => void;
}

interface TerminalOutputMessage { type: "output"; data: string }
interface TerminalExitMessage { type: "exit"; code: number }
interface TerminalRenderMessage { type: "render"; assetId: string; url: string }
type TerminalServerMessage = TerminalOutputMessage | TerminalExitMessage | TerminalRenderMessage;

function isTerminalServerMessage(value: unknown): value is TerminalServerMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type: unknown }).type;
  return type === "output" || type === "exit" || type === "render";
}

/**
 * An xterm.js pane wired to the per-post terminal websocket (src/server/terminal/ws.ts).
 * The server owns the pty and the sandbox cwd; this component only relays keystrokes in
 * and rendered output back, plus terminal resize so the pty's rows/cols stay in sync with
 * the pane's on-screen size. The exposed `send` handle lets the studio inject commands into
 * the live session, and `onRender` reports captured render frames back to the studio.
 */
export const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
  { postId, onRender },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;

  useImperativeHandle(ref, () => ({
    send: (text: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: text }));
      }
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    let cleanedUp = false;

    const term = new Terminal({
      convertEol: false,
      fontFamily: "IBM Plex Mono, monospace",
      theme: { background: "#08080a", foreground: "#f2f2f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    const ws = new WebSocket(`ws://${location.host}/api/terminal/ws?post=${postId}`);
    wsRef.current = ws;

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!isTerminalServerMessage(parsed)) {
        return;
      }
      if (parsed.type === "output") {
        term.write(parsed.data);
      } else if (parsed.type === "render") {
        onRenderRef.current?.({ assetId: parsed.assetId, url: parsed.url });
      } else {
        term.write("\r\nsession ended\r\n");
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(container);

    return () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      resizeObserver.disconnect();
      ws.close();
      wsRef.current = null;
      term.dispose();
    };
  }, [postId]);

  return <div ref={containerRef} className="h-full w-full" />;
});
