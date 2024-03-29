import {Observable, Subject} from "rxjs";

function getGlobal(): any {
    try {
        return window === undefined ? {} : window;
    } catch (error) {
        return self;
    }
};

export const _global = getGlobal();

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
    debug?: boolean,
    allowChromeRuntime?: boolean,
    allowChromeActiveTab?: boolean,
    allowParentIframe?: boolean,
    allowChildIframes?: boolean,
    allowLocalBus?: boolean,
    trustedOrigins?: Set<string>,
    trustedSockets?: Set<string>,
    isTrustedSocket?: (origin: string) => boolean,
    isTrustedOrigin?: (origin: string) => boolean
}

export function defaultSettings(): Settings {
    return {
        debug: false,
        allowChildIframes: true,
        allowChromeActiveTab: true,
        allowChromeRuntime: true,
        allowParentIframe: true,
        allowLocalBus: true,
        trustedOrigins: new Set(),
        trustedSockets: new Set(),
        isTrustedSocket: socket => false,
        isTrustedOrigin: origin => false
    }
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