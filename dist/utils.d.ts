import { Network } from "./models";
export declare function mergeNetworks(net1: Network, net2: Network): Network;
export declare function deepEquals(a: any, b: any): boolean;
export declare function isObject(o: any): boolean;
export declare function uuid(): string;
export declare function clone<T>(data: T): T;
export declare function looksLikeValidPacket(msg: any): any;
