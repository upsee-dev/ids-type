import { OPERATOR_ICON } from "@/lib/engine";

const ROLE_OPACITY: Record<number, number> = { 1: 0.85, 2: 0.38, 3: 0.2 };

/**
 * 操作子の配置図。IDC文字(⿰⿱…)は端末のフォントによっては豆腐(□)になるため、
 * 文字ではなく矩形で描く。図形定義は core/engine.ts の OPERATOR_ICON（ネイティブ版と共有）。
 *
 * 配置図を持たない鏡映・回転・除去だけは IDC の字形(⿾⿿㇯)を出す。端末のフォントには
 * まず無い字なので、Plangothic まで並んだ .kanji のスタックで描く。
 */
export function OperatorIcon({ code, size = 22 }: { code: string; size?: number }) {
  const spec = OPERATOR_ICON[code];
  if (!spec) return null;
  if (spec.symbol) {
    return (
      <span
        aria-hidden
        style={{ fontSize: size, lineHeight: `${size}px`, height: size, opacity: 0.85 }}
        className="kanji block text-center"
      >
        {spec.symbol}
      </span>
    );
  }
  return (
    <span aria-hidden className="relative block" style={{ width: size, height: size }}>
      {spec.rects!.map((r, i) => (
        <span
          key={i}
          className="absolute rounded-[1.5px] bg-current"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
            opacity: ROLE_OPACITY[r.role],
          }}
        />
      ))}
    </span>
  );
}
