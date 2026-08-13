// KanjiVG(CC BY-SA 3.0)の字形SVGを折れ線に直す。
//
// パターン辞書の生成(build-handwriting.mts)と、異体字を使った精度評価
// (build-handwriting-bench.mts)の両方が使う。上流の d="…" は M と C/S が
// ほとんどだが、まれな L/H/V/Q/T も受ける。


import { resampleStroke } from "../../../core/handwriting.ts";

/** パス文字列をコマンドと数値の列に分ける */
function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtZzAa])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/g;
  for (const m of d.matchAll(re)) {
    if (m[1]) out.push(m[1]);
    else out.push(parseFloat(m[2]));
  }
  return out;
}

/** 3次ベジェを刻んで点列に足す(始点は含めない) */
function cubic(
  pts: number[][],
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): void {
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    pts.push([
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ]);
  }
}

/**
 * 1画ぶんのパスを折れ線にする。KanjiVG が使うのは M と C/c/S/s がほぼ全部
 * だが、まれな L/H/V/Q/T も受ける。A(円弧)は KanjiVG に無い(出たら直線で逃げる)。
 */
export function samplePath(d: string): number[][] {
  const toks = tokenize(d);
  const pts: number[][] = [];
  let x = 0, y = 0;         // 現在点
  let sx = 0, sy = 0;       // サブパス始点(Z用)
  let cx = 0, cy = 0;       // 直前の制御点(S/T の鏡映用)
  let prev = "";            // 直前のコマンド(制御点の鏡映が効く条件)
  let i = 0;
  let cmd = "";
  const num = () => toks[i++] as number;
  while (i < toks.length) {
    if (typeof toks[i] === "string") cmd = toks[i++] as string;
    // コマンド省略時は直前を繰り返す(M の繰り返しは L 扱い)
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        x = sx = nx; y = sy = ny;
        pts.push([x, y]);
        break;
      }
      case "L": {
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        x = nx; y = ny;
        pts.push([x, y]);
        break;
      }
      case "H": {
        x = num() + (rel ? x : 0);
        pts.push([x, y]);
        break;
      }
      case "V": {
        y = num() + (rel ? y : 0);
        pts.push([x, y]);
        break;
      }
      case "C": {
        const x1 = num() + (rel ? x : 0), y1 = num() + (rel ? y : 0);
        const x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0);
        const x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0);
        cubic(pts, x, y, x1, y1, x2, y2, x3, y3);
        cx = x2; cy = y2; x = x3; y = y3;
        break;
      }
      case "S": {
        // 直前が C/S なら制御点を鏡映、でなければ現在点
        const c1x = /[CcSs]/.test(prev) ? 2 * x - cx : x;
        const c1y = /[CcSs]/.test(prev) ? 2 * y - cy : y;
        const x2 = num() + (rel ? x : 0), y2 = num() + (rel ? y : 0);
        const x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0);
        cubic(pts, x, y, c1x, c1y, x2, y2, x3, y3);
        cx = x2; cy = y2; x = x3; y = y3;
        break;
      }
      case "Q": {
        const qx = num() + (rel ? x : 0), qy = num() + (rel ? y : 0);
        const x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0);
        // 2次を3次に持ち上げて同じ経路で刻む
        cubic(pts, x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
        cx = qx; cy = qy; x = x3; y = y3;
        break;
      }
      case "T": {
        const qx = /[QqTt]/.test(prev) ? 2 * x - cx : x;
        const qy = /[QqTt]/.test(prev) ? 2 * y - cy : y;
        const x3 = num() + (rel ? x : 0), y3 = num() + (rel ? y : 0);
        cubic(pts, x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
        cx = qx; cy = qy; x = x3; y = y3;
        break;
      }
      case "Z": {
        x = sx; y = sy;
        pts.push([x, y]);
        break;
      }
      case "A": {
        // KanjiVG には出ない。出たら端点まで直線で逃げる(rx ry rot laf sf x y)
        num(); num(); num(); num(); num();
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        x = nx; y = ny;
        pts.push([x, y]);
        break;
      }
    }
    prev = cmd;
  }
  return pts;
}

/**
 * KanjiVG の1字ぶんの中身(<path d="…"> の並び)から、画ごとの折れ線を取り出す。
 * 弧長等間隔の間引きは照合側と同じ実装を使う(core/handwriting.ts の resampleStroke)。
 */
export function strokesOf(body: string, points: number): number[][][] {
  const out: number[][][] = [];
  for (const p of body.matchAll(/\sd="([^"]+)"/g)) {
    out.push(
      resampleStroke(
        samplePath(p[1]).map(([x, y]) => [x, y] as const),
        points,
      ),
    );
  }
  return out;
}
