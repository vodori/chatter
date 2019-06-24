import {Observable, Subject} from "rxjs";

export const _global = window;
export const _chrome = _global.chrome;
export const _window: Window = _global.window;
export const _document: Document = _global.document;
export const _localMessageBus = new Subject<NetPacket>();

export enum NetProto {
    BROADCAST = <any>"BROADCAST",
    POINT_TO_POINT = <any>"POINT_TO_POINT"
}

export enum AppProto {
    PUSH = <any>"PUSH",
    REQUEST = <any>"REQUEST",
    SUBSCRIPTION = <any>"SUBSCRIPTION"
}

export interface NetHeader {
    id: string;
    source: string;
    target?: string;
    protocol: NetProto
}

export interface AppHeader {

    // what kind of thing is happening
    protocol: AppProto

    // the source requesting the stream
    source: string;

    // the target providing the stream
    target?: string;

    // identifies the stream
    transaction: string;

    // identifies the remote handler
    key: string;

    next?: boolean;
    error?: boolean;
    complete?: boolean;
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
    trustedOrigins?: Set<string>
}

export function defaultSettings(): Settings {
    return {trustedOrigins: new Set()}
}
export type Network = { [s: string]: string[] };


export interface Socket {

    bind(): void;

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