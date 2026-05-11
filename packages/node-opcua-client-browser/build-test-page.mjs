/**
 * Build the smoke-test page for the Playwright harness.
 *
 * Produces `test/page/dist/{index.html, main.js}` from `test/page/main.ts`
 * using a minimal esbuild config. The smoke page only verifies the bundler
 * wiring end-to-end; later PRs will introduce a fuller build configuration
 * (shared with the production browser bundle) in `esbuild-config.mjs`.
 */

import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, copyFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageDir = resolve(__dirname, "test", "page");
const outDir = resolve(pageDir, "dist");

export async function buildTestPage(opts = {}) {
    mkdirSync(outDir, { recursive: true });

    // index.html references `./main.js`; emit the bundle under that name.
    copyFileSync(resolve(pageDir, "index.html"), resolve(outDir, "index.html"));

    await esbuild.build({
        entryPoints: [resolve(pageDir, "main.ts")],
        outfile: resolve(outDir, "main.js"),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
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
