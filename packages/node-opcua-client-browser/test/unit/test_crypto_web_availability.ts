/**
 * Smoke test: confirm that the primitives Basic256Sha256 needs are reachable
 * through `node-opcua-crypto/web` and produce sane output.
 *
 * We don't test every algorithm exhaustively here — the secure-channel layer
 * (which the browser package reuses verbatim via the §1/§2 factory seam)
 * already exercises them against real OPC UA servers. This suite is a gate: if
 * `node-opcua-crypto/web` ever ships a release where one of these primitives
 * disappears or throws at import time, the unit test fails and we know before
 * the E2E layer.
 */

import should from "should";
import * as cryptoWeb from "node-opcua-crypto/web";

describe("node-opcua-crypto/web – Basic256Sha256 primitive availability", () => {
    it("exports the RSA asymmetric primitives", () => {
        cryptoWeb.publicEncrypt.should.be.a.Function();
        cryptoWeb.privateDecrypt.should.be.a.Function();
        cryptoWeb.RSA_PKCS1_OAEP_PADDING.should.be.a.Number();
        cryptoWeb.RSA_PKCS1_PADDING.should.be.a.Number();
    });

    it("exports the symmetric sign/encrypt primitives used on the wire", () => {
        cryptoWeb.makeMessageChunkSignature.should.be.a.Function();
        cryptoWeb.verifyMessageChunkSignature.should.be.a.Function();
        cryptoWeb.encryptBufferWithDerivedKeys.should.be.a.Function();
        cryptoWeb.decryptBufferWithDerivedKeys.should.be.a.Function();
        cryptoWeb.verifyChunkSignatureWithDerivedKeys.should.be.a.Function();
        cryptoWeb.makeMessageChunkSignatureWithDerivedKeys.should.be.a.Function();
    });

    it("exports computeDerivedKeys (needed for symmetric key rollout)", () => {
        cryptoWeb.computeDerivedKeys.should.be.a.Function();
    });

    it("exports certificate-handling helpers needed for OPN", () => {
        cryptoWeb.extractPublicKeyFromCertificate.should.be.a.Function();
        cryptoWeb.coerceCertificate.should.be.a.Function();
        cryptoWeb.makeSHA1Thumbprint.should.be.a.Function();
    });

    it("exports PRNG used for nonces (P_SHA256)", () => {
        cryptoWeb.makePseudoRandomBuffer.should.be.a.Function();
        const secret = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
        const seed = Buffer.from("fedcba9876543210fedcba9876543210", "utf8");
        const n = cryptoWeb.makePseudoRandomBuffer(secret, seed, 32, "SHA256");
        n.length.should.be.greaterThanOrEqual(32);
        // deterministic (same inputs -> same output)
        const n2 = cryptoWeb.makePseudoRandomBuffer(secret, seed, 32, "SHA256");
        n.equals(n2).should.be.true();
    });

    it("computes a consistent SHA-1 thumbprint", () => {
        // A zero-length buffer always has a well-known SHA-1: da39a3ee5e6b4b0d3255bfef95601890afd80709
        const tp = cryptoWeb.makeSHA1Thumbprint(Buffer.alloc(0));
        tp.toString("hex").should.equal("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });
});
