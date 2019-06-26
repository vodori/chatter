"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dijkstra = require("dijkstrajs");
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
    }
    return cloned;
}
exports.normalizeNetwork = normalizeNetwork;
function convertNetwork(net) {
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
    const graph = convertNetwork(net);
    try {
        return dijkstra.find_path(graph, a, b);
    }
    catch (e) {
        return [];
    }
}
exports.shortestPath = shortestPath;
