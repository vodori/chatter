import {Network} from "../src/models";
import {networkPaths} from "../src/topo";

test('shortestPath', () => {

    const net: Network = {
        'a': ['b', 'c'],
        'd': ['b', 'e'],
        'b': ['d'],
        'e': ['c']
    };

    expect(networkPaths(net, 'a', 'c')).toEqual([
        ['a', 'c'],
        ['a', 'b', 'd', 'e', 'c']
    ]);

});