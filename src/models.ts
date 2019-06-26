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

export interface Settings {
    trustedOrigins?: Set<string>
}

export function defaultSettings(): Settings {
    return {trustedOrigins: new Set()}
}
export type Network = { [s: string]: string[] };


export interface Socket {

    address(): string;

    bind(): void;

    discover(): Observable<Network>;

    push(address: string, key: string, message?: any): void;

    request(address: string, key: string, message?: any): Observable<any>;

    requestPacket(address: string, key: string, message?: any): Observable<AppPacket>;

    subscription(address: string, key: string, message?: any): Observable<any>;

    subscriptionPacket(address: string, key: string, message?: any): Observable<AppPacket>;

    handlePushesPacket(key: string, callback: (msg: AppPacket) => void): void;

    handlePushes(key: string, callback: (msg: any) => void): void;

    handleRequestsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void;

    handleRequests(key: string, callback: (msg: any) => Observable<any>): void;

    handleSubscriptionsPacket(key: string, callback: (msg: AppPacket) => Observable<any>): void;

    handleSubscriptions(key: string, callback: (msg: any) => Observable<any>): void;

    unhandlePushes(key: string): void;

    unhandleRequests(key: string): void;

    unhandleSubscriptions(key: string): void;

    close(): void;

}