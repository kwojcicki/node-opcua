/**
 * E2E test page entry.
 *
 * Playwright drives this via `page.evaluate()` calling functions hung off
 * `window.opcua`. We expose a minimal imperative surface: connect, read,
 * write, subscribe, browse, call, disconnect. Each returns serialisable
 * data so it can cross the Playwright boundary cleanly.
 *
 * Internally this uses `OPCUAClient` + `ClientSession` (the real Node
 * client, bundled for the browser via esbuild) with the browser WebSocket
 * transport factory and an in-memory certificate manager — see
 * `createBrowserClient`.
 */

import {
    AttributeIds,
    ClientSession,
    ClientSubscription,
    createBrowserClient,
    MessageSecurityMode,
    OPCUAClient,
    SecurityPolicy,
    TimestampsToReturn
} from "../../dist-esm/index.js";

type ConnectOptions = {
    endpointUrl: string;
    /** Backend `opc.tcp://` URL for the CreateSessionRequest, when fronted by a bridge. */
    sessionEndpointUrl?: string;
    securityPolicy?: "None" | "Basic256Sha256";
    securityMode?: "None" | "Sign" | "SignAndEncrypt";
    /** DER-encoded server cert as hex string */
    serverCertificateHex?: string;
    clientCertificatePem?: string;
    clientPrivateKeyPem?: string;
    user?: { userName: string; password: string };
};

declare global {
    interface Window {
        opcua: {
            connect: (opts: ConnectOptions) => Promise<void>;
            read: (nodeId: string) => Promise<{ value: unknown; statusCode: string }>;
            write: (nodeId: string, value: number) => Promise<string>;
            browse: (nodeId: string) => Promise<{ references: { browseName: string; nodeId: string }[]; statusCode: string }>;
            call: (objectId: string, methodId: string, inputArgument?: unknown) => Promise<{ statusCode: string; outputs: unknown[] }>;
            startSubscription: (nodeId?: string) => Promise<{ subscriptionId: number }>;
            waitForChange: (timeoutMs?: number) => Promise<number>;
            disconnect: () => Promise<void>;
            lastError?: string;
        };
    }
}

let client: OPCUAClient | undefined;
let session: ClientSession | undefined;
let subscription: ClientSubscription | undefined;
const changes: number[] = [];
let waitingResolver: ((v: number) => void) | undefined;

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/\s+/g, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function pemToDer(pem: string): Uint8Array {
    const base64 = pem
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, "");
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function coerceSecurityPolicy(s?: "None" | "Basic256Sha256"): SecurityPolicy {
    if (s === "Basic256Sha256") return SecurityPolicy.Basic256Sha256;
    return SecurityPolicy.None;
}
function coerceSecurityMode(s?: "None" | "Sign" | "SignAndEncrypt"): MessageSecurityMode {
    if (s === "Sign") return MessageSecurityMode.Sign;
    if (s === "SignAndEncrypt") return MessageSecurityMode.SignAndEncrypt;
    return MessageSecurityMode.None;
}

