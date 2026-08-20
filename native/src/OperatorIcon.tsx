import { Text, View } from "react-native";
import { OPERATOR_ICON } from "./engine";
import { fontFor } from "./theme";

const ROLE_OPACITY: Record<number, number> = { 1: 0.85, 2: 0.38, 3: 0.2 };

/**
 * 操作子の配置図。IDC文字(⿰⿱…)は端末のフォント次第で豆腐(□)になるので、
 * 文字ではなくViewの矩形で描く。図形定義は core/engine.ts の OPERATOR_ICON（Web版と共有）。
 *
 * 配置図を持たない鏡映・回転・除去だけは IDC の字形(⿾⿿㇯)を出す。この3字も
 * 端末の標準フォントには無いが、**同梱フォント(KatachiExt)が持っている**ので
 * fontFor() でそれを当てる。端末に関係なく同じ絵になる。
 */
export function OperatorIcon({
  code,
  size = 22,
  color,
}: {
  code: string;
  size?: number;
  color: string;
}) {
  const spec = OPERATOR_ICON[code];
  if (!spec) return null;
  if (spec.symbol) {
    return (
      <View style={{ width: size, height: size, justifyContent: "center" }}>
        <Text
          style={{
            fontFamily: fontFor(spec.symbol),
            fontSize: size,
            lineHeight: size,
            textAlign: "center",
            color,
            opacity: ROLE_OPACITY[1],
          }}
        >
          {spec.symbol}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }}>
      {spec.rects!.map((r, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: r.x * size,
            top: r.y * size,
            width: r.w * size,
            height: r.h * size,
            borderRadius: 1.5,
            backgroundColor: color,
            opacity: ROLE_OPACITY[r.role],
          }}
        />
      ))}
    </View>
  );
}
