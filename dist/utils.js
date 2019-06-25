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
    return (JSON.stringify(a) === JSON.stringify(b));
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
function union(s1, s2) {
    const results = new Set();
    s1.forEach(s => results.add(s));
    s2.forEach(s => results.add(s));
    return s1;
}
exports.union = union;
function difference(s1, s2) {
    const results = new Set();
    s1.forEach(s => {
        if (!s2.has(s)) {
            results.add(s);
        }
    });
    return s1;
}
exports.difference = difference;
function findPathToTarget(net, source, target) {
}
exports.findPathToTarget = findPathToTarget;
function looksLikeValidPacket(msg) {
    return isObject(msg) &&
        msg.hasOwnProperty("header") &&
        msg.hasOwnProperty("body");
}
exports.looksLikeValidPacket = looksLikeValidPacket;
