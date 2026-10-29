/**
 * @bacons/apple-targets 5.0.0 assumes one extension per type and reuses targets[0]
 * when another keyboard's productName is absent. It also dereferences a build config
 * list after removeReference() has unset it. Both break two independent keyboards.
 * Apply narrowly checked fixes before loading the upstream plugin. No silent patch
 * against a future version: remove this adapter when upgrading to an upstream fix.
 */
const fs = require("node:fs");

function patchAppleTargets() {
  const pkg = require("@bacons/apple-targets/package.json");
  if (pkg.version !== "5.0.0") throw new Error("Review withAppleTargets.js when upgrading @bacons/apple-targets from 5.0.0");
  const file = require.resolve("@bacons/apple-targets/build/with-xcode-changes");
  let source = fs.readFileSync(file, "utf8");
  const marker = "// IdsType: support multiple keyboard targets and safe configuration replacement.";
  if (source.includes(marker)) return;
  const select = "let targetToUpdate = (_a = targets.find((target) => target.props.productName === productName)) !== null && _a !== void 0 ? _a : targets[0];";
  const start = source.indexOf("        // Remove existing build phases");
  const end = source.indexOf("        // Create new build phases", start);
  if (!source.includes(select) || start < 0 || end < 0) throw new Error("Unexpected apple-targets source; refusing an unverified patch");
  const block = source.slice(start,end);
  if (!block.includes("targetToUpdate.props.buildConfigurationList.removeFromProject();")) throw new Error("Unexpected apple-targets configuration cleanup");
  source = source.slice(0,start)
    + "        const previousConfigurationList = targetToUpdate.props.buildConfigurationList;\n"
    + block.replaceAll("targetToUpdate.props.buildConfigurationList", "previousConfigurationList")
    + source.slice(end);
  source = marker + "\n" + source.replace(select,"let targetToUpdate = targets.find((target) => target.props.productName === productName);");
  fs.writeFileSync(file,source);
  delete require.cache[file];
}

module.exports = (config, props) => {
  patchAppleTargets();
  return require("@bacons/apple-targets/build/config-plugin")(config,props);
};
module.exports.patchAppleTargets = patchAppleTargets;
