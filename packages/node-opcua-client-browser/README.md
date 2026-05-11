# node-opcua-client-browser

OPC UA client SDK for modern browsers, using the **WebSocket transport mapping**
defined in OPC UA Part 6, §7.5.

> **Status — work in progress.**
> This package is under active development as part of the
> `add-browser-client-wsopcua` OpenSpec change. The public API is assembled
> incrementally; consult `openspec/changes/add-browser-client-wsopcua/` for the
> canonical scope, roadmap, and security-policy coverage.

## Scope

- Endpoint URL schemes: `opc.ws://`, `opc.wss://`, `ws://`, `wss://`
- Security policies: `None`, `Basic256Sha256` (SignAndEncrypt)
- User identity tokens: Anonymous, UserName/Password (password encrypted under
  `Basic256Sha256` when applicable)
- Services: Read / Write / CreateSubscription / CreateMonitoredItems / Publish

## What is **not** in v1

- Policies other than `None` and `Basic256Sha256` (follow-up)
- `x509IdentityToken` (client-side certificate user identity) — follow-up
- A browser-side OPC UA server
- IE / legacy browsers

## Private keys in the browser

Shipping an application private key to a browser is acceptable **only for
development and internal tooling**. In production, source the PEM from a
controlled backend (authenticated download) or use a WebCrypto `CryptoKey`
minted by the browser itself; never commit private keys to a public bundle.

When a PEM string is supplied, the client imports it into WebCrypto with
`extractable: false` so page JS cannot retrieve the raw key material after
initial import.

## Using this package in another project

Two consumption modes, depending on how much your consumer's bundler can do:

### Mode A — self-contained pre-built bundle (simplest)

If your app's bundler doesn't (or can't) apply the ~40 aliases this package
needs for Node built-ins, consume the prebuilt self-contained bundle. It
inlines every dep and every shim into a single ESM file. Your bundler sees
one file; no further configuration needed.

```bash
# Inside this monorepo
cd packages/node-opcua-client-browser
pnpm build:browser-bundle           # unminified (~5.6 MB)
pnpm build:browser-bundle:min       # minified   (~2.7 MB)
```

Then in your consumer app:

```js
import { createBrowserClient, AttributeIds } from "node-opcua-client-browser/browser-bundle";

const client = createBrowserClient({
    endpointUrl: "opc.ws://your-host:4840",
    applicationName: "MyBrowserApp",
    applicationUri: "urn:MyBrowserApp:Client"
});
await client.connect("opc.ws://your-host:4840");
const session = await client.createSession();
const dv = await session.read({ nodeId: "ns=1;s=Temperature", attributeId: AttributeIds.Value });
```

To iterate locally, `pnpm link` (or `npm link`) this package into your
consumer app after running `pnpm build:browser-bundle`. Re-run the build
whenever you change source and the consumer picks it up on next load.

### Mode B — source import (tree-shakeable, bundler-intensive)

If you want tree-shaking and finer-grained control, import the source entry
(`node-opcua-client-browser` without `/browser-bundle`). Your bundler then
needs to apply the same aliases and shims we use internally — see
`esbuild-config.mjs` and `esbuild-shims/` for the full table. `build-test-page.mjs`
is a minimal worked example.

This mode is appropriate for consumers using esbuild directly, or for bundlers
where you're comfortable copying the alias table verbatim.

## Running the Playwright tests

```bash
pnpm test:e2e             # headless
pnpm exec playwright test --headed    # watch a browser
```

Two specs cover Read / Write / Subscribe end-to-end:

- `client.ws.spec.ts`  — `opc.ws://` + `SecurityPolicy.None` + anonymous
- `client.wss.spec.ts` — `opc.wss://` + `Basic256Sha256` + `SignAndEncrypt` + anonymous

## License

MIT — see [LICENSE](./LICENSE).
