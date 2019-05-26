import {createGossipNode} from "../src";
import {interval, of} from "rxjs";
import {bufferCount, tap} from "rxjs/operators";
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


test('pushes buffer until the peer handler is available', done => {
    const node9 = createGossipNode('node9');
    node9.push("node10", "m1", "TEST");

    const node10 = createGossipNode("node10");

    node10.handlePushes("m1", msg => {
        expect(msg).toEqual("TEST");
        done();
    });
});


test('requests buffer until the peer handler is available', done => {
    const node11 = createGossipNode('node11');

    node11.request("node12", "m1", 1).subscribe(result => {
        expect(result).toEqual(2);
        done();
    });

    const node12 = createGossipNode("node12");

    node12.handleRequests("m1", msg => {
        return of(msg + 1);
    });

});


test('subscriptions buffer until the peer handler is available', done => {
    const node13 = createGossipNode('node13');

    node13.subscription("node14", "m1", 1).subscribe(result => {
        expect(result).toEqual(2);
        done();
    });

    const node14 = createGossipNode("node14");

    node14.handleSubscriptions("m1", msg => {
        return of(msg + 1);
    });

});

test('broadcast requests solicit the entire network', done => {
    const hub = createGossipNode("hub");
    const x1 = createGossipNode("x1");
    const x2 = createGossipNode("x2");
    const x3 = createGossipNode("x3");

    x1.handleRequests("moon", x => {
        return of(x + 1);
    });

    x2.handleRequests("moon", x => {
        return of(x + 2);
    });

    x3.handleRequests("moon", x => {
        return of(x + 3);
    });

    hub.broadcastRequest("moon", 1).pipe(bufferCount(3)).subscribe(response => {
        expect(response.length).toEqual(3);
        done();
    });

});


test('broadcast subscriptions solicit the entire network', done => {
    const hub = createGossipNode("hub");
    const x1 = createGossipNode("x1");
    const x2 = createGossipNode("x2");
    const x3 = createGossipNode("x3");

    x1.handleSubscriptions("moon", x => {
        return of(x + 1);
    });

    x2.handleSubscriptions("moon", x => {
        return of(x + 2);
    });

    x3.handleSubscriptions("moon", x => {
        return of(x + 3);
    });

    hub.broadcastSubscription("moon", 1).pipe(bufferCount(3)).subscribe(response => {
        expect(response.length).toEqual(3);
        done();
    });

});