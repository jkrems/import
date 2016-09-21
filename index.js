'use strict';
const path = require('path');
const fs = require('fs');

const ModuleRecord = require('./build/Release/addon.node').ModuleRecord;

function readFile(filename) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (error, content) => {
      if (error) reject(error);
      else resolve(content);
    });
  });
}

const cache = new Map();
function parseModule(filename) {
  if (cache.has(filename)) return Promise.resolve(cache.get(filename));
  return readFile(filename).then(source => {
    const record = new ModuleRecord(filename, source);
    cache.set(filename, record);
    return record;
  });
}

function resolveModuleUrl(request, referrer) {
  return path.resolve(path.dirname(referrer.filename), request);
}

function createModuleRecord(rootFilename) {
  const seen = new Set();

  function visit(filename) {
    if (cache.has(filename) || seen.has(filename)) return;
    seen.add(filename);
    return parseModule(filename).then(record => {
      return Promise.all(record.requests.map(request => {
        return visit(resolveModuleUrl(request, record));
      })).then(() => record);
    });
  }

  return visit(rootFilename);
}

function resolveModuleSync(request, referrer) {
  const filename = resolveModuleUrl(request, referrer);
  return cache.get(filename);
}

function runModule(filename) {
  return createModuleRecord(filename)
    .then(record => record.run(resolveModuleSync));
}

runModule(path.resolve('examples/index.js'))
  .then(() => console.log('ok'));
