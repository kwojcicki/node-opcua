/**
 * Empty-module stub used for Node built-ins that the browser-client
 * transitively references but never executes at runtime (e.g. `node:net`,
 * `node:os`, `node:fs`). Provides zero-cost re-exports so esbuild resolves
 * the import during bundling; any attempt to *use* these symbols at runtime
 * is a programming error that should surface as a clear `TypeError` rather
 * than silently succeed.
 */

const notAvailable = (name) => () => {
    throw new Error(
        `[node-opcua-client-browser] ${name} is not available in the browser. ` +
            "If you see this, a Node-only code path was exercised unexpectedly."
    );
};

// Common surface we've observed being imported (extend as needed).
export const createConnection = notAvailable("createConnection");
export const Server = notAvailable("Server");
export const Socket = notAvailable("Socket");
export const hostname = () => "localhost";
export const networkInterfaces = () => ({});
export const platform = () => "browser";
export const readFileSync = notAvailable("readFileSync");
export const existsSync = () => false;
export const fileURLToPath = (u) => {
    if (typeof u === "string" && u.startsWith("file://")) return u.slice(7);
    return "/";
};
export const pathToFileURL = (p) => new URL("file://" + String(p));

// Minimal `path` surface used by log-prefix helpers
export const join = (...parts) => parts.filter(Boolean).join("/");
export const resolve = (...parts) => "/" + parts.filter(Boolean).join("/");
export const dirname = (p) => {
    const idx = String(p).lastIndexOf("/");
    return idx <= 0 ? "/" : String(p).slice(0, idx);
};
export const basename = (p) => String(p).split("/").pop() || "";
export const extname = (p) => {
    const b = basename(String(p));
    const idx = b.lastIndexOf(".");
    return idx <= 0 ? "" : b.slice(idx);
};
export const sep = "/";
export const posix = { join, resolve, dirname, basename, extname, sep };

// `node-opcua-hostname` minimal surface
export const getHostname = () => "browser.localhost";
export const extractFullyQualifiedDomainName = async () => "browser.localhost";
export const getFullyQualifiedDomainName = () => "browser.localhost";

export default {
    createConnection,
    Server,
    Socket,
    hostname,
    networkInterfaces,
    platform,
    readFileSync,
    existsSync,
    fileURLToPath,
    pathToFileURL,
    join,
    resolve,
    dirname,
    basename,
    extname,
    sep,
    posix
};
