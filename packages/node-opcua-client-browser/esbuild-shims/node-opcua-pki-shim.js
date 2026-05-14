/**
 * node-opcua-pki-shim.js
 *
 * Minimal shim for `node-opcua-pki` that provides just enough surface for
 * `node-opcua-certificate-manager`'s module-top `class X extends
 * CertificateManager` declaration to succeed. At runtime in the browser,
 * `InMemoryCertificateKeyPairProvider` + `InMemoryCertificateStore` (from
 * `node-opcua-common`) are used instead, so the `OPCUACertificateManager`
 * class (the one that extends this) is never instantiated.
 */

/** Stub base class. Never instantiated in the browser runtime. */
export class CertificateManager {
    constructor(_opts) {
        throw new Error(
            "[node-opcua-client-browser] OPCUACertificateManager is not supported in the browser. " +
                "Use InMemoryCertificateStore + InMemoryCertificateKeyPairProvider from node-opcua-common instead."
        );
    }
}

export const defaultSubject = "/O=Sterfive/L=Orleans/C=FR";
