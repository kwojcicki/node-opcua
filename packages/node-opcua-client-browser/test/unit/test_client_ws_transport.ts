import should from "should";
import { WebSocket, WebSocketServer } from "ws";

import { browserWsTransportFactory, ClientWS_transport, parseWsEndpointUrl } from "../../dist";
import type { IClientTransport, IClientTransportFactory } from "node-opcua-transport";

describe("parseWsEndpointUrl", () => {
    it("accepts opc.ws:// and returns ws:// plus secure=false", () => {
        const r = parseWsEndpointUrl("opc.ws://host:4840/path");
        r.wsUrl.should.equal("ws://host:4840/path");
        r.secure.should.be.false();
    });
    it("accepts opc.wss:// and returns wss:// plus secure=true", () => {
        const r = parseWsEndpointUrl("opc.wss://host:4843/path");
        r.wsUrl.should.equal("wss://host:4843/path");
        r.secure.should.be.true();
    });
    it("accepts ws:// as-is", () => {
        const r = parseWsEndpointUrl("ws://host:1234");
        r.wsUrl.should.equal("ws://host:1234");
        r.secure.should.be.false();
    });
    it("accepts wss:// as-is", () => {
        const r = parseWsEndpointUrl("wss://host:1234");
        r.wsUrl.should.equal("wss://host:1234");
        r.secure.should.be.true();
    });
    it("rejects opc.tcp:// with a clear error", () => {
        (() => parseWsEndpointUrl("opc.tcp://host:4840")).should.throw(/unsupported endpoint URL scheme/);
    });
    it("rejects garbage", () => {
        (() => parseWsEndpointUrl("not-a-url")).should.throw(/unsupported endpoint URL scheme/);
    });
});

describe("ClientWS_transport — structural / factory", () => {
    it("factory returns a ClientWS_transport instance", () => {
        // Inject the `ws` constructor since no globalThis.WebSocket exists on Node <22.
        const factory: IClientTransportFactory = {
            create(s) {
                return new ClientWS_transport({ ...(s as object), webSocketCtor: WebSocket as any });
            }
        };
        const t = factory.create({});
        t.should.be.instanceof(ClientWS_transport);
    });

    it("conforms to IClientTransport (compile-time check)", () => {
        const t = new ClientWS_transport({ webSocketCtor: WebSocket as any });
        const asIface: IClientTransport = t;
        asIface.name.should.match(/^ClientWS_transport/);
    });

    it("exports a default factory object (globalThis.WebSocket path only)", () => {
        // If the host Node has a WebSocket global (22+), the default factory works;
        // otherwise constructing should throw the "no WebSocket constructor" error.
        const hasNativeWs = typeof (globalThis as any).WebSocket === "function";
        if (hasNativeWs) {
            const t = browserWsTransportFactory.create({});
            t.should.be.instanceof(ClientWS_transport);
        } else {
            (() => browserWsTransportFactory.create({})).should.throw(/no WebSocket constructor/);
        }
    });

    it("rejects unsupported scheme at connect() time", (done) => {
        const t = new ClientWS_transport({ webSocketCtor: WebSocket as any });
        t.connect("opc.tcp://localhost:4840", (err) => {
            should.exist(err);
            (err as Error).message.should.match(/unsupported endpoint URL scheme|opc\.tcp/);
            done();
        });
    });
});

describe("ClientWS_transport — HEL/ACK over ws://", function () {
    this.timeout(20000);

    let server: WebSocketServer | undefined;
    let endpointUrl: string;

    beforeEach((done) => {
        // Stand up a Node WebSocketServer that speaks UACP: on each binary
        // message, reply with a canned ACK so the transport's HEL/ACK loop
        // completes. We parse the HEL just enough to surface meaningful
        // failures.
        server = new WebSocketServer({ port: 0, handleProtocols: (protocols) =>
            protocols.has("opcua+uacp") ? "opcua+uacp" : false
        });
        server.on("listening", () => {
            const port = (server!.address() as { port: number }).port;
            endpointUrl = `ws://127.0.0.1:${port}`;
            done();
        });
        server.on("connection", (ws) => {
            ws.on("message", (data, isBinary) => {
                if (!isBinary) return;
                const buf = data as Buffer;
                // First 3 bytes should be "HEL"
                const msgType = buf.slice(0, 3).toString("ascii");
                if (msgType !== "HEL") {
                    ws.close(1002, `unexpected msgType=${msgType}`);
                    return;
                }
                // Build a minimal ACK manually rather than pulling encoder deps
                // in the test — just enough to make the client's ACK handler
                // succeed. The transport reads: msgType(3)+chr(1)+len(4)+
                // protocolVersion(4)+receiveBufferSize(4)+sendBufferSize(4)+
                // maxMessageSize(4)+maxChunkCount(4) = 28 bytes total.
                const ack = Buffer.alloc(28);
                ack.write("ACK", 0, 3, "ascii");
                ack.write("F", 3, 1, "ascii");
                ack.writeUInt32LE(28, 4);               // length
                ack.writeUInt32LE(0, 8);                // protocolVersion
                ack.writeUInt32LE(65535, 12);           // receiveBufferSize
                ack.writeUInt32LE(65535, 16);           // sendBufferSize
                ack.writeUInt32LE(0, 20);               // maxMessageSize
                ack.writeUInt32LE(0, 24);               // maxChunkCount
                ws.send(ack);
            });
        });
    });

    afterEach((done) => {
        if (!server) return done();
        server.close(() => done());
        server = undefined;
    });

    it("connects, performs HEL/ACK, and emits 'connect'", (done) => {
        const t = new ClientWS_transport({ webSocketCtor: WebSocket as any });
        let finished = false;
        const finish = (err?: Error) => {
            if (finished) return;
            finished = true;
            try {
                t.dispose();
            } catch { /* ignore */ }
            done(err);
        };
        t.on("connect", () => {
            try {
                t.isValid().should.be.true();
                t.receiveBufferSize.should.be.greaterThan(0);
                finish();
            } catch (e) {
                finish(e as Error);
            }
        });
        t.connect(endpointUrl, (err) => {
            if (err) finish(err);
            // note: "connect" event fires before this callback in the happy path
        });
    });

    it("returns an error if the peer closes without sending ACK", function (done) {
        this.timeout(10000);
        // Replace the message handler to just close on HEL
        server!.removeAllListeners("connection");
        server!.on("connection", (ws) => {
            ws.on("message", () => ws.close(1002, "synthetic failure"));
        });
        const t = new ClientWS_transport({ webSocketCtor: WebSocket as any });
        t.connect(endpointUrl, (err) => {
            should.exist(err);
            t.dispose();
            done();
        });
    });
});
