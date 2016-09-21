# Playing around with V8 Modules

*Tested with node compiled against `v8/v8@cf127e81449f0bc4d09368a376623fe3743094a7`.*

Not much to see here. Basically just a port of the latest d8 import resolution stuff to node.

When everything worked, `../node/node index.js` will print:

```
From other.js
From index.js
ok
```
