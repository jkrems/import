import pkg from 'node://../package.json';
import http from 'node://http';

export * from 'node://http';

console.log('pkg', pkg);
console.log('http', http.STATUS_CODES);