async function connect(opts: ConnectOptions): Promise<void> {
    const policy = coerceSecurityPolicy(opts.securityPolicy);
    const mode = coerceSecurityMode(opts.securityMode);
    const serverCert = opts.serverCertificateHex ? Buffer.from(hexToBytes(opts.serverCertificateHex)) : undefined;
    const clientCert = opts.clientCertificatePem ? Buffer.from(pemToDer(opts.clientCertificatePem)) : undefined;

    console.log("[page] connect: start", opts.endpointUrl);

    // Lazy-import `makePrivateKeyFromPem` from `node-opcua-crypto/web` (aliased to
    // our shim at bundle time). Wraps a PEM string into the `{hidden: ...}` shape
    // the secure-channel expects.
    const { makePrivateKeyFromPem } = await import("node-opcua-crypto/web");
    const privateKey = opts.clientPrivateKeyPem
        ? (makePrivateKeyFromPem(opts.clientPrivateKeyPem) as never)
        : undefined;

    console.log("[page] connect: creating in-memory credential + trust stores");
    const { InMemoryCertificateKeyPairProvider, InMemoryCertificateStore } = await import("../../dist-esm/index.js");
    const credentialProvider = new InMemoryCertificateKeyPairProvider(
        clientCert ? [clientCert] : undefined,
        privateKey as never
    );
    const trustStore = new InMemoryCertificateStore({ autoAcceptUnknown: true });
    console.log("[page] connect: stores created");

    console.log("[page] connect: calling OPCUAClient.create");
    const browserModule = await import("../../dist-esm/index.js");
    console.log("[page] connect: browserModule loaded");
    const transportFactory = browserModule.browserWsTransportFactory;
    console.log("[page] connect: got transportFactory", typeof transportFactory);
    try {
        client = OPCUAClient.create({
            applicationName: "node-opcua-client-browser-e2e",
            applicationUri: "urn:NodeOPCUA-Browser-Test:Client",
            productUri: "urn:NodeOPCUA-Browser:Product",
            endpointMustExist: false,
            securityPolicy: policy,
            securityMode: mode,
            serverCertificate: serverCert,
            connectionStrategy: { maxRetry: 3, initialDelay: 200, maxDelay: 2000 },
            certificateKeyPairProvider: credentialProvider,
            clientCertificateManager: trustStore as never,
            transportFactory
        });
        console.log("[page] connect: OPCUAClient created");
    } catch (err) {
        const e = err as Error;
        console.error("[page] connect: OPCUAClient.create threw:", e.name, "|", e.message || "<no message>", "|", e.stack);
        throw err;
    }

    console.log("[page] connect: calling client.connect");
    try {
        await client.connect(opts.endpointUrl);
        console.log("[page] connect: channel opened");
    } catch (err) {
        console.log("[page] connect: channel open failed", (err as Error).message);
        throw err;
    }

    // If a distinct `sessionEndpointUrl` was supplied (for bridge setups where
    // the transport URL `opc.wss://bridge` doesn't match any server-advertised
    // endpoint), override `client.endpointUrl` before `createSession` so the
    // CreateSessionRequest carries the backend URL the server recognizes.
    if (opts.sessionEndpointUrl && opts.sessionEndpointUrl !== opts.endpointUrl) {
        console.log("[page] connect: overriding endpointUrl for CreateSession →", opts.sessionEndpointUrl);
        (client as unknown as { endpointUrl: string }).endpointUrl = opts.sessionEndpointUrl;
    }

    // For identity, pass `userName`/`password` via createSession's userIdentityInfo.
    // The password must be a string (not a function); `node-opcua-client`'s
    // `createUserNameIdentityToken` asserts `typeof password === "string"`.
    const userIdentityInfo = opts.user ? { userName: opts.user.userName, password: opts.user.password } : undefined;
    console.log("[page] connect: creating session, identity =", opts.user ? "username" : "anonymous");
    session = await client.createSession(userIdentityInfo as never);
    console.log("[page] connect: session ready");
}

async function read(nodeId: string) {
    if (!session) throw new Error("not connected");
    const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
    return {
        value: dv.value?.value,
        statusCode: dv.statusCode?.toString() ?? "unknown"
    };
}

async function write(nodeId: string, value: number): Promise<string> {
    if (!session) throw new Error("not connected");
    const { Variant, DataType } = await import("node-opcua-variant");
    const sc = await session.write({
        nodeId,
        attributeId: AttributeIds.Value,
        value: { value: new Variant({ dataType: DataType.Double, value }) } as never
    });
    return sc.toString();
}

async function browse(nodeId: string) {
    if (!session) throw new Error("not connected");
    const result = await session.browse(nodeId);
    return {
        references: (result.references ?? []).map((r) => ({
            browseName: r.browseName?.toString() ?? "",
            nodeId: r.nodeId?.toString() ?? ""
        })),
        statusCode: result.statusCode?.toString() ?? "unknown"
    };
}

async function call(objectId: string, methodId: string, inputArgument?: unknown) {
    if (!session) throw new Error("not connected");
    const { Variant, DataType } = await import("node-opcua-variant");
    const inputArguments = inputArgument !== undefined
        ? [new Variant({ dataType: DataType.String, value: String(inputArgument) })]
        : [];
    const callResult = await session.call({ objectId, methodId, inputArguments } as never);
    return {
        statusCode: callResult.statusCode?.toString() ?? "unknown",
        outputs: (callResult.outputArguments ?? []).map((v: { value: unknown }) => v.value)
    };
}

