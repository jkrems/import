# Playing around with V8 Modules

*Tested with node compiled against `v8/v8@9f5ef0a453521a39b707c3ca6c73ca056ff7a457`.*

Not much to see here. Basically just a port of the latest d8 import resolution stuff to node.

When everything worked, `../node/node --ignition --require . app.js ./examples/imports.js` will print:

```
Imported function f(x) { return x * 2; }
sum([10, f(2)]) = 14
Import from node module function def() {}
ok undefined
```
