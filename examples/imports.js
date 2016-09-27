import { f } from './exports.js';
import { sum } from 'lodash-es/lodash.js';
import cjs from 'node:./cjs';
console.log('Imported', f);
console.log('sum([10, f(2)]) = %j', sum([10, f(2)]));
console.log('Import from node module', cjs);
