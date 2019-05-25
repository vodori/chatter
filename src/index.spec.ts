import {createGossipNode} from "./index";
import {interval, of} from "rxjs";
import {tap} from "rxjs/operators";
import {fromArray} from "rxjs/internal/observable/fromArray";

test('pushes get sent and handled', done => {
    const b1 = createGossipNode("node1");
    const b2 = createGossipNode("node2");

    b1.handlePushes("m1", msg => {
        expect(msg).toEqual("hello");
        done()
    });

    b2.push("node1", "m1", "hello");
});

test('requests get sent and responses returned', done => {

    const b3 = createGossipNode("node3");
    const b4 = createGossipNode("node4");

    b3.handleRequests("m1", msg => {
        return of(msg + 1);
    });

    b4.request("node3", "m1", 1).subscribe(response => {
        expect(response).toEqual(2);
        done();
    });

});

test('only ever receive a single response', done => {

    const b5 = createGossipNode("node5");
    const b6 = createGossipNode("node6");

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
        done();
    }, 100)

});

test('producers stop when subscriptions are unsubscribed', done => {

    const b7 = createGossipNode("node7");
    const b8 = createGossipNode("node8");

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
        done();
    }, 100)

});