import {Observable, Subject} from "rxjs";

export const _global = window;
export const _chrome = _global.chrome;
export const _window: Window = _global.window;
export const _document: Document = _global.document;
export const _localMessageBus = new Subject<NetPacket>();

export enum NetProto {
    POINT_TO_POINT = <any>"POINT_TO_POINT",
    BROADCAST = <any>"BROADCAST"
}

export enum AppProto {
    PUSH = <any>"PUSH",
    REQUEST = <any>"REQUEST",
    SUBSCRIPTION = <any>"SUBSCRIPTION"
}

export interface NetHeader {
    id: string;
    ttl: number;
    source: string;
    target: string;
    protocol: NetProto
}

export interface AppHeader {
    protocol: AppProto
    source: string;
    target: string;
    transaction: string;
    key: string;
    next: boolean;
    error: boolean;
    complete: boolean;
}

export interface NetPacket {
    header: NetHeader
    body: AppPacket
}

export interface AppPacket {
    header: AppHeader
    body: any
}

export type Receiver = Subject<AppPacket>;
export type PushListener = (msg: AppPacket) => void;
export type RequestListener = (msg: AppPacket) => Observable<any>;
export type SubscriptionListener = (msg: AppPacket) => Observable<any>;

export interface Settings {
    startingTTL?: number,
    trustedOrigins?: Set<string>
}

export type Network = { [s: string]: string[] };

export interface DiscoveryMessage {
    source: string;
    network: Network
}

export interface Socket {

    discover(): Observable<Network>;

    push(address: string, key: string, message?: any): void;

    broadcastPush(key: string, message?: any): void;

    request(address: string, key: string, message?: any): Observable<AppPacket>;

    broadcastRequest(key: string, message?: any): Observable<AppPacket>;

    subscription(address: string, key: string, message?: any): Observable<AppPacket>;

    broadcastSubscription(key: string, message?: any): Observable<AppPacket>;

    handlePushes(key: string, callback: PushListener): void;

    handleRequests(key: string, callback: RequestListener): void;

    handleSubscriptions(key: string, callback: SubscriptionListener): void;

    unhandlePushes(key: string): void;

    unhandleRequests(key: string): void;

    unhandleSubscriptions(key: string): void;

    close(): void;

}