import {Observable, Subject, Subscription} from "rxjs";
import {first} from "rxjs/operators";

export enum MessageProtocol {
    PUSH,
    REQUEST_REPLY,
    TOPIC_SUBSCRIBE
}

export type MessageID = string;
export type MessageKey = string;
export type MessagePayload = any;
export type MessageLocation = string;
export type MessageConsumer = (msg: any) => void;
export type MessageResponder = (msg: any) => Observable<any>;
export type MessagePublisher = (msg: any) => Observable<any>;
export type Predicate<T> = (x: T) => boolean;

export const ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";

const _global = this;
const _chrome = _global.chrome;
const _window = _global.window;
const _document = _global.document;
const _localMessageBus = new Subject<MessagePacket>();

export interface MessagePacket {
    id: MessageID;
    source: MessageLocation;
    target: MessageLocation;
    protocol: MessageProtocol;
    key: MessageKey;
    data: MessagePayload;
}

interface BrokerState {
    seen: Set<number>,
    location: MessageLocation,
    openProducers: { [s: string]: Subscription }
    pushListeners: { [s: string]: MessageConsumer },
    requestListeners: { [s: string]: MessageResponder },
    subscriptionListeners: { [s: string]: MessagePublisher },
    pendingRequests: { [s: string]: Subject<MessagePacket> },
    pendingSubscriptions: { [s: string]: Subject<MessagePacket> },

}

export interface BrokerSettings {
    verbose?: boolean;
    originVerifier?: Predicate<string>;
}

export interface MessageBroker {

    /**
     * Send a one-way message to the specified location.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    push(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): void;

    /**
     * Send a request message to the specified location and get an observable
     * that will emit the response.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    request(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;

    /**
     * Send a request message to the specified location and get an observable
     * that will emit each message produced..
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    subscription(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;

    /**
     * Setup a handler that will be invoked every time this location receives
     * a push message.
     *
     * @param kind - The type of message
     * @param handler - The callback function
     */
    handlePushes(kind: MessageKey, handler: MessageConsumer): void;

    /**
     * Setup a  handler that will be invoked to produce a response every time this location
     * receives a request message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that eventually produces a response.
     */
    handleRequests(kind: MessageKey, handler: MessageResponder): void;

    /**
     * Setup a  handler that will be invoked to produce one or more responses every
     * time this location receives a subscription message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that may eventually produce responses.
     */
    handleSubscriptions(kind: MessageKey, handler: MessagePublisher): void;
}


function defaultSettings(): BrokerSettings {
    return {
        verbose: false,
        originVerifier: _ => true
    }
}

function emptyBrokerState(location: MessageLocation): BrokerState {
    return {
        location: location,
        seen: new Set(),
        openProducers: {},
        pendingRequests: {},
        pendingSubscriptions: {},
        pushListeners: {},
        requestListeners: {},
        subscriptionListeners: {},
    }
}

function extractHostname(url) {
    let hostname;
    if (url.indexOf("//") > -1) {
        hostname = url.split('/')[2];
    } else {
        hostname = url.split('/')[0];
    }
    hostname = hostname.split(':')[0];
    hostname = hostname.split('?')[0];
    return hostname;
}