async function startSubscription(nodeId: string = "ns=1;s=Counter") {
    if (!session) throw new Error("not connected");
    console.log("[page] startSubscription: creating");
    subscription = ClientSubscription.create(session, {
        requestedPublishingInterval: 250,
        requestedLifetimeCount: 600,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 0,
        publishingEnabled: true,
        priority: 128
    });
    console.log("[page] startSubscription: waiting for started");
    await new Promise<void>((resolve, reject) => {
        subscription!.once("started", () => resolve());
        subscription!.once("error", reject);
    });
    console.log("[page] startSubscription: started, subscriptionId =", subscription.subscriptionId);
    const { ClientMonitoredItem } = await import("node-opcua-client");
    const item = ClientMonitoredItem.create(
        subscription,
        { nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: 250, queueSize: 10, discardOldest: true },
        TimestampsToReturn.Both
    );
    item.on("initialized", () => console.log("[page] monitoredItem: initialized"));
    item.on("err", (e) => console.log("[page] monitoredItem: err", e));
    item.on("changed", (dv) => {
        const v = Number(dv.value?.value);
        console.log("[page] monitoredItem: changed", v);
        changes.push(v);
        if (waitingResolver) {
            const r = waitingResolver;
            waitingResolver = undefined;
            r(v);
        }
    });

    // Inspect the publish engine to see whether publish requests are getting sent.
    const pe = (session as unknown as { _publishEngine?: { nbPendingPublishRequests: number; send_publish_request: () => void; _receive_publish_response?: (r: unknown) => void } })._publishEngine;
    const channel = (client as unknown as { _secureChannel?: { getTransport?: () => { bytesRead: number; bytesWritten: number } | undefined } })._secureChannel;

    // Monkey-patch _receive_publish_response to count responses.
    let publishResponsesReceived = 0;
    if (pe && typeof pe._receive_publish_response === "function") {
        const orig = pe._receive_publish_response.bind(pe);
        pe._receive_publish_response = (r: unknown) => {
            publishResponsesReceived++;
            console.log(
                `[page] _receive_publish_response #${publishResponsesReceived} subId=${(r as { subscriptionId: number })?.subscriptionId}` +
                    ` hasData=${!!(r as { notificationMessage?: { notificationData?: unknown[] } })?.notificationMessage?.notificationData?.length}`
            );
            return orig(r);
        };
    }

    if (pe) {
        let tickCount = 0;
        const inspectTick = setInterval(async () => {
            tickCount++;
            const transport = channel?.getTransport?.();
            console.log(
                `[page] tick ${tickCount * 500}ms — nbPendingPublishRequests=${pe.nbPendingPublishRequests}` +
                    ` bytesRead=${transport?.bytesRead ?? "?"} bytesWritten=${transport?.bytesWritten ?? "?"}`
            );
            if (tickCount === 2) {
                try {
                    const dv = await session!.read({ nodeId: "ns=1;s=Counter", attributeId: AttributeIds.Value });
                    console.log(`[page] mid-sub read: Counter = ${dv.value?.value} status=${dv.statusCode?.toString()}`);
                } catch (e) {
                    console.log(`[page] mid-sub read failed: ${(e as Error).message}`);
                }
            }
            if (tickCount > 20) clearInterval(inspectTick);
        }, 500);
    } else {
        console.log("[page] WARNING: no publish engine found on session");
    }
    console.log("[page] startSubscription: monitored item created");
    return { subscriptionId: subscription.subscriptionId };
}

function waitForChange(timeoutMs = 5000): Promise<number> {
    if (changes.length > 0) return Promise.resolve(changes.shift()!);
    return new Promise<number>((resolve, reject) => {
        let elapsed = 0;
        const tick = setInterval(() => {
            elapsed += 500;
            console.log(
                `[page] waitForChange tick ${elapsed}ms — changes.length=${changes.length} ` +
                    `subscriptionId=${subscription?.subscriptionId ?? "none"} ` +
                    `subscriptionCount=${((session as unknown as { subscriptionCount: number })?.subscriptionCount ?? 0)}`
            );
        }, 500);
        const t = setTimeout(() => {
            clearInterval(tick);
            waitingResolver = undefined;
            reject(new Error(`waitForChange timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        waitingResolver = (v) => {
            clearTimeout(t);
            clearInterval(tick);
            resolve(v);
        };
    });
}

async function disconnect(): Promise<void> {
    try {
        if (subscription) {
            await subscription.terminate();
            subscription = undefined;
        }
        if (session) {
            await session.close();
            session = undefined;
        }
        if (client) {
            await client.disconnect();
            client = undefined;
        }
    } finally {
        changes.length = 0;
        waitingResolver = undefined;
    }
}

window.opcua = { connect, read, write, browse, call, startSubscription, waitForChange, disconnect };

window.addEventListener("unhandledrejection", (ev) => {
    const err = ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason));
    window.opcua.lastError = `${err.message}\n${err.stack ?? ""}`;
});
window.addEventListener("error", (ev) => {
    window.opcua.lastError = `${ev.message}\n${ev.error?.stack ?? ""}`;
});

document.getElementById("status")!.textContent = "loaded";
