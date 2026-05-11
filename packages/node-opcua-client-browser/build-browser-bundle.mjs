/**
 * Build a self-contained browser bundle of `node-opcua-client-browser`.
 *
 * Emits `dist-browser-bundle/index.js` — a single ESM file with every
 * transitive dependency inlined and every Node-only code path either
 * tree-shaken away or replaced by its browser-safe shim. Consumers can
 * `import` from this file directly without needing any aliases or
 * polyfills in their own bundler config.
 *
 * Mirrors the bundling approach upstream's `node-opcua-crypto` takes for
 * its `./bundled-web` export:
 *   https://github.com/node-opcua/node-opcua-crypto/blob/master/packages/node-opcua-crypto-web/build-web.mjs
 *
 * Use this when you want to `pnpm link` / `npm link` this package into an
 * external app whose own bundler (Vite, webpack, Rollup, Parcel, …) doesn't
 * have — and shouldn't need to have — the ~40 aliases and shim files we
 * use internally. The external app imports one pre-bundled ESM module.
 *
 * ⚠️ The entry point for this bundle is `dist-esm/index.js`, so you must
 * run `pnpm build` (which emits both `dist/` CJS and `dist-esm/` ESM)
 * before invoking this script. `pnpm build:browser-bundle` does both.
 */

import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, statSync, writeFileSync } from "node:fs";

import { browserBuildDefaults } from "./esbuild-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "dist-esm", "index.js");
const outDir = resolve(__dirname, "dist-browser-bundle");

export async function buildBrowserBundle(opts = {}) {
    // Confirm the ESM build exists; fail with a clear hint rather than a
    // cryptic esbuild "could not resolve" error.
    try {
        statSync(entry);
    } catch {
        throw new Error(
            `Entry not found: ${entry}\n` +
                "Run `pnpm build` first (or use `pnpm build:browser-bundle` which does both)."
        );
    }

    mkdirSync(outDir, { recursive: true });

    const result = await esbuild.build({
        ...browserBuildDefaults,
        entryPoints: [entry],
        outfile: resolve(outDir, "index.js"),
        minify: opts.minify ?? false,
        sourcemap: opts.sourcemap ?? true,
        logLevel: opts.logLevel ?? "warning",
        metafile: true,
        // Keep the bundle as a true ESM module, not an IIFE / UMD shim.
        // Consumers either `<script type="module" src=".../index.js">` or
        // `import` it from their own bundler.
        format: "esm"
    });

    // Emit a tiny `package.json` in the bundle dir so tools that resolve
    // via `exports` pick up the right module shape.
    writeFileSync(
        resolve(outDir, "package.json"),
        JSON.stringify(
            {
                name: "node-opcua-client-browser/browser-bundle",
                type: "module",
                main: "./index.js",
                module: "./index.js",
                browser: "./index.js",
                sideEffects: false,
                // Provenance: tie the emitted bundle to the commit that produced it.
                "//": "Emitted by packages/node-opcua-client-browser/build-browser-bundle.mjs"
            },
            null,
            2
        ) + "\n"
    );

    // Emit the esbuild metafile so downstream size-tracking / tree-shaking
    // diagnostics can parse it if the reader wants to know what went in.
    if (result.metafile) {
        writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(result.metafile));
    }

    return outDir;
}

// CLI entry: `node build-browser-bundle.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const minify = process.argv.includes("--minify");
    await buildBrowserBundle({ logLevel: "info", minify });
    console.log(`Built self-contained browser bundle at ${outDir}${minify ? " (minified)" : ""}`);
}
