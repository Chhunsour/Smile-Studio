// The Expo iOS template runs react-native-xcode.sh via an unquoted backtick substitution, which breaks
// when the project path contains a space (this repo lives in "Smile Studio"). Quote it.
const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withSpaceSafeBundleScript(config) {
  return withXcodeProject(config, (cfg) => {
    const phases = cfg.modResults.hash.project.objects.PBXShellScriptBuildPhase;
    for (const phase of Object.values(phases)) {
      if (typeof phase !== 'object' || !phase.shellScript?.includes('react-native-xcode.sh')) continue;
      phase.shellScript = phase.shellScript.replace(
        /`(\\"\$NODE_BINARY\\" --print [^`]*react-native-xcode\.sh'\\")`/,
        '\\"$($1)\\"',
      );
    }
    return cfg;
  });
};
