[![Build Status](https://travis-ci.org/vodori/chatter.svg?branch=develop)](https://travis-ci.org/vodori/chatter)
[![MIT Licence](https://badges.frapsoft.com/os/mit/mit.svg?v=103)](https://opensource.org/licenses/mit-license.php)


A [gossip protocol](https://en.wikipedia.org/wiki/Gossip_protocol) implementation for communicating 
across various browser contexts (nested iframes, extension background script, extension content script). 
Higher level abstractions like push, request/reply, and long lived topic subscriptions are implemented on 
top of unidirectional messages that automatically propagate to all reachable contexts.

___

### Why

We're maintaining a pretty sophisticated chrome extension. Turns out, this involves sending a 
lot of messages across a lot of contexts. We wanted a unified way to route messages from wherever 
we were to wherever they needed to go. Gossip protocol proved to be a great fit since we don't need 
to adjust the implementation depending on the context topology. 

___

### Install

``` 
npm install @vodori/chatter --save
```

___

### Usage


The way you communicate stays the same regardless of the context you're in. Just name each location
and start sending and/or handling messages. As an example:



From a chrome-extension background script.

```typescript

import {createGossipNode} from "chatter";

const broker = createGossipNode("BACKGROUND");

broker.request("CONTENT_SCRIPT", "domNodeCount", {}).subscribe(response => {
    console.log(`The dom currently has ${response} nodes.`);
});

broker.subscription("MY_IFRAME", "serverPings", {url: "https://example.com/healthz"}).subscribe(response => {
    console.log(`The status code of example.com/healthz is ${response}`);
});

broker.handlePushes("SAY_HELLO", message => {
    console.log("Someone said hello to the background script!");
});
```

From a chrome-extension content script.

```typescript
import {createGossipNode} from "chatter";
import {of} from "rxjs";

const broker = createGossipNode("CONTENT_SCRIPT");

broker.handleRequests("domNodeCount", message => {
   return of(Array.from(document.getElementsByTagName("*")).length);
});
```


From an iframe inside an iframe injected by a content script.

```typescript

import {createGossipNode} from "chatter";
import {interval, map, switchMap, fromPromise} from "rxjs";

const broker = createGossipNode("MY_IFRAME");

broker.handleSubscriptions("serverPings", message => {
    return interval(5000).pipe(switchMap(_ => {
        return fromPromise(fetch(message.url, {method: 'get'})).pipe(map(response => {
            return response.status;
        }));
    }));
});

broker.push("BACKGROUND_SCRIPT", "SAY_HELLO");

```

___


### Security

Note that there are security concerns when sending messages between contexts in the browser. You don't
want code listening in an untrusted frame to intercept traffic only intended for your application.
You should define an originVerifier at each node to constrain the inbound and outbound messages.

``` 
function gossipSettings(): BrokerSettings {
    return {
        originVerifier: origin => {
            const verifiers: RegExp[] = [];
            if (chrome && chrome.runtime && chrome.runtime.id) {
                verifiers.push(exactMatch(chrome.runtime.id));
            }
            verifiers.push(/^example.com$/);
            return verifiers.some(verifier => verifier.test(origin));
        }
    }
}

// now this node will only accept/send messages from example.com or other
// components of the same chrome extension
const backgroundNode = createGossipNode("BACKGROUND", gossipSettings());

```

___

### FAQ

_Q:_ 

Do I have to be building a chrome extension to use this?

_A:_ 

No. It's useful when you're dealing with iframes too.

_Q:_ 

Do I have to have iframes to use this?

_A:_ 

No. You can create two nodes in the same frame if you want.

___

### License

This project is licensed under [MIT license](http://opensource.org/licenses/MIT).