import {Observable, Subject, Subscription} from "rxjs";
import {first, map} from "rxjs/operators";

export enum MessageProtocol {
    PUSH,
    REQUEST_REPLY,
    TOPIC_SUBSCRIBE
}

export type MessageID = string;
export type MessageKey = string;
export type MessageLocation = string;
export type MessageConsumer = (msg: any) => void;
export type MessageResponder = (msg: any) => Observable<any>;
export type MessagePublisher = (msg: any) => Observable<any>;

export const ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";

export interface MessagePacket {
    id: MessageID;
    source: MessageLocation;
    target: MessageLocation;
    protocol: MessageProtocol;
    key: MessageKey;
    data: any;
}

export interface MessageBroker {

    /**
     * Send a one-way message to the specified location.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    push<T>(dest: MessageLocation, kind: MessageKey, message: T): void;

    /**
     * Send a request message to the specified location and get an observable
     * that will emit the response.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    request<T, S>(dest: MessageLocation, kind: MessageKey, message: T): Observable<S>;

    /**
     * Send a request message to the specified location and get an observable
     * that will emit each message produced..
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    subscribe<T, S>(dest: MessageLocation, kind: MessageKey, message: T): Observable<S>;

    /**
     * Setup a handler that will be invoked every time this location receives
     * a push message.
     *
     * @param kind - The type of message
     * @param handler - The callback function
     */
    handlePushes<T>(kind: MessageKey, handler: (msg: T) => void): void;

    /**
     * Setup a  handler that will be invoked to produce a response every time this location
     * receives a request message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that eventually produces a response.
     */
    handleRequests<T, S>(kind: MessageKey, handler: (msg: T) => Observable<S>): void;

    /**
     * Setup a  handler that will be invoked to produce one or more responses every
     * time this location receives a subscription message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that may eventually produce responses.
     */
    handleSubscriptions<T, S>(kind: MessageKey, handler: (msg: T) => Observable<S>): void;
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

interface BrokerSettings {
    trustedOrigins: Set<string>;
}

function defaultSettings(): BrokerSettings {
    return {
        trustedOrigins: new Set(["*"])
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
    const identity = {
        id: message.id,
        protocol: message.protocol,
        source: message.source,
        target: message.target
    };
    return simpleHash(JSON.stringify(identity));
}

function isObject(o: any) {
    if (!o) return false;
    if (Array.isArray(o)) return false;
    return o.constructor == Object;
}

function intersection<T>(s1: Set<T>, s2: Set<T>) {
    const inter = new Set();
    s1.forEach(v => {
        if (s2.has(v)) {
            inter.add(v);
        }
    });
    return inter;
}

function onUnsubscribe<T>(obs: Observable<T>, f: () => void): Observable<T> {
    return new Observable(observer => {
        const sub = obs.subscribe(message => {
            observer.next(message);
        }, error => {
            observer.error(error);
        });
        return () => {
            try {
                sub.unsubscribe();
            } finally {
                f();
            }
        };
    });
};

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
    const keys = new Set(Object.keys(message || {}));
    const expected = new Set(["id", "protocol", "source", "target", "key", "data"]);
    return intersection(keys, expected).size === expected.size;
}

function getIframes(): HTMLIFrameElement[] {
    return Array.from(document.getElementsByTagName('iframe'));
}

function broadcast(message: MessagePacket) {

    if (window && window.parent && window.parent !== window) {
        window.parent.postMessage(message, "*");
    }

    if (!document || document.readyState === 'loading') {
        if (window && window.addEventListener) {
            window.addEventListener("DOMContentLoaded", () => {
                getIframes().forEach(frame => {
                    frame.contentWindow.postMessage(message, "*");
                });
            });
        }
    } else {
        getIframes().forEach(frame => {
            frame.contentWindow.postMessage(message, "*");
        });
    }

    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message);
    }

    if (chrome && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, message);
        });
    }

}

export function createGossipNode(location: MessageLocation, settings: BrokerSettings = defaultSettings()): MessageBroker {
    const state = emptyBrokerState(location);

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
        broadcast(msg);
    };

    const receive = (message: any) => {
        if (quacksLikeAGossipPacket(message)) {
            const packet = <MessagePacket>message;
            const hash = computeMessageHash(message);
            if (!state.seen.has(hash)) {
                if (packet.target === state.location) {
                    if (state.pendingRequests[packet.id]) {
                        const subject = state.pendingRequests[packet.id];
                        delete state.pendingRequests[packet.id];
                        subject.next(packet);
                        subject.unsubscribe();
                        return;
                    }

                    if (state.pendingSubscriptions[packet.id]) {
                        const subject = state.pendingSubscriptions[packet.id];
                        subject.next(packet);
                        return;
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
                    send(packet);
                }
            }
        }

    };

    if (window && window.addEventListener) {
        window.addEventListener("message", event => {
            receive(event.data);
        });
    }

    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender) => {
            receive(message);
        });
    }

    return {
        handlePushes<T>(kind: string, handler: (msg: T) => void): void {
            state.pushListeners[kind] = handler;
        },
        handleRequests<T, S>(kind: string, handler: (msg: T) => Observable<S>): void {
            state.requestListeners[kind] = handler;
        },
        handleSubscriptions<T, S>(kind: string, handler: (msg: T) => Observable<S>): void {
            state.subscriptionListeners[kind] = handler;
        },
        push<T>(dest: string, kind: string, message: T): void {
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
        request<T, S>(dest: string, kind: string, message: T): Observable<S> {
            const transaction = uuid();

            const subject = new Subject<MessagePacket>();

            state.pendingRequests[transaction] = subject;

            send({
                id: transaction,
                protocol: MessageProtocol.REQUEST_REPLY,
                source: state.location,
                target: dest,
                key: kind,
                data: message
            });

            return subject.pipe(first(), map(message => {
                return message.data;
            }));
        },
        subscribe<T, S>(dest: string, kind: string, message: T): Observable<S> {
            const transaction = uuid();

            const subject = new Subject<MessagePacket>();

            state.pendingSubscriptions[transaction] = subject;

            send({
                id: transaction,
                protocol: MessageProtocol.TOPIC_SUBSCRIBE,
                source: state.location,
                target: dest,
                key: kind,
                data: message
            });

            const returnObservable = subject.pipe(map(message => {
                return message.data;
            }));

            return onUnsubscribe(returnObservable, () => {
                send({
                    id: uuid(),
                    protocol: MessageProtocol.PUSH,
                    source: state.location,
                    target: dest,
                    key: ChatterUnsubscribeMessageKey,
                    data: {subscriptionId: transaction}
                });
            });
        }

    }
}