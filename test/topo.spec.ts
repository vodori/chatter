import {normalizeNetwork, shortestPath} from "../src/topo";
import {deepEquals} from "../src/utils";

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
    const graph = {
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


test('normalize graph', () => {

    const given = {
        a: ['b', 'c']
    };

    const expected = {
        a: ['b', 'c'],
        b: ['a'],
        c: ['a']
    };

    expect(normalizeNetwork(given)).toEqual(expected);

    const given2 = {
        HUGE_0: ["HUGE_1"],
        HUGE_1: ["HUGE_1", "HUGE_2"]
    };

    const expected2 = {
        HUGE_0: ["HUGE_1"],
        HUGE_1: ["HUGE_2", "HUGE_0"],
        HUGE_2: ["HUGE_1"]
    };

    expect(deepEquals(normalizeNetwork(given2), expected2)).toBeTruthy();

});