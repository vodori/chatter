import {normalizeNetwork, shortestPath} from "../src/topo";
import {deepEquals} from "../src/utils";

test('shortest path', () => {

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

    expect(shortestPath(graph, 'a', 'i')).toEqual([ 'a', 'b', 'c', 'f', 'i' ]);

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