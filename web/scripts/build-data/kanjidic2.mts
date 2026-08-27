// KANJIDIC2(EDRDG, CC BY-SA 4.0) から読み・学年・頻度を取る。
// ここに載っている字が、このアプリでの「日本の漢字」の定義になる。
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SRC } from "./paths.mts";

export interface KanjiInfo {
  /** 学年。1〜6=小学校, 8=常用, 9/10=人名用, 0=指定なし */
  grade: number;
  /** 頻度順位(1が最頻)。0=圏外 */
  freq: number;
  on: string[];
  kun: string[];
  /**
   * 人名でだけ使う読み(KANJIDIC2 の <nanori>)。「正式な音訓ではないが実際に
   * 使われる読み」で、名前を打つときはこれが無いと引けない字が多い。
   * 音訓とは別に持ち、UI でも「人名」と断って出す
   */
  nanori: string[];
  /** 画数。0=データなし */
  strokes: number;
  /** 康熙部首番号(1〜214)。0=データなし。字は U+2F00+n-1 で引ける */
  rad: number;
  /** 意味(KANJIDIC2の英語グロス)。日本語の語釈データは無いので英語のまま出す */
  meaning: string[];
}

/** 字 -> 読み・学年・頻度 */
export function loadKanjidic2(): Map<string, KanjiInfo> {
  // 展開済み xml は 15MB あってリポジトリに入れていないので、無ければ .gz から読む
  const xml = existsSync(SRC.kanjidic2Xml)
    ? readFileSync(SRC.kanjidic2Xml, "utf8")
    : gunzipSync(readFileSync(SRC.kanjidic2Gz)).toString("utf8");

  const out = new Map<string, KanjiInfo>();
  for (const block of xml.split("</character>")) {
    const lit = block.match(/<literal>(.+?)<\/literal>/);
    if (!lit) continue;
    const grade = block.match(/<grade>(\d+)<\/grade>/);
    const freq = block.match(/<freq>(\d+)<\/freq>/);
    const on = [...block.matchAll(/<reading r_type="ja_on">(.+?)<\/reading>/g)].map(
      (m) => m[1],
    );
    const kun = [...block.matchAll(/<reading r_type="ja_kun">(.+?)<\/reading>/g)].map(
      (m) => m[1],
    );
    const nanori = [...block.matchAll(/<nanori>(.+?)<\/nanori>/g)].map((m) => m[1]);
    const strokes = block.match(/<stroke_count>(\d+)<\/stroke_count>/);
    const rad = block.match(/<rad_value rad_type="classical">(\d+)<\/rad_value>/);
    // m_lang 属性なし = 英語。他言語(<meaning m_lang="fr">など)は拾わない
    const meaning = [...block.matchAll(/<meaning>([^<]+)<\/meaning>/g)].map(
      (m) => m[1],
    );
    out.set(lit[1], {
      grade: grade ? +grade[1] : 0,
      freq: freq ? +freq[1] : 0,
      // 候補一覧に出す用途なので先頭4つで足りる
      on: on.slice(0, 4),
      kun: kun.slice(0, 4),
      nanori: nanori.slice(0, 6),
      strokes: strokes ? +strokes[1] : 0,
      rad: rad ? +rad[1] : 0,
      meaning: meaning.slice(0, 3),
    });
  }
  return out;
}
