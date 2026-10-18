const Module = require('node:module');

const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vitest' || request.startsWith('vitest/')) {
    return resolveFilename.call(
      this,
      request,
      { ...parent, paths: Module._nodeModulePaths(__dirname) },
      ...rest,
    );
  }
  return resolveFilename.call(this, request, parent, ...rest);
};
