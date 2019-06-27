"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("./models");
const rxjs_1 = require("rxjs");
const utils_1 = require("./utils");
const operators_1 = require("rxjs/operators");
const topo_1 = require("./topo");
const CHATTER_UNSUBSCRIBE = "__chatterUnsubscribe";
const CHATTER_DISCOVERY = "__chatterDiscovery";
const sockets = {};
class ChatterSocket {
    constructor(_address, settings) {
        this._address = _address;
        this.settings = settings;
        const net = {};
        net[_address] = [];
        this.network = new rxjs_1.BehaviorSubject(net);
        const original = this.network.next.bind(this.network);
        this.network.next = v => {
            original(topo_1.normalizeNetwork(v));
        };
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
        this.ignoredTransactionMessages = new Set();
        this.cleanups = [];
    }
    startDebugMode() {
        const sub = this.network.pipe(operators_1.debounceTime(5000), operators_1.distinctUntilChanged(utils_1.deepEquals)).subscribe(net => {
            this.logMessage(() => {
                console.log(`The network for node ${this.address()}`);
                console.log(utils_1.prettyPrint(net));
            });
        });
        this.cleanups.push(() => sub.unsubscribe());
    }
    address() {
        return this._address;
    }
    broadcastPush(key, message = {}) {
        const transaction = utils_1.uuid();
        this.broadcast({
            header: {
                id: utils_1.uuid(),
                protocol: models_1.NetProto.BROADCAST,
                source: this._address
            },
            body: {
                header: {
                    key: key,
                    protocol: models_1.AppProto.PUSH,
                    source: this._address,
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
        this.cleanups.forEach(cleanup => cleanup());
        delete sockets[this._address];
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
                source: this._address,
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
                    source: this._address,
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
                    source: this._address,
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
            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Handling ${message.body.header.protocol} message of type ${message.body.header.key}`);
                    console.log(utils_1.prettyPrint(message.body.body));
                });
            }
            const handler = this.pushHandlers[message.body.header.key];
            handler(message.body);
            return true;
        }
        else {
            return false;
        }
    }
    logMessage(callback) {
        const addressLength = this.address().length;
        let footer = "";
        for (let i = 0; i < addressLength + 10; i++) {
            footer += "=";
        }
        console.log(`=====${this.address()}=====`);
        callback();
        console.log(footer);
        console.log("");
    }
    handleIncomingResponsiveMessage(message, handlers) {
        if (handlers.hasOwnProperty(message.body.header.key)) {
            const handler = handlers[message.body.header.key];
            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Handling ${message.body.header.protocol} message of type ${message.body.header.key}`);
                    console.log(utils_1.prettyPrint(message.body.body));
                });
            }
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
                        source: this._address,
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
                        source: this._address,
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
                        source: this._address,
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
            source: this._address
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
    ignoreTransaction(transactionId) {
        this.ignoredTransactionMessages.add(transactionId);
        setTimeout(() => this.ignoredTransactionMessages.delete(transactionId), 5000);
    }
    isIgnoredTransaction(transactionId) {
        return this.ignoredTransactionMessages.has(transactionId);
    }
    receiveIncomingMessage(message) {
        if (message.body.header.target === this._address || message.header.protocol === models_1.NetProto.BROADCAST) {
            if (!this.consumeInboundMessage(message)) {
                if (!this.handleInboundMessage(message)) {
                    if (message.header.protocol === models_1.NetProto.POINT_TO_POINT) {
                        this.bufferInboundMessage(message);
                    }
                }
            }
        }
        if (message.body.header.target !== this._address && message.header.protocol === models_1.NetProto.BROADCAST) {
            this.ignoreTransaction(message.body.header.transaction);
            this.broadcastInboundMessage(message);
        }
        if (message.body.header.target !== this._address && message.header.protocol === models_1.NetProto.POINT_TO_POINT) {
            this.forwardInboundMessage(message);
        }
    }
    bind() {
        this.allSubscriptions = new rxjs_1.Subscription();
        this.handlePushes(CHATTER_DISCOVERY, msg => {
            const current = utils_1.clone(this.network.getValue());
            const merged = topo_1.mergeNetworks(current, msg.network);
            this.network.next(merged);
        });
        this.handlePushes(CHATTER_UNSUBSCRIBE, (msg) => {
            const transaction = msg.transaction;
            if (this.openProducers[transaction]) {
                this.openProducers[transaction].unsubscribe();
                delete this.openProducers[transaction];
            }
        });
        this.allSubscriptions.add(this.incomingMessages().subscribe(msg => this.receiveIncomingMessage(msg)));
        this.broadcastPush(CHATTER_DISCOVERY, { network: this.network.getValue() });
        this.allSubscriptions.add(this.network.pipe(operators_1.distinctUntilChanged(utils_1.deepEquals)).subscribe(changedNetwork => {
            for (let k in this.sourceBuffer) {
                if (changedNetwork.hasOwnProperty(k)) {
                    const messages = utils_1.clone(this.sourceBuffer[k]);
                    messages.forEach(msg => this.send(msg));
                    delete this.sourceBuffer[k];
                }
            }
            this.broadcastPush(CHATTER_DISCOVERY, { network: changedNetwork });
        }));
        if (this.settings.debug) {
            this.startDebugMode();
        }
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
        const path = topo_1.shortestPath(net, this._address, message.header.target);
        if (path.length >= 2) {
            const nextHop = path[1];
            const netPacket = {
                header: {
                    id: utils_1.uuid(),
                    source: this._address,
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
            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log("Outbound message buffered because next hop could not be determined yet.");
                    console.log(utils_1.prettyPrint(message.body));
                });
            }
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
        if (this.settings.trustedOrigins.has("*")) {
            return true;
        }
        if (this.settings.trustedOrigins.has(origin) || this.settings.isTrustedOrigin(origin)) {
            this.settings.trustedOrigins.add(origin);
            return true;
        }
        return false;
    }
    registerPeer(packet, edgeId, respond) {
        const peer = packet.header.source;
        this.peers = this.peers || {};
        this.peers[peer] = this.peers[peer] || {};
        this.peers[peer][edgeId] = this.peers[peer][edgeId] || respond;
        const network = utils_1.clone(this.network.getValue());
        if (peer !== this._address) {
            if (network[this._address].indexOf(peer) === -1) {
                network[this._address].push(peer);
            }
        }
        if (!network.hasOwnProperty(peer)) {
            network[peer] = [this._address];
        }
        this.network.next(network);
    }
    listenToLocalMessages() {
        if (!this.settings.allowLocalBus) {
            return rxjs_1.EMPTY;
        }
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
    listenToParentFrameMessages() {
        if (!this.settings.allowParentIframe) {
            return rxjs_1.EMPTY;
        }
        return new rxjs_1.Observable(observer => {
            const listener = (event) => {
                const isMyParent = event.source === window.parent && window.parent !== window;
                if (this.isTrustedOrigin(event.origin) && isMyParent) {
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
    listenToChildFrameMessages() {
        if (!this.settings.allowChildIframes) {
            return rxjs_1.EMPTY;
        }
        return new rxjs_1.Observable(observer => {
            const listener = (event) => {
                const isChild = event.source !== window.parent && event.source !== window;
                console.log(event.source, event.source === window, event.source === window.parent);
                if (this.isTrustedOrigin(event.origin) && isChild) {
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
        return rxjs_1.merge(this.listenToMessagesFromChromeRuntime(), this.listenToMessagesFromChromeTabs(), this.listenToChildFrameMessages(), this.listenToParentFrameMessages(), this.listenToLocalMessages())
            .pipe(operators_1.filter(msg => msg.header.source !== this._address), operators_1.filter(msg => msg.body.header.source !== this._address), operators_1.filter(msg => msg.header.target === this._address || msg.header.protocol === models_1.NetProto.BROADCAST), operators_1.filter(msg => !this.isIgnoredTransaction(msg.body.header.transaction)));
    }
    isIframeContext() {
        return !!models_1._window && !!models_1._window.parent && models_1._window.parent !== models_1._window;
    }
    isChromeContentScriptContext() {
        return !!models_1._chrome && !!models_1._chrome.runtime && !models_1._chrome.tabs;
    }
    isChromeBackgroundScriptContext() {
        return !!models_1._chrome && !!models_1._chrome.runtime && !!models_1._chrome.tabs;
    }
    listenToMessagesFromChromeRuntime() {
        if (!this.settings.allowChromeRuntime) {
            return rxjs_1.EMPTY;
        }
        return new rxjs_1.Observable(observer => {
            const listener = (message, sender) => {
                const origin = `chrome-extension://${sender.id}`;
                if (!sender.tab && this.isTrustedOrigin(origin)) {
                    if (utils_1.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chromeRuntime::${origin}`, msg => {
                            this.sendToChromeRuntime(msg);
                        });
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
    listenToMessagesFromChromeTabs() {
        if (!this.settings.allowChromeActiveTab) {
            return rxjs_1.EMPTY;
        }
        return new rxjs_1.Observable(observer => {
            const listener = (message, sender) => {
                const origin = `chrome-extension://${sender.id}`;
                const cameFromActiveContentScript = (sender.tab && sender.tab.active);
                if (cameFromActiveContentScript && this.isTrustedOrigin(origin)) {
                    if (utils_1.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chromeTab::${origin}`, msg => {
                            this.sendToActiveChromeTab(msg);
                        });
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
        if (models_1._window && models_1._window.parent && models_1._window.parent !== models_1._window && this.settings.allowParentIframe) {
            this.settings.trustedOrigins.forEach(origin => {
                try {
                    models_1._window.parent.postMessage(message, origin);
                }
                catch (e) {
                }
            });
        }
    }
    sendToLocalBus(message) {
        if (models_1._localMessageBus && !models_1._localMessageBus.closed && this.settings.allowLocalBus) {
            models_1._localMessageBus.next(message);
        }
    }
    sendToChildIframes(message) {
        if (this.settings.allowChildIframes) {
            const getIframes = () => {
                return Array.from(models_1._document.getElementsByTagName('iframe'));
            };
            const send = () => {
                getIframes().forEach(frame => {
                    this.settings.trustedOrigins.forEach(origin => {
                        try {
                            frame.contentWindow.postMessage(message, origin);
                        }
                        catch (e) {
                        }
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
    }
    sendToChromeRuntime(message) {
        if (this.supportsRuntime() && this.settings.allowChromeRuntime) {
            models_1._chrome.runtime.sendMessage(message);
        }
    }
    supportsRuntime() {
        return models_1._chrome && models_1._chrome.runtime && !!models_1._chrome.runtime.sendMessage;
    }
    supportsTabs() {
        return models_1._chrome && models_1._chrome.tabs && !!models_1._chrome.tabs.query;
    }
    sendToActiveChromeTab(message) {
        if (this.supportsTabs() && this.settings.allowChromeActiveTab) {
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
function getAllSockets() {
    const socks = [];
    for (let k in sockets) {
        const sock = sockets[k];
        socks.push(sock);
    }
    return socks;
}
exports.getAllSockets = getAllSockets;
function closeAllSockets() {
    getAllSockets().forEach(sock => sock.close());
}
exports.closeAllSockets = closeAllSockets;
function bind(name, settings = {}) {
    if (sockets[name]) {
        return sockets[name];
    }
    else {
        const socket = new ChatterSocket(name, Object.assign(models_1.defaultSettings(), settings));
        sockets[name] = socket;
        socket.bind();
        return socket;
    }
}
exports.bind = bind;
