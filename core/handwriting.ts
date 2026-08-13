// 手書き検索の照合エンジン。
//
// 描いた画(点列の配列)を、KanjiVG 由来のストローク特徴
// (handwriting-data.json、生成は web/scripts/build-handwriting.mts)と突き合わせて
// 似ている字を返す。通信はしない。認識モデルではなく単純な形の照合なので、
// 端末を選ばず数msで引ける。
//
// 仕組み:
//   1. 描いた各画を弧長等間隔の8点に間引く(参照側と同じ)
//   2. 字全体の外接枠で正規化(等倍・中央寄せ。書く大きさ・位置に依存しない)
//   3. 候補字ごとに「描いた画 → 参照の画」を貪欲に対応づけ、1画ずつの距離を合計
//      - 書き順が多少違っても引けるよう、対応相手は先頭からではなく全画から選ぶ
//      - 逆向きに書いた画(下から上など)も、小さな加点つきで許す
//      - 続け書きで画がつながった字(口を2画で書くなど)も、参照側の隣り合う2画を
//        つなげた形と照合して拾う
//
// 画数で足切りし、重心だけの粗選別を挟むので、全6,400字が相手でも数ms〜十数msで返る。
// スコアは小さいほど似ている。並べ替え・拡張漢字の後回しは呼び出し側で行う
// (このファイルは辞書(Engine)を知らないため)。
//
// **加点の重みは当てずっぽうではなく測って決めてある**。KanjiVG の異体字
// (楷書体・別筆順。本体の辞書には1字も入っていない)4,959枚に、乱雑な筆づかいを
// 模した崩しを重ねたものが問題集で、web の `npm run bench:handwriting` が測る。
// この値で 上位1件 96.9% / 上位5件 99.4%。重みをいじったら必ず測り直すこと
// (自己照合の test:handwriting は実装が壊れていないかを見るだけで、実力は測れない)。
//
// **Kotlin(Handwriting.kt)・Swift(Handwriting.swift)へ移植してある**。
// 3つが同じ候補を同じ順で返せるよう、数値の扱いを次の3点に揃えてある。
// 崩すと移植どうしがずれる(検証は web の test:handwriting と ime/test/)。
//   - 参照の点は 0〜63 の**整数のまま**持ち、距離を測るときだけ INV63 を掛ける
//     (float32 で持つと言語ごとに丸めが変わる。整数なら食い違いようがない)
//   - 長さは hypot ではなく sqrt(dx*dx+dy*dy)。hypot の精度は処理系依存
//   - 並べ替えはスコアが同点のとき**辞書順(id)**で割る。Swift の sort は
//     安定ではないので、同点の順序を実装任せにしない

export interface HandwritingData {
  v: number;
  /** 1画あたりの点数(生成側と一致していること) */
  n: number;
  /** 字 -> 量子化ストローク列(1点=2文字の64進、1画=n*2文字) */
  chars: Record<string, string>;
}

export interface HwMatch {
  ch: string;
  /** 小さいほど似ている(0=同一)。おおむね 0.1 未満が「かなり近い」 */
  score: number;
  /** 参照側の画数(続け書き判定に使える) */
  strokes: number;
}

/** x,y 1点ぶん(どの座標系でもよい。正規化はこちらで行う) */
export type HwPoint = readonly [number, number];

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE = new Map([...ALPHABET].map((c, i) => [c.charCodeAt(0), i]));

/** 量子化の段数(0〜63)。参照の1目盛りぶん */
const INV63 = 1.0 / 63.0;

/** 折れ線を弧長で等間隔 n 点に間引く(生成スクリプトと共有) */
export function resampleStroke(pts: readonly HwPoint[], n: number): number[][] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]]);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    acc.push(acc[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = acc[acc.length - 1];
  const out: number[][] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const seg = acc[j + 1] - acc[j];
    const t = seg > 0 ? (target - acc[j]) / seg : 0;
    out.push([
      pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
      pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t,
    ]);
  }
  return out;
}

