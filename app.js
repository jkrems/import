'use strict';
module.import('./examples/index.js')
  .then(record => console.log('ok', record))
  .then(null, console.error);
