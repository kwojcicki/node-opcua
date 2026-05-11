import should from "should";
import { createServer, type Socket } from "node:net";
import { WebSocket } from "ws";

import { ClientWS_transport } from "../../dist";
import { startWsBridge } from "../fixtures/start-ws-bridge";

describe("ClientWS_transport end-to-end via ws-bridge", function () {
    this.timeout(15000);

    it("completes HEL/ACK through a real TCP↔WS bridge", async () => {
        // TCP server speaking UACP: on the first inbound HEL, reply with a valid ACK
        let sawHello = false;
        const tcpServer = createServer((sock: Socket) => {
            sock.once("data", (buf) => {
                const msgType = buf.slice(0, 3).toString("ascii");
                msgType.should.equal("HEL");
                sawHello = true;
                // Send a minimal ACK (28 bytes)
                const ack = Buffer.alloc(28);
                ack.write("ACK", 0, 3, "ascii");
                ack.write("F", 3, 1, "ascii");
                ack.writeUInt32LE(28, 4);
                ack.writeUInt32LE(0, 8);
                ack.writeUInt32LE(65535, 12);
                ack.writeUInt32LE(65535, 16);
                ack.writeUInt32LE(0, 20);
                ack.writeUInt32LE(0, 24);
                sock.write(ack);
            });
        });
        await new Promise<void>((resolve) => tcpServer.listen(0, "127.0.0.1", () => resolve()));
        const tcpPort = (tcpServer.address() as { port: number }).port;

        const bridge = await startWsBridge({ backendHost: "127.0.0.1", backendPort: tcpPort });

        try {
            const transport = new ClientWS_transport({ webSocketCtor: WebSocket as any });
            const connected = await new Promise<boolean>((resolve, reject) => {
                transport.on("connect", () => resolve(true));
                transport.connect(bridge.url, (err) => {
                    if (err) reject(err);
                });
            });
            connected.should.be.true();
            sawHello.should.be.true();
            transport.isValid().should.be.true();
            transport.receiveBufferSize.should.be.greaterThan(0);
            transport.dispose();
        } finally {
            await bridge.stop();
            await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
        }
    });
});
