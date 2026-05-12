/**
 * @module node-opcua-client-browser
 *
 * `ClientWS_transport` — OPC UA WebSocket client transport (Part 6 §7.5).
 *
 * Subclasses `ClientTCP_transport` and reuses its HEL/ACK + chunk-reassembly
 * machinery unchanged. The only swap is the socket-creation step: instead of
 * opening a TCP connection, we open a `WebSocket` and hand a
 * {@link WsSocketAdapter} to `TCP_transport._install_socket`.
 *
 * OPC UA WebSocket framing:
 *   - One UACP chunk per outgoing binary WebSocket frame (handled naturally —
 *     each `write(chunk)` call invokes `ws.send(chunk)` once).
 *   - Incoming bytes are fed into `TCP_transport`'s packet-assembler, which
 *     re-combines split chunks.
 *   - Subprotocol `opcua+uacp` is requested on the handshake. If the server
 *     echoes it back we record that; if not (common with a `websockify`
 *     bridge) we continue without failing — browsers still accept the
 *     connection provided the server's bytes are valid UACP.
 */

/* global WebSocket */

import { assert } from "node-opcua-assert";
import { checkDebugFlag, make_debugLog, make_warningLog } from "node-opcua-debug";
import type { ErrorCallback } from "node-opcua-status-code";
import {
    ClientTCP_transport,
    type IClientTransport,
    type IClientTransportFactory,
    type ISocketLike,
    type TransportSettingsOptions
} from "node-opcua-transport";

import { type WebSocketLike, WsSocketAdapter } from "./ws_socket_adapter";

const debugLog = make_debugLog("ClientWS_transport");
const warningLog = make_warningLog("ClientWS_transport");
const doDebug = checkDebugFlag("ClientWS_transport");

/** WebSocket subprotocol name defined by OPC UA Part 6 §7.5 */
export const OPCUA_UACP_SUBPROTOCOL = "opcua+uacp";

/**
 * A tiny WebSocket-constructor type. In the browser this is `globalThis.WebSocket`;
 * in Node-side unit tests this is the `ws` package's `default` export. Either works.
 */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocketLike;

/** Options specific to the browser WebSocket transport. */
export interface ClientWSTransportOptions extends TransportSettingsOptions {
    /**
     * The WebSocket constructor to use. Defaults to `globalThis.WebSocket`.
     * Override this from Node-side unit tests to inject the `ws` package.
     */
    webSocketCtor?: WebSocketConstructor;

    /**
     * When `true`, `connect()` fails if the peer does not echo back the
     * `opcua+uacp` subprotocol on the WebSocket opening handshake. Defaults to
     * `false` because `websockify` bridges do not negotiate subprotocols; the
     * OPC UA bytes that follow will fail the HEL/ACK step anyway if the peer
     * isn't actually speaking UACP.
     */
    strictSubprotocol?: boolean;
}

/**
 * Parsed endpoint URL, normalised for the browser `WebSocket` constructor.
 */
export interface ParsedWsEndpoint {
    /** The URL to pass to `new WebSocket(url, …)` — always starts with `ws://` or `wss://`. */
    wsUrl: string;
    /** `true` if the original URL used `opc.wss://` or `wss://`. */
    secure: boolean;
}

/**
 * Parse and normalise an OPC UA WebSocket endpoint URL. Accepts all four
 * forms: `opc.ws://`, `opc.wss://`, `ws://`, `wss://`. Anything else throws.
 *
 * @throws {Error} if the scheme is not one of the four accepted forms.
 */
export function parseWsEndpointUrl(endpointUrl: string): ParsedWsEndpoint {
    const m = /^(opc\.ws|opc\.wss|ws|wss):\/\/(.+)$/i.exec(endpointUrl);
    if (!m) {
        throw new Error(
            `[node-opcua-client-browser] unsupported endpoint URL scheme for WebSocket transport: ${endpointUrl} ` +
                `(expected one of opc.ws://, opc.wss://, ws://, wss://)`
        );
    }
    const scheme = m[1].toLowerCase();
    const secure = scheme === "opc.wss" || scheme === "wss";
    const wsUrl = `${secure ? "wss" : "ws"}://${m[2]}`;
    return { wsUrl, secure };
}

