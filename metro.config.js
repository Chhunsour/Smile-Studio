const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;

config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /[/\\](?:android[/\\](?:build|\.gradle|\.cxx)|ios[/\\](?:build|Pods))(?:[/\\]|$)/,
];

module.exports = config;
