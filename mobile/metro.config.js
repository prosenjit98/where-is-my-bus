const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The app shares its journey planning and tracking code with the server (../packages/core)
// and ships the demo network (../data) for offline use. Both live outside this folder.
const repoRoot = path.resolve(__dirname, '..');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.join(repoRoot, 'packages', 'core'), path.join(repoRoot, 'data')],
  resolver: {
    // Files in packages/core have no node_modules of their own; use the app's.
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
  },
});
