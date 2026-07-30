// 収録漏れの検証。zi.tools の字符集と同じ範囲を1字も落としていないか、
// ビルドのたびに数える。範囲表(core/data/blocks.ts)は実行時の Engine と共有。
//
// この検証が無かったとき、ブロック範囲の書き間違いで拡張C/Eの末尾18字が
// 黙って落ちていた。欠落があればビルドを止める。
import { BLOCKS, COMPAT_BLOCKS } from "../../../core/data/blocks.ts";
import type { RawData } from "../../../core/data/types.ts";
import type { IdsMode } from "./merge.mts";

export function verifyCoverage(
  data: RawData,
  mode: IdsMode,
): { log: string[]; missing: number } {
  const { chars, ext } = data;
  const log: string[] = [];
  let missing = 0;

  for (const { label, lo, hi } of BLOCKS) {
    let have = 0;
    let withIds = 0;
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      const ids = ch in ext ? ext[ch] : chars[ch]?.[0];
      if (ids === undefined) continue;
      have++;
      if (ids) withIds++;
    }
    const total = hi - lo + 1;
    const miss = total - have;
    missing += miss;
    log.push(
      `${label.padEnd(6)} ${have}/${total} 字収録 (分解あり ${withIds})` +
        (miss ? `  ← ${miss}字 欠落` : ""),
    );
  }

  // 互換漢字ブロックは途中に未割り当てがあるので、件数だけ出して欠落判定はしない
  for (const { label, lo, hi } of COMPAT_BLOCKS) {
    let have = 0;
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      if (ch in ext || ch in chars) have++;
    }
    log.push(`${label.padEnd(6)} ${have} 字収録`);
  }

  if (missing) {
    const msg = `統合漢字に ${missing} 字の欠落があります`;
    // babelstone モードは拡張Jが落ちるのが仕様なので警告どまり
    if (mode === "babelstone") {
      console.warn(`!! ${msg} (IDS_SOURCE=babelstone のため想定内)`);
    } else {
      throw new Error(`${msg} (core/data/blocks.ts の範囲かデータ源を確認)`);
    }
  }
  return { log, missing };
}
