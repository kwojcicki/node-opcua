/**
 * Tiny TCP ↔ WebSocket bridge used by the E2E test harness.
 *
 * `websockify-js` is not available on npm (only `websockify` and the Python
 * reference implementation); to keep the test harness self-contained we ship
 * this ~70 LoC bridge built on the `ws` package. It accepts WebSocket
 * connections and tunnels raw bytes to a backend TCP socket, exactly like
 * `websockify --wrap-mode`.
 *
 * Usage:
 *   const bridge = await startWsBridge({ backendHost: "127.0.0.1", backendPort: 26543 });
 *   // bridge.url === "ws://127.0.0.1:<randomPort>"
 *   await bridge.stop();
 *
 * For TLS termination (wss://), pass `tls: { cert, key }` (PEM strings). The
 * bridge creates an `https` server and hands it to `ws`'s `WebSocketServer`,
 * so clients that trust the cert (or set `rejectUnauthorized: false`) can
 * connect with `wss://...`.
 */

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createConnection, type Socket } from "node:net";
import { WebSocketServer } from "ws";

export interface StartWsBridgeOptions {
    /** TCP host/port the backend OPC UA server is listening on. */
    backendHost: string;
    backendPort: number;
    /** WebSocket port to listen on. 0 = random. */
    wsPort?: number;
    /** If provided, the bridge listens over TLS (wss://). Accepts PEM strings. */
    tls?: { cert: string | Buffer; key: string | Buffer };
    /** Host interface to bind the bridge to. Defaults to `127.0.0.1`. */
    host?: string;
}

export interface WsBridge {
    /** Full URL a client should connect to (`ws://…` or `wss://…`). */
    url: string;
    /** Bridge's own port (useful when `wsPort: 0` was passed). */
    port: number;
    /** Number of currently-open tunnels. */
    activeTunnels(): number;
    /** Shut down cleanly. Resolves when all sockets are closed. */
    stop(): Promise<void>;
}

export async function startWsBridge(options: StartWsBridgeOptions): Promise<WsBridge> {
    const host = options.host ?? "127.0.0.1";
    const httpServer = options.tls
        ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key })
        : createHttpServer();

    const wss = new WebSocketServer({
        server: httpServer,
        handleProtocols: (protocols) => (protocols.has("opcua+uacp") ? "opcua+uacp" : false)
    });

    const tunnels = new Set<{ ws: import("ws").WebSocket; tcp: Socket }>();

    wss.on("connection", (ws) => {
        const tcp = createConnection({ host: options.backendHost, port: options.backendPort }, () => {
            /* tcp connected */
        });
        const entry = { ws, tcp };
        tunnels.add(entry);

        tcp.on("data", (chunk) => {
            // Send raw TCP bytes as a binary WS frame. Per OPC UA Part 6 §7.5,
            // each UACP chunk "should" be its own frame, but websockify
            // historically sends each TCP read as a frame; the client's
            // packet-assembler recombines whatever the bytes look like.
            if (ws.readyState === ws.OPEN) {
                ws.send(chunk);
            }
        });
        tcp.on("close", () => {
            try {
                ws.close();
            } catch {
                /* swallow */
            }
            tunnels.delete(entry);
        });
        tcp.on("error", () => {
            try {
                ws.close();
            } catch {
                /* swallow */
            }
        });

        ws.on("message", (data, isBinary) => {
            if (!isBinary) return;
            tcp.write(data as Buffer);
        });
        ws.on("close", () => {
            try {
                tcp.destroy();
            } catch {
                /* swallow */
            }
            tunnels.delete(entry);
        });
        ws.on("error", () => {
            try {
                tcp.destroy();
            } catch {
                /* swallow */
            }
        });
    });

    await new Promise<void>((resolve) => {
        httpServer.listen(options.wsPort ?? 0, host, () => resolve());
    });
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const scheme = options.tls ? "wss" : "ws";
    const url = `${scheme}://${host}:${port}`;

    return {
        url,
        port,
        activeTunnels: () => tunnels.size,
        async stop() {
            // Close active WS connections
            for (const { ws, tcp } of tunnels) {
                try {
                    ws.terminate();
                } catch {
                    /* swallow */
                }
                try {
                    tcp.destroy();
                } catch {
                    /* swallow */
                }
            }
            tunnels.clear();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    };
}
