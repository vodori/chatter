A gossip protocol implementation for communicating across various browser contexts 
(nested iframes, extension background script, extension content script). Higher level 
abstractions like push, request/reply, and long lived topic subscriptions are 
implemented on top of unidirectional messages that automatically propagate to all 
reachable contexts.


### Why

We're maintaining a pretty sophisticated chrome extension. Turns out, this involves sending a 
lot of messages across a lot of contexts. We wanted a unified way to route messages from wherever 
we were to wherever they needed to go. Gossip protocol proved to be a great fit since we don't need 
to adjust the implementation depending on the context topology. 


