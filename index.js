'use strict';

const fs = require('fs');
const CJSModule = require('module');
const path = require('path');
const Url = require('url');

const { ModuleWrap } = require('bindings')('module_wrap');

function readFileAsync(filename) {
    return new Promise((resolve, reject) => {
      fs.readFile(filename, (error, source) => {
        if (error) {
          reject(error);
        } else {
          resolve(source);
        }
      });
    });
}

class ModuleJob {
  constructor({ loadSource, resolveUrl, link, cache }) {
    this._pending = new Map();
    this._loadSource = loadSource;
    this._resolveUrl = resolveUrl;
    this._link = link;
    this._cache = cache;

    this.resolveImportedModule = this._resolveImportedModule.bind(this);
  }

  async _createModule(req) {
    const m = await req.createModule();
    if (m.url) this._cache.set(m.url, m);
    req.linkModule(m, this.resolveImportedModule);
    return m;
  }

  // async to ensure we consistently return promises, even when returning from cache
  async _resolveImportedModule(referencingModule, specifier) {
    const req = this._resolveUrl(referencingModule.url, specifier);
    if (this._cache.has(req.url)) return this._cache.get(req.url);
    if (this._pending.has(req.url)) return this._pending.get(req.url);

    const eventualModule = this._createModule(req);
    this._pending.set(req.url, eventualModule); // important to use the promise so we can support cycles
    return eventualModule;
  }

  async run(referencingModule, specifier) {
    const moduleRoot = await this._resolveImportedModule(referencingModule, specifier);
    await Promise.all(this._pending.values());
    moduleRoot.instantiate();
    moduleRoot.evaluate();
    return moduleRoot;
  }
}

class StandardModuleRequest {
  constructor(url) {
    this.url = url;
    this._filename = url.replace(/^file:\/\//, '');
  }

  async createModule() {
    const source = await readFileAsync(this._filename);
    const m = new ModuleWrap(source.toString(), this.url);
    return m;
  }

  linkModule(m, resolveImportedModule) {
    m.link(resolveImportedModule);
  }
}

function createFakeCJSModule(modulePath) {
  const cjs = new CJSModule(modulePath);
  return cjs;
}

class CJSModuleRequest {
  constructor(parentUrl, parsed) {
    const requirePath = `${parsed.hostname}${parsed.pathname || ''}`;
    let basePath = Url.parse(parentUrl).pathname;
    if (basePath[basePath.length - 1] === '/') {
      basePath += '.';
    }
    this._parent = require.cache[basePath] || createFakeCJSModule(basePath);
    this._filename = CJSModule._resolveFilename(requirePath, this._parent);
    this.url = `node://${this._filename}`;
  }

  async createModule() {
    const m = new ModuleWrap('import { $ } from ""; export default $;', this.url);
    return m;
  }

  linkModule(m, resolveImportedModule) {
    const content = this._parent.require(this._filename);
    const reflective = new ModuleWrap(`export let $; ({ set_$(v) { $ = v; } })`, '');
    reflective.instantiate();
    const mutator = reflective.evaluate();
    mutator.set_$(content);

    m.link(() => Promise.resolve(reflective));
  }
}

function getNamespaceOf(m) {
  const tmp = new ModuleWrap('import * as _ from "";_;', '');
  tmp.link(() => Promise.resolve(m));
  tmp.instantiate();
  const ns = tmp.evaluate();
  return ns;
}

function pathToFileURL(pathname) {
  // TODO: Handle windows paths
  return `file://${pathname}/`;
}

class Loader {
  constructor(base = pathToFileURL(process.cwd())) {
    this._cache = new Map();
    this._parent = { url: base };
    this._loadStrategy = {
      cache: this._cache,
      resolveUrl: this._resolveRequestUrl.bind(this),
    };
  }

  async import(specifier, parent = this._parent) {
    const job = new ModuleJob(this._loadStrategy);
    const m = await job.run(parent, specifier);
    return getNamespaceOf(m);
  }

  _resolveRequestUrl(url, specifier) {
    // TODO: Handle library paths (e.g. anything not using "/" or ".")
    const parsed = Url.parse(specifier);

    switch (parsed.protocol) {
      case null:
      case 'file:':
        return new StandardModuleRequest(Url.resolve(url, specifier));

      case 'node:':
        return new CJSModuleRequest(url, parsed);

      default:
        throw new TypeError(`Unsupported protocol ${parsed.protocol}`);
    }
  }
}
const loader = new Loader();

CJSModule.prototype.import = function importES(specifier) {
  const fakeES = { url: `file://${this.filename}` };
  return loader.import(specifier, fakeES);
};

loader.import('./example/a.js')
  .then(console.log, console.error);

loader.import('./example/d.js')
  .then(console.log, console.error);

loader.import(`file://${__dirname}/example/cycle-a.js`)
  .then(console.log, console.error);

loader.import(`node://./package.json`)
  .then(console.log, console.error);

loader.import(`./example/import-cjs.js`)
  .then(console.log, console.error);

require('./example/require-es.js');

loader.import(`node://${__dirname}/package.json`)
  .then(console.log, console.error);

// require(cjsModule)
// module.import(jsModule)
// import 'node:///path/to/cjs/module';
// import '/path/to/js/module';
