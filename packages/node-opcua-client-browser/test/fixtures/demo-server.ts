/**
 * E2E test fixture: a minimal `node-opcua-server` with:
 *   - `ns=1;s=Counter`  — auto-incrementing Double (updated every 250 ms)
 *   - `ns=1;s=Setpoint` — writable Double
 *   - UserManager accepting the single credential `alice` / `opcua42`
 *
 * Returned struct lets the harness stop the server cleanly.
 */

import { OPCUAServer, Variant, DataType, StatusCodes, MessageSecurityMode, SecurityPolicy } from "node-opcua";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DemoServerOptions {
    port?: number;
    host?: string;
    /** Additional security policies to enable beyond None. */
    securityPolicies?: SecurityPolicy[];
    /** Additional security modes beyond None. */
    securityModes?: MessageSecurityMode[];
    /**
     * PEM paths for the server's own application certificate + key. Required
     * when enabling any non-None security policy. When omitted, the server
     * auto-generates one under its default cert store.
     */
    serverCertificate?: { certPath: string; keyPath: string };
}

export interface DemoServer {
    port: number;
    endpointUrl: string;
    counter: () => number;
    /** DER-encoded server application certificate. Present once security is active. */
    getServerCertificate: () => Buffer;
    /** Stop the server and cleanup. */
    stop: () => Promise<void>;
}

export async function startDemoServer(options: DemoServerOptions = {}): Promise<DemoServer> {
    const port = options.port ?? 0;
    const host = options.host ?? "127.0.0.1";

    const serverOpts: ConstructorParameters<typeof OPCUAServer>[0] = {
        port,
        resourcePath: "/UA/BrowserClientTest",
        // Advertise 127.0.0.1 as an alternate hostname so the endpoint URL
        // the client sends in CreateSessionRequest.endpointUrl (built from
        // the bridge's 127.0.0.1 URL) matches one of the server-advertised
        // endpoints. Without this, the server emits "Cannot find suitable
        // endpoints" and rejects anonymous tokens with BadIdentityTokenInvalid.
        alternateHostname: ["127.0.0.1"],
        buildInfo: { productName: "node-opcua-client-browser-test", buildNumber: "1", buildDate: new Date() },
        userManager: {
            isValidUser: (userName: string, password: string) => userName === "alice" && password === "opcua42"
        },
        securityPolicies: [SecurityPolicy.None, ...(options.securityPolicies ?? [])],
        securityModes: [MessageSecurityMode.None, ...(options.securityModes ?? [])],
        // Accept self-signed / unknown certs so the test harness doesn't need to pre-trust
        // the auto-generated client cert. This is a **test** server.
        allowAnonymous: true
    };

    if (options.serverCertificate) {
        (serverOpts as Record<string, unknown>).certificateFile = options.serverCertificate.certPath;
        (serverOpts as Record<string, unknown>).privateKeyFile = options.serverCertificate.keyPath;
    }

    const server = new OPCUAServer(serverOpts);
    await server.initialize();

    // Populate the address space with the two variables the E2E tests need.
    const addressSpace = server.engine.addressSpace!;
    const namespace = addressSpace.getOwnNamespace();

    let counterValue = 0;
    const setpoint = { v: 0 };

    namespace.addVariable({
        browseName: "Counter",
        nodeId: "s=Counter",
        organizedBy: addressSpace.rootFolder.objects,
        dataType: "Double",
        minimumSamplingInterval: 100,
        value: {
            get: () => new Variant({ dataType: DataType.Double, value: counterValue })
        }
    });

    namespace.addVariable({
        browseName: "Setpoint",
        nodeId: "s=Setpoint",
        organizedBy: addressSpace.rootFolder.objects,
        dataType: "Double",
        minimumSamplingInterval: 100,
        value: {
            get: () => new Variant({ dataType: DataType.Double, value: setpoint.v }),
            set: (variant: Variant) => {
                setpoint.v = Number(variant.value);
                return StatusCodes.Good;
            }
        }
    });

    // Counter ticker
    const ticker = setInterval(() => {
        counterValue++;
    }, 250);

    await server.start();
    // Accept trust-any client cert (tests only)
    // The certificate manager lazily creates the trust folder; any cert presented by a
    // new client is accepted if the server is in trust-any mode. node-opcua's default
    // behaviour for a freshly-initialised cert manager is to reject unknown clients
    // unless `automaticallyAcceptUnknownCertificate` is set.
    try {
        (server.userCertificateManager as unknown as { automaticallyAcceptUnknownCertificate: boolean })
            .automaticallyAcceptUnknownCertificate = true;
    } catch { /* ignore */ }
    try {
        (server.serverCertificateManager as unknown as { automaticallyAcceptUnknownCertificate: boolean })
            .automaticallyAcceptUnknownCertificate = true;
    } catch { /* ignore */ }

    const boundPort = (server.endpoints?.[0] as unknown as { port: number })?.port ?? port;
    const endpointUrl = `opc.tcp://${host}:${boundPort}${serverOpts.resourcePath}`;

    return {
        port: boundPort,
        endpointUrl,
        counter: () => counterValue,
        getServerCertificate: () => server.getCertificate(),
        async stop() {
            clearInterval(ticker);
            await server.shutdown();
        }
    };
}
