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
const ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";
const ChatterNodeJoinedKey = "_ChatterNodeJoined";
const ChatterWildcardTarget = "*";
const _global = window;
const _chrome = _global.chrome;
const _window = _global.window;
const _document = _global.document;
const _localMessageBus = new rxjs_1.Subject();
function defaultSettings() {
    return {
        verbose: false,
        originVerifier: _ => true
    };
}
function emptyBrokerState(location) {
    return {
        location: location,
        peers: new rxjs_1.BehaviorSubject(new Set()),
        outboundBuffer: {},
        inboundPushBuffer: {},
        inboundRequestBuffer: {},
        inboundSubscriptionBuffer: {},
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
    const keys = ["id", "protocol", "source", "target", "key", "data"];
    return keys.every(key => message.hasOwnProperty(key));
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
        else if (settings.verbose) {
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
function union(s1, s2) {
    const results = new Set();
    s1.forEach(x => results.add(x));
    s2.forEach(x => results.add(x));
    return results;
}
exports.union = union;
function difference(s1, s2) {
    const results = new Set();
    s1.forEach(s => {
        if (!s2.has(s)) {
            results.add(s);
        }
    });
    return s1;
}
exports.difference = difference;
function createGossipNode(location, settings = {}) {
    settings = Object.assign(defaultSettings(), settings);
    const state = emptyBrokerState(location);
    state.peers.pipe(operators_1.pairwise()).subscribe(([s1, s2]) => {
        difference(s2, s1).forEach(x => {
            if (state.outboundBuffer[x]) {
                state.outboundBuffer[x].forEach(msg => send(msg));
                delete state.outboundBuffer[x];
            }
            if (state.outboundBuffer[ChatterWildcardTarget]) {
                state.outboundBuffer[ChatterWildcardTarget].forEach(msg => send(msg));
            }
        });
    });
    const send = (msg) => {
        state.seen.add(computeMessageHash(msg));
        const knownTargets = state.peers.getValue();
        if (msg.target === state.location) {
            return;
        }
        if (msg.target === ChatterWildcardTarget) {
            broadcast(settings, msg);
            return;
        }
        if (knownTargets.has(msg.target)) {
            broadcast(settings, msg);
            return;
        }
        else {
            const buffer = state.outboundBuffer[msg.target] || [];
            buffer.push(msg);
            state.outboundBuffer[msg.target] = buffer;
        }
    };
    const receive = (message) => {
        if (quacksLikeAGossipPacket(message)) {
            const packet = message;
            if (packet.source === state.location) {
                return;
            }
            const hash = computeMessageHash(message);
            if (!state.seen.has(hash)) {
                state.seen.add(hash);
                const knownTargets = state.peers.getValue();
                if (!knownTargets.has(packet.source)) {
                    const seen = union(knownTargets, new Set([packet.source]));
                    state.peers.next(seen);
                }
                if (packet.target === ChatterWildcardTarget || packet.target === state.location) {
                    if (packet.protocol === MessageProtocol.REQUEST_REPLY) {
                        if (state.pendingRequests[packet.id]) {
                            const subject = state.pendingRequests[packet.id];
                            if (!subject.closed) {
                                subject.next(packet);
                            }
                            else if (settings.verbose) {
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
                            else if (settings.verbose) {
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
                            const buffer = state.inboundPushBuffer[packet.key] || [];
                            buffer.push(packet);
                            state.inboundPushBuffer[packet.key] = buffer;
                        }
                        return;
                    }
                    if (packet.protocol === MessageProtocol.REQUEST_REPLY) {
                        const handler = state.requestListeners[packet.key];
                        if (handler) {
                            const responseObservable = handler(packet.data);
                            state.openProducers[packet.id] = responseObservable.pipe(operators_1.first()).subscribe(response => {
                                send({
                                    id: packet.id,
                                    key: packet.key,
                                    protocol: packet.protocol,
                                    source: state.location,
                                    target: packet.source,
                                    data: response
                                });
                            });
                        }
                        else {
                            const buffer = state.inboundRequestBuffer[packet.key] || [];
                            buffer.push(packet);
                            state.inboundRequestBuffer[packet.key] = buffer;
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
                                    source: state.location,
                                    target: packet.source,
                                    data: response
                                });
                            });
                        }
                        else {
                            const buffer = state.inboundSubscriptionBuffer[packet.key] || [];
                            buffer.push(packet);
                            state.inboundSubscriptionBuffer[packet.key] = buffer;
                        }
                    }
                }
                if (packet.target !== state.location) {
                    send(packet);
                }
            }
        }
    };
    if (_localMessageBus) {
        _localMessageBus.subscribe(receive);
    }
    if (_window && _window.addEventListener) {
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
    const pushRaw = (dest, kind, message = {}) => {
        send({
            id: uuid(),
            protocol: MessageProtocol.PUSH,
            source: state.location,
            target: dest,
            key: kind,
            data: message
        });
    };
    const requestRaw = (dest, kind, message = {}) => {
        return new rxjs_1.Observable(observer => {
            const transaction = uuid();
            const subject = new rxjs_1.Subject();
            state.pendingRequests[transaction] = subject;
            const sub = subject.subscribe(result => {
                observer.next(result);
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
                send({
                    id: uuid(),
                    protocol: MessageProtocol.PUSH,
                    source: state.location,
                    target: dest,
                    key: ChatterUnsubscribeMessageKey,
                    data: { providerId: transaction }
                });
                delete state.pendingRequests[transaction];
                sub.unsubscribe();
                subject.unsubscribe();
            };
        });
    };
    const subscriptionRaw = (dest, kind, message = {}) => {
        return new rxjs_1.Observable(observer => {
            const transaction = uuid();
            const subject = new rxjs_1.Subject();
            state.pendingSubscriptions[transaction] = subject;
            const sub = subject.subscribe(result => {
                observer.next(result);
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
                    data: { providerId: transaction }
                });
                delete state.pendingSubscriptions[transaction];
                sub.unsubscribe();
                subject.unsubscribe();
            };
        });
    };
    const resubmit = (msg) => {
        state.seen.delete(computeMessageHash(msg));
        receive(msg);
    };
    const broker = {
        push(dest, kind, message = {}) {
            pushRaw(dest, kind, message);
        },
        request(dest, kind, message = {}) {
            return requestRaw(dest, kind, message).pipe(operators_1.map(msg => msg.data));
        },
        subscription(dest, kind, message = {}) {
            return subscriptionRaw(dest, kind, message).pipe(operators_1.map(msg => msg.data));
        },
        broadcastPush(kind, message = {}) {
            pushRaw(ChatterWildcardTarget, kind, message);
        },
        broadcastRequest(kind, message = {}) {
            return requestRaw(ChatterWildcardTarget, kind, message).pipe(operators_1.map(msg => {
                return { location: msg.source, data: msg.data };
            }));
        },
        broadcastSubscription(kind, message = {}) {
            return subscriptionRaw(ChatterWildcardTarget, kind, message).pipe(operators_1.map(msg => {
                return { location: msg.source, data: msg.data };
            }));
        },
        handlePushes(kind, handler) {
            state.pushListeners[kind] = handler;
            (state.inboundPushBuffer[kind] || []).forEach(result => {
                resubmit(result);
            });
            delete state.inboundPushBuffer[kind];
        },
        handleRequests(kind, handler) {
            state.requestListeners[kind] = handler;
            (state.inboundRequestBuffer[kind] || []).forEach(result => {
                resubmit(result);
            });
            delete state.inboundRequestBuffer[kind];
        },
        handleSubscriptions(kind, handler) {
            state.subscriptionListeners[kind] = handler;
            (state.inboundSubscriptionBuffer[kind] || []).forEach(result => {
                resubmit(result);
            });
            delete state.inboundSubscriptionBuffer[kind];
        }
    };
    broker.handlePushes(ChatterUnsubscribeMessageKey, msg => {
        if (msg.providerId) {
            const subject = state.openProducers[msg.providerId];
            delete state.openProducers[msg.providerId];
            if (subject) {
                subject.unsubscribe();
            }
        }
    });
    broker.handleSubscriptions(ChatterNodeJoinedKey, msg => {
        return new rxjs_1.Observable(observer => {
            const sub = state.peers.subscribe(peers => {
                observer.next(peers);
            });
            return () => {
                sub.unsubscribe();
            };
        });
    });
    broker.broadcastSubscription(ChatterNodeJoinedKey).subscribe(peerPeers => {
        const friendsOfKevinBacon = union(new Set(peerPeers.data), new Set([peerPeers.location]));
        const friendsOfMine = state.peers.getValue();
        const reachable = union(friendsOfMine, friendsOfKevinBacon);
        if (reachable.size > friendsOfMine.size) {
            state.peers.next(reachable);
        }
    });
    return broker;
}
exports.createGossipNode = createGossipNode;
