import "mocha";
import should from "should";
import { OPCUASecureObject, type ICertificateKeyPairProvider } from "../source/opcua_secure_object";

describe("OPCUASecureObject + injected ICertificateKeyPairProvider", () => {
    const cert = Buffer.from("FAKE-CERT");
    const pk = { hidden: "FAKE-KEY" } as unknown as import("node-opcua-crypto/web").PrivateKey;
    const provider: ICertificateKeyPairProvider = {
        getCertificate: () => cert,
        getCertificateChain: () => [cert],
        getPrivateKey: () => pk
    };

    it("constructs without certificateFile/privateKeyFile strings when a provider is supplied", () => {
        const obj = new OPCUASecureObject({ certificateKeyPairProvider: provider });
        obj.certificateFile.should.equal("<in-memory>");
        obj.privateKeyFile.should.equal("<in-memory>");
    });

    it("delegates getCertificate() / getCertificateChain() / getPrivateKey() to the provider without touching fs", () => {
        const obj = new OPCUASecureObject({ certificateKeyPairProvider: provider });
        obj.getCertificate().should.equal(cert);
        obj.getCertificateChain()[0].should.equal(cert);
        obj.getPrivateKey().should.equal(pk);
    });

    it("without a provider, the original string-path assertions still reject empty options", () => {
        (() => new OPCUASecureObject({})).should.throw();
    });

    it("without a provider, a constructed object still has the file paths", () => {
        const obj = new OPCUASecureObject({
            certificateFile: "/fake/cert.pem",
            privateKeyFile: "/fake/key.pem"
        });
        obj.certificateFile.should.equal("/fake/cert.pem");
        obj.privateKeyFile.should.equal("/fake/key.pem");
    });
});
