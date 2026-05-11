import { test, expect } from "@playwright/test";

import { startHarness, type HarnessContext } from "./harness";

/**
 * E2E spec (1 of 2): plain `opc.ws://` with `SecurityPolicy=None` / anonymous.
 *
 * Validates that from a browser page loaded under Playwright, we can:
 *   - connect through the WebSocket transport
 *   - Read the `Counter` variable
 *   - Write `Setpoint = 42` and re-Read to confirm persistence
 *   - Subscribe and receive at least one DataValue change
 */
test.describe("browser client — ws:// + SecurityPolicy=None", () => {
    let ctx: HarnessContext;

    test.beforeAll(async () => {
        ctx = await startHarness({ tls: false });
    });

    test.afterAll(async () => {
        await ctx?.stopAll();
    });

    test("Read / Write / Subscribe", async ({ page }) => {
        test.setTimeout(120_000);
        const consoleMessages: string[] = [];
        page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
        page.on("pageerror", (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`));

        await page.goto(ctx.pageUrl, { waitUntil: "load" });
        try {
            await expect(page.locator("#status")).toHaveText("loaded");
        } catch (err) {
            throw new Error(`Page didn't reach "loaded". Console:\n${consoleMessages.join("\n")}`);
        }

        // Connect — kick off the promise and poll for progress / errors
        const connectPromise = page.evaluate(async (endpointUrl) => {
            try {
                await window.opcua.connect({ endpointUrl, securityPolicy: "None", securityMode: "None" });
                return { ok: true as const };
            } catch (err) {
                return { ok: false as const, error: (err as Error).message, stack: (err as Error).stack };
            }
        }, ctx.opcWsEndpointUrl);

        // While the connect is in flight, sample the bridge to confirm the WS
        // actually reached the Node side. If not, we know the failure is on
        // the browser side of the network (e.g. the `new WebSocket(...)` call).
        await new Promise((r) => setTimeout(r, 2000));
        const tunnelCountAt2s = ctx.bridge.activeTunnels();

        const connectResult = await Promise.race([
            connectPromise,
            new Promise<{ ok: false; error: string; stack?: string }>((resolve) =>
                setTimeout(
                    () => resolve({ ok: false, error: `connect() hung for 30s; bridge tunnels=${tunnelCountAt2s}; console:\n${consoleMessages.join("\n")}` }),
                    30_000
                )
            )
        ]);

        if (!connectResult.ok) {
            const lastErr = await page.evaluate(() => window.opcua.lastError).catch(() => "<page closed>");
            throw new Error(
                `connect() failed: ${connectResult.error}\nlastError: ${lastErr}\nbridge-tunnels-at-2s: ${tunnelCountAt2s}\nConsole:\n${consoleMessages.join("\n")}`
            );
        }

        // Read Counter
        const firstRead = await page.evaluate(() => window.opcua.read("ns=1;s=Counter"));
        expect(firstRead.statusCode).toMatch(/Good/);
        expect(typeof firstRead.value).toBe("number");

        // Write Setpoint = 42
        const writeStatus = await page.evaluate(() => window.opcua.write("ns=1;s=Setpoint", 42));
        expect(writeStatus).toMatch(/Good/);

        // Re-Read Setpoint; should observe 42
        const reRead = await page.evaluate(() => window.opcua.read("ns=1;s=Setpoint"));
        expect(reRead.statusCode).toMatch(/Good/);
        expect(reRead.value).toBe(42);

        // Subscribe: register a monitored item on Counter and wait for at least one change
        await page.evaluate(() => window.opcua.startSubscription());
        let observed: number;
        try {
            observed = await page.evaluate(() => window.opcua.waitForChange(20000));
        } catch (err) {
            throw new Error(
                `waitForChange failed: ${(err as Error).message}\nConsole trail:\n${consoleMessages.join("\n")}`
            );
        }
        expect(typeof observed).toBe("number");

        // Disconnect
        await page.evaluate(() => window.opcua.disconnect());

        // Fail the test if the page surfaced any unhandled error
        const lastError = await page.evaluate(() => window.opcua.lastError);
        expect(lastError, `Page error:\n${lastError}\nConsole trail:\n${consoleMessages.join("\n")}`).toBeFalsy();
    });
});

/**
 * Always-on harness smoke test: the harness comes up cleanly and serves the page.
 * Kept alongside the E2E spec so harness regressions surface independently of any
 * browser-runtime regression.
 */
test.describe("browser client harness smoke test (ws://)", () => {
    let ctx: HarnessContext;

    test.beforeAll(async () => {
        ctx = await startHarness({ tls: false });
    });

    test.afterAll(async () => {
        await ctx?.stopAll();
    });

    test("harness starts, serves the page, and surfaces the opcua namespace", async ({ page }) => {
        await page.goto(ctx.pageUrl, { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toHaveText("node-opcua-client-browser E2E");
        expect(ctx.opcWsEndpointUrl).toMatch(/^opc\.ws:\/\//);
        expect(ctx.wsEndpointUrl).toMatch(/^ws:\/\//);
    });
});

