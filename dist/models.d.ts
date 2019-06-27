/// <reference types="chrome" />
import { Observable, Subject } from "rxjs";
export declare const _global: Window;
export declare const _chrome: typeof chrome;
export declare const _window: Window;
export declare const _document: Document;
export declare const _localMessageBus: Subject<NetPacket>;
export declare enum NetProto {
    BROADCAST,
    POINT_TO_POINT
}
export declare enum AppProto {
    PUSH,
    REQUEST,
    SUBSCRIPTION
}
export interface NetHeader {
    id: string;
    source: string;
    target?: string;
    protocol: NetProto;
}
export interface AppHeader {
    protocol: AppProto;
    source: string;
    target?: string;
    transaction: string;
    key: string;
    next?: boolean;
    error?: boolean;
    complete?: boolean;
}
export interface NetPacket {
    header: NetHeader;
    body: AppPacket;
}
export interface AppPacket {
    header: AppHeader;
    body: any;
}
export interface Settings {
    debug?: boolean;
    allowChromeRuntime?: boolean;
    allowChromeActiveTab?: boolean;
    allowParentIframe?: boolean;
    allowChildIframes?: boolean;
    allowLocalBus?: boolean;
    trustedOrigins?: Set<string>;
    isTrustedOrigin?: (origin: string) => boolean;
}
export declare function defaultSettings(): Settings;
export declare type Network = {
    [s: string]: string[];
};
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
