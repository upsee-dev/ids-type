module.exports = {
  type: "keyboard",
  name: "japanese",
  displayName: "日本語拡張フリック",
  bundleIdentifier: ".japanese",
  deploymentTarget: "16.4",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.upsee.idskanjitype"],
  },
};
