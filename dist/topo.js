"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dijkstrajs_1 = require("dijkstrajs");
const utils_1 = require("./utils");
function normalizeNetwork(net) {
    const cloned = utils_1.clone(net);
    for (let k in net) {
        cloned[k].forEach(node => {
            if (!cloned.hasOwnProperty(node)) {
                cloned[node] = [k];
            }
            else if (cloned[node].indexOf(k) === -1) {
                cloned[node].push(k);
            }
        });
        cloned[k] = cloned[k].filter(v => v !== k);
        cloned[k] = cloned[k].sort();
    }
    return cloned;
}
exports.normalizeNetwork = normalizeNetwork;
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
    return normalizeNetwork(merged);
}
exports.mergeNetworks = mergeNetworks;
function convertToWeightedGraph(net) {
    let graph = {};
    for (let n in net) {
        let map = {};
        for (let i = 0; i < net[n].length; i++) {
            map[net[n][i]] = 1;
        }
        graph[n] = map;
    }
    return graph;
}
function shortestPath(net, a, b) {
    const graph = convertToWeightedGraph(net);
    try {
        return dijkstrajs_1.find_path(graph, a, b);
    }
    catch (e) {
        return [];
    }
}
exports.shortestPath = shortestPath;
