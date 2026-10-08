// IRG ワーキングセット(WS2015・WS2017・WS2021・WS2024)の審査ツールから、
// 提案された字の「読み」を集める。
//
//   cd web && npm run fetch:irg     # 続きから(取れている番号は飛ばす)
//   npm run fetch:irg -- --force   # 最初から取り直す
//   npm run fetch:irg -- --ws=ws2024
//
// 上流は https://hc.jsecs.org/irg/<ws>/app/?id=NNNNN (Henry Chan 氏の審査ツール。
// IRG #50 以降は更新が止まった資料庫扱い)。字ごとのページに、各国・地域が提案時に
// 付けた表(Raw Info / 証拠の表)が載っていて、そこに読みの欄がある：
//
//   WS2015  読みの欄は無い(備考に書かれていることがある)
//   WS2017  G「Optional Information」(古壮字は "(Reading: aep)")・V「Reading」
//   WS2021  T「l) Optional info」(拼音)・GZ「l) Optional info」(壮語)・V「Reading」
//   WS2024  各源の「Pronunciation」(拼音・壮語・ハングル・ベトナム語)
//
// どれも**日本語の読みではない**(日本は J源を出していない)。何語の読みかは
// 源の記号で決まる(build-data/irg.mts)。ここでは加工せず、ページにあるまま取る。
//
// 異体字セレクタ(Itai-ji-selection)にも同じスクリプトがある。取れたものは
// data-src/irg/ にそのまま置くので、片方で取ったものを複製して使ってよい。
//
// 行儀：2本ずつ・1本ごとに 400ms 空ける。個人運営の資料庫なので、
// 失敗が続いたら休み、それでも直らなければ止める。1字1行の JSONL に書き足すので
// 途中で止めても続きから再開できる。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_SRC } from "./build-data/paths.mts";

const OUT_DIR = join(DATA_SRC, "irg");
const BASE = "https://hc.jsecs.org/irg";

/** 番号の上限。各ワーキングセットの索引ページにある最後の番号(WS2015 は索引が無いので空振りで止める) */
const WORKSETS: { ws: string; last?: number }[] = [
  { ws: "ws2015" },
  { ws: "ws2017", last: 5039 },
  { ws: "ws2021", last: 4952 },
  { ws: "ws2024", last: 4674 },
];

const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--ws="))?.slice(5);
/** 動きを見るときだけ使う。各ワーキングセットの先頭 N 番でやめる */
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 0);

const CONCURRENCY = 2;
const SPACING_MS = 400;
const COOLDOWN_MS = 60_000;
const GIVE_UP_AFTER = 5;
/** 索引の無い WS2015 は、これだけ続けて空のページが返ったら終わりとみなす */
const EMPTY_STREAK_END = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

export type IrgPage = {
  sn: string;
  /** ページの見出し("00115 | ⿱七二 | WS2015v5.0") */
  title: string;
  /** 審議の記録(統合・保留など) */
  discussion: string;
  /** 源の記号 → その源の表(空欄は落とす) */
  sources: Record<string, Record<string, string>>;
};

/**
 * 1ページを読む。WS2015/2017 は全源を1枚にまとめた「Raw Info」の表、
 * WS2021/2024 は源ごとの表を JSON で埋め込んだ <ws-evidences data-evidence> を持つ。
 */
