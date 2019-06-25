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
export declare type PushListener = (msg: AppPacket) => void;
export declare type RequestListener = (msg: AppPacket) => Observable<any>;
export declare type SubscriptionListener = (msg: AppPacket) => Observable<any>;
export interface Settings {
    trustedOrigins?: Set<string>;
}
export declare function defaultSettings(): Settings;
export declare type Network = {
    [s: string]: string[];
};
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
