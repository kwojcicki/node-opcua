import should from "should";
import { createServer } from "node:net";
import { WebSocket } from "ws";

import { startWsBridge } from "../fixtures/start-ws-bridge";

describe("startWsBridge — TCP ↔ WebSocket bridge", function () {
    this.timeout(10000);

    it("tunnels raw bytes between a WS client and a TCP server", async () => {
        // Echo server on TCP
        const tcpServer = createServer((socket) => {
            socket.on("data", (chunk) => {
                socket.write(chunk); // echo
            });
        });
        await new Promise<void>((resolve) => tcpServer.listen(0, "127.0.0.1", () => resolve()));
        const tcpPort = (tcpServer.address() as { port: number }).port;

        const bridge = await startWsBridge({ backendHost: "127.0.0.1", backendPort: tcpPort });
        try {
            const ws = new WebSocket(bridge.url, "opcua+uacp");
            const received: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
                ws.on("open", () => {
                    ws.send(Buffer.from([1, 2, 3, 4, 5]));
                });
                ws.on("message", (data, isBinary) => {
                    isBinary.should.be.true();
                    received.push(data as Buffer);
                    if (received.length === 1) {
                        ws.close();
                    }
                });
                ws.on("close", () => resolve());
                ws.on("error", reject);
            });
            received.should.have.length(1);
            Buffer.concat(received).should.deepEqual(Buffer.from([1, 2, 3, 4, 5]));
        } finally {
            await bridge.stop();
            await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
        }
    });

    it("reports active tunnel counts", async () => {
        const tcpServer = createServer(() => { /* just accept */ });
        await new Promise<void>((resolve) => tcpServer.listen(0, "127.0.0.1", () => resolve()));
        const tcpPort = (tcpServer.address() as { port: number }).port;

        const bridge = await startWsBridge({ backendHost: "127.0.0.1", backendPort: tcpPort });
        try {
            bridge.activeTunnels().should.equal(0);
            const ws = new WebSocket(bridge.url, "opcua+uacp");
            await new Promise<void>((resolve) => ws.on("open", () => resolve()));
            // Give the server a tick to register the connection
            await new Promise((r) => setTimeout(r, 50));
            bridge.activeTunnels().should.equal(1);
            ws.close();
            await new Promise((r) => setTimeout(r, 100));
            bridge.activeTunnels().should.equal(0);
        } finally {
            await bridge.stop();
            await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
        }
    });
});
