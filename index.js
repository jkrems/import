'use strict';

const fs = require('fs');
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
  constructor({ loadSource, resolveUrl, cache }) {
    this._pending = new Map();
    this._loadSource = loadSource;
    this._resolveUrl = resolveUrl;
    this._cache = cache;

    this.resolveImportedModule = this._resolveImportedModule.bind(this);
  }

  async _createModule(url) {
    const source = await this._loadSource(url);
    const m = new ModuleWrap(source.toString(), url);
    if (m.url) this._cache.set(m.url, m);
    m.link(this.resolveImportedModule);
    return m;
  }

  // async to ensure we consistently return promises, even when returning from cache
  async _resolveImportedModule(referencingModule, specifier) {
    const url = referencingModule ? this._resolveUrl(referencingModule.url, specifier) : specifier;
    if (this._cache.has(url)) return this._cache.get(url);
    if (this._pending.has(url)) return this._pending.get(url);

    const eventualModule = this._createModule(url);
    this._pending.set(url, eventualModule); // important to use the promise so we can support cycles
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
      loadSource: this._loadModuleSource.bind(this),
      resolveUrl: this._resolveRequestUrl.bind(this),
    };
  }

  import(specifier, parent = this._parent) {
    const job = new ModuleJob(this._loadStrategy);
    return job.run(parent, specifier);
  }

  _resolveRequestUrl(url, specifier) {
    // TODO: Handle library paths (e.g. anything not using "/" or ".")
    return Url.resolve(url, specifier);
  }

  _loadModuleSource(url) {
    return new Promise((resolve, reject) => {
      return readFileAsync(url.replace(/^file:\/\//, ''));
    });
  }
}
const loader = new Loader();

loader.import('./example/d.js')
  .catch(console.error);

loader.import(`file://${__dirname}/example/cycle-a.js`)
  .catch(console.error);
