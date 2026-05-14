/**
 * inject-buffer.js
 *
 * Inject `Buffer` and `process` as globals. Used via esbuild's `inject`
 * option in `build-test-page.mjs`.
 *
 * PROVENANCE — derived from upstream:
 *   https://github.com/node-opcua/node-opcua-crypto
 *   packages/node-opcua-crypto-web/inject-buffer.js  @ master
 *
 * Extends the upstream shim with a `process.hrtime` polyfill because
 * `node-opcua-client`'s `detectLongOperation` (in `private/performance.ts`)
 * calls `process.hrtime()` and the `process@0.11.10` browser polyfill
 * doesn't provide `hrtime`. Without this, any `_receive_publish_response`
 * path throws before the notification is dispatched to the consumer's
 * `changed` event handler.
 */

import { Buffer } from "buffer";
import processShim from "process";

// Polyfill `process.hrtime` using `performance.now()` so
// `node-opcua-client/private/performance.ts#detectLongOperation` works in
// the browser. Returns `[seconds, nanoseconds]` the same shape as Node.
if (typeof processShim.hrtime !== "function") {
    const perfNow = () =>
        typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
    processShim.hrtime = (previousTimestamp) => {
        const clockMs = perfNow();
        const clockSec = clockMs / 1000;
        let seconds = Math.floor(clockSec);
        let nanoseconds = Math.floor((clockSec - seconds) * 1e9);
        if (previousTimestamp) {
            seconds -= previousTimestamp[0];
            nanoseconds -= previousTimestamp[1];
            if (nanoseconds < 0) {
                seconds--;
                nanoseconds += 1e9;
            }
        }
        return [seconds, nanoseconds];
    };
}

const process = processShim;
export { Buffer, process };

