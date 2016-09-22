'use strict';
const path = require('path');
const fs = require('fs');
const NodeModule = require('module');

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

function resolveModuleUrl(request, referrerUrl) {
  return path.resolve(path.dirname(referrerUrl), request);
}

function createModuleRecord(rootFilename) {
  const seen = new Set();

  function visit(filename) {
    if (cache.has(filename) || seen.has(filename)) return;
    seen.add(filename);
    return parseModule(filename).then(record => {
      return Promise.all(record.requests.map(request => {
        return visit(resolveModuleUrl(request, record.filename));
      })).then(() => record);
    });
  }

  return visit(rootFilename);
}

function resolveModuleSync(request, referrer) {
  const filename = resolveModuleUrl(request, referrer.filename);
  return cache.get(filename);
}

function runModule(filename) {
  return createModuleRecord(filename)
    .then(record => record.run(resolveModuleSync));
}

NodeModule.prototype.import = function importES6(request) {
  const filename = resolveModuleUrl(request, this.filename);
  return runModule(filename);
};
