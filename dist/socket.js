"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("./models");
const rxjs_1 = require("rxjs");
const utils_1 = require("./utils");
const operators_1 = require("rxjs/operators");
const topo_1 = require("./topo");
const CHATTER_UNSUBSCRIBE = "__chatterUnsubscribe";
const CHATTER_DISCOVERY_OUT = "__chatterDiscoveryOut";
const CHATTER_DISCOVERY_IN = "__chatterDiscoveryIn";
const sockets = {};
class ChatterSocket {
    constructor(address, settings) {
        this.address = address;
        this.settings = settings;
        const net = {};
        net[address] = [];
        this.network = new rxjs_1.BehaviorSubject(net);
        this.sourceBuffer = {};
        this.destinationPushBuffer = {};
        this.destinationRequestBuffer = {};
        this.destinationSubscriptionBuffer = {};
        this.subscriptionHandlers = {};
        this.requestHandlers = {};
        this.pushHandlers = {};
        this.openConsumers = {};
        this.openProducers = {};
        this.peers = {};
    }
    broadcastPush(key, message = {}) {
        const transaction = utils_1.uuid();
        this.broadcast({
            header: {
                id: utils_1.uuid(),
                protocol: models_1.NetProto.BROADCAST,
                source: this.address
            },
            body: {
                header: {
                    key: key,
                    protocol: models_1.AppProto.PUSH,
                    source: this.address,
                    transaction: transaction,
                },
                body: message
            }
        });
    }
    close() {
        this.network.complete();
        if (this.allSubscriptions) {
            this.allSubscriptions.unsubscribe();
        }
        for (let k in this.openProducers) {
            const producer = this.openProducers[k];
            producer.unsubscribe();
        }
        for (let k in this.openConsumers) {
            const consumer = this.openConsumers[k];
            if (!consumer.successInProgress) {
                consumer.error({ message: "Socket closed!" });
            }
        }
        delete sockets[this.address];
    }
    discover() {
        return this.network;
    }
    handlePushes(key, callback) {
        this.handlePushesPacket(key, msg => callback(msg.body));
    }
    handleRequests(key, callback) {
        this.handleRequestsPacket(key, msg => callback(msg.body));
    }
    handleSubscriptions(key, callback) {
        this.handleSubscriptionsPacket(key, msg => callback(msg.body));
    }
    handlePushesPacket(key, callback) {
        this.pushHandlers[key] = callback;
        this.processPushBuffer(key);
    }
    handleRequestsPacket(key, callback) {
        this.requestHandlers[key] = msg => callback(msg).pipe(operators_1.first());
        this.processRequestBuffer(key);
    }
    handleSubscriptionsPacket(key, callback) {
        this.subscriptionHandlers[key] = callback;
        this.processSubscriptionBuffer(key);
    }
    push(address, key, message = {}) {
        const transaction = utils_1.uuid();
        this.send({
            header: {
                key: key,
                protocol: models_1.AppProto.PUSH,
                source: this.address,
                target: address,
                transaction: transaction,
            },
            body: message
        });
    }
    requestPacket(address, key, message = {}) {
        const transaction = utils_1.uuid();
        const observable = new rxjs_1.Observable(observer => {
            this.openConsumers[transaction] = observer;
            this.send({
                header: {
                    key: key,
                    protocol: models_1.AppProto.REQUEST,
                    source: this.address,
                    target: address,
                    transaction: transaction,
                },
                body: message
            });
            return () => {
                delete this.openConsumers[transaction];
                this.push(address, CHATTER_UNSUBSCRIBE, { transaction: transaction });
            };
        });
        return this.monkeyPatchObservableSubscribe(transaction, observable);
    }
    subscriptionPacket(address, key, message = {}) {
        const transaction = utils_1.uuid();
        const observable = new rxjs_1.Observable(observer => {
            this.openConsumers[transaction] = observer;
            this.send({
                header: {
                    key: key,
                    protocol: models_1.AppProto.SUBSCRIPTION,
                    source: this.address,
                    target: address,
                    transaction: transaction,
                },
                body: message
            });
            return () => {
                delete this.openConsumers[transaction];
                this.push(address, CHATTER_UNSUBSCRIBE, { transaction: transaction });
            };
        });
        return this.monkeyPatchObservableSubscribe(transaction, observable);
    }
    unhandlePushes(key) {
        delete this.pushHandlers[key];
    }
    unhandleRequests(key) {
        delete this.requestHandlers[key];
    }
    unhandleSubscriptions(key) {
        delete this.subscriptionHandlers[key];
    }
    handleInboundPushMessage(message) {
        if (this.pushHandlers[message.body.header.key]) {
            const handler = this.pushHandlers[message.body.header.key];
            handler(message.body);
            return true;
        }
        else {
            return false;
        }
    }
    handleIncomingResponsiveMessage(message, handlers) {
        if (handlers.hasOwnProperty(message.body.header.key)) {
            const handler = handlers[message.body.header.key];
            const responseStream = (() => {
                try {
                    return handler(message.body);
                }
                catch (error) {
                    // send an error message
                    return new rxjs_1.Observable(observer => {
                        observer.error(error);
                    });
                }
            })();
            this.openProducers[message.body.header.transaction] = responseStream.subscribe(response => {
                this.send({
                    header: {
                        transaction: message.body.header.transaction,
                        key: message.body.header.key,
                        protocol: message.body.header.protocol,
                        next: true,
                        error: false,
                        complete: false,
                        source: this.address,
                        target: message.body.header.source
                    },
                    body: response
                });
            }, error => {
                this.send({
                    header: {
                        transaction: message.body.header.transaction,
                        key: message.body.header.key,
                        protocol: message.body.header.protocol,
                        next: false,
                        error: true,
                        complete: false,
                        source: this.address,
                        target: message.body.header.source
                    },
                    body: error
                });
            }, () => {
                this.send({
                    header: {
                        transaction: message.body.header.transaction,
                        key: message.body.header.key,
                        protocol: message.body.header.protocol,
                        next: false,
                        error: false,
                        complete: true,
                        source: this.address,
                        target: message.body.header.source
                    },
                    body: null
                });
            });
            return true;
        }
        return false;
    }
    handleInboundRequestMessage(message) {
        return this.handleIncomingResponsiveMessage(message, this.requestHandlers);
    }
    handleInboundSubscriptionMessage(message) {
        return this.handleIncomingResponsiveMessage(message, this.subscriptionHandlers);
    }
    handleInboundMessage(message) {
        const dispatch = {};
        dispatch[models_1.AppProto.SUBSCRIPTION] = this.handleInboundSubscriptionMessage.bind(this);
        dispatch[models_1.AppProto.REQUEST] = this.handleInboundRequestMessage.bind(this);
        dispatch[models_1.AppProto.PUSH] = this.handleInboundPushMessage.bind(this);
        return dispatch[message.body.header.protocol](message);
    }
    consumeInboundMessage(message) {
        if (this.openProducers.hasOwnProperty(message.body.header.transaction)) {
            return true;
        }
        if (this.openConsumers.hasOwnProperty(message.body.header.transaction)) {
            const consumer = this.openConsumers[message.body.header.transaction];
            const appPacket = message.body;
            const appHeader = appPacket.header;
            if (appHeader.next) {
                consumer.next(appPacket);
            }
            else if (appHeader.error) {
                consumer.error(appPacket.body);
            }
            else if (appHeader.complete) {
                consumer.complete();
            }
            return true;
        }
        return false;
    }
    broadcastInboundMessage(message) {
        const newHeader = Object.assign({}, message.header, {
            id: utils_1.uuid(),
            source: this.address
        });
        const newPacket = Object.assign({}, message, { header: newHeader });
        this.broadcast(newPacket);
    }
    processPushBuffer(key) {
        const messages = this.destinationPushBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationPushBuffer[key];
    }
    processRequestBuffer(key) {
        const messages = this.destinationRequestBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationRequestBuffer[key];
    }
    processSubscriptionBuffer(key) {
        const messages = this.destinationSubscriptionBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationSubscriptionBuffer[key];
    }
    bufferInboundMessage(message) {
        if (message.body.header.protocol === models_1.AppProto.PUSH) {
            this.destinationPushBuffer[message.body.header.key] = this.destinationPushBuffer[message.body.header.key] || [];
            this.destinationPushBuffer[message.body.header.key].push(message);
        }
        else if (message.body.header.protocol === models_1.AppProto.REQUEST) {
            this.destinationRequestBuffer[message.body.header.key] = this.destinationRequestBuffer[message.body.header.key] || [];
            this.destinationRequestBuffer[message.body.header.key].push(message);
        }
        else if (message.body.header.protocol === models_1.AppProto.SUBSCRIPTION) {
            this.destinationSubscriptionBuffer[message.body.header.key] = this.destinationSubscriptionBuffer[message.body.header.key] || [];
            this.destinationSubscriptionBuffer[message.body.header.key].push(message);
        }
    }
    forwardInboundMessage(message) {
        this.send(message.body);
    }
    receiveIncomingMessage(message) {
        if (message.body.header.target === this.address || message.header.protocol === models_1.NetProto.BROADCAST) {
            if (!this.consumeInboundMessage(message)) {
                if (!this.handleInboundMessage(message)) {
                    if (message.header.protocol === models_1.NetProto.POINT_TO_POINT) {
                        this.bufferInboundMessage(message);
                    }
                }
            }
        }
        if (message.body.header.target !== this.address && message.header.protocol === models_1.NetProto.BROADCAST) {
            this.broadcastInboundMessage(message);
        }
        if (message.body.header.target !== this.address && message.header.protocol === models_1.NetProto.POINT_TO_POINT) {
            this.forwardInboundMessage(message);
        }
    }
    bind() {
        this.allSubscriptions = new rxjs_1.Subscription();
        this.handlePushes(CHATTER_DISCOVERY_IN, msg => {
            const current = utils_1.clone(this.network.getValue());
            const merged = utils_1.mergeNetworks(current, msg.network);
            this.network.next(merged);
        });
        this.handlePushesPacket(CHATTER_DISCOVERY_OUT, (msg) => {
            this.push(msg.header.source, CHATTER_DISCOVERY_IN, { network: this.network.getValue() });
        });
        this.handlePushes(CHATTER_UNSUBSCRIBE, (msg) => {
            const transaction = msg.transaction;
            if (this.openProducers[transaction]) {
                this.openProducers[transaction].unsubscribe();
                delete this.openProducers[transaction];
            }
        });
        this.allSubscriptions.add(this.incomingMessages().subscribe(msg => this.receiveIncomingMessage(msg)));
        this.broadcastPush(CHATTER_DISCOVERY_OUT, { network: this.network.getValue() });
        this.allSubscriptions.add(this.network.pipe(operators_1.distinctUntilChanged(utils_1.deepEquals)).subscribe(changedNetwork => {
            for (let k in this.sourceBuffer) {
                if (changedNetwork.hasOwnProperty(k)) {
                    const messages = utils_1.clone(this.sourceBuffer[k]);
                    messages.forEach(msg => this.send(msg));
                    delete this.sourceBuffer[k];
                }
            }
            this.broadcastPush(CHATTER_DISCOVERY_IN, { network: changedNetwork });
        }));
    }
    monkeyPatchObservableSubscribe(transaction, observable) {
        const originalSubscribe = observable.subscribe;
        const modifiedSubscribe = (originalNext, error, complete) => {
            if (!(typeof originalNext === 'function')) {
                const next = originalNext.next;
                if (next) {
                    const modifiedNext = value => {
                        const consumer = this.openConsumers[transaction];
                        consumer.successInProgress = true;
                        const returnValue = next.bind(originalNext)(value);
                        consumer.successInProgress = false;
                        return returnValue;
                    };
                    originalNext.next = modifiedNext;
                }
                return originalSubscribe.apply(observable, [originalNext]);
            }
            else {
                const args = [];
                if (originalNext) {
                    const modifiedNext = value => {
                        const consumer = this.openConsumers[transaction];
                        consumer.successInProgress = true;
                        const returnValue = originalNext(value);
                        consumer.successInProgress = false;
                        return returnValue;
                    };
                    args.push(modifiedNext);
                }
                if (error) {
                    args.push(error);
                }
                if (complete) {
                    args.push(complete);
                }
                return originalSubscribe.apply(observable, args);
            }
        };
        observable.subscribe = modifiedSubscribe;
        return observable;
    }
    send(message) {
        const net = this.network.getValue();
        const path = topo_1.shortestPath(net, this.address, message.header.target);
        if (path.length >= 2) {
            const nextHop = path[1];
            const netPacket = {
                header: {
                    id: utils_1.uuid(),
                    source: this.address,
                    protocol: models_1.NetProto.POINT_TO_POINT,
                    target: nextHop
                },
                body: message
            };
            for (let k in this.peers[message.header.target]) {
                const edge = this.peers[message.header.target][k];
                edge(netPacket);
            }
        }
        else {
            this.sourceBuffer[message.header.target] = this.sourceBuffer[message.header.target] || [];
            this.sourceBuffer[message.header.target].push(message);
        }
    }
    broadcast(message) {
        this.sendToLocalBus(message);
        this.sendToParentFrame(message);
        this.sendToChildIframes(message);
        this.sendToChromeRuntime(message);
        this.sendToActiveChromeTab(message);
    }
    isTrustedOrigin(origin) {
        return this.settings.trustedOrigins.has(origin) || this.settings.trustedOrigins.has("*");
    }
    registerPeer(packet, edgeId, respond) {
        const peer = packet.header.source;
        this.peers = this.peers || {};
        this.peers[peer] = this.peers[peer] || {};
        this.peers[peer][edgeId] = this.peers[peer][edgeId] || respond;
        const network = utils_1.clone(this.network.getValue());
        if (peer !== this.address) {
            if (network[this.address].indexOf(peer) === -1) {
                network[this.address].push(peer);
            }
        }
        if (!network.hasOwnProperty(peer)) {
            network[peer] = [this.address];
        }
        this.network.next(network);
    }
    listenToLocalMessages() {
        return new rxjs_1.Observable(observer => {
            const sub = models_1._localMessageBus.subscribe(packet => {
                if (utils_1.looksLikeValidPacket(packet)) {
                    this.registerPeer(packet, "local::bus", this.sendToLocalBus.bind(this));
                    observer.next(packet);
                }
            });
            return () => {
                sub.unsubscribe();
            };
        });
    }
    listenToFrameMessages() {
        return new rxjs_1.Observable(observer => {
            const listener = (event) => {
                if (this.isTrustedOrigin(event.origin)) {
                    const message = event.data;
                    if (utils_1.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `window::${event.origin}`, msg => {
                            event.source.postMessage(msg, event.origin);
                        });
                        observer.next(message);
                    }
                }
            };
            if (models_1._window && models_1._window.addEventListener) {
                models_1._window.addEventListener("message", listener);
            }
            return () => {
                if (models_1._window && models_1._window.removeEventListener) {
                    models_1._window.removeEventListener("message", listener);
                }
            };
        });
    }
    incomingMessages() {
        return rxjs_1.merge(this.listenToChromeMessages(), this.listenToFrameMessages(), this.listenToLocalMessages())
            .pipe(operators_1.filter(msg => msg.header.source !== this.address), operators_1.filter(msg => msg.body.header.source !== this.address));
    }
    listenToChromeMessages() {
        return new rxjs_1.Observable(observer => {
            const listener = (message, sender) => {
                const origin = `chrome-extension://${sender.id}`;
                if (this.isTrustedOrigin(origin)) {
                    if (utils_1.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chrome::${origin}`, this.sendToChromeRuntime);
                        observer.next(message);
                    }
                }
            };
            if (models_1._chrome && models_1._chrome.runtime && models_1._chrome.runtime.onMessage && models_1._chrome.runtime.onMessage.addListener) {
                models_1._chrome.runtime.onMessage.addListener(listener);
            }
            return () => {
                if (models_1._chrome && models_1._chrome.runtime && models_1._chrome.runtime.onMessage && models_1._chrome.runtime.onMessage.removeListener) {
                    models_1._chrome.runtime.onMessage.removeListener(listener);
                }
            };
        });
    }
    sendToParentFrame(message) {
        if (models_1._window && models_1._window.parent && models_1._window.parent !== models_1._window) {
            this.settings.trustedOrigins.forEach(origin => {
                models_1._window.parent.postMessage(message, origin);
            });
        }
    }
    sendToLocalBus(message) {
        if (models_1._localMessageBus && !models_1._localMessageBus.closed) {
            models_1._localMessageBus.next(message);
        }
    }
    sendToChildIframes(message) {
        const getIframes = () => {
            return Array.from(models_1._document.getElementsByTagName('iframe'));
        };
        const send = () => {
            getIframes().forEach(frame => {
                this.settings.trustedOrigins.forEach(origin => {
                    frame.contentWindow.postMessage(message, origin);
                });
            });
        };
        if (!models_1._document || models_1._document.readyState === 'loading') {
            if (models_1._window && models_1._window.addEventListener) {
                models_1._window.addEventListener('DOMContentLoaded', send);
            }
        }
        else {
            send();
        }
    }
    sendToChromeRuntime(message) {
        if (models_1._chrome && models_1._chrome.runtime && models_1._chrome.runtime.id && models_1._chrome.runtime.sendMessage) {
            models_1._chrome.runtime.sendMessage(models_1._chrome.runtime.id, message);
        }
    }
    sendToActiveChromeTab(message) {
        if (models_1._chrome && models_1._chrome.tabs && models_1._chrome.tabs.query) {
            models_1._chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (tabs.length) {
                    models_1._chrome.tabs.sendMessage(tabs[0].id, message);
                }
            });
        }
    }
    request(address, key, message) {
        return this.requestPacket(address, key, message).pipe(operators_1.map(msg => msg.body));
    }
    subscription(address, key, message) {
        return this.subscriptionPacket(address, key, message).pipe(operators_1.map(msg => msg.body));
    }
}
exports.ChatterSocket = ChatterSocket;
function bind(name, settings = models_1.defaultSettings()) {
    if (sockets[name]) {
        return sockets[name];
    }
    else {
        const socket = new ChatterSocket(name, settings);
        sockets[name] = socket;
        socket.bind();
        return socket;
    }
}
exports.bind = bind;
