import {Network} from "./models";
import {find_path} from "dijkstrajs";
import {clone} from "./utils";

export function normalizeNetwork(net: Network): Network {

    const cloned = clone(net);

    for (let k in net) {
        cloned[k].forEach(node => {
            if(!cloned.hasOwnProperty(node)) {
                cloned[node] = [k];
            } else if(cloned[node].indexOf(k) === -1) {
                cloned[node].push(k);
            }
        });

        cloned[k] = cloned[k].filter(v => v !== k);
        cloned[k] = cloned[k].sort();
    }

    return cloned;
}

export function mergeNetworks(net1: Network, net2: Network): Network {
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

function convertToWeightedGraph(net: Network) {
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

export function shortestPath(net: Network, a: string, b: string) {
    const graph = convertToWeightedGraph(net);
    try {
        return find_path(graph, a, b);
    } catch (e) {
        return [];
    }
}
