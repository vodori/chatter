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
const _global = this;
const _chrome = _global.chrome;
const _window = _global.window;
const _document = _global.document;
const _localMessageBus = new rxjs_1.Subject();
function defaultSettings() {
    return {
        originVerifier: _ => true
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
function extractHostname(url) {
    let hostname;
    if (url.indexOf("//") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }
    hostname = hostname.split(':')[0];
    hostname = hostname.split('?')[0];
    return hostname;
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
    return Array.from(_document.getElementsByTagName('iframe'));
}
function broadcast(settings, message) {
    if (_window && _window.parent && _window.parent !== _window) {
        _window.parent.postMessage(message, '*');
    }
    if (_localMessageBus) {
        if (!_localMessageBus.closed) {
            _localMessageBus.next(message);
        }
        else {
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
    }
    else {
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
        _chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs.length) {
                _chrome.tabs.sendMessage(tabs[0].id, message);
            }
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
        broadcast(settings, msg);
    };
    const receive = (message) => {
        if (quacksLikeAGossipPacket(message)) {
            const packet = message;
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
                            }
                            else {
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
                            }
                            else {
                                console.warn("Tried to send message to closed subscription", packet);
                            }
                            return;
                        }
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
        handlePushes(kind, handler) {
            state.pushListeners[kind] = handler;
        },
        handleRequests(kind, handler) {
            state.requestListeners[kind] = handler;
        },
        handleSubscriptions(kind, handler) {
            state.subscriptionListeners[kind] = handler;
        },
        push(dest, kind, message = {}) {
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
        request(dest, kind, message = {}) {
            return new rxjs_1.Observable(observer => {
                const transaction = uuid();
                const subject = new rxjs_1.Subject();
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
                };
            });
        },
        subscription(dest, kind, message = {}) {
            return new rxjs_1.Observable(observer => {
                const transaction = uuid();
                const subject = new rxjs_1.Subject();
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
                        key: exports.ChatterUnsubscribeMessageKey,
                        data: { subscriptionId: transaction }
                    });
                    delete state.pendingSubscriptions[transaction];
                    sub.unsubscribe();
                    subject.unsubscribe();
                };
            });
        }
    };
}
exports.createGossipNode = createGossipNode;
