import {Network} from "./models";
import * as dijkstra from "dijkstrajs";
import {clone} from "./utils";

export function normalizeNetwork(net: Network) {

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
    }

    return cloned;
}

function convertNetwork(net: Network) {
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
    const graph = convertNetwork(net);

    try {
        return dijkstra.find_path(graph, a, b);
    } catch (e) {
        return [];
    }
}
