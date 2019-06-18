import {_chrome, _document, _localMessageBus, _window, AppHeader, AppPacket, AppProto, NetHeader, NetPacket, NetProto, Network, PushListener, Receiver, RequestListener, Settings, Socket, SubscriptionListener} from "./models";
import {BehaviorSubject, merge, Observable, Subject, Subscription} from "rxjs";
import {looksLikeValidPacket, uuid} from "./utils";
import {distinctUntilChanged, filter, first, tap} from "rxjs/operators";
import {shortestPath} from "./topo";

const sockets: { [s: string]: Socket } = {};

const deepClone = x => JSON.parse(JSON.stringify(x));

const deepEquals = (a, b) => (JSON.stringify(a) === JSON.stringify(b));

export function defaultSettings(): Settings {
    return {
        startingTTL: 10,
        trustedOrigins: new Set<string>()
    }
}


function create(address: string, settings: Settings): Socket {
    settings = Object.assign({}, defaultSettings(), settings);

    const network: BehaviorSubject<Network> = new BehaviorSubject((() => {
        const net = {};
        net[address] = [];
        return net;
    })());

    const receivers: { [s: string]: Receiver } = {};
    const pushListeners: { [s: string]: PushListener } = {};
    const requestListeners: { [s: string]: RequestListener } = {};
    const subscriptionListeners: { [s: string]: SubscriptionListener } = {};
    const inboundPushBuffer: { [s: string]: NetPacket[] } = {};
    const inboundRequestBuffer: { [s: string]: NetPacket[] } = {};
    const inboundSubscriptionBuffer: { [s: string]: NetPacket[] } = {};
    const outboundBuffer: { [s: string]: NetPacket[] } = {};
    const openSubscriptions: { [s: string]: Subscription } = {};
    const peers: { [s: string]: { [s: string]: (msg: any) => void } } = {};

    function registerPeer(packet: NetPacket, sourceId: string, respond: (msg: any) => void): void {
        if (packet.header.source !== address) {
            const neighbor = peers[packet.header.source] || {};

            if (!neighbor.hasOwnProperty(sourceId)) {
                neighbor[sourceId] = respond;
            }

            if (!peers.hasOwnProperty(packet.header.source)) {
                const currentNet = deepClone(network.getValue());
                peers[packet.header.source] = neighbor;
                if (!currentNet[address].includes(packet.header.source)) {
                    currentNet[address].push(packet.header.source);
                    network.next(currentNet);
                }
            }
        }
    }

    function trustedOrigin(origin: string): boolean {
        return settings.trustedOrigins.has(origin) || settings.trustedOrigins.has('*');
    }

    function listenToLocalMessages(): Observable<NetPacket> {
        return _localMessageBus.pipe(filter(packet => {
            return looksLikeValidPacket(packet);
        }), tap(packet => {
            registerPeer(packet, "local::bus", sendToLocalBus);
        }));
    }

    function listenToFrameMessages(): Observable<NetPacket> {
        return new Observable<NetPacket>(observer => {

            const listener = (event: MessageEvent) => {
                if (trustedOrigin(event.origin)) {
                    const message = event.data;
                    if (looksLikeValidPacket(message)) {
                        registerPeer(message, `window::${event.origin}`, msg => {
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


    function listenToChromeMessages(): Observable<NetPacket> {
        return new Observable<NetPacket>(observer => {
            const listener: any = (message: any, sender) => {
                const origin = `chrome-extension://${sender.id}`;
                if (trustedOrigin(origin)) {
                    if (looksLikeValidPacket(message)) {
                        registerPeer(message, `chrome::${origin}`, sendToChromeRuntime);
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

    function inboundMessages(): Observable<NetPacket> {
        return merge(listenToLocalMessages(), listenToFrameMessages(), listenToChromeMessages())
            .pipe(filter(msg => msg.header.source !== address),
                filter(msg => msg.body.header.source !== address),
                filter(msg => msg.header.ttl > 0),
                distinctUntilChanged(equalById));
    }

    function sendToParentFrame(message: any): void {
        if (_window && _window.parent && _window.parent !== _window) {
            settings.trustedOrigins.forEach(origin => {
                _window.parent.postMessage(message, origin);
            });
        }
    }

    function sendToLocalBus(message: any): void {
        if (_localMessageBus && !_localMessageBus.closed) {
            _localMessageBus.next(message);
        }
    }

    function sendToChildIframes(message: any): void {
        const getIframes = (): HTMLIFrameElement[] => {
            return Array.from(_document.getElementsByTagName('iframe'));
        };

        const send = () => {
            getIframes().forEach(frame => {
                settings.trustedOrigins.forEach(origin => {
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

    function sendToChromeRuntime(message: any): void {
        if (_chrome && _chrome.runtime && _chrome.runtime.id && _chrome.runtime.sendMessage) {
            _chrome.runtime.sendMessage(_chrome.runtime.id, message);
        }
    }

    function sendToActiveChromeTab(message: any): void {
        if (_chrome && _chrome.tabs && _chrome.tabs.query) {
            _chrome.tabs.query({active: true, currentWindow: true}, tabs => {
                if (tabs.length) {
                    _chrome.tabs.sendMessage(tabs[0].id, message);
                }
            });
        }
    }

    function broadcast(message: NetPacket): void {
        sendToLocalBus(message);
        sendToParentFrame(message);
        sendToChildIframes(message);
        sendToChromeRuntime(message);
        sendToActiveChromeTab(message);
    }

    function send(message: NetPacket): boolean {
        if (!peers.hasOwnProperty(message.header.target)) {
            return false;
        }

        const senders = peers[message.header.target];

        if (senders.length) {
            for (let k in senders) {
                senders[k](message);
            }
            return true;
        } else {
            return false;
        }
    }

    function bufferInbound(msg: NetPacket): void {
        switch (msg.body.header.protocol) {
            case AppProto.PUSH:
                inboundPushBuffer[msg.body.header.key] = inboundPushBuffer[msg.body.header.key] || [];
                inboundPushBuffer[msg.body.header.key].push(msg);
                break;
            case AppProto.REQUEST:
                inboundRequestBuffer[msg.body.header.key] = inboundRequestBuffer[msg.body.header.key] || [];
                inboundRequestBuffer[msg.body.header.key].push(msg);
                break;
            case AppProto.SUBSCRIPTION:
                inboundSubscriptionBuffer[msg.body.header.key] = inboundSubscriptionBuffer[msg.body.header.key] || [];
                inboundSubscriptionBuffer[msg.body.header.key].push(msg);
                break;
        }
    }

    function bufferOutbound(msg: NetPacket): void {
        outboundBuffer[msg.header.target] = outboundBuffer[msg.header.target] || [];
        outboundBuffer[msg.header.target].push(msg);
    }

    function receive(msg: NetPacket): boolean {
        switch (msg.body.header.protocol) {
            case AppProto.PUSH:
                if (pushListeners.hasOwnProperty(msg.body.header.key)) {
                    pushListeners[msg.body.header.key](msg.body);
                    return true;
                } else {
                    return false;
                }
            case AppProto.REQUEST:
                if (receivers.hasOwnProperty(msg.body.header.transaction)) {
                    const receiver = receivers[msg.body.header.transaction];
                    if (msg.body.header.next) {
                        receiver.next(msg.body);
                    }

                    if (msg.body.header.error) {
                        receiver.error(msg.body);
                    }

                    if (msg.body.header.complete) {
                        receiver.complete();
                    }

                    return true;
                } else if (requestListeners.hasOwnProperty(msg.body.header.key)) {
                    const handler = requestListeners[msg.body.header.key];
                    const response = handler(msg.body);
                    openSubscriptions[msg.body.header.transaction] = response.pipe(first()).subscribe(response => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.REQUEST,
                                    key: msg.body.header.key,
                                    next: true,
                                    error: false,
                                    complete: false
                                },
                                body: response
                            }
                        })
                    }, error => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.REQUEST,
                                    key: msg.body.header.key,
                                    next: false,
                                    error: true,
                                    complete: false
                                },
                                body: error
                            }
                        })
                    }, () => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.REQUEST,
                                    key: msg.body.header.key,
                                    next: false,
                                    error: false,
                                    complete: true
                                },
                                body: {}
                            }
                        })
                    });
                    return true;
                } else {
                    return false;
                }
            case AppProto.SUBSCRIPTION:
                if (receivers.hasOwnProperty(msg.body.header.transaction)) {
                    const receiver = receivers[msg.body.header.transaction];

                    if (msg.body.header.next) {
                        receiver.next(msg.body);
                    }

                    if (msg.body.header.error) {
                        receiver.error(msg.body);
                    }

                    if (msg.body.header.complete) {
                        receiver.complete();
                    }
                    return true;
                } else if (subscriptionListeners.hasOwnProperty(msg.body.header.key)) {
                    const handler = subscriptionListeners[msg.body.header.key];
                    const response = handler(msg.body);
                    openSubscriptions[msg.body.header.transaction] = response.subscribe(response => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.SUBSCRIPTION,
                                    key: msg.body.header.key,
                                    next: true,
                                    error: false,
                                    complete: false,
                                },
                                body: response
                            }
                        })
                    }, error => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.SUBSCRIPTION,
                                    key: msg.body.header.key,
                                    next: false,
                                    error: true,
                                    complete: false
                                },
                                body: error
                            }
                        })
                    }, () => {
                        send({
                            header: {
                                id: uuid(),
                                protocol: NetProto.POINT_TO_POINT,
                                target: msg.header.source,
                                source: address,
                                ttl: msg.header.ttl
                            },
                            body: {
                                header: {
                                    transaction: msg.body.header.transaction,
                                    source: address,
                                    target: msg.body.header.source,
                                    protocol: AppProto.SUBSCRIPTION,
                                    key: msg.body.header.key,
                                    next: false,
                                    error: false,
                                    complete: true
                                },
                                body: {}
                            }
                        })
                    });
                    return true;
                } else {
                    return false;
                }
        }
    }

    function drop(msg: NetPacket): void {
        console.warn("Dropped a packet!", msg);
    }

    function equalById(m1: NetPacket, m2: NetPacket) {
        return m1.header.id === m2.header.id;
    }


    const sub = inboundMessages().subscribe(msg => {
        if (msg.header.protocol === NetProto.BROADCAST) {
            if (!receive(msg)) {
                bufferInbound(msg);
            }
            broadcast({
                header: {
                    ttl: msg.header.ttl - 1,
                    target: msg.header.target,
                    source: address,
                    protocol: NetProto.BROADCAST,
                    id: uuid()
                },
                body: msg.body
            });
            return;
        }

        if (msg.body.header.target === address) {
            if (!receive(msg)) {
                bufferInbound(msg);
            }
            return;
        }

        if (msg.body.header.target !== address) {
            if (!send(msg)) {
                bufferOutbound(msg);
            }
            return;
        }

        drop(msg);
    });

    let socket: Socket;

    socket = {
        discover(): Observable<Network> {
            return network;
        },
        broadcastPush(key: string, message: any = {}): void {
            const netHeader: NetHeader = {
                id: uuid(),
                protocol: NetProto.BROADCAST,
                source: address,
                target: "__*__",
                ttl: settings.startingTTL
            };

            const appHeader: AppHeader = {
                key: key,
                protocol: AppProto.PUSH,
                source: address,
                target: "__*__",
                transaction: uuid(),
                error: false,
                next: true,
                complete: false
            };

            const appPacket: AppPacket = {
                body: message,
                header: appHeader
            };

            const netPacket: NetPacket = {
                header: netHeader,
                body: appPacket
            };

            broadcast(netPacket);
        },
        broadcastRequest(key: string, message: any = {}): Observable<any> {
            return new Observable(observer => {

                const subject = new Subject<AppPacket>();
                const transaction = uuid();

                receivers[transaction] = subject;

                const sub = subject.subscribe(message => {
                    observer.next(message);
                }, error => {
                    observer.error(error);
                }, () => {
                    observer.complete();
                });

                broadcast({
                    header: {
                        ttl: settings.startingTTL,
                        target: "__*__",
                        source: address,
                        protocol: NetProto.BROADCAST,
                        id: uuid()
                    },
                    body: {
                        header: {
                            key: key,
                            protocol: AppProto.REQUEST,
                            source: address,
                            target: "__*__",
                            transaction: transaction,
                            error: false,
                            next: true,
                            complete: false
                        },
                        body: message
                    }
                });

                return () => {
                    delete receivers[transaction];
                    sub.unsubscribe();
                };

            });
        },
        broadcastSubscription(key: string, message: any = {}): Observable<any> {
            return new Observable(observer => {

                const subject = new Subject<AppPacket>();
                const transaction = uuid();
                receivers[transaction] = subject;

                const sub = subject.subscribe(message => {
                    observer.next(message);
                }, error => {
                    observer.error(error);
                }, () => {
                    observer.complete();
                });

                broadcast({
                    header: {
                        ttl: settings.startingTTL,
                        target: "__*__",
                        source: address,
                        protocol: NetProto.BROADCAST,
                        id: uuid()
                    },
                    body: {
                        header: {
                            key: key,
                            protocol: AppProto.SUBSCRIPTION,
                            source: address,
                            target: "__*__",
                            transaction: transaction,
                            error: false,
                            next: true,
                            complete: false
                        },
                        body: message
                    }
                });

                return () => {
                    delete receivers[transaction];
                    sub.unsubscribe();
                };
            });
        },
        handlePushes(key: string, callback: (msg: AppPacket) => void): void {
            pushListeners[key] = callback;
        },
        handleRequests(key: string, callback: (msg: AppPacket) => Observable<any>): void {
            requestListeners[key] = callback;
        },
        handleSubscriptions(key: string, callback: (msg: AppPacket) => Observable<any>): void {
            subscriptionListeners[key] = callback;
        },
        push(target: string, key: string, message: any = {}): void {
            const net = network.getValue();
            const [me, next, ..._] = shortestPath(net, address, target);
            send({
                header: {
                    ttl: settings.startingTTL,
                    target: next,
                    source: address,
                    protocol: NetProto.POINT_TO_POINT,
                    id: uuid()
                },
                body: {
                    header: {
                        target: target,
                        source: address,
                        transaction: uuid(),
                        protocol: AppProto.PUSH,
                        key: key,
                        error: false,
                        next: true,
                        complete: false
                    },
                    body: message
                }
            });
        },
        request(target: string, key: string, message: any = {}): Observable<AppPacket> {
            return new Observable(observer => {
                const net = network.getValue();
                const transaction = uuid();
                const [me, next, ..._] = shortestPath(net, address, target);
                const subject = new Subject<AppPacket>();

                receivers[transaction] = subject;

                const subscription = subject.subscribe(msg => {
                    observer.next(msg);
                }, error => {
                    observer.error(error);
                }, () => {
                    observer.complete();
                });

                send({
                    header: {
                        ttl: settings.startingTTL,
                        target: next,
                        source: address,
                        protocol: NetProto.POINT_TO_POINT,
                        id: uuid()
                    },
                    body: {
                        header: {
                            target: target,
                            source: address,
                            transaction: transaction,
                            protocol: AppProto.REQUEST,
                            key: key,
                            complete: false,
                            next: true,
                            error: false
                        },
                        body: message
                    }
                });

                return () => {
                    delete receivers[transaction];
                    subscription.unsubscribe();
                };
            });
        },
        subscription(target: string, key: string, message: any = {}): Observable<AppPacket> {
            return new Observable(observer => {
                const net = network.getValue();
                const transaction = uuid();
                const [me, next, ..._] = shortestPath(net, address, target);
                const subject = new Subject<AppPacket>();

                receivers[transaction] = subject;

                const subscription = subject.subscribe(msg => {
                    observer.next(msg);
                }, error => {
                    observer.error(error);
                }, () => {
                    observer.complete();
                });

                send({
                    header: {
                        ttl: settings.startingTTL,
                        target: next,
                        source: address,
                        protocol: NetProto.POINT_TO_POINT,
                        id: uuid()
                    },
                    body: {
                        header: {
                            target: target,
                            source: address,
                            transaction: transaction,
                            protocol: AppProto.SUBSCRIPTION,
                            key: key,
                            next: true,
                            error: false,
                            complete: false
                        },
                        body: message
                    }
                });

                return () => {
                    delete receivers[transaction];
                    subscription.unsubscribe();
                };
            });
        },
        close(): void {
            sub.unsubscribe();
        },
        unhandlePushes(key: string): void {
            delete pushListeners[key];
        },
        unhandleRequests(key: string): void {
            delete requestListeners[key];
        },
        unhandleSubscriptions(key: string): void {
            delete subscriptionListeners[key];
        }
    };


    return socket;
}


export function bind(address: string, settings: Settings = defaultSettings()): Socket {
    if (sockets.hasOwnProperty(address)) {
        return sockets[address];
    } else {
        return sockets[address] = create(address, settings);
    }
}