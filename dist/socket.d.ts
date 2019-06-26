import { AppPacket, NetPacket, Network, Settings, Socket } from "./models";
import { BehaviorSubject, Observable, Observer, Subscription } from "rxjs";
export declare class ChatterSocket implements Socket {
    private _address;
    private settings;
    openProducers: {
        [s: string]: Subscription;
    };
    allSubscriptions: Subscription;
    network: BehaviorSubject<Network>;
    sourceBuffer: {
        [s: string]: AppPacket[];
    };
    destinationPushBuffer: {
        [s: string]: NetPacket[];
    };
    destinationRequestBuffer: {
        [s: string]: NetPacket[];
    };
    destinationSubscriptionBuffer: {
        [s: string]: NetPacket[];
    };
    pushHandlers: {
        [s: string]: (msg: AppPacket) => void;
    };
    requestHandlers: {
        [s: string]: (msg: AppPacket) => Observable<any>;
    };
    subscriptionHandlers: {
        [s: string]: (msg: AppPacket) => Observable<any>;
    };
    peers: {
        [s: string]: {
            [s: string]: (msg: NetPacket) => void;
        };
    };
    openConsumers: {
        [s: string]: Observer<AppPacket>;
    };
    transactionIds: Set<string>;
    constructor(_address: string, settings: Settings);
    address(): string;
    broadcastPush(key: string, message?: any): void;
    close(): void;
    discover(): Observable<Network>;
    handlePushes(key: string, callback: (msg: any) => void): void;
    handleRequests(key: string, callback: (msg: any) => Observable<any>): void;
    handleSubscriptions(key: string, callback: (msg: any) => Observable<any>): void;
    handlePushesPacket(key: string, callback: (msg: AppPacket) => void): void;
    handleRequestsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void;
    handleSubscriptionsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void;
    push(address: string, key: string, message?: any): void;
    requestPacket(address: string, key: string, message?: any): Observable<AppPacket>;
    subscriptionPacket(address: string, key: string, message?: any): Observable<AppPacket>;
    unhandlePushes(key: string): void;
    unhandleRequests(key: string): void;
    unhandleSubscriptions(key: string): void;
    handleInboundPushMessage(message: NetPacket): boolean;
    handleIncomingResponsiveMessage(message: NetPacket, handlers: {
        [s: string]: (msg: AppPacket) => Observable<any>;
    }): boolean;
    handleInboundRequestMessage(message: NetPacket): boolean;
    handleInboundSubscriptionMessage(message: NetPacket): boolean;
    handleInboundMessage(message: NetPacket): boolean;
    consumeInboundMessage(message: NetPacket): boolean;
    broadcastInboundMessage(message: NetPacket): void;
    processPushBuffer(key: string): void;
    processRequestBuffer(key: string): void;
    processSubscriptionBuffer(key: string): void;
    bufferInboundMessage(message: NetPacket): void;
    forwardInboundMessage(message: NetPacket): void;
    receiveIncomingMessage(message: NetPacket): void;
    bind(): void;
    monkeyPatchObservableSubscribe(transaction: any, observable: Observable<any>): Observable<any>;
    send(message: AppPacket): void;
    broadcast(message: NetPacket): void;
    isTrustedOrigin(origin: string): boolean;
    registerPeer(packet: NetPacket, edgeId: string, respond: (msg: any) => void): void;
    listenToLocalMessages(): Observable<NetPacket>;
    listenToFrameMessages(): Observable<NetPacket>;
    incomingMessages(): Observable<NetPacket>;
    listenToChromeMessages(): Observable<NetPacket>;
    sendToParentFrame(message: any): void;
    sendToLocalBus(message: any): void;
    sendToChildIframes(message: any): void;
    sendToChromeRuntime(message: any): void;
    supportsRuntime(): boolean;
    supportsTabs(): boolean;
    sendToActiveChromeTab(message: any): void;
    request(address: string, key: string, message?: any): Observable<any>;
    subscription(address: string, key: string, message?: any): Observable<any>;
}
export declare function bind(name: string, settings?: Settings): Socket;
