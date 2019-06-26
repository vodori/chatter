import {bind} from "../src";
import {combineLatest, interval, of, throwError} from "rxjs";
import {tap} from "rxjs/operators";
import {fromArray} from "rxjs/internal/observable/fromArray";
import {deepEquals, uuid} from "../src/utils";


test('automatic discovery', done => {

    const x1 = bind("node1");
    const x2 = bind("node2");

    combineLatest([x1.discover(), x2.discover()]).subscribe(([x1Net, x2Net]) => {
        expect(x1Net).toEqual(x2Net);
        x1.close();
        x2.close();
        done();
    });

});


test('pushes get sent and handled', done => {
    const b1 = bind("node1");
    const b2 = bind("node2");

    b1.handlePushes("m1", msg => {
        expect(msg).toEqual("hello");
        b1.close();
        b2.close();
        done()
    });

    b2.push("node1", "m1", "hello");
});

test('requests get sent and responses returned', done => {

    const b3 = bind("node3");
    const b4 = bind("node4");

    b3.handleRequests("m1", msg => {
        return of(msg + 1);
    });

    b4.request("node3", "m1", 1).subscribe(response => {
        expect(response).toEqual(2);
        b3.close();
        b4.close();
        done();
    });

});

test('only ever receive a single response', done => {

    const b5 = bind("node5");
    const b6 = bind("node6");

    const sent = [];
    const received = [];

    b5.handleRequests("m1", msg => {
        return fromArray([msg + 1, msg + 2, msg + 3]).pipe(tap(m => sent.push(m)));
    });

    const sub = b6.request("node5", "m1", 1).subscribe(response => {
        received.push(response);
    });

    setTimeout(() => {
        sub.unsubscribe();
    }, 50);

    setTimeout(() => {
        expect(sent).toEqual([2]);
        expect(sent).toEqual(received);
        b5.close();
        b6.close();
        done();
    }, 100)
});

test('producers stop when subscriptions are unsubscribed', done => {

    const b7 = bind("node7");
    const b8 = bind("node8");

    const sent = [];
    const received = [];

    b7.handleSubscriptions("m1", msg => {
        return interval(10).pipe(tap(msg => sent.push(msg)));
    });

    const sub = b8.subscription("node7", "m1", 1).subscribe(response => {
        received.push(response);
    });

    setTimeout(() => {
        sub.unsubscribe();
    }, 50);

    setTimeout(() => {
        expect(sent).toEqual(received);
        expect(sent.length).toBeLessThan(6);
        expect(received.length).toBeLessThan(6);
        b7.close();
        b8.close();
        done();
    }, 500)

});


test('pushes buffer until the peer handler is available', done => {
    const node9 = bind('node9');
    node9.push("node10", "m1", "TEST");

    const node10 = bind("node10");

    node10.handlePushes("m1", msg => {
        expect(msg).toEqual("TEST");
        node9.close();
        node10.close();
        done();
    });
});


test('requests buffer until the peer handler is available', done => {
    const node11 = bind('node11');

    node11.request("node12", "m1", 1).subscribe(result => {
        expect(result).toEqual(2);
        node11.close();
        bind('node12').close();
        done();
    });

    const node12 = bind("node12");

    node12.handleRequests("m1", msg => {
        return of(msg + 1);
    });

});


test('subscriptions buffer until the peer handler is available', done => {
    const node13 = bind('node13');

    node13.subscription("node14", "m1", 1).subscribe(result => {
        expect(result).toEqual(2);
        node13.close();
        bind('node14').close();
        done();
    });

    const node14 = bind("node14");

    node14.handleSubscriptions("m1", msg => {
        return of(msg + 1);
    });

});

test('error propagation of requests', done => {

    const node1 = bind(uuid());
    const node2 = bind(uuid());

    node1.handleRequests("x", msg => {
        return throwError("rawr");
    });

    node2.request(node1.address(), "x").subscribe(next => {

    }, error => {
        node1.close();
        node2.close();
        expect(error).toEqual("rawr");
        done();
    }, () => {

    })

});

test('completion propagation of requests', done => {

    const node1 = bind(uuid());
    const node2 = bind(uuid());

    node1.handleRequests("x", msg => {
        return of(1);
    });

    const values = [];

    node2.request(node1.address(), "x").subscribe(next => {
        values.push(next);
    }, error => {

    }, () => {
        expect(values[0]).toEqual(1);
        node1.close();
        node2.close();
        done();
    })

});

test('error propagation of subscriptions', done => {

    const node1 = bind(uuid());
    const node2 = bind(uuid());

    node1.handleSubscriptions("x", msg => {
        return throwError("rawr");
    });

    node2.subscription(node1.address(), "x").subscribe(next => {

    }, error => {
        expect(error).toEqual("rawr");
        node1.close();
        node2.close();
        done();
    }, () => {

    })

});

test('completion propagation of subscriptions', done => {

    const node1 = bind(uuid());
    const node2 = bind(uuid());

    node1.handleSubscriptions("x", msg => {
        return fromArray([1, 2, 3]);
    });

    const values = [];

    node2.subscription(node1.address(), "x").subscribe(next => {
        values.push(next);
    }, error => {

    }, () => {
        expect(values).toEqual([1, 2, 3]);
        node1.close();
        node2.close();
        done();
    })

});

test('larger networks', done => {

    const realSize = 10;

    const observables = [];

    for (let i = 0; i < realSize; i++) {
        const socket = bind(i + "_HUGE");
        observables.push(socket.discover());
    }

    combineLatest(observables).subscribe(results => {
        const result = <any>results.reduce((agg: any, next) => {
            if (agg.previous === null) {
                return {equal: true, previous: next}
            } else {
                return {equal: agg.equal && deepEquals(next, agg.previous), previous: next}
            }
        }, {equal: true, previous: null});

        if (result.equal) {
            done();
        }
    });

});