'use strict';
module.import(process.argv[2])
  .then(record => console.log('ok', record))
  .then(null, console.error);
