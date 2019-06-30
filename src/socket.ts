import {_chrome, _document, _localMessageBus, _window, AppPacket, AppProto, defaultSettings, NetPacket, NetProto, Network, Settings, Socket} from "./models";
import {BehaviorSubject, EMPTY, merge, Observable, Observer, Subscription} from "rxjs";
import {clone, deepEquals, isObject, prettyPrint, uuid} from "./utils";
import {debounceTime, distinctUntilChanged, filter, first, map} from "rxjs/operators";
import {mergeNetworks, normalizeNetwork, shortestPath} from "./topo";

const CHATTER_UNSUBSCRIBE = "__chatterUnsubscribe";
const CHATTER_DISCOVERY = "__chatterDiscovery";


const sockets: { [s: string]: Socket } = {};

export class ChatterSocket implements Socket {

    openProducers: { [s: string]: Subscription };
    allSubscriptions: Subscription;
    network: BehaviorSubject<Network>;
    sourceBuffer: { [s: string]: AppPacket[] };
    destinationPushBuffer: { [s: string]: NetPacket[] };
    destinationRequestBuffer: { [s: string]: NetPacket[] };
    destinationSubscriptionBuffer: { [s: string]: NetPacket[] };
    pushHandlers: { [s: string]: (msg: AppPacket) => void };
    requestHandlers: { [s: string]: (msg: AppPacket) => Observable<any> };
    subscriptionHandlers: { [s: string]: (msg: AppPacket) => Observable<any> };
    peers: { [s: string]: { [s: string]: (msg: NetPacket) => void } };
    openConsumers: { [s: string]: Observer<AppPacket> };
    cleanups: (() => void)[];

    constructor(private _address: string, private settings: Settings) {
        const net = {};
        net[_address] = [];
        this.network = new BehaviorSubject(net);
        const original = this.network.next.bind(this.network);
        this.network.next = v => {
            original(normalizeNetwork(v));
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
        this.cleanups = [];
    }


    startDebugMode() {
        const sub = this.network.pipe(debounceTime(5000), distinctUntilChanged(deepEquals)).subscribe(net => {
            this.logMessage(() => {
                console.log(`The network for node ${this.address()}`);
                console.log(prettyPrint(net));
            });
        });

        this.cleanups.push(() => sub.unsubscribe());
    }

    address(): string {
        return this._address;
    }

    broadcastPush(key: string, message: any = {}): void {
        const transaction = uuid();

        this.broadcast({
            header: {
                id: uuid(),
                protocol: NetProto.BROADCAST,
                source: this._address
            },
            body: {
                header: {
                    key: key,
                    protocol: AppProto.PUSH,
                    source: this._address,
                    transaction: transaction,
                },
                body: message
            }
        });
    }


    close(): void {

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
            if (!(<any>consumer).successInProgress) {
                consumer.error({message: "Socket closed!"});
            }
        }

        this.cleanups.forEach(cleanup => cleanup());

        delete sockets[this._address];
    }

    discover(): Observable<Network> {
        return this.network;
    }

    handlePushes(key: string, callback: (msg: any) => void): void {
        this.handlePushesPacket(key, msg => callback(msg.body));
    }

    handleRequests(key: string, callback: (msg: any) => Observable<any>): void {
        this.handleRequestsPacket(key, msg => callback(msg.body));
    }

    handleSubscriptions(key: string, callback: (msg: any) => Observable<any>): void {
        this.handleSubscriptionsPacket(key, msg => callback(msg.body));
    }

    handlePushesPacket(key: string, callback: (msg: AppPacket) => void): void {
        this.pushHandlers[key] = callback;
        this.processPushBuffer(key);
    }

    handleRequestsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void {
        this.requestHandlers[key] = msg => callback(msg).pipe(first());
        this.processRequestBuffer(key);
    }

    handleSubscriptionsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void {
        this.subscriptionHandlers[key] = callback;
        this.processSubscriptionBuffer(key);
    }

