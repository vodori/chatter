"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function mergeNetworks(net1, net2) {
    const merged = {};
    for (let k in net1) {
        const vs = new Set(net1[k]);
        if (k in net2) {
            net2[k].forEach(v => vs.add(v));
        }
        vs.delete(k);
        merged[k] = Array.from(vs).sort();
    }
    for (let k in net2) {
        if (!(k in net1)) {
            const vs = new Set(net2[k]);
            vs.delete(k);
            merged[k] = Array.from(vs).sort();
        }
    }
    return merged;
}
exports.mergeNetworks = mergeNetworks;
function deepEquals(a, b) {
    const isArray = Array.isArray;
    const keyList = Object.keys;
    const hasProp = Object.prototype.hasOwnProperty;
    if (a === b)
        return true;
    if (a && b && typeof a == 'object' && typeof b == 'object') {
        const arrA = isArray(a), arrB = isArray(b);
        let i, length, key;
        if (arrA && arrB) {
            length = a.length;
            if (length != b.length)
                return false;
            for (i = length; i-- !== 0;)
                if (!deepEquals(a[i], b[i]))
                    return false;
            return true;
        }
        if (arrA != arrB)
            return false;
        const dateA = a instanceof Date, dateB = b instanceof Date;
        if (dateA != dateB)
            return false;
        if (dateA && dateB)
            return a.getTime() == b.getTime();
        const regexpA = a instanceof RegExp, regexpB = b instanceof RegExp;
        if (regexpA != regexpB)
            return false;
        if (regexpA && regexpB)
            return a.toString() == b.toString();
        const keys = keyList(a);
        length = keys.length;
        if (length !== keyList(b).length)
            return false;
        for (i = length; i-- !== 0;)
            if (!hasProp.call(b, keys[i]))
                return false;
        for (i = length; i-- !== 0;) {
            key = keys[i];
            if (!deepEquals(a[key], b[key]))
                return false;
        }
        return true;
    }
    return a !== a && b !== b;
}
exports.deepEquals = deepEquals;
function isObject(o) {
    if (!o)
        return false;
    if (Array.isArray(o))
        return false;
    return o.constructor == Object;
}
exports.isObject = isObject;
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
exports.uuid = uuid;
function clone(data) {
    return JSON.parse(JSON.stringify(data));
}
exports.clone = clone;
function looksLikeValidPacket(msg) {
    return isObject(msg) &&
        msg.hasOwnProperty("header") &&
        msg.hasOwnProperty("body");
}
exports.looksLikeValidPacket = looksLikeValidPacket;
