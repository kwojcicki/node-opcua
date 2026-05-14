/**
 * esbuild-config.mjs
 *
 * Shared esbuild configuration for the browser builds. Exports the aliases,
 * defines, injects, banners, and conditions that any consumer of this package
 * needs to bundle cleanly. Used by:
 *
 *   - `build-test-page.mjs`     — bundles the Playwright test page
 *   - `build-browser-bundle.mjs` — bundles the package's public entry for
 *                                  consumption by external apps
 *
 * Keeping one source of truth avoids drift between "how we bundle for
 * tests" and "how consumers bundle". If you add a new transitive `node:*`
 * import somewhere in the graph and it breaks one builder, fix it here and
 * both get the fix.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shimsDir = resolve(__dirname, "esbuild-shims");

/**
 * Alias table — maps each import specifier that isn't browser-safe to a
 * local shim / browserify polyfill. The values are absolute filesystem
 * paths so esbuild can resolve them regardless of the consumer's cwd.
 */
export const aliases = {
    // --- node:crypto → our shim with createPublicKey / createPrivateKey
    crypto: resolve(shimsDir, "node-crypto-shim.js"),
    "node:crypto": resolve(shimsDir, "node-crypto-shim.js"),

    // --- peculiar/webcrypto → native window.crypto (bundle-size win)
    "@peculiar/webcrypto": resolve(shimsDir, "webcrypto-shim.js"),

    // --- other Node built-ins → their browserify equivalents
    assert: "assert",
    "node:assert": "assert",
    buffer: "buffer",
    "node:buffer": "buffer",
    stream: "stream-browserify",
    "node:stream": "stream-browserify",
    util: "util",
    "node:util": "util",
    constants: "constants-browserify",
    "node:constants": "constants-browserify",
    events: "events",
    "node:events": "events",
    vm: "vm-browserify",
    "node:vm": "vm-browserify",
    string_decoder: "string_decoder",
    "node:string_decoder": "string_decoder",
    "safe-buffer": "buffer",

    // --- Node built-ins that are dead code in the browser path (never
    //     executed at runtime; behind cert-manager disk paths / Node-only
    //     helpers). The empty-shim throws with a clear message if any of
    //     these is ever reached, so accidental regressions surface loudly.
    net: resolve(shimsDir, "node-empty-shim.js"),
    "node:net": resolve(shimsDir, "node-empty-shim.js"),
    os: resolve(shimsDir, "node-empty-shim.js"),
    "node:os": resolve(shimsDir, "node-empty-shim.js"),
    tls: resolve(shimsDir, "node-empty-shim.js"),
    "node:tls": resolve(shimsDir, "node-empty-shim.js"),
    fs: resolve(shimsDir, "node-empty-shim.js"),
    "node:fs": resolve(shimsDir, "node-empty-shim.js"),
    "node:fs/promises": resolve(shimsDir, "node-empty-shim.js"),
    "fs/promises": resolve(shimsDir, "node-empty-shim.js"),
    path: resolve(shimsDir, "node-empty-shim.js"),
    "node:path": resolve(shimsDir, "node-empty-shim.js"),
    url: resolve(shimsDir, "node-empty-shim.js"),
    "node:url": resolve(shimsDir, "node-empty-shim.js"),
    dgram: resolve(shimsDir, "node-empty-shim.js"),
    "node:dgram": resolve(shimsDir, "node-empty-shim.js"),
    http: resolve(shimsDir, "node-empty-shim.js"),
    "node:http": resolve(shimsDir, "node-empty-shim.js"),
    https: resolve(shimsDir, "node-empty-shim.js"),
    "node:https": resolve(shimsDir, "node-empty-shim.js"),
    child_process: resolve(shimsDir, "node-empty-shim.js"),
    "node:child_process": resolve(shimsDir, "node-empty-shim.js"),
    worker_threads: resolve(shimsDir, "node-empty-shim.js"),
    "node:worker_threads": resolve(shimsDir, "node-empty-shim.js"),
    zlib: resolve(shimsDir, "node-empty-shim.js"),
    "node:zlib": resolve(shimsDir, "node-empty-shim.js"),
    timers: resolve(shimsDir, "node-empty-shim.js"),
    "node:timers": resolve(shimsDir, "node-empty-shim.js"),
    "timers/promises": resolve(shimsDir, "node-empty-shim.js"),
    "proper-lockfile": resolve(shimsDir, "node-empty-shim.js"),
    "@ster5/global-mutex": resolve(shimsDir, "node-empty-shim.js"),
    chokidar: resolve(shimsDir, "node-empty-shim.js"),
    "node-opcua-hostname": resolve(shimsDir, "node-empty-shim.js"),
    "node-opcua-pki": resolve(shimsDir, "node-opcua-pki-shim.js"),
    "env-paths": resolve(shimsDir, "env-paths-shim.js"),
    dns: resolve(shimsDir, "node-empty-shim.js"),
    "node:dns": resolve(shimsDir, "node-empty-shim.js")
};

/**
 * `define` entries for esbuild. `__filename` / `__dirname` are referenced
 * at module load by some transitively-imported packages; we supply stable
 * placeholders. `process.env.*` values are pre-substituted so tree-shaking
 * can drop the Node-only branches that check them.
 */
export const define = {
    __filename: JSON.stringify("file:///browser.js"),
    __dirname: JSON.stringify("file:///"),
    global: "globalThis",
    "process.env.IGNORE_SUBTLE_FROM_CRYPTO": "undefined",
    "process.env.NODE_DEBUG": "undefined",
    "process.env.NODE_ENV": JSON.stringify("production")
};

/**
 * Files prepended to every module as esbuild parses it. `inject-buffer.js`
 * puts `Buffer` and `process` (with a `process.hrtime` polyfill) into scope
 * so downstream code that references them works without a runtime fallback.
 */
export const inject = [resolve(shimsDir, "inject-buffer.js")];

/**
 * Banner prepended to the emitted bundle. Polyfills `setImmediate` at the
 * top of the output so calls that happen before our `inject-buffer.js` has
 * run still succeed.
 */
export const banner = {
    js: "globalThis.setImmediate = globalThis.setImmediate || ((cb, ...args) => Promise.resolve().then(() => cb(...args)));"
};

/**
 * esbuild `conditions` for export-map resolution. `browser` first, then
 * the ESM-preferred chain. Keeps every dep that has a separate browser
 * entry (e.g. `node-opcua-crypto/web`) on its browser code path.
 */
export const conditions = ["browser", "import", "module", "default"];

/**
 * `mainFields` order for resolution. `module` first for ESM, `browser`
 * for explicit browser builds, `main` as a final fallback.
 */
export const mainFields = ["module", "browser", "main"];

/**
 * Convenience: a partial esbuild `BuildOptions` object with all the
 * browser-safety settings bundled together. Callers spread this and then
 * add their own `entryPoints`, `outfile`, etc.
 */
export const browserBuildDefaults = {
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    alias: aliases,
    define,
    inject,
    banner,
    conditions,
    mainFields
};
