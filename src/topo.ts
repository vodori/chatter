import {Network} from "./models";
import * as dijkstra from "dijkstrajs";

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
