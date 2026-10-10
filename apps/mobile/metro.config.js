// Metro for an npm-workspaces monorepo: watch packages/shared (TypeScript source, no build step) and resolve
// modules from this app first, then the repo root where npm hoists them.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(workspaceRoot, 'packages/shared')])];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];

module.exports = config;
