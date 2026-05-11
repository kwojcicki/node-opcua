/**
 * E2E harness: orchestrates the three processes the browser specs need.
 *
 *   1. `node-opcua-server` on a random TCP port (demo-server.ts).
 *   2. A TCP↔WebSocket bridge (plain `ws://` or TLS `wss://`) in-process.
 *   3. A plain Node `http.Server` serving `test/page/dist/` as static files.
 *      The contents of `dist/` are produced by a one-shot esbuild bundle
 *      (`build-test-page.mjs`) run at harness startup — mirroring upstream's
 *      `node-opcua-crypto/packages/node-opcua-crypto-web/build-web.mjs`.
 *
 * `startHarness({tls})` returns a context with the URLs / creds the specs
 * will hand to `window.opcua.connect`. `stopAll()` tears everything down.
 */

import { readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MessageSecurityMode, SecurityPolicy } from "node-opcua";

import { startDemoServer, type DemoServer } from "../fixtures/demo-server";
import { startWsBridge, type WsBridge } from "../fixtures/start-ws-bridge";

export interface StaticServer {
    url: string;
    port: number;
    close: () => Promise<void>;
}

export interface HarnessContext {
    /** The static-server URL hosting the test page. */
    pageUrl: string;
    /** The WebSocket URL the page should connect to. `ws://` for plain, `wss://` for TLS. */
    wsEndpointUrl: string;
    /** Convenience: the OPC UA endpoint URL in `opc.ws[s]://` scheme. */
    opcWsEndpointUrl: string;
    /** Demo server (backend). */
    server: DemoServer;
    /** TCP↔WS bridge. */
    bridge: WsBridge;
    /** Static page server. */
    pageServer: StaticServer;
    /** Shut everything down. */
    stopAll: () => Promise<void>;
}

export interface HarnessOptions {
    /** If true, the bridge terminates TLS and the wsEndpointUrl is wss://. */
    tls?: boolean;
}

const packageDir = resolve(__dirname, "..", "..");
const certsDir = resolve(packageDir, "test", "fixtures", "certs");
const pageDistDir = resolve(packageDir, "test", "page", "dist");

const MIME_BY_EXT: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

/**
 * Start a tiny static-file HTTP server rooted at `test/page/dist/`.
 *
 * Intentionally minimal: GET-only, no directory listing, no range requests,
 * no caching headers, no symlink escape check. The test harness is the only
 * consumer; there's no security boundary here.
 */
async function startStaticPageServer(): Promise<StaticServer> {
    // Only start the server after confirming the bundle is on disk. If
    // someone invokes this before calling `buildTestPage()`, fail loud rather
    // than serve 404s.
    try {
        statSync(join(pageDistDir, "index.html"));
        statSync(join(pageDistDir, "main.js"));
    } catch {
        throw new Error(
            `Test page bundle is missing at ${pageDistDir}. Call buildTestPage() before startStaticPageServer().`
        );
    }

    const server = createHttpServer((req, res) => {
        if (!req.url || req.method !== "GET") {
            res.writeHead(405).end();
            return;
        }
        // Strip query string; default "/" → "/index.html"
        let urlPath = req.url.split("?", 1)[0];
        if (urlPath === "/") urlPath = "/index.html";
        const filePath = join(pageDistDir, urlPath);
        // Basic path-escape guard
        if (!filePath.startsWith(pageDistDir)) {
            res.writeHead(403).end();
            return;
        }
        try {
            const content = readFileSync(filePath);
            const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
            res.writeHead(200, { "content-type": mime, "content-length": String(content.length) });
            res.end(content);
        } catch {
            res.writeHead(404).end();
        }
    });

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
    const addr = server.address();
    if (!addr || typeof addr !== "object") {
        await new Promise<void>((r) => server.close(() => r()));
        throw new Error("Static page server did not bind to a usable address");
    }
    const port = addr.port;
    const url = `http://127.0.0.1:${port}`;

    return {
        url,
        port,
        close: () =>
            new Promise<void>((resolveClose) => {
                server.close(() => resolveClose());
            })
    };
}

export async function startHarness(options: HarnessOptions = {}): Promise<HarnessContext> {
    // 0. One-shot esbuild bundle of the test page. Rebuilt unconditionally
    //    so spec runs pick up the latest source without needing a manual
    //    `pnpm build:test-page`. Typical cost is a few seconds and runs once
    //    per harness startup.
    {
        // Dynamic import — `build-test-page.mjs` is ESM with top-level await,
        // which Playwright's CJS test-loader can't `require()`.
        const url = pathToFileURL(resolve(packageDir, "build-test-page.mjs")).href;
        const mod = (await import(url)) as { buildTestPage: (opts?: { logLevel?: string }) => Promise<string> };
        await mod.buildTestPage({ logLevel: "warning" });
    }

    // 1. OPC UA server — enable Basic256Sha256 when the harness is in TLS mode so
    //    the wss spec can exercise both TLS (at the bridge) and OPC UA message-level
    //    security (at the channel).
    const server = await startDemoServer({
        host: "127.0.0.1",
        securityPolicies: options.tls ? [SecurityPolicy.Basic256Sha256] : [],
        securityModes: options.tls ? [MessageSecurityMode.SignAndEncrypt] : []
    });

    // 2. Bridge
    const bridgeOpts: Parameters<typeof startWsBridge>[0] = {
        backendHost: "127.0.0.1",
        backendPort: server.port,
        host: "127.0.0.1"
    };
    if (options.tls) {
        bridgeOpts.tls = {
            cert: readFileSync(resolve(certsDir, "bridge.crt.pem")),
            key: readFileSync(resolve(certsDir, "bridge.key.pem"))
        };
    }
    const bridge = await startWsBridge(bridgeOpts);

    // 3. Static page server (serves the esbuild-built bundle).
    const pageServer = await startStaticPageServer();
    const pageUrl = `${pageServer.url}/index.html`;

    const wsEndpointUrl = bridge.url;
    const opcScheme = options.tls ? "opc.wss" : "opc.ws";
    const opcWsEndpointUrl = `${opcScheme}://${bridge.url.replace(/^wss?:\/\//, "")}`;

    let stopped = false;
    const stopAll = async () => {
        if (stopped) return;
        stopped = true;
        await pageServer.close();
        await bridge.stop();
        await server.stop();
    };

    return { pageUrl, wsEndpointUrl, opcWsEndpointUrl, server, bridge, pageServer, stopAll };
}

/** Read a PEM file out of the test/fixtures/certs/ directory. */
export function readCertPem(name: string): string {
    return readFileSync(resolve(certsDir, name), "utf8");
}
