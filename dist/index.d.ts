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
export declare const ChatterUnsubscribeMessageKey = "_ChatterUnsubscribe";
export interface MessagePacket {
    id: MessageID;
    source: MessageLocation;
    target: MessageLocation;
    protocol: MessageProtocol;
    key: MessageKey;
    data: MessagePayload;
}
export interface BrokerSettings {
    originVerifier: Predicate<string>;
}
export interface MessageBroker {
    /**
     * Send a one-way message to the specified location.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    push(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): void;
    /**
     * Send a request message to the specified location and get an observable
     * that will emit the response.
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    request(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;
    /**
     * Send a request message to the specified location and get an observable
     * that will emit each message produced..
     *
     * @param dest - The destination
     * @param kind - The type of message
     * @param message - The message data
     */
    subscription(dest: MessageLocation, kind: MessageKey, message?: MessagePayload): Observable<MessagePayload>;
    /**
     * Setup a handler that will be invoked every time this location receives
     * a push message.
     *
     * @param kind - The type of message
     * @param handler - The callback function
     */
    handlePushes(kind: MessageKey, handler: MessageConsumer): void;
    /**
     * Setup a  handler that will be invoked to produce a response every time this location
     * receives a request message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that eventually produces a response.
     */
    handleRequests(kind: MessageKey, handler: MessageResponder): void;
    /**
     * Setup a  handler that will be invoked to produce one or more responses every
     * time this location receives a subscription message.
     *
     * @param kind - The type of message
     * @param handler - The callback function that may eventually produce responses.
     */
    handleSubscriptions(kind: MessageKey, handler: MessagePublisher): void;
}
export declare function createGossipNode(location: MessageLocation, settings?: BrokerSettings): MessageBroker;
