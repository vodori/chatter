"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function nodes(graph, node) {
    return graph.reduce((p, c) => {
        (c[0] === node) && p.push(c[1]);
        return p;
    }, []);
}
function hasEdgeBeenFollowedInPath({ edge, path }) {
    const indices = allIndices(path, edge.from);
    return indices.some(i => path[i + 1] === edge.to);
}
function allIndices(arr, val) {
    const indices = [];
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === val) {
            indices.push(i);
        }
    }
    return indices;
}
function memoize(fn) {
    const cache = new Map();
    return function () {
        const key = JSON.stringify(arguments);
        let cached = cache.get(key);
        if (cached) {
            return cached;
        }
        cached = fn.apply(this, arguments);
        cache.set(key, cached);
        return cached;
    };
}
function paths({ graph = [], from, to }, path = []) {
    const linkedNodes = memoize(nodes.bind(null, graph));
    return explore(from, to);
    function explore(currNode, to, paths = []) {
        path.push(currNode);
        for (let linkedNode of linkedNodes(currNode)) {
            if (linkedNode === to) {
                let result = path.slice(); // copy values
                result.push(to);
                paths.push(result);
                continue;
            }
            if (!hasEdgeBeenFollowedInPath({
                edge: {
                    from: currNode,
                    to: linkedNode
                },
                path
            })) {
                explore(linkedNode, to, paths);
            }
        }
        path.pop();
        return paths;
    }
}
function edges(graph) {
    const edges = [];
    for (let k in graph) {
        graph[k].forEach(v => {
            edges.push([k, v]);
        });
    }
    return edges;
}
function networkPaths(net, a, b) {
    return paths({ graph: edges(net), from: a, to: b })
        .sort((a, b) => a.length > b.length ? 1 : a.length < b.length ? -1 : 0);
}
exports.networkPaths = networkPaths;
function shortestPath(net, a, b) {
    const paths = networkPaths(net, a, b);
    if (paths.length) {
        return paths[0];
    }
    else {
        return [];
    }
}
exports.shortestPath = shortestPath;
