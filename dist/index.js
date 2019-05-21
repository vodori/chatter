"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
var MessageProtocol;
(function (MessageProtocol) {
    MessageProtocol[MessageProtocol["PUSH"] = 0] = "PUSH";
    MessageProtocol[MessageProtocol["REQUEST_REPLY"] = 1] = "REQUEST_REPLY";
    MessageProtocol[MessageProtocol["TOPIC_SUBSCRIBE"] = 2] = "TOPIC_SUBSCRIBE";
})(MessageProtocol = exports.MessageProtocol || (exports.MessageProtocol = {}));
exports.ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";
function defaultSettings() {
    return {
        originVerifier: x => true
    };
}
function emptyBrokerState(location) {
    return {
        location: location,
        seen: new Set(),
        openProducers: {},
        pendingRequests: {},
        pendingSubscriptions: {},
        pushListeners: {},
        requestListeners: {},
        subscriptionListeners: {},
    };
}
function simpleHash(text) {
    let hash = 0;
    if (text.length === 0)
        return hash;
    for (let index = 0; index < text.length; index++) {
        const char = text.charCodeAt(index);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}
function computeMessageHash(message) {
    return simpleHash(JSON.stringify(message));
}
function isObject(o) {
    if (!o)
        return false;
    if (Array.isArray(o))
        return false;
    return o.constructor == Object;
}
function intersection(s1, s2) {
    const inter = new Set();
    s1.forEach(v => {
        if (s2.has(v)) {
            inter.add(v);
        }
    });
    return inter;
}
function onUnsubscribe(obs, f) {
    return new rxjs_1.Observable(observer => {
        const sub = obs.subscribe(message => {
            observer.next(message);
        }, error => {
            observer.error(error);
        });
        return () => {
            try {
                sub.unsubscribe();
            }
            finally {
                f();
            }
        };
    });
}
;
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
function quacksLikeAGossipPacket(message) {
    if (!isObject(message)) {
        return false;
    }
    const keys = new Set(Object.keys(message || {}));
    const expected = new Set(["id", "protocol", "source", "target", "key", "data"]);
    return intersection(keys, expected).size === expected.size;
}
function getIframes() {
    return Array.from(document.getElementsByTagName('iframe'));
}
function broadcast(message) {
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
    }
    else {
        getIframes().forEach(frame => {
            frame.contentWindow.postMessage(message, "*");
        });
    }
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message);
    }
    if (chrome && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, message);
        });
    }
}
function createGossipNode(location, settings = defaultSettings()) {
    const state = emptyBrokerState(location);
    state.pushListeners[exports.ChatterUnsubscribeMessageKey] = (msg) => {
        if (msg.subscriptionId) {
            const subject = state.openProducers[msg.subscriptionId];
            delete state.openProducers[msg.subscriptionId];
            if (subject) {
                subject.unsubscribe();
            }
        }
    };
    const send = (msg) => {
        state.seen.add(computeMessageHash(msg));
        broadcast(msg);
    };
    const receive = (message) => {
        if (quacksLikeAGossipPacket(message)) {
            const packet = message;
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
                        }
                        else {
                            console.warn("Received packet of unknown kind.", packet);
                        }
                        return;
                    }
                    if (packet.protocol === MessageProtocol.REQUEST_REPLY) {
                        const handler = state.requestListeners[packet.key];
                        if (handler) {
                            const responseObservable = handler(packet.data);
                            responseObservable.pipe(operators_1.first()).subscribe(response => {
                                send({
                                    id: packet.id,
                                    key: packet.key,
                                    protocol: packet.protocol,
                                    source: packet.target,
                                    target: packet.source,
                                    data: response
                                });
                            });
                        }
                        else {
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
                        }
                        else {
                            console.warn("Received packet of unknown kind.", packet);
                        }
                    }
                }
                else {
                    send(packet);
                }
            }
        }
    };
    if (window && window.addEventListener) {
        window.addEventListener("message", event => {
            if (settings.originVerifier(event.origin)) {
                receive(event.data);
            }
        });
    }
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender) => {
            const origin = `chrome-extension://${sender.id}`;
            if (settings.originVerifier(origin)) {
                receive(message);
            }
        });
    }
    return {
        handlePushes(kind, handler) {
            state.pushListeners[kind] = handler;
        },
        handleRequests(kind, handler) {
            state.requestListeners[kind] = handler;
        },
        handleSubscriptions(kind, handler) {
            state.subscriptionListeners[kind] = handler;
        },
        push(dest, kind, message) {
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
        request(dest, kind, message) {
            const transaction = uuid();
            const subject = new rxjs_1.Subject();
            state.pendingRequests[transaction] = subject;
            send({
                id: transaction,
                protocol: MessageProtocol.REQUEST_REPLY,
                source: state.location,
                target: dest,
                key: kind,
                data: message
            });
            return subject.pipe(operators_1.first(), operators_1.map(message => {
                return message.data;
            }));
        },
        subscribe(dest, kind, message) {
            const transaction = uuid();
            const subject = new rxjs_1.Subject();
            state.pendingSubscriptions[transaction] = subject;
            send({
                id: transaction,
                protocol: MessageProtocol.TOPIC_SUBSCRIBE,
                source: state.location,
                target: dest,
                key: kind,
                data: message
            });
            const returnObservable = subject.pipe(operators_1.map(message => {
                return message.data;
            }));
            return onUnsubscribe(returnObservable, () => {
                send({
                    id: uuid(),
                    protocol: MessageProtocol.PUSH,
                    source: state.location,
                    target: dest,
                    key: exports.ChatterUnsubscribeMessageKey,
                    data: { subscriptionId: transaction }
                });
            });
        }
    };
}
exports.createGossipNode = createGossipNode;