/** 逆向きに書いた画への加点 */
const REVERSE_PENALTY = 0.2;
/**
 * 書き順が参照とずれている対応への弱い加点。
 * 見るのは画の**番号の差ではなく、書き進みの割合の差**。続け書きで画がつながると
 * 描いた側の番号だけが遅れていくので、番号で測ると「続けて書いた人」ほど
 * 正解が重くなってしまう(卿を8画で書くと参照12画との差が4つぶん罰になる)。
 */
const ORDER_BIAS = 0.4;
/**
 * 描かれずに余った参照1画あたりの加点。
 * ここを重くすると「画数がぴったり合う字」ばかりが上に来る。乱雑に書くと画は
 * つながったり足りなかったりするのが普通なので、軽くしたほうがよく当たる
 * (0.05→0.02 で 上位1件が 93→96% に上がった)。
 */
const EXTRA_REF = 0.02;
/**
 * 対応相手が見つからなかった(参照より多く描いた)画の距離。
 * 余計な1画を描いてしまっても、他がよく合っていれば候補に残す
 */
const UNMATCHED = 0.4;
/**
 * 描いた画数との差をどこまで候補にするか。
 * 多い側(MORE_OK)は「口を2画で続け書きした」の類。描きかけの字を先読みするための
 * 枠ではない(全体を外接枠で正規化する方式では、描きかけは形が別物になる)
 */
const FEWER_OK = 2; // 参照の方が少ない(画を分けて書いた)
const MORE_OK = 6; // 参照の方が多い(続け書きで画がつながった)

/** 続け書き(1画で参照の2画ぶんを書いた)対応への加点 */
const MERGE_PENALTY = 0.05;

/** 粗選別で残す数。重心だけの安い距離で足切りしてから本照合する */
const PREFILTER = 400;

interface Ref {
  ch: string;
  /** 辞書に現れた順。スコアが同点のときの並べ替えをこれで割る */
  id: number;
  /** 画数 */
  m: number;
  /** [画*n*2] 量子化(0〜63)のまま持つ */
  pts: Uint8Array;
  /** 隣り合う画 j,j+1 をつなげて引き直した形。続け書きの照合用 */
  merged: Uint8Array;
  /** 各画の重心 [画*2]。粗選別用(0〜1 に直してある) */
  cents: Float64Array;
}

/**
 * 置き場所のずれをどれだけ重く見るか(形の違いを 1.0 としたとき)。
 *
 * 1画の距離は「重心を合わせたときの形の違い」と「重心そのもののずれ」に分けて
 * 測る。素朴に点どうしの距離を測るとこの2つが混ざり、とくに**逆向きに書いた画の
 * 判定が置き場所に邪魔される**(位置がずれていると、前向きも逆向きも等しく遠いと
 * 出てしまう)。分けてから測るようにしただけで 上位1件が 87→93% に上がった。
 */
const POS_WEIGHT = 1.3;

/**
 * 1画の距離。逆向きに書いた画も小さな加点で許す。
 * 形の違い(重心を合わせたときの点どうしの差)と、重心そのもののずれに分けて測る。
 */
function strokeDist(
  q: Float64Array,
  qAt: number,
  ref: Uint8Array,
  refAt: number,
  n: number,
): number {
  // それぞれの重心
  let qx = 0, qy = 0, rx = 0, ry = 0;
  for (let k = 0; k < n; k++) {
    qx += q[qAt + k * 2];
    qy += q[qAt + k * 2 + 1];
    rx += ref[refAt + k * 2];
    ry += ref[refAt + k * 2 + 1];
  }
  qx /= n;
  qy /= n;
  rx = (rx / n) * INV63;
  ry = (ry / n) * INV63;
  const ox = qx - rx;
  const oy = qy - ry;
  const pos = Math.sqrt(ox * ox + oy * oy);

  // 重心を合わせたうえでの形の違い(前向き・逆向きの近いほう)
  let fwd = 0;
  let rev = 0;
  for (let k = 0; k < n; k++) {
    const ax = q[qAt + k * 2] - qx;
    const ay = q[qAt + k * 2 + 1] - qy;
    let dx = ax - (ref[refAt + k * 2] * INV63 - rx);
    let dy = ay - (ref[refAt + k * 2 + 1] * INV63 - ry);
    fwd += Math.sqrt(dx * dx + dy * dy);
    const r = refAt + (n - 1 - k) * 2;
    dx = ax - (ref[r] * INV63 - rx);
    dy = ay - (ref[r + 1] * INV63 - ry);
    rev += Math.sqrt(dx * dx + dy * dy);
  }
  return Math.min(fwd / n, rev / n + REVERSE_PENALTY) + POS_WEIGHT * pos;
}