function parse(sn: string, html: string): IrgPage | null {
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  if (!title.startsWith(sn)) return null; // 番号の外は空のページが返る
  const disc = html.match(/class=ws201[5-7]_chart_table_discussion>\s*<div>([\s\S]*?)<\/div>/);
  const discussion = decode(disc?.[1] ?? "");
  const sources: IrgPage["sources"] = {};

  // 源ごとの表(WS2021/2024 はここに全部ある。WS2017 は空の箱だけ)
  const ev = html.match(/data-evidence="([^"]*)"/);
  if (ev) {
    // 源によっては中身が null のことがある(WS2017 の一部のページ)
    const data = JSON.parse(decode(ev[1])) as Record<string, { info?: { data?: Record<string, string> | null } | null } | null>;
    for (const [ref, v] of Object.entries(data)) {
      const row: Record<string, string> = {};
      for (const [k, val] of Object.entries(v?.info?.data ?? {})) {
        const t = String(val ?? "").trim();
        if (t) row[k.trim()] = t;
      }
      sources[ref] = row;
    }
  }
  // 全源を1枚にまとめた表(WS2015/2017): <tr><td>12 - G Source</td><td>GHZR10014.07</td></tr>
  const raw = html.slice(Math.max(0, html.indexOf("Raw Info")));
  const row: Record<string, string> = {};
  for (const m of raw.matchAll(/<tr><td>\s*\d+ - ([^<]*)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)) {
    const v = decode(m[2]);
    if (v) row[m[1].replace(/\s+/g, " ").trim()] = v;
  }
  if (Object.keys(row).length) {
    // 源ごとに分ける("T Source" が源の記号、"T ..." がその源の欄)
    const regions = Object.keys(row)
      .filter((k) => / Source$/.test(k))
      .map((k) => k.replace(/ Source$/, ""));
    for (const reg of regions) {
      const ref = row[`${reg} Source`];
      const r: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) if (k.startsWith(`${reg} `)) r[k.slice(reg.length + 1)] = v;
      sources[ref] = { ...sources[ref], ...r };
    }
    // 源に属さない欄(番号・部首・IDS など)。K源の欄は "i1) Page No." のように
    // 地域名が付かないのでここに落ちるが、読みの欄ではないので害は無い
    const common: Record<string, string> = {};
    for (const [k, v] of Object.entries(row))
      if (!regions.some((reg) => k.startsWith(`${reg} `))) common[k] = v;
    sources["*"] = common;
  }
  return { sn, title, discussion, sources };
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "katachi-ime/1.0 (reading index; polite)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchWorkset(ws: string, last?: number) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${ws}.jsonl`);
  if (force && existsSync(file)) writeFileSync(file, "");
  const done = new Set<string>();
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) if (line) done.add(JSON.parse(line).sn);

  let next = 1;
  let emptyStreak = 0;
  let stop = false;
  let failures = 0;
  let got = 0;

  const worker = async () => {
    while (!stop) {
      const n = next++;
      if ((last && n > last) || (limit && n > limit)) return;
      const sn = String(n).padStart(5, "0");
      if (done.has(sn)) {
        emptyStreak = 0;
        continue;
      }
      let html: string;
      try {
        html = await get(`${BASE}/${ws}/app/?id=${sn}`);
        failures = 0;
      } catch (e) {
        failures++;
        console.log(`  ${ws} ${sn} 失敗 (${(e as Error).message}) — ${failures}回目`);
        if (failures >= GIVE_UP_AFTER) {
          console.log(`  失敗が続くので止める。あとで npm run fetch:irg で続きから`);
          stop = true;
          process.exitCode = 1;
          return;
        }
        next = Math.min(next, n); // 取り直す
        await sleep(COOLDOWN_MS);
        continue;
      }
      const page = parse(sn, html);
      if (!page) {
        if (last) console.log(`  ${ws} ${sn} 空のページ`);
        if (++emptyStreak >= EMPTY_STREAK_END && !last) stop = true;
      } else {
        emptyStreak = 0;
        appendFileSync(file, JSON.stringify(page) + "\n");
        got++;
        if (got % 200 === 0) console.log(`  ${ws} ${sn} まで (${got}件)`);
      }
      await sleep(SPACING_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`${ws}: 新たに ${got} 件 (取得済み ${done.size} 件)`);
}

for (const { ws, last } of WORKSETS) {
  if (only && ws !== only) continue;
  await fetchWorkset(ws, last);
  if (process.exitCode) break;
}
