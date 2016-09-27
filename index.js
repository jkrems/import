'use strict';
const path = require('path');
const fs = require('fs');
const NodeModule = require('module');

const debug = require('debug')('module-import');

const ModuleRecord = require('./build/Release/addon.node').ModuleRecord;

process.__nodeModuleCache = NodeModule._cache;

function readFile(filename) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (error, content) => {
      if (error) reject(error);
      else resolve(content);
    });
  });
}

function generateNodeModuleStub(filename) {
  var nodeModule = NodeModule._cache[filename];
  return `
// Generated module stub for ${filename}
const nodeModule = process.__nodeModuleCache[${JSON.stringify(filename)}];
export default nodeModule.exports;
`.trim();
}

const cache = new Map();
function parseModule(filename) {
  if (cache.has(filename)) return Promise.resolve(cache.get(filename));

  function processSource(source) {
    const record = new ModuleRecord(filename, source);
    cache.set(filename, record);
    return record;
  }

  if (filename.startsWith('node:')) {
    return Promise.resolve(generateNodeModuleStub(filename.slice(5)))
      .then(processSource);
  } else {
    debug('read', filename);
    return readFile(filename).then(processSource);
  }
}

function getPathsFromReferrer(referrerUrl) {
  return NodeModule._nodeModulePaths(path.dirname(referrerUrl));
}

function findFromPath(request, paths) {
  for (var i = 0; i < paths.length; ++i) {
    var filename = path.join(paths[i], request);
    if (cache.has(filename)) return filename;
    var stat;
    try {
      stat = fs.statSync(filename);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      continue;
    }
    if (stat.isFile()) return filename;
    debug('Found non-file', filename, stat);
  }
  throw new Error('Module not found: ' + request);
}

function resolveNodeModule(request, referrerUrl) {
  var fakeModule = new NodeModule(referrerUrl);
  fakeModule.filename = referrerUrl;
  fakeModule.paths = NodeModule._nodeModulePaths(path.dirname(referrerUrl));
  var filename = NodeModule._resolveFilename(request, fakeModule, false);
  fakeModule.require(filename);
  return `node:${filename}`;
}

function resolveModuleUrl(request, referrerUrl) {
  switch (request[0]) {
    case '.':
      return path.resolve(path.dirname(referrerUrl), request);
    case '/':
      return request;
    default:
      if (request.startsWith('node:')) {
        return resolveNodeModule(request.slice(5), referrerUrl);
      }
      return findFromPath(request, getPathsFromReferrer(referrerUrl));
  }
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
