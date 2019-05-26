import { Observable } from "rxjs";
export declare enum MessageProtocol {
    PUSH = 0,
    REQUEST_REPLY = 1,
    TOPIC_SUBSCRIBE = 2
}
export declare type MessageID = string;
export declare type MessageKey = string;
export declare type MessagePayload = any;
export declare type MessageLocation = string;
export declare type MessageConsumer = (msg: any) => void;
export declare type MessageResponder = (msg: any) => Observable<any>;
export declare type MessagePublisher = (msg: any) => Observable<any>;
export declare type Predicate<T> = (x: T) => boolean;
export interface AddressedPayload {
    location: MessageLocation;
    data: MessagePayload;
}
export interface MessagePacket {
    id: MessageID;
    source: MessageLocation;
    target: MessageLocation;
    protocol: MessageProtocol;
    key: MessageKey;
    data: MessagePayload;
}
export interface BrokerSettings {
    verbose?: boolean;
    originVerifier?: Predicate<string>;
}
export interface MessageBroker {
    broadcastPush(kind: MessageKey, message?: MessagePayload): void;
    broadcastRequest(kind: MessageKey, message?: MessagePayload): Observable<AddressedPayload>;
    broadcastSubscription(kind: MessageKey, message?: MessagePayload): Observable<AddressedPayload>;
    push(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): void;
    request(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;
    subscription(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;
    handlePushes(kind: MessageKey, handler: MessageConsumer): void;
    handleRequests(kind: MessageKey, handler: MessageResponder): void;
    handleSubscriptions(kind: MessageKey, handler: MessagePublisher): void;
}
export declare function union<T>(s1: Set<T>, s2: Set<T>): Set<T>;
export declare function difference<T>(s1: Set<T>, s2: Set<T>): Set<T>;
export declare function createGossipNode(location: MessageLocation, settings?: BrokerSettings): MessageBroker;
