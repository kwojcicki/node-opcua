/**
 * Build the E2E test page with esbuild.
 *
 * Mirrors upstream's `node-opcua-crypto/packages/node-opcua-crypto-web/build-web.mjs`:
 * a one-shot esbuild bundle with explicit aliases for Node built-ins and for
 * `@peculiar/webcrypto`. Running this once produces `test/page/dist/main.js`,
 * which the harness then serves as a static file.
 *
 * Why esbuild instead of Vite's dev-server for this page:
 *   - Zero "Outdated Optimize Dep" 504 loops (no background dep-optimizer).
 *   - Deterministic: same inputs → same output bytes.
 *   - No plugin/version churn (Vite + vite-plugin-node-polyfills + Node 22).
 *   - Matches upstream's own approach to bundling `node-opcua-crypto/web`.
 *
 * See `../openspec/changes/add-browser-client-wsopcua/cross-package-edits.md`.
 */

import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, copyFileSync } from "node:fs";

import { browserBuildDefaults } from "./esbuild-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageDir = resolve(__dirname, "test", "page");
const outDir = resolve(pageDir, "dist");

export async function buildTestPage(opts = {}) {
    mkdirSync(outDir, { recursive: true });

    // index.html references `./main.js`; emit the bundle under that name.
    copyFileSync(resolve(pageDir, "index.html"), resolve(outDir, "index.html"));

    await esbuild.build({
        ...browserBuildDefaults,
        entryPoints: [resolve(pageDir, "main.ts")],
        outfile: resolve(outDir, "main.js"),
        minify: false,
        sourcemap: opts.sourcemap ?? true,
        logLevel: opts.logLevel ?? "warning"
    });

    return outDir;
}

// CLI entry: `node build-test-page.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    await buildTestPage({ logLevel: "info" });
    console.log(`Built test page at ${outDir}`);
}
