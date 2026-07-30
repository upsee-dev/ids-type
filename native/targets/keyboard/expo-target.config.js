/**
 * iOS のキーボード拡張ターゲット定義（@bacons/apple-targets が読む）。
 *
 * 実体のソースは ../../ime/ios/ に置き、prebuild 時にここへ複製する
 * （withKatachiIme.js が担当）。Android 側と同じ考え方で、
 * ios/ が prebuild の生成物である以上、単一の出所を native/ime/ に置いている。
 */
module.exports = {
  type: "keyboard",
  name: "カタチ入力",
  icon: "../../assets/icon.png",
  colors: { $accent: "#4437D1" },
  deploymentTarget: "15.1",
};