export class HandwritingIndex {
  private n: number;
  /** 画数 -> その画数の字。画数フィルタを引きやすい持ち方 */
  private byCount = new Map<number, Ref[]>();
  readonly size: number;

  constructor(data: HandwritingData) {
    this.n = data.n;
    const per = data.n * 2;
    let id = 0;
    for (const [ch, enc] of Object.entries(data.chars)) {
      const m = (enc.length / per) | 0;
      if (m < 1) continue;
      const pts = new Uint8Array(m * per);
      for (let k = 0; k < m * per; k++) {
        pts[k] = CODE.get(enc.charCodeAt(k)) ?? 0;
      }
      const cents = new Float64Array(m * 2);
      for (let s = 0; s < m; s++) {
        let cx = 0;
        let cy = 0;
        for (let k = 0; k < data.n; k++) {
          cx += pts[s * per + k * 2];
          cy += pts[s * per + k * 2 + 1];
        }
        cents[s * 2] = (cx / data.n) * INV63;
        cents[s * 2 + 1] = (cy / data.n) * INV63;
      }
      // 続け書き用: 隣り合う2画をつなげ、同じ点数に引き直した形を先に作っておく
      const merged = new Uint8Array(Math.max(0, m - 1) * per);
      for (let s = 0; s + 1 < m; s++) {
        // 画 s と画 s+1 を続けて1本の折れ線にする(間は resample が直線で橋渡しする)
        const joined: HwPoint[] = [];
        for (let t = s; t <= s + 1; t++) {
          for (let k = 0; k < data.n; k++) {
            joined.push([
              pts[t * per + k * 2] * INV63,
              pts[t * per + k * 2 + 1] * INV63,
            ]);
          }
        }
        const r = resampleStroke(joined, data.n);
        for (let k = 0; k < data.n; k++) {
          merged[s * per + k * 2] = quantize(r[k][0]);
          merged[s * per + k * 2 + 1] = quantize(r[k][1]);
        }
      }
      const list = this.byCount.get(m);
      const ref: Ref = { ch, id: id++, m, pts, merged, cents };
      if (list) list.push(ref);
      else this.byCount.set(m, [ref]);
    }
    this.size = id;
  }

