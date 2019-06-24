import {_chrome, _document, _localMessageBus, _window, AppPacket, AppProto, defaultSettings, NetPacket, NetProto, Network, Settings, Socket} from "./models";
import {BehaviorSubject, merge, Observable, Observer, Subscription} from "rxjs";
import {clone, deepEquals, looksLikeValidPacket, mergeNetworks, uuid} from "./utils";
import {distinctUntilChanged, filter} from "rxjs/operators";
import {shortestPath} from "./topo";

export class ChatterSocket implements Socket {

    openProducers: { [s: string]: Subscription };
    allSubscriptions: Subscription;
    network: BehaviorSubject<Network>;
    subscriptionHandlers: { [s: string]: (msg: AppPacket) => Observable<any> };
    peers: { [s: string]: { [s: string]: (msg: NetPacket) => void } };
    openConsumers: { [s: string]: Observer<AppPacket> };

    constructor(private address: string, private settings: Settings) {
        const net = {};
        net[address] = [];
        this.network = new BehaviorSubject(net);
        this.subscriptionHandlers = {};
        this.openConsumers = {};
        this.openProducers = {};
        this.peers = {};
    }

    broadcastPush(key: string, message?: any): void {
    }

    broadcastRequest(key: string, message?: any): Observable<AppPacket> {
        return undefined;
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
                this.broadcastPush("_chatter_Unsubscribe", {transaction: transaction});
            }
        });
    }

    close(): void {
        if (this.allSubscriptions) {
            this.allSubscriptions.unsubscribe();
        }
    }

    discover(): Observable<Network> {
        return this.network;
    }

    handlePushes(key: string, callback: (msg: AppPacket) => void): void {

    }

    handleRequests(key: string, callback: (msg: AppPacket) => Observable<any>): void {

    }

    handleSubscriptions(key: string, callback: (msg: AppPacket) => Observable<any>): void {
        this.subscriptionHandlers[key] = callback;
    }

    push(address: string, key: string, message?: any): void {

    }

    request(address: string, key: string, message?: any): Observable<AppPacket> {
        return undefined;
    }

    subscription(address: string, key: string, message?: any): Observable<AppPacket> {
        return undefined;
    }

    unhandlePushes(key: string): void {
    }

    unhandleRequests(key: string): void {
    }

    unhandleSubscriptions(key: string): void {

    }

    handleInboundPushMessage(message: NetPacket) {

    }

    handleInboundRequestMessage(message: NetPacket) {

    }

    handleInboundSubscriptionMessage(message: NetPacket) {

        if (this.subscriptionHandlers.hasOwnProperty(message.body.header.key)) {
            const handler = this.subscriptionHandlers[message.body.header.key];

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

                const net = this.network.getValue();
                const path = shortestPath(net, this.address, message.body.header.source);
                const nextHop = path[1];
                const outboundPacket = {
                    header: {
                        id: uuid(),
                        protocol: NetProto.POINT_TO_POINT,
                        source: this.address,
                        target: nextHop
                    },
                    body: {
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
                    }
                };

                this.send(outboundPacket);
            }, error => {
                const net = this.network.getValue();
                const path = shortestPath(net, this.address, message.body.header.source);
                const nextHop = path[1];
                this.send({
                    header: {
                        id: uuid(),
                        protocol: NetProto.POINT_TO_POINT,
                        source: this.address,
                        target: nextHop
                    },
                    body: {
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
                    }
                })
            }, () => {
                const net = this.network.getValue();
                const path = shortestPath(net, this.address, message.body.header.source);
                const nextHop = path[1];
                this.send({
                    header: {
                        id: uuid(),
                        protocol: NetProto.POINT_TO_POINT,
                        source: this.address,
                        target: nextHop
                    },
                    body: {
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
                    }
                })
            });
        }
    }

    handleInboundMessage(message: NetPacket) {
        const dispatch = {};
        dispatch[AppProto.SUBSCRIPTION] = this.handleInboundSubscriptionMessage.bind(this);
        dispatch[AppProto.REQUEST] = this.handleInboundRequestMessage.bind(this);
        dispatch[AppProto.PUSH] = this.handleInboundPushMessage.bind(this);
        dispatch[message.body.header.protocol](message);
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

    forwardInboundMessage(message: NetPacket) {
        const net = this.network.getValue();
        const source = this.address;
        const target = message.body.header.target;
        const path = shortestPath(net, source, target);
        const nextHop = path[1];
        this.send({
            header: {
                id: uuid(),
                protocol: NetProto.POINT_TO_POINT,
                source: this.address,
                target: nextHop
            },
            body: message.body
        });
    }

    bind(): void {

        this.allSubscriptions = new Subscription();

        this.handleSubscriptions("_chatter_NETWORK", (msg: AppPacket) => {
            // this.allSubscriptions.add(this.subscription("_chatter_NETWORK", msg.header.source).subscribe(network => {
            //     const updatedNetwork = mergeNetworks(clone(this.network.getValue()), network.body);
            //     this.network.next(updatedNetwork);
            // }));
            return this.network.pipe(distinctUntilChanged(deepEquals));
        });

        this.handlePushes("_chatter_Unsubscribe", (msg: AppPacket) => {
            const transaction = msg.body.transaction;
            if (this.openProducers[transaction]) {
                this.openProducers[transaction].unsubscribe();
                delete this.openProducers[transaction];
            }
        });

        this.allSubscriptions.add(this.broadcastSubscription("_chatter_NETWORK").subscribe(response => {
            console.log("received a response!!!!");
            const updatedNetwork = mergeNetworks(clone(this.network.getValue()), response.body);
            this.network.next(updatedNetwork);
        }));

        this.allSubscriptions.add(this.incomingMessages().subscribe((message: NetPacket) => {

            if (message.body.header.target === this.address || message.header.protocol === NetProto.BROADCAST) {
                if (!this.consumeInboundMessage(message)) {
                    this.handleInboundMessage(message);
                }
            }

            if (message.body.header.target !== this.address && message.header.protocol === NetProto.BROADCAST) {
                this.broadcastInboundMessage(message);
            }

            if (message.body.header.target !== this.address && message.header.protocol === NetProto.POINT_TO_POINT) {
                this.forwardInboundMessage(message);
            }

        }));

    }


    send(message: NetPacket): void {
        if (!this.peers[message.header.target]) {
            console.error(`Your target is not one of my peers`, message);
            throw new Error(`Your target is not one of my peers ${JSON.stringify(message)}`);
        }

        for (let k in this.peers[message.header.target]) {
            const edge = this.peers[message.header.target][k];
            edge(message);
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

        if(peer !== this.address) {
            if (network[this.address].indexOf(peer) === -1) {
                network[this.address].push(peer);
            }
        }

        if (!network.hasOwnProperty(peer)) {
            network[peer] = [];
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
    const socket = new ChatterSocket(name, settings);
    socket.bind();
    return socket;
}