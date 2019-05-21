import { Observable } from "rxjs";
export declare enum MessageProtocol {
    PUSH = 0,
    REQUEST_REPLY = 1,
    TOPIC_SUBSCRIBE = 2
}
export declare type MessageID = string;
export declare type MessageKey = string;
export declare type MessageLocation = string;
export declare type MessageConsumer = (msg: any) => void;
export declare type MessageResponder = (msg: any) => Observable<any>;
export declare type MessagePublisher = (msg: any) => Observable<any>;
export declare const ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";
export interface MessagePacket {
    id: MessageID;
    source: MessageLocation;
    target: MessageLocation;
    protocol: MessageProtocol;
    key: MessageKey;
    data: any;
}
export interface MessageBroker {
    /**
     * Send a one-way message to the specified location.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    push<T>(dest: MessageLocation, kind: MessageKey, message: T): void;
    /**
     * Send a request message to the specified location and get an observable
     * that will emit the response.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    request<T, S>(dest: MessageLocation, kind: MessageKey, message: T): Observable<S>;
    /**
     * Send a request message to the specified location and get an observable
     * that will emit each message produced..
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    subscribe<T, S>(dest: MessageLocation, kind: MessageKey, message: T): Observable<S>;
    /**
     * Setup a handler that will be invoked every time this location receives
     * a push message.
     *
     * @param kind - The type of message
     * @param handler - The callback function
     */
    handlePushes<T>(kind: MessageKey, handler: (msg: T) => void): void;
    /**
     * Setup a  handler that will be invoked to produce a response every time this location
     * receives a request message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that eventually produces a response.
     */
    handleRequests<T, S>(kind: MessageKey, handler: (msg: T) => Observable<S>): void;
    /**
     * Setup a  handler that will be invoked to produce one or more responses every
     * time this location receives a subscription message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that may eventually produce responses.
     */
    handleSubscriptions<T, S>(kind: MessageKey, handler: (msg: T) => Observable<S>): void;
}
export declare type Predicate<T> = (x: T) => boolean;
export interface BrokerSettings {
    originVerifier: Predicate<string>;
}
export declare function createGossipNode(location: MessageLocation, settings?: BrokerSettings): MessageBroker;