function simpleHash(text: string): number {
    let hash = 0;
    if (text.length === 0) return hash;
    for (let index = 0; index < text.length; index++) {
        const char = text.charCodeAt(index);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

function computeMessageHash(message: MessagePacket): number {
    return simpleHash(JSON.stringify(message));
}

function isObject(o: any) {
    if (!o) return false;
    if (Array.isArray(o)) return false;
    return o.constructor == Object;
}

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function quacksLikeAGossipPacket(message: any): boolean {
    if (!isObject(message)) {
        return false;
    }
    const keys = ["id", "protocol", "source", "target", "key", "data"];
    return keys.every(key => message.hasOwnProperty(key));
}

function getIframes(): HTMLIFrameElement[] {
    return Array.from(_document.getElementsByTagName('iframe'));
}

function broadcast(settings: BrokerSettings, message: MessagePacket) {

    if (_window && _window.parent && _window.parent !== _window) {
        _window.parent.postMessage(message, '*');
    }

    if (_localMessageBus) {
        if (!_localMessageBus.closed) {
            _localMessageBus.next(message);
        } else if (settings.verbose) {
            console.warn("Tried to send request to closed local message bus", message);
        }
    }

    if (!_document || _document.readyState === 'loading') {
        if (_window && _window.addEventListener) {
            _window.addEventListener('DOMContentLoaded', () => {
                getIframes().forEach(frame => {
                    const targetOrigin = frame.src;
                    if (settings.originVerifier(extractHostname(targetOrigin))) {
                        frame.contentWindow.postMessage(message, '*');
                    }
                });
            });
        }
    } else {
        getIframes().forEach(frame => {
            const targetOrigin = frame.src;
            if (settings.originVerifier(extractHostname(targetOrigin))) {
                frame.contentWindow.postMessage(message, '*');
            }
        });
    }

    if (_chrome && _chrome.runtime && _chrome.runtime.id && _chrome.runtime.sendMessage) {
        _chrome.runtime.sendMessage(_chrome.runtime.id, message);
    }

    if (_chrome && _chrome.tabs && _chrome.tabs.query) {
        _chrome.tabs.query({active: true, currentWindow: true}, tabs => {
            if (tabs.length) {
                _chrome.tabs.sendMessage(tabs[0].id, message);
            }
        });
    }

}

export function createGossipNode(location: MessageLocation, settings: BrokerSettings = {}): MessageBroker {
    const state = emptyBrokerState(location);
    settings = Object.assign(defaultSettings(), settings);

    state.pushListeners[ChatterUnsubscribeMessageKey] = (msg: any) => {
        if (msg.subscriptionId) {
            const subject = state.openProducers[msg.subscriptionId];
            delete state.openProducers[msg.subscriptionId];
            if (subject) {
                subject.unsubscribe();
            }
        }
    };

    const send = (msg: MessagePacket): void => {
        state.seen.add(computeMessageHash(msg));
        broadcast(settings, msg);
    };

    const receive = (message: any) => {
        if (quacksLikeAGossipPacket(message)) {
            const packet = <MessagePacket>message;
            const hash = computeMessageHash(message);
            if (!state.seen.has(hash)) {
                state.seen.add(hash);

                if (packet.target === state.location) {

                    if (packet.protocol === MessageProtocol.REQUEST_REPLY) {
                        if (state.pendingRequests[packet.id]) {
                            const subject = state.pendingRequests[packet.id];
                            delete state.pendingRequests[packet.id];
                            if (!subject.closed) {
                                subject.next(packet);
                            } else if (settings.verbose) {
                                console.warn("Tried to send message to closed request", packet);
                            }
                            return;
                        }
                    }

                    if (packet.protocol === MessageProtocol.TOPIC_SUBSCRIBE) {
                        if (state.pendingSubscriptions[packet.id]) {
                            const subject = state.pendingSubscriptions[packet.id];
                            if (!subject.closed) {
                                subject.next(packet);
                            } else if (settings.verbose) {
                                console.warn("Tried to send message to closed subscription", packet);
                            }
                            return;
                        }
                    }

                    if (packet.protocol === MessageProtocol.PUSH) {
                        const handler = state.pushListeners[packet.key];
                        if (handler) {
                            handler(packet.data);
                        } else {
                            console.warn("Received packet of unknown kind.", packet);
                        }
                        return;
                    }

                    if (packet.protocol === MessageProtocol.REQUEST_REPLY) {
                        const handler = state.requestListeners[packet.key];
                        if (handler) {
                            const responseObservable = handler(packet.data);
                            responseObservable.pipe(first()).subscribe(response => {

                                send({
                                    id: packet.id,
                                    key: packet.key,
                                    protocol: packet.protocol,
                                    source: packet.target,
                                    target: packet.source,
                                    data: response
                                });

                            });
                        } else {
                            console.warn("Received packet of unknown kind.", packet);
                        }
                        return;
                    }


                    if (packet.protocol === MessageProtocol.TOPIC_SUBSCRIBE) {
                        const handler = state.subscriptionListeners[packet.key];
                        if (handler) {
                            const responseObservable = handler(packet.data);
                            state.openProducers[packet.id] = responseObservable.subscribe(response => {
                                send({
                                    id: packet.id,
                                    key: packet.key,
                                    protocol: packet.protocol,
                                    source: packet.target,
                                    target: packet.source,
                                    data: response
                                });
                            });
                        } else {
                            console.warn("Received packet of unknown kind.", packet);
                        }
                    }

                } else {
                    // forward packet intended for another location
                    send(packet);
                }
            }
        }

    };

    if (_localMessageBus) {
        _localMessageBus.subscribe(receive);
    }

    if (_global.window && _window.addEventListener) {
        _window.addEventListener("message", event => {
            if (settings.originVerifier(extractHostname(event.origin))) {
                receive(event.data);
            }
        });
    }

    if (_chrome && _chrome.runtime && _chrome.runtime.onMessage) {
        _chrome.runtime.onMessage.addListener((message, sender) => {
            if (settings.originVerifier(extractHostname(sender.id))) {
                receive(message);
            }
        });
    }

    return {
        handlePushes(kind: MessageKey, handler: MessageConsumer): void {
            state.pushListeners[kind] = handler;
        },
        handleRequests(kind: MessageKey, handler: MessageResponder): void {
            state.requestListeners[kind] = handler;
        },
        handleSubscriptions(kind: MessageKey, handler: MessagePublisher): void {
            state.subscriptionListeners[kind] = handler;
        },
        push<T>(dest: MessageLocation, kind: MessageKey, message: MessagePayload = {}): void {
            const transaction = uuid();

            send({
                id: transaction,
                protocol: MessageProtocol.PUSH,
                source: state.location,
                target: dest,
                key: kind,
                data: message
            });

        },
        request(dest: MessageLocation, kind: MessageKey, message: MessagePayload = {}): Observable<MessagePayload> {
            return new Observable(observer => {

                const transaction = uuid();
                const subject = new Subject<MessagePacket>();
                state.pendingRequests[transaction] = subject;

                const sub = subject.subscribe(result => {
                    observer.next(result.data);
                });

                send({
                    id: transaction,
                    protocol: MessageProtocol.REQUEST_REPLY,
                    source: state.location,
                    target: dest,
                    key: kind,
                    data: message
                });

                return () => {
                    delete state.pendingRequests[transaction];
                    sub.unsubscribe();
                    subject.unsubscribe();
                }
            });
        },
        subscription(dest: MessageLocation, kind: MessageKey, message: MessagePayload = {}): Observable<MessagePayload> {
            return new Observable(observer => {

                const transaction = uuid();
                const subject = new Subject<MessagePacket>();
                state.pendingSubscriptions[transaction] = subject;

                const sub = subject.subscribe(result => {
                    observer.next(result.data);
                });

                send({
                    id: transaction,
                    protocol: MessageProtocol.TOPIC_SUBSCRIBE,
                    source: state.location,
                    target: dest,
                    key: kind,
                    data: message
                });

                return () => {
                    send({
                        id: uuid(),
                        protocol: MessageProtocol.PUSH,
                        source: state.location,
                        target: dest,
                        key: ChatterUnsubscribeMessageKey,
                        data: {subscriptionId: transaction}
                    });

                    delete state.pendingSubscriptions[transaction];
                    sub.unsubscribe();
                    subject.unsubscribe();
                };
            });

        }

    }
}