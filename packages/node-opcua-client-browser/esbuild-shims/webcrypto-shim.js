/**
 * webcrypto-shim.js
 *
 * Replace `@peculiar/webcrypto` with the native browser `crypto.subtle`.
 *
 * PROVENANCE — vendored VERBATIM from upstream:
 *   https://github.com/node-opcua/node-opcua-crypto
 *   packages/node-opcua-crypto-web/webcrypto-shim.js  @ master
 */

const crypto = globalThis.crypto;
const Crypto = globalThis.Crypto;
export { crypto, Crypto };
export default globalThis.crypto;
