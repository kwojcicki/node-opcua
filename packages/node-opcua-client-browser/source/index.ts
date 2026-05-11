/*!
 * The MIT License (MIT)
 * Copyright (c) 2022-2025  Sterfive SAS - 833264583 RCS ORLEANS - France (https://www.sterfive.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
/**
 * @module node-opcua-client-browser
 *
 * Browser entry point for `node-opcua-client`. This initial scaffold ships the
 * package layout, build toolchain, and Playwright smoke harness. Later PRs add:
 *
 *   - The WebSocket transport (`ClientWS_transport`,
 *     `browserWsTransportFactory`) over OPC UA Part 6 §7.5 framing.
 *   - `createBrowserClient(...)` pre-wired with in-memory credentials and a
 *     browser-safe trust store.
 *   - Re-exports of the full `OPCUAClient` / `ClientSession` /
 *     `ClientSubscription` / `ClientMonitoredItem` surface.
 *   - An `esbuild`-produced standalone browser bundle.
 *
 * Target environments: modern evergreen browsers (Chromium, Firefox, WebKit).
 */

export const VERSION = "2.170.1";
