/**
 * Build the smoke-test page for the Playwright harness.
 *
 * Produces `test/page/dist/{index.html, main.js}` from `test/page/main.ts`,
 * spreading the shared `browserBuildDefaults` from `./esbuild-config.mjs`
 * so the bundler picks up the alias table and shims that route every
 * Node-only import (`node:net`, `node:fs`, `node:os`, `node:events`, ...)
 * to a browser-safe stub or browserify polyfill. The shared config is the
 * same one `build-browser-bundle.mjs` will consume in a follow-up PR.
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