    push(address: string, key: string, message: any = {}): void {
        const transaction = uuid();
        this.send({
            header: {
                key: key,
                protocol: AppProto.PUSH,
                source: this._address,
                target: address,
                transaction: transaction,
            },
            body: message
        });
    }

    requestPacket(address: string, key: string, message: any = {}): Observable<AppPacket> {
        const transaction = uuid();

        const observable = new Observable(observer => {
            this.openConsumers[transaction] = observer;

            this.send({
                header: {
                    key: key,
                    protocol: AppProto.REQUEST,
                    source: this._address,
                    target: address,
                    transaction: transaction,
                },
                body: message
            });

            return () => {
                delete this.openConsumers[transaction];
                this.push(address, CHATTER_UNSUBSCRIBE, {transaction: transaction});
            }
        });

        return this.monkeyPatchObservableSubscribe(transaction, observable);
    }

    subscriptionPacket(address: string, key: string, message: any = {}): Observable<AppPacket> {
        const transaction = uuid();

        const observable = new Observable(observer => {
            this.openConsumers[transaction] = observer;

            this.send({
                header: {
                    key: key,
                    protocol: AppProto.SUBSCRIPTION,
                    source: this._address,
                    target: address,
                    transaction: transaction,
                },
                body: message
            });

            return () => {
                delete this.openConsumers[transaction];
                this.push(address, CHATTER_UNSUBSCRIBE, {transaction: transaction});
            }
        });

        return this.monkeyPatchObservableSubscribe(transaction, observable);
    }

    unhandlePushes(key: string): void {
        delete this.pushHandlers[key];
    }

    unhandleRequests(key: string): void {
        delete this.requestHandlers[key];
    }

    unhandleSubscriptions(key: string): void {
        delete this.subscriptionHandlers[key];
    }