  /**
   * 描いた画から似ている字を返す(スコア昇順)。
   * strokes はキャンバス座標のままでよい(正規化はここで行う)。
   */
  match(strokes: readonly (readonly HwPoint[])[], limit = 32): HwMatch[] {
    const drawn = strokes.filter((s) => s.length > 0);
    if (!drawn.length) return [];
    const n = this.n;
    const per = n * 2;

    // 参照側と同じ正規化: 全画の外接枠 -> 等倍で 0..1 に中央寄せ
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const sampled = drawn.map((s) => resampleStroke(s, n));
    for (const s of sampled) {
      for (const [x, y] of s) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const scale = Math.max(maxX - minX, maxY - minY) || 1;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const k = sampled.length;
    const q = new Float64Array(k * per);
    for (let i = 0; i < k; i++) {
      for (let p = 0; p < n; p++) {
        q[i * per + p * 2] = 0.5 + (sampled[i][p][0] - midX) / scale;
        q[i * per + p * 2 + 1] = 0.5 + (sampled[i][p][1] - midY) / scale;
      }
    }

    const qCents = new Float64Array(k * 2);
    for (let i = 0; i < k; i++) {
      let cx = 0;
      let cy = 0;
      for (let p = 0; p < n; p++) {
        cx += q[i * per + p * 2];
        cy += q[i * per + p * 2 + 1];
      }
      qCents[i * 2] = cx / n;
      qCents[i * 2 + 1] = cy / n;
    }

    // 1段目: 画の重心どうしの距離だけで粗く選ぶ(点8つの照合より1桁速い)。
    // 続け書きした画の重心は参照の2画の中間に来るので、隣り合う重心の中点も
    // 比較対象に含める。重複対応を許す近似なので取りこぼしにくく、外れだけが落ちる。
    // 画数差のペナルティはここでは掛けない。続け書きかどうかは点列を見ないと
    // 分からず、本照合と違う罰を掛けると続け書きの本命ほどここで沈んでしまう
    const rough: { ref: Ref; cost: number }[] = [];
    for (const [m, refs] of this.byCount) {
      if (m < k - FEWER_OK || m > k + MORE_OK) continue;
      for (const ref of refs) {
        let total = 0;
        for (let i = 0; i < k; i++) {
          const qx = qCents[i * 2];
          const qy = qCents[i * 2 + 1];
          let best = UNMATCHED;
          for (let j = 0; j < m; j++) {
            let dx = qx - ref.cents[j * 2];
            let dy = qy - ref.cents[j * 2 + 1];
            const c = Math.sqrt(dx * dx + dy * dy);
            if (c < best) best = c;
            if (j + 1 < m) {
              dx = qx - (ref.cents[j * 2] + ref.cents[j * 2 + 2]) / 2;
              dy = qy - (ref.cents[j * 2 + 1] + ref.cents[j * 2 + 3]) / 2;
              const cm = Math.sqrt(dx * dx + dy * dy) + MERGE_PENALTY;
              if (cm < best) best = cm;
            }
          }
          total += best;
        }
        rough.push({ ref, cost: total / k });
      }
    }
    rough.sort((a, b) => a.cost - b.cost || a.ref.id - b.ref.id);

    // 2段目: 残った候補だけ、点列で貪欲に対応づけて本照合。
    // 対応相手は「参照の1画」か「隣り合う2画をつなげた形」(続け書き)のどちらか
    const scored: { ch: string; id: number; score: number; strokes: number }[] = [];
    const used = new Uint8Array(k + MORE_OK + 1);
    const take = Math.min(rough.length, PREFILTER);
    for (let r = 0; r < take; r++) {
      const ref = rough[r].ref;
      const m = ref.m;
      let total = 0;
      let consumed = 0; // 対応づいた参照側の画数(続け書きは2と数える)
      used.fill(0, 0, m);
      const jStep = m > 1 ? 1 / (m - 1) : 0;
      const iStep = k > 1 ? 1 / (k - 1) : 0;
      for (let i = 0; i < k; i++) {
        const iAt = i * iStep;
        let best = UNMATCHED;
        let bestJ = -1;
        let bestMerge = false;
        for (let j = 0; j < m; j++) {
          if (used[j]) continue;
          const bias = ORDER_BIAS * Math.abs(iAt - j * jStep);
          const c = strokeDist(q, i * per, ref.pts, j * per, n) + bias;
          if (c < best) {
            best = c;
            bestJ = j;
            bestMerge = false;
          }
          if (j + 1 < m && !used[j + 1]) {
            const cm =
              strokeDist(q, i * per, ref.merged, j * per, n) +
              MERGE_PENALTY +
              bias;
            if (cm < best) {
              best = cm;
              bestJ = j;
              bestMerge = true;
            }
          }
        }
        if (bestJ >= 0) {
          used[bestJ] = 1;
          consumed++;
          if (bestMerge) {
            used[bestJ + 1] = 1;
            consumed++;
          }
        }
        total += best;
      }
      // 対応が残らなかった参照の画(=描かれなかったぶん)だけを咎める
      scored.push({
        ch: ref.ch,
        id: ref.id,
        score: total / k + (m - consumed) * EXTRA_REF,
        strokes: m,
      });
    }
    // 同点は辞書順で割る(Swift の sort は安定ではないので実装任せにしない)
    scored.sort((a, b) => a.score - b.score || a.id - b.id);
    return scored
      .slice(0, limit)
      .map(({ ch, score, strokes }) => ({ ch, score, strokes }));
  }
}

/** 0〜1 を 0〜63 の目盛りへ。丸めは3実装で同じ規則(正の値の四捨五入) */
function quantize(v: number): number {
  const q = Math.round(v * 63);
  return q < 0 ? 0 : q > 63 ? 63 : q;
}