/**
 * WebSocket-backed client transport. Instances satisfy {@link IClientTransport}
 * by inheritance from {@link ClientTCP_transport}; the only overridden method
 * is `connect`, which constructs a WebSocket and adapts it to `ISocketLike`.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter mirror of ClientTCP_transport
export interface ClientWS_transport {
    on(eventName: "chunk", eventHandler: (messageChunk: Buffer) => void): this;
    on(eventName: "close", eventHandler: (err: Error | null) => void): this;
    on(eventName: "connection_break", eventHandler: (err: Error | null) => void): this;
    on(eventName: "connect", eventHandler: () => void): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ClientWS_transport extends ClientTCP_transport {
    private readonly _webSocketCtor: WebSocketConstructor;
    private readonly _strictSubprotocol: boolean;

    constructor(options?: ClientWSTransportOptions) {
        super(options);
        const resolvedCtor =
            options?.webSocketCtor ??
            ((typeof globalThis !== "undefined" ? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket : undefined) as
                | WebSocketConstructor
                | undefined);
        if (!resolvedCtor) {
            throw new Error(
                "[ClientWS_transport] no WebSocket constructor available: pass `webSocketCtor` explicitly or run in a browser / Node 22+"
            );
        }
        this._webSocketCtor = resolvedCtor;
        this._strictSubprotocol = !!options?.strictSubprotocol;
    }

    /**
     * Opens a WebSocket to `endpointUrl`, adapts it to `ISocketLike`, and
     * defers to `ClientTCP_transport`'s HEL/ACK transaction.
     */
    public override connect(endpointUrl: string, callback: ErrorCallback): void {
        this.endpointUrl = endpointUrl;

        /* c8 ignore next */
        doDebug && debugLog(`ClientWS_transport#connect(endpointUrl = ${endpointUrl})`);

        let parsed: ParsedWsEndpoint;
        try {
            parsed = parseWsEndpointUrl(endpointUrl);
        } catch (err) {
            callback(err as Error);
            return;
        }

        let ws: WebSocketLike;
        try {
            ws = new this._webSocketCtor(parsed.wsUrl, OPCUA_UACP_SUBPROTOCOL);
        } catch (err) {
            /* c8 ignore next */
            doDebug && debugLog("WebSocket construction failed", (err as Error).message);
            callback(err as Error);
            return;
        }

        const socket: ISocketLike = new WsSocketAdapter(ws, parsed.wsUrl);

        const onEarlyError = (err: Error) => {
            callback(err);
        };
        socket.once("error", onEarlyError);

        socket.once("connect", () => {
            socket.removeListener("error", onEarlyError);

            // Subprotocol negotiation check. Browser WS exposes `protocol` on the
            // instance; `ws` package exposes it too. When the peer doesn't
            // negotiate (e.g. a websockify bridge), `protocol` is an empty
            // string. Only fail in strict mode.
            const negotiated: string | undefined = (ws as unknown as { protocol?: string }).protocol;
            if (negotiated && negotiated !== OPCUA_UACP_SUBPROTOCOL) {
                const msg = `unexpected WebSocket subprotocol negotiated: "${negotiated}" (expected "${OPCUA_UACP_SUBPROTOCOL}")`;
                if (this._strictSubprotocol) {
                    callback(new Error(`[ClientWS_transport] ${msg}`));
                    socket.destroy();
                    return;
                }
                warningLog(msg);
            } else if (!negotiated) {
                /* c8 ignore next */
                doDebug &&
                    debugLog(
                        `peer did not echo the "${OPCUA_UACP_SUBPROTOCOL}" subprotocol; continuing ` +
                            `(set strictSubprotocol=true to reject this)`
                    );
            }

            // Defer to TCP_transport's install path + ClientTCP_transport's
            // HEL/ACK handshake by installing the socket directly.
            assert(!this._socket, "transport should not have a socket yet");
            // _install_socket is protected; subclassing grants access.
            (this as unknown as { _install_socket(s: ISocketLike): void })._install_socket(socket);

            // Kick off HEL/ACK. _perform_HEL_ACK_transaction is private on the
            // parent, so we reuse the public behaviour by invoking the parent
            // `connect` again — but that would loop. Instead, the parent's
            // `_on_socket_connect` handler is wired to perform HEL/ACK and then
            // emit "connect" on `this`. We trigger it by emitting "connect" on
            // the freshly-installed socket; but the parent attached its
            // `once("connect", _on_socket_connect)` via its own `connect()`,
            // which we're overriding. So we call the HEL/ACK sequence directly.
            const parentAny = this as unknown as {
                _perform_HEL_ACK_transaction(cb: ErrorCallback): void;
            };
            parentAny._perform_HEL_ACK_transaction((err) => {
                if (!err) {
                    /* c8 ignore next */
                    if (!this._socket) {
                        return callback(new Error("Abandoned"));
                    }
                    // Install the connection-break detector that ClientTCP_transport's
                    // success path installs.
                    this._socket.on("error", (e: Error) => {
                        if (e.message.match(/ECONNRESET|EPIPE|premature socket termination/)) {
                            /* c8 ignore next */
                            doDebug && debugLog("connection_break after reconnection", endpointUrl);
                            this.emit("connection_break", e);
                        }
                    });
                    this.emit("connect");
                } else {
                    debugLog("_perform_HEL_ACK_transaction has failed with err=", err.message);
                }
                callback(err);
            });
        });
    }
}

/**
 * A factory that produces {@link ClientWS_transport} instances. Pass to
 * `ClientSecureChannelLayerOptions.transportFactory` to route all channel
 * traffic through a WebSocket.
 *
 * @example
 *   const ws = browserWsTransportFactory.create({});
 *   // or, on Node:
 *   import WebSocket from "ws";
 *   const factory: IClientTransportFactory = {
 *       create(s) { return new ClientWS_transport({ ...s, webSocketCtor: WebSocket as any }); }
 *   };
 */
export const browserWsTransportFactory: IClientTransportFactory = {
    create(settings?: TransportSettingsOptions): IClientTransport {
        return new ClientWS_transport(settings as ClientWSTransportOptions | undefined);
    }
};
