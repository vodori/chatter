import {_chrome, _document, _localMessageBus, _window, AppPacket, AppProto, defaultSettings, NetPacket, NetProto, Network, Settings, Socket} from "./models";
import {BehaviorSubject, merge, Observable, Observer, Subscription} from "rxjs";
import {clone, deepEquals, looksLikeValidPacket, mergeNetworks, uuid} from "./utils";
import {distinctUntilChanged, filter, first} from "rxjs/operators";
import {shortestPath} from "./topo";

const CHATTER_UNSUBSCRIBE = "_chatter_Unsubscribe";
const CHATTER_DISCOVERY = "_chatter_NETWORK";


const sockets: {[s:string]: Socket} = {};

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

    constructor(private address: string, private settings: Settings) {
        const net = {};
        net[address] = [];
        this.network = new BehaviorSubject(net);
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

    broadcastPush(key: string, message?: any): void {
        const transaction = uuid();

        this.broadcast({
            header: {
                id: uuid(),
                protocol: NetProto.BROADCAST,
                source: this.address
            },
            body: {
                header: {
                    key: key,
                    protocol: AppProto.PUSH,
                    source: this.address,
                    transaction: transaction,
                },
                body: message
            }
        });
    }

    broadcastRequest(key: string, message?: any): Observable<AppPacket> {
        return new Observable(observer => {

            const transaction = uuid();
            this.openConsumers[transaction] = observer;

            this.broadcast({
                header: {
                    id: uuid(),
                    protocol: NetProto.BROADCAST,
                    source: this.address
                },
                body: {
                    header: {
                        key: key,
                        protocol: AppProto.REQUEST,
                        source: this.address,
                        transaction: transaction,
                    },
                    body: message
                }
            });

            return () => {
                delete this.openConsumers[transaction];
                this.broadcastPush(CHATTER_UNSUBSCRIBE, {transaction: transaction});
            }
        });
    }

    broadcastSubscription(key: string, message: any = {}): Observable<AppPacket> {
        return new Observable(observer => {

            const transaction = uuid();
            this.openConsumers[transaction] = observer;

            this.broadcast({
                header: {
                    id: uuid(),
                    protocol: NetProto.BROADCAST,
                    source: this.address
                },
                body: {
                    header: {
                        key: key,
                        protocol: AppProto.SUBSCRIPTION,
                        source: this.address,
                        transaction: transaction,
                    },
                    body: message
                }
            });

            return () => {
                delete this.openConsumers[transaction];
                this.broadcastPush(CHATTER_UNSUBSCRIBE, {transaction: transaction});
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

        delete sockets[this.address];
    }

    discover(): Observable<Network> {
        return this.network;
    }

    handlePushes(key: string, callback: (msg: AppPacket) => void): void {
        this.pushHandlers[key] = callback;
        this.processPushBuffer(key);
    }

    handleRequests(key: string, callback: (msg: AppPacket) => Observable<any>): void {
        this.requestHandlers[key] = msg => callback(msg).pipe(first());
        this.processRequestBuffer(key);
    }

    handleSubscriptions(key: string, callback: (msg: AppPacket) => Observable<any>): void {
        this.subscriptionHandlers[key] = callback;
        this.processSubscriptionBuffer(key);
    }

    push(address: string, key: string, message?: any): void {
        const transaction = uuid();
        this.send({
            header: {
                key: key,
                protocol: AppProto.PUSH,
                source: this.address,
                target: address,
                transaction: transaction,
            },
            body: message
        });
    }

    request(address: string, key: string, message?: any): Observable<AppPacket> {
        const transaction = uuid();

        const observable = new Observable(observer => {
            this.openConsumers[transaction] = observer;

            this.send({
                header: {
                    key: key,
                    protocol: AppProto.REQUEST,
                    source: this.address,
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

        const originalSubscribe = observable.subscribe.bind(observable);
        const modifiedSubscribe = (originalNext, error, complete) => {
            const args = [];
            if (originalNext) {
                const modifiedNext = value => {
                    const consumer = this.openConsumers[transaction];
                    (<any>consumer).successInProgress = true;
                    const returnValue = originalNext(value);
                    (<any>consumer).successInProgress = false;
                    return returnValue;
                };
                args.push(modifiedNext.bind(observable));
            }
            if (error) {
                args.push(error);
            }
            if (complete) {
                args.push(complete);
            }
            return originalSubscribe.apply(observable, args);
        };

        observable.subscribe = <any>modifiedSubscribe;

        return <any>observable;
    }

    subscription(address: string, key: string, message?: any): Observable<AppPacket> {
        return new Observable(observer => {
            const transaction = uuid();
            this.openConsumers[transaction] = observer;

            this.send({
                header: {
                    key: key,
                    protocol: AppProto.SUBSCRIPTION,
                    source: this.address,
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
            const handler = this.pushHandlers[message.body.header.key];
            handler(message.body);
            return true;
        } else {
            return false;
        }
    }

    handleIncomingResponsiveMessage(message: NetPacket, handlers: { [s: string]: (msg: AppPacket) => Observable<any> }): boolean {
        if (handlers.hasOwnProperty(message.body.header.key)) {
            const handler = handlers[message.body.header.key];

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

    broadcastInboundMessage(message: NetPacket) {
        const newHeader = Object.assign({}, message.header, {
            id: uuid(),
            source: this.address
        });
        const newPacket = Object.assign({}, message, {header: newHeader});
        this.broadcast(newPacket);
    }

    processPushBuffer(key:string) {
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
        if (message.body.header.target === this.address || message.header.protocol === NetProto.BROADCAST) {
            if (!this.consumeInboundMessage(message)) {
                if (!this.handleInboundMessage(message)) {
                    if(message.header.protocol === NetProto.POINT_TO_POINT) {
                        this.bufferInboundMessage(message);
                    }
                }
            }
        }

        if (message.body.header.target !== this.address && message.header.protocol === NetProto.BROADCAST) {
            this.broadcastInboundMessage(message);
        }

        if (message.body.header.target !== this.address && message.header.protocol === NetProto.POINT_TO_POINT) {
            this.forwardInboundMessage(message);
        }
    }

    bind(): void {

        this.allSubscriptions = new Subscription();

        this.handleSubscriptions(CHATTER_DISCOVERY, (msg: AppPacket) => {
            // this.allSubscriptions.add(this.subscription(msg.header.source, CHATTER_DISCOVERY).subscribe(network => {
            //     const updatedNetwork = mergeNetworks(clone(this.network.getValue()), network.body);
            //     this.network.next(updatedNetwork);
            // }));
            return this.network.pipe(distinctUntilChanged(deepEquals));
        });

        this.handlePushes(CHATTER_UNSUBSCRIBE, (msg: AppPacket) => {
            const transaction = msg.body.transaction;
            if (this.openProducers[transaction]) {
                this.openProducers[transaction].unsubscribe();
                delete this.openProducers[transaction];
            }
        });

        this.allSubscriptions.add(this.incomingMessages().subscribe(msg => this.receiveIncomingMessage(msg)));

        this.allSubscriptions.add(this.broadcastSubscription(CHATTER_DISCOVERY).subscribe(response => {
            const updatedNetwork = mergeNetworks(clone(this.network.getValue()), response.body);
            this.network.next(updatedNetwork);
        }));

        this.allSubscriptions.add(this.network.pipe(distinctUntilChanged(deepEquals)).subscribe(changedNetwork => {
            for (let k in this.sourceBuffer) {
                if (changedNetwork.hasOwnProperty(k)) {
                    const messages = clone(this.sourceBuffer[k]);
                    messages.forEach(msg => this.send(msg));
                    delete this.sourceBuffer[k];
                }
            }
        }));
    }


    send(message: AppPacket): void {

        const net = this.network.getValue();
        const path = shortestPath(net, this.address, message.header.target);

        if (path.length >= 2) {

            const nextHop = path[1];

            const netPacket: NetPacket = {
                header: {
                    id: uuid(),
                    source: this.address,
                    protocol: NetProto.POINT_TO_POINT,
                    target: nextHop
                },
                body: message
            };

            for (let k in this.peers[message.header.target]) {
                const edge = this.peers[message.header.target][k];
                edge(netPacket);
            }

        } else {
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
        return this.settings.trustedOrigins.has(origin) || this.settings.trustedOrigins.has("*");
    }

    registerPeer(packet: NetPacket, edgeId: string, respond: (msg: any) => void): void {
        const peer = packet.header.source;
        this.peers = this.peers || {};
        this.peers[peer] = this.peers[peer] || {};
        this.peers[peer][edgeId] = this.peers[peer][edgeId] || respond;

        const network = clone(this.network.getValue());

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


    listenToLocalMessages(): Observable<NetPacket> {
        return new Observable(observer => {

            const sub = _localMessageBus.subscribe(packet => {
                if (looksLikeValidPacket(packet)) {
                    this.registerPeer(packet, "local::bus", this.sendToLocalBus.bind(this));
                    observer.next(packet);
                }
            });

            return () => {
                sub.unsubscribe();
            }
        });
    }

    listenToFrameMessages(): Observable<NetPacket> {
        return new Observable<NetPacket>(observer => {
            const listener = (event: MessageEvent) => {
                if (this.isTrustedOrigin(event.origin)) {
                    const message = event.data;
                    if (looksLikeValidPacket(message)) {
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
        return merge(this.listenToChromeMessages(),
            this.listenToFrameMessages(),
            this.listenToLocalMessages())
            .pipe(filter(msg => msg.header.source !== this.address),
                filter(msg => msg.body.header.source !== this.address));
    }

    listenToChromeMessages(): Observable<NetPacket> {
        return new Observable<NetPacket>(observer => {

            const listener: any = (message: any, sender) => {
                const origin = `chrome-extension://${sender.id}`;
                if (this.isTrustedOrigin(origin)) {
                    if (looksLikeValidPacket(message)) {
                        this.registerPeer(message, `chrome::${origin}`, this.sendToChromeRuntime);
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
        if (_window && _window.parent && _window.parent !== _window) {
            this.settings.trustedOrigins.forEach(origin => {
                _window.parent.postMessage(message, origin);
            });
        }
    }

    sendToLocalBus(message: any): void {
        if (_localMessageBus && !_localMessageBus.closed) {
            _localMessageBus.next(message);
        }
    }

    sendToChildIframes(message: any): void {
        const getIframes = (): HTMLIFrameElement[] => {
            return Array.from(_document.getElementsByTagName('iframe'));
        };

        const send = () => {
            getIframes().forEach(frame => {
                this.settings.trustedOrigins.forEach(origin => {
                    frame.contentWindow.postMessage(message, origin);
                });
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

    sendToChromeRuntime(message: any): void {
        if (_chrome && _chrome.runtime && _chrome.runtime.id && _chrome.runtime.sendMessage) {
            _chrome.runtime.sendMessage(_chrome.runtime.id, message);
        }
    }

    sendToActiveChromeTab(message: any): void {
        if (_chrome && _chrome.tabs && _chrome.tabs.query) {
            _chrome.tabs.query({active: true, currentWindow: true}, tabs => {
                if (tabs.length) {
                    _chrome.tabs.sendMessage(tabs[0].id, message);
                }
            });
        }
    }


}

export function bind(name: string, settings: Settings = defaultSettings()): Socket {
    if(sockets[name]) {
        return sockets[name];
    } else {
        const socket = new ChatterSocket(name, settings);
        sockets[name] = socket;
        socket.bind();
        return socket;
    }
}