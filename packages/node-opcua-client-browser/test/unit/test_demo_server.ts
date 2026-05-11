import should from "should";
import { startDemoServer } from "../fixtures/demo-server";

describe("demo-server fixture", function () {
    this.timeout(30000);

    it("starts, exposes Counter and Setpoint, and stops cleanly", async () => {
        const server = await startDemoServer();
        try {
            server.endpointUrl.should.match(/^opc\.tcp:\/\/127\.0\.0\.1:\d+\/UA\/BrowserClientTest$/);
            server.port.should.be.greaterThan(0);
            // Counter ticks at 250ms; wait 600ms and we should see > 1
            await new Promise((r) => setTimeout(r, 600));
            server.counter().should.be.greaterThan(1);
        } finally {
            await server.stop();
        }
    });
});
