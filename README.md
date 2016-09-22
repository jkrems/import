# Playing around with V8 Modules

*Tested with node compiled against `v8/v8@3bbd11c23390243a237158af4a01358497958b5b`.*

Not much to see here. Basically just a port of the latest d8 import resolution stuff to node.

When everything worked, `../node/node index.js` will print:

```
From other.js
From index.js
ok
```
