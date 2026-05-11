import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

import { startHarness, type HarnessContext } from "./harness";

/**
 * E2E spec (anonymous identity): TLS `opc.wss://` with `SecurityPolicy=Basic256Sha256`
 * / `SignAndEncrypt` and Anonymous identity.
 *
 * Validates:
 *   - TLS termination at the bridge (the browser negotiates `wss://` with a
 *     self-signed cert; Playwright is launched with `ignoreHTTPSErrors: true`).
 *   - OPC UA message-level security: `Basic256Sha256` / `SignAndEncrypt`
 *     handshake through `ClientSecureChannelLayer`.
 *   - Same Read / Write / Subscribe flow as the ws:// spec.
 *
 * A companion spec below (`"wss:// + Basic256Sha256 + username identity"`)
 * covers the per-user-token password-encryption path with a real username /
 * password pair.
 *
 * Uses the vendored `node-crypto-shim.js` (see `esbuild-shims/`) wired in via
 * `build-test-page.mjs` — same approach as upstream's
 * `node-opcua-crypto-web/build-web.mjs`.
 */
test.describe("browser client — wss:// + Basic256Sha256 (anonymous identity)", () => {
    let ctx: HarnessContext;

    const certsDir = resolve(__dirname, "..", "fixtures", "certs");
    const clientCertPem = readFileSync(resolve(certsDir, "app.cert.pem"), "utf8");
    const clientKeyPem = readFileSync(resolve(certsDir, "app.key.pem"), "utf8");

    test.beforeAll(async () => {
        ctx = await startHarness({ tls: true });
    });

    test.afterAll(async () => {
        await ctx?.stopAll();
    });

    test("Read / Write / Subscribe over wss:// with Basic256Sha256", async ({ page, context }) => {
        test.setTimeout(180_000);
        const consoleMessages: string[] = [];
        page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
        page.on("pageerror", (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`));
        page.on("crash", () => consoleMessages.push(`[crash] page crashed`));

        await page.goto(ctx.pageUrl, { waitUntil: "load" });
        try {
            await expect(page.locator("#status")).toHaveText("loaded");
        } catch (err) {
            throw new Error(`Page didn't reach "loaded". Console:\n${consoleMessages.join("\n")}`);
        }

        expect(ctx.opcWsEndpointUrl).toMatch(/^opc\.wss:\/\//);

        // Server certificate needs to be passed to the browser for Basic256Sha256
        // message security. Serialize as hex for cleanly crossing the Playwright boundary.
        const serverCertHex = ctx.server.getServerCertificate().toString("hex");

        let connectResult: { ok: true } | { ok: false; error: string; stack?: string };
        try {
            connectResult = await page.evaluate(
                async (args) => {
                    try {
                        await window.opcua.connect({
                            endpointUrl: args.endpointUrl,
                            sessionEndpointUrl: args.sessionEndpointUrl,
                            securityPolicy: "Basic256Sha256",
                            securityMode: "SignAndEncrypt",
                            serverCertificateHex: args.serverCertHex,
                            clientCertificatePem: args.clientCertPem,
                            clientPrivateKeyPem: args.clientKeyPem
                            // Anonymous identity — this spec validates the TLS
                            // layer + Basic256Sha256 message security; per-user-
                            // token password encryption is a follow-up.
                        });
                        return { ok: true as const };
                    } catch (err) {
                        return { ok: false as const, error: (err as Error).message, stack: (err as Error).stack };
                    }
                },
                {
                    endpointUrl: ctx.opcWsEndpointUrl,
                    // `CreateSessionRequest.endpointUrl` must match a
                    // server-advertised endpoint. The bridge's `opc.wss://` URL
                    // doesn't, so we send the backend `opc.tcp://` URL here.
                    sessionEndpointUrl: ctx.server.endpointUrl,
                    serverCertHex,
                    clientCertPem: clientCertPem,
                    clientKeyPem: clientKeyPem
                }
            );
        } catch (evalErr) {
            throw new Error(
                `page.evaluate for connect() threw (page likely crashed): ${(evalErr as Error).message}\nConsole:\n${consoleMessages.join("\n")}`
            );
        }
        if (!connectResult.ok) {
            throw new Error(`connect() failed: ${connectResult.error}\n${connectResult.stack}\nConsole:\n${consoleMessages.join("\n")}`);
        }

        const firstRead = await page.evaluate(() => window.opcua.read("ns=1;s=Counter"));
        expect(firstRead.statusCode).toMatch(/Good/);
        expect(typeof firstRead.value).toBe("number");

        const writeStatus = await page.evaluate(() => window.opcua.write("ns=1;s=Setpoint", 99));
        expect(writeStatus).toMatch(/Good/);
        const reRead = await page.evaluate(() => window.opcua.read("ns=1;s=Setpoint"));
        expect(reRead.value).toBe(99);

        await page.evaluate(() => window.opcua.startSubscription());
        const observed = await page.evaluate(() => window.opcua.waitForChange(8000));
        expect(typeof observed).toBe("number");

        await page.evaluate(() => window.opcua.disconnect());

        const lastError = await page.evaluate(() => window.opcua.lastError);
        expect(lastError, `Page error:\n${lastError}\nConsole trail:\n${consoleMessages.join("\n")}`).toBeFalsy();
    });
});

/**
 * E2E spec: TLS `opc.wss://` with `SecurityPolicy=Basic256Sha256` /
 * `SignAndEncrypt` and `UserNameIdentityToken`.
 *
 * Differs from the anonymous-identity spec above in that:
 *   - `createSession` receives `{ userName, password }`, not anonymous.
 *   - `node-opcua-client`'s `createUserNameIdentityToken` path encrypts the
 *     password with the server's public key per the policy's asymmetric-
 *     encryption algorithm (`RSA-OAEP-SHA256` for Basic256Sha256). That path
 *     runs entirely in the browser bundle:
 *       1. `extractPublicKeyFromCertificateSync(serverCert)` — uses our
 *          `node-crypto-shim.js`'s `@peculiar/x509`-based `createPublicKey`.
 *       2. `cryptoFactory.asymmetricEncrypt(block, publicKey)` — routes
 *          through `publicEncrypt_long` → `crypto.publicEncrypt`, whose
 *          browser shim unwraps the KeyObject-shaped pubkey before
 *          delegating to `crypto-browserify.publicEncrypt`.
 *
 * This test therefore exercises the full per-user-token encryption round-trip
 * in the browser, on top of the channel-level `Basic256Sha256` / `SignAndEncrypt`
 * security that the anonymous spec already covers.
 *
 * Credentials match the `demo-server` fixture's `userManager` definition:
 * `alice` / `opcua42`.
 */
test.describe("browser client — wss:// + Basic256Sha256 + username identity", () => {
    let ctx: HarnessContext;

    const certsDir = resolve(__dirname, "..", "fixtures", "certs");
    const clientCertPem = readFileSync(resolve(certsDir, "app.cert.pem"), "utf8");
    const clientKeyPem = readFileSync(resolve(certsDir, "app.key.pem"), "utf8");

    test.beforeAll(async () => {
        ctx = await startHarness({ tls: true });
    });

    test.afterAll(async () => {
        await ctx?.stopAll();
    });

    test("Read / Write / Subscribe with username identity", async ({ page }) => {
        test.setTimeout(180_000);
        const consoleMessages: string[] = [];
        page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
        page.on("pageerror", (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`));
        page.on("crash", () => consoleMessages.push(`[crash] page crashed`));

        await page.goto(ctx.pageUrl, { waitUntil: "load" });
        try {
            await expect(page.locator("#status")).toHaveText("loaded");
        } catch (err) {
            throw new Error(`Page didn't reach "loaded". Console:\n${consoleMessages.join("\n")}`);
        }

        expect(ctx.opcWsEndpointUrl).toMatch(/^opc\.wss:\/\//);

        const serverCertHex = ctx.server.getServerCertificate().toString("hex");

        // Step 1 — happy path: valid username + password.
        let connectResult: { ok: true } | { ok: false; error: string; stack?: string };
        try {
            connectResult = await page.evaluate(
                async (args) => {
                    try {
                        await window.opcua.connect({
                            endpointUrl: args.endpointUrl,
                            sessionEndpointUrl: args.sessionEndpointUrl,
                            securityPolicy: "Basic256Sha256",
                            securityMode: "SignAndEncrypt",
                            serverCertificateHex: args.serverCertHex,
                            clientCertificatePem: args.clientCertPem,
                            clientPrivateKeyPem: args.clientKeyPem,
                            user: { userName: "alice", password: "opcua42" }
                        });
                        return { ok: true as const };
                    } catch (err) {
                        return { ok: false as const, error: (err as Error).message, stack: (err as Error).stack };
                    }
                },
                {
                    endpointUrl: ctx.opcWsEndpointUrl,
                    sessionEndpointUrl: ctx.server.endpointUrl,
                    serverCertHex,
                    clientCertPem,
                    clientKeyPem
                }
            );
        } catch (evalErr) {
            throw new Error(
                `page.evaluate for connect() threw (page likely crashed): ${(evalErr as Error).message}\nConsole:\n${consoleMessages.join("\n")}`
            );
        }
        if (!connectResult.ok) {
            throw new Error(`connect() failed: ${connectResult.error}\n${connectResult.stack}\nConsole:\n${consoleMessages.join("\n")}`);
        }

        // If the session activated with a username token, the password was
        // successfully encrypted with the server cert and accepted by the
        // server's `userManager.isValidUser`. Prove the session is usable.
        const firstRead = await page.evaluate(() => window.opcua.read("ns=1;s=Counter"));
        expect(firstRead.statusCode).toMatch(/Good/);
        expect(typeof firstRead.value).toBe("number");

        const writeStatus = await page.evaluate(() => window.opcua.write("ns=1;s=Setpoint", 77));
        expect(writeStatus).toMatch(/Good/);
        const reRead = await page.evaluate(() => window.opcua.read("ns=1;s=Setpoint"));
        expect(reRead.value).toBe(77);

        await page.evaluate(() => window.opcua.startSubscription());
        const observed = await page.evaluate(() => window.opcua.waitForChange(20000));
        expect(typeof observed).toBe("number");

        await page.evaluate(() => window.opcua.disconnect());

        const lastError = await page.evaluate(() => window.opcua.lastError);
        expect(lastError, `Page error:\n${lastError}\nConsole trail:\n${consoleMessages.join("\n")}`).toBeFalsy();
    });

    test("rejects connection when username credentials are wrong", async ({ page }) => {
        // Companion negative-path test — confirms the happy path above isn't
        // accepting every credential pair. A wrong password should cause the
        // server to reject ActivateSession with `BadUserAccessDenied` or
        // `BadIdentityTokenRejected`, which surfaces as a thrown error from
        // `client.createSession()`.
        test.setTimeout(60_000);
        const consoleMessages: string[] = [];
        page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
        page.on("pageerror", (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`));

        await page.goto(ctx.pageUrl, { waitUntil: "load" });
        await expect(page.locator("#status")).toHaveText("loaded");

        const serverCertHex = ctx.server.getServerCertificate().toString("hex");

        const connectResult = await page.evaluate(
            async (args) => {
                try {
                    await window.opcua.connect({
                        endpointUrl: args.endpointUrl,
                        sessionEndpointUrl: args.sessionEndpointUrl,
                        securityPolicy: "Basic256Sha256",
                        securityMode: "SignAndEncrypt",
                        serverCertificateHex: args.serverCertHex,
                        clientCertificatePem: args.clientCertPem,
                        clientPrivateKeyPem: args.clientKeyPem,
                        user: { userName: "alice", password: "wrong-password" }
                    });
                    return { ok: true as const };
                } catch (err) {
                    return { ok: false as const, error: (err as Error).message };
                }
            },
            {
                endpointUrl: ctx.opcWsEndpointUrl,
                sessionEndpointUrl: ctx.server.endpointUrl,
                serverCertHex,
                clientCertPem,
                clientKeyPem
            }
        );

        expect(connectResult.ok, `Expected connect() to reject for bad password; console:\n${consoleMessages.join("\n")}`).toBe(false);
        if (!connectResult.ok) {
            // Either the server sends BadUserAccessDenied / BadIdentityTokenRejected,
            // or the client-side validation surfaces the same as a generic
            // "activation failed" / "bad identity token" error. Accept any of
            // these so a slight protocol-level phrasing change doesn't flake
            // the test.
            expect(connectResult.error).toMatch(/BadUserAccessDenied|BadIdentityTokenRejected|BadSecurityChecksFailed|identity/i);
        }

        // Clean up — even a failed connect leaves the client bound to the
        // page; `disconnect()` is idempotent and clears state.
        await page.evaluate(() => window.opcua.disconnect()).catch(() => {
            /* already torn down */
        });
    });
});

/**
 * Always-on harness smoke test: the wss harness comes up with TLS.
 */
test.describe("browser client harness smoke test (wss://)", () => {
    let ctx: HarnessContext;

    test.beforeAll(async () => {
        ctx = await startHarness({ tls: true });
    });

    test.afterAll(async () => {
        await ctx?.stopAll();
    });

    test("harness starts with TLS termination", async ({ page }) => {
        await page.goto(ctx.pageUrl, { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toHaveText("node-opcua-client-browser E2E");
        expect(ctx.opcWsEndpointUrl).toMatch(/^opc\.wss:\/\//);
        expect(ctx.wsEndpointUrl).toMatch(/^wss:\/\//);
    });
});
