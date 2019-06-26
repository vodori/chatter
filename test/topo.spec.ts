import {Network} from "../src/models";
import {shortestPath} from "../src/topo";

test('shortest path', () => {

    const g = {};

    for (let i = 0; i < 6; i++) {

        g[i + ''] = [];

        for (let j = 0; j < 6; j++) {
            if (i !== j) {

                g[j + ''] = g[j + ''] || [];

                if (g[i + ''].indexOf(j + '') === -1) {
                    g[i + ''].push(j + '');
                }

                if (g[j + ''].indexOf(i + '') === -1) {
                    g[j + ''].push(i + '');
                }
            }
        }
    }

    // A B C
    // D E F
    // G H I
    var graph = {
        a: ['b', 'd'],
        b: ['a', 'c', 'e'],
        c: ['b', 'f'],
        d: ['a', 'e', 'g'],
        e: ['b', 'd', 'f', 'h'],
        f: ['c', 'e', 'i'],
        g: ['d', 'h'],
        h: ['e', 'g', 'i'],
        i: ['f', 'h']
    };

    console.log(g);

    console.log(shortestPath(graph, 'a', 'i'));

});