    handleInboundPushMessage(message: NetPacket): boolean {
        if (this.pushHandlers[message.body.header.key]) {

            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Handling ${message.body.header.protocol} message from ${message.body.header.source} of type ${message.body.header.key}`);
                    console.log(prettyPrint(message.body.body));
                });
            }

            const handler = this.pushHandlers[message.body.header.key];
            handler(message.body);
            return true;
        } else {
            return false;
        }
    }


    logMessage(callback) {
        const header = `=====${this.address()}=====`;
        let footer = "";
        for (let i = 0; i < header.length; i++) {
            footer += "=";
        }
        console.log(header);
        callback();
        console.log(footer);
        console.log("");
    }


    handleIncomingResponsiveMessage(message: NetPacket, handlers: { [s: string]: (msg: AppPacket) => Observable<any> }): boolean {
        if (handlers.hasOwnProperty(message.body.header.key)) {
            const handler = handlers[message.body.header.key];

            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Handling ${message.body.header.protocol} message from ${message.body.header.source} of type ${message.body.header.key}`);
                    console.log(prettyPrint(message.body.body));
                });
            }

            const responseStream = (() => {
                try {
                    return handler(message.body)
                } catch (error) {
                    // send an error message
                    return new Observable(observer => {
                        observer.error(error);
                    })
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
                })
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

    handleInboundRequestMessage(message: NetPacket): boolean {
        return this.handleIncomingResponsiveMessage(message, this.requestHandlers);
    }

    handleInboundSubscriptionMessage(message: NetPacket): boolean {
        return this.handleIncomingResponsiveMessage(message, this.subscriptionHandlers);
    }

    handleInboundMessage(message: NetPacket): boolean {
        const dispatch = {};
        dispatch[AppProto.SUBSCRIPTION] = this.handleInboundSubscriptionMessage.bind(this);
        dispatch[AppProto.REQUEST] = this.handleInboundRequestMessage.bind(this);
        dispatch[AppProto.PUSH] = this.handleInboundPushMessage.bind(this);
        return dispatch[message.body.header.protocol](message);
    }

    consumeInboundMessage(message: NetPacket): boolean {


        if (this.openProducers.hasOwnProperty(message.body.header.transaction)) {
            return true;
        }

        if (this.openConsumers.hasOwnProperty(message.body.header.transaction)) {
            const consumer = this.openConsumers[message.body.header.transaction];
            const appPacket = message.body;
            const appHeader = appPacket.header;
            if (appHeader.next) {
                consumer.next(appPacket);
            } else if (appHeader.error) {
                consumer.error(appPacket.body);
            } else if (appHeader.complete) {
                consumer.complete();
            }

            return true;
        }

        return false;
    }

    processPushBuffer(key: string) {
        const messages = this.destinationPushBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationPushBuffer[key];
    }

    processRequestBuffer(key: string) {
        const messages = this.destinationRequestBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationRequestBuffer[key];
    }

    processSubscriptionBuffer(key: string) {
        const messages = this.destinationSubscriptionBuffer[key] || [];
        messages.forEach(msg => this.receiveIncomingMessage(msg));
        delete this.destinationSubscriptionBuffer[key];
    }

    bufferInboundMessage(message: NetPacket) {
        if (message.body.header.protocol === AppProto.PUSH) {
            this.destinationPushBuffer[message.body.header.key] = this.destinationPushBuffer[message.body.header.key] || [];
            this.destinationPushBuffer[message.body.header.key].push(message);
        } else if (message.body.header.protocol === AppProto.REQUEST) {
            this.destinationRequestBuffer[message.body.header.key] = this.destinationRequestBuffer[message.body.header.key] || [];
            this.destinationRequestBuffer[message.body.header.key].push(message);
        } else if (message.body.header.protocol === AppProto.SUBSCRIPTION) {
            this.destinationSubscriptionBuffer[message.body.header.key] = this.destinationSubscriptionBuffer[message.body.header.key] || [];
            this.destinationSubscriptionBuffer[message.body.header.key].push(message);
        }
    }

    forwardInboundMessage(message: NetPacket) {
        this.send(message.body);
    }

    receiveIncomingMessage(message: NetPacket) {

        if (message.body.header.target === this._address || message.header.protocol === NetProto.BROADCAST) {
            if (!this.consumeInboundMessage(message)) {
                if (!this.handleInboundMessage(message)) {
                    if (message.header.protocol === NetProto.POINT_TO_POINT) {
                        this.bufferInboundMessage(message);
                    }
                }
            }
        }

        if (message.body.header.target !== this._address && message.header.protocol === NetProto.POINT_TO_POINT) {
            this.forwardInboundMessage(message);
        }
    }

    bind(): void {

        this.allSubscriptions = new Subscription();

        this.handlePushes(CHATTER_DISCOVERY, msg => {
            const current = clone(this.network.getValue());
            const merged = mergeNetworks(current, msg.network);
            this.network.next(merged);
        });

        this.handlePushes(CHATTER_UNSUBSCRIBE, (msg: any) => {
            const transaction = msg.transaction;
            if (this.openProducers[transaction]) {
                this.openProducers[transaction].unsubscribe();
                delete this.openProducers[transaction];
            }
        });

        this.allSubscriptions.add(this.incomingMessages().subscribe(msg => this.receiveIncomingMessage(msg)));

        this.broadcastPush(CHATTER_DISCOVERY, {network: this.network.getValue()});

        this.allSubscriptions.add(this.network.pipe(distinctUntilChanged(deepEquals)).subscribe(changedNetwork => {
            for (let k in this.sourceBuffer) {
                if (changedNetwork.hasOwnProperty(k)) {
                    const messages = clone(this.sourceBuffer[k]);
                    this.sourceBuffer[k] = [];
                    messages.forEach(msg => this.send(msg));
                }
            }

            this.getPeers().forEach(peer => {
                this.push(peer, CHATTER_DISCOVERY, {network: changedNetwork});
            });
        }));

        if (this.settings.debug) {
            this.startDebugMode();
        }
    }

    getPeers(): Set<string> {
        const peers = new Set<string>();
        Object.keys(this.peers).forEach(peer => {
            peers.add(peer);
        });
        peers.delete(this._address);
        return peers;
    }

    monkeyPatchObservableSubscribe(transaction, observable: Observable<any>): Observable<any> {

        const originalSubscribe = observable.subscribe;

        const modifiedSubscribe = (originalNext, error, complete) => {

            if (!(typeof originalNext === 'function')) {
                const next = originalNext.next;
                if (next) {
                    const modifiedNext = value => {
                        const consumer = this.openConsumers[transaction];
                        (<any>consumer).successInProgress = true;
                        const returnValue = next.bind(originalNext)(value);
                        (<any>consumer).successInProgress = false;
                        return returnValue;
                    };
                    originalNext.next = modifiedNext;
                }

                return originalSubscribe.apply(observable, [originalNext]);
            } else {

                const args = [];

                if (originalNext) {
                    const modifiedNext = value => {
                        const consumer = this.openConsumers[transaction];
                        (<any>consumer).successInProgress = true;
                        const returnValue = originalNext(value);
                        (<any>consumer).successInProgress = false;
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

        observable.subscribe = <any>modifiedSubscribe;

        return <any>observable;
    }


    send(message: AppPacket): void {
        if (message.header.source === message.header.target) {
            this.logMessage(() => {
                console.error("You tried to send a packet to yourself.");
            });
            return;
        }

        const net = this.network.getValue();
        const path = shortestPath(net, this._address, message.header.target);

        if (path.length >= 2) {

            const nextHop = path[1];

            const netPacket: NetPacket = {
                header: {
                    id: uuid(),
                    source: this._address,
                    protocol: NetProto.POINT_TO_POINT,
                    target: nextHop
                },
                body: message
            };

            for (let k in this.peers[nextHop]) {
                if (this.peers[nextHop].hasOwnProperty(k)) {
                    const edge = this.peers[nextHop][k];
                    edge(netPacket);
                }
            }

        } else {
            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log("Outbound message buffered because next hop could not be determined yet.");
                    console.log(prettyPrint(message));
                });
            }
            this.sourceBuffer[message.header.target] = this.sourceBuffer[message.header.target] || [];
            this.sourceBuffer[message.header.target].push(message);
        }
    }


    broadcast(message: NetPacket): void {
        this.sendToLocalBus(message);
        this.sendToParentFrame(message);
        this.sendToChildIframes(message);
        this.sendToChromeRuntime(message);
        this.sendToActiveChromeTab(message);
    }


    isTrustedOrigin(origin: string): boolean {
        if (this.settings.trustedOrigins.has("*")) {
            return true;
        }
        if (this.settings.trustedOrigins.has(origin) || this.settings.isTrustedOrigin(origin)) {
            this.settings.trustedOrigins.add(origin);
            return true;
        }
        return false;
    }

    registerPeer(packet: NetPacket, edgeId: string, respond: (msg: any) => void): void {
        const peer = packet.header.source;
        this.peers = this.peers || {};

        if (!this.peers.hasOwnProperty(peer)) {

            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Learned of a new peer ${peer}.`);
                });
            }

            this.peers[peer] = this.peers[peer] || {};
        }

        if (!this.peers[peer].hasOwnProperty(edgeId)) {

            if (this.settings.debug) {
                this.logMessage(() => {
                    console.log(`Learned of a new edge ${edgeId} for peer ${peer}`);
                });
            }

            this.peers[peer][edgeId] = respond;

            const network = clone(this.network.getValue());

            if (peer !== this._address) {
                if (network[this._address].indexOf(peer) === -1) {
                    network[this._address].push(peer);
                }
            }

            if (!network.hasOwnProperty(peer)) {
                network[peer] = [this._address];
            }

            if (!deepEquals(network, this.network.getValue())) {
                this.network.next(network);
            }

        }
    }


    listenToLocalMessages(): Observable<NetPacket> {
        if (!this.settings.allowLocalBus) {
            return EMPTY;
        }

        return new Observable(observer => {

            const sub = _localMessageBus.subscribe(packet => {
                if (this.looksLikeValidPacket(packet)) {
                    this.registerPeer(packet, "local::bus", this.sendToLocalBus.bind(this));
                    observer.next(packet);
                }
            });

            return () => {
                sub.unsubscribe();
            }
        });
    }

    listenToParentFrameMessages(): Observable<NetPacket> {
        if (!this.settings.allowParentIframe) {
            return EMPTY;
        }

        return new Observable<NetPacket>(observer => {
            const listener = (event: MessageEvent) => {
                const isMyParent = event.source === window.parent && window.parent !== window;
                if (this.isTrustedOrigin(event.origin) && isMyParent) {
                    const message = event.data;
                    if (this.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `window::${event.origin}`, msg => {
                            (<any>event.source).postMessage(msg, event.origin);
                        });
                        observer.next(message)
                    }
                }
            };
            if (_window && _window.addEventListener) {
                _window.addEventListener("message", listener);
            }
            return () => {
                if (_window && _window.removeEventListener) {
                    _window.removeEventListener("message", listener);
                }
            }
        });
    }

    listenToChildFrameMessages(): Observable<NetPacket> {
        if (!this.settings.allowChildIframes) {
            return EMPTY;
        }

        return new Observable<NetPacket>(observer => {
            const listener = (event: MessageEvent) => {
                const isChild = event.source !== window.parent && event.source !== window;
                if (this.isTrustedOrigin(event.origin) && isChild) {
                    const message = event.data;
                    if (this.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `window::${event.origin}`, msg => {
                            (<any>event.source).postMessage(msg, event.origin);
                        });
                        observer.next(message)
                    }
                }
            };
            if (_window && _window.addEventListener) {
                _window.addEventListener("message", listener);
            }
            return () => {
                if (_window && _window.removeEventListener) {
                    _window.removeEventListener("message", listener);
                }
            }
        });
    }

    incomingMessages(): Observable<NetPacket> {

        return merge(this.listenToMessagesFromChromeRuntime(),
            this.listenToMessagesFromChromeTabs(),
            this.listenToChildFrameMessages(),
            this.listenToParentFrameMessages(),
            this.listenToLocalMessages())
            .pipe(filter(msg => msg.header.source !== this._address),
                filter(msg => msg.body.header.source !== this._address),
                filter(msg => this.isTrustedSocket(msg.header.source)),
                filter(msg => msg.header.target === this._address || msg.header.protocol === NetProto.BROADCAST));
    }

    listenToMessagesFromChromeRuntime(): Observable<NetPacket> {
        if (!this.settings.allowChromeRuntime) {
            return EMPTY;
        }
        return new Observable<NetPacket>(observer => {
            const listener: any = (message: any, sender: any) => {
                const origin = `chrome-extension://${sender.id}`;
                if (!sender.tab && this.isTrustedOrigin(origin)) {

                    if (this.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chromeRuntime::${origin}`, msg => {
                            this.sendToChromeRuntime(msg);
                        });
                        observer.next(message);
                    }
                }
            };

            if (_chrome && _chrome.runtime && _chrome.runtime.onMessage && _chrome.runtime.onMessage.addListener) {
                _chrome.runtime.onMessage.addListener(listener);
            }

            return () => {
                if (_chrome && _chrome.runtime && _chrome.runtime.onMessage && _chrome.runtime.onMessage.removeListener) {
                    _chrome.runtime.onMessage.removeListener(listener);
                }
            }
        })
    }

    listenToMessagesFromChromeTabs(): Observable<NetPacket> {
        if (!this.settings.allowChromeActiveTab) {
            return EMPTY;
        }
        return new Observable<NetPacket>(observer => {
            const listener: any = (message: any, sender: any) => {
                const cameFromActiveContentScript = (sender.tab && sender.tab.active);
                if (cameFromActiveContentScript) {
                    const origin = `chrome-extension://${sender.id}`;
                    if (this.isTrustedOrigin(origin) && this.looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chromeTab::${sender.tab.id}`, msg => {
                            _chrome.tabs.sendMessage(sender.tab.id, msg);
                        });
                        observer.next(message);
                    }
                }
            };

            if (_chrome && _chrome.runtime && _chrome.runtime.onMessage && _chrome.runtime.onMessage.addListener) {
                _chrome.runtime.onMessage.addListener(listener);
            }

            return () => {
                if (_chrome && _chrome.runtime && _chrome.runtime.onMessage && _chrome.runtime.onMessage.removeListener) {
                    _chrome.runtime.onMessage.removeListener(listener);
                }
            }
        })
    }

    sendToParentFrame(message: any): void {
        if (_window && _window.parent && _window.parent !== _window && this.settings.allowParentIframe) {
            this.settings.trustedOrigins.forEach(origin => {
                try {
                    _window.parent.postMessage(message, origin);
                } catch (e) {

                }
            });
        }
    }

    sendToLocalBus(message: any): void {
        if (_localMessageBus && !_localMessageBus.closed && this.settings.allowLocalBus) {
            _localMessageBus.next(message);
        }
    }

    sendToChildIframes(message: any): void {
        if (this.settings.allowChildIframes) {
            const getIframes = (): HTMLIFrameElement[] => {
                return Array.from(_document.getElementsByTagName('iframe')).filter(frame => {
                    return !!frame.src
                });
            };

            const send = () => {
                getIframes().forEach(frame => {
                    try {
                        const url = new URL(frame.src);
                        if (this.settings.trustedOrigins.has("*")) {
                            frame.contentWindow.postMessage(message, "*");
                        } else if (this.settings.trustedOrigins.has(url.origin)) {
                            frame.contentWindow.postMessage(message, url.origin);
                        } else if (this.settings.isTrustedOrigin(url.origin)) {
                            this.settings.trustedOrigins.add(url.origin);
                            frame.contentWindow.postMessage(message, url.origin);
                        }
                    } catch (e) {

                    }
                });
            };

            if (!_document || _document.readyState === 'loading') {
                if (_window && _window.addEventListener) {
                    _window.addEventListener('DOMContentLoaded', send);
                }
            } else {
                send();
            }
        }
    }

    sendToChromeRuntime(message: any): void {
        if (this.supportsRuntime() && this.settings.allowChromeRuntime) {
            _chrome.runtime.sendMessage(message);
        }
    }

    supportsRuntime(): boolean {
        return _chrome && _chrome.runtime && !!_chrome.runtime.sendMessage;
    }

    supportsTabs(): boolean {
        return _chrome && _chrome.tabs && !!_chrome.tabs.query;
    }

    sendToActiveChromeTab(message: any): void {
        if (this.supportsTabs() && this.settings.allowChromeActiveTab) {
            _chrome.tabs.query({active: true, currentWindow: true}, tabs => {
                if (tabs.length) {
                    _chrome.tabs.sendMessage(tabs[0].id, message);
                }
            });
        }
    }

    request(address: string, key: string, message?: any): Observable<any> {
        return this.requestPacket(address, key, message).pipe(map(msg => msg.body));
    }

    subscription(address: string, key: string, message?: any): Observable<any> {
        return this.subscriptionPacket(address, key, message).pipe(map(msg => msg.body));
    }

    isTrustedSocket(address: string) {
        if (this.settings.trustedSockets.has("*")) {
            return true;
        }
        if (this.settings.trustedSockets.has(address) || this.settings.isTrustedSocket(address)) {
            this.settings.trustedSockets.add(address);
            return true;
        }
        return false;
    }

    looksLikeValidPacket(msg: any) {
        return isObject(msg) &&
            msg.hasOwnProperty("header") &&
            msg.hasOwnProperty("body") &&
            this.isTrustedSocket(msg.header.source);
    }

}

export function getAllSockets(): Socket[] {
    const socks = [];
    for (let k in sockets) {
        const sock = sockets[k];
        socks.push(sock);
    }
    return socks;
}

export function closeAllSockets(): void {
    getAllSockets().forEach(sock => sock.close());
}

export function bind(name: string, settings: Settings = {}): Socket {
    if (sockets[name]) {
        return sockets[name];
    } else {
        const socket = new ChatterSocket(name, Object.assign(defaultSettings(), settings));
        sockets[name] = socket;
        socket.bind();
        return socket;
    }
}