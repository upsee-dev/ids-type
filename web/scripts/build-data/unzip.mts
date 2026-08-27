// zip の中の1ファイルだけを取り出す(依存なし)。
//
// Unihan は上流が zip でしか配られておらず、展開すると 25MB ある。
// data-src/ は「上流のまま置く」決まりなので zip のまま置き、ビルドのときに
// 必要な3ファイルだけをここで取り出す。Node に zip を読む API は無いが、
// 中身の圧縮は deflate なので zlib.inflateRawSync でそのまま戻せる。
//
// 読むのは末尾の中央ディレクトリ(EOCD → セントラルディレクトリ)。先頭から
// ローカルヘッダを辿る作り方もあるが、それだと目的のファイルに当たるまで
// 8MB を舐めることになるので、目次を引いて1回だけ seek する。
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** zip の目次(セントラルディレクトリ)の位置。末尾から EOCD を探す */
function findEocd(buf: Buffer): number {
  // コメント最大 65535 + EOCD 22 バイトぶんだけ後ろから見る
  const from = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("zip の EOCD が見つかりません(壊れているか zip ではない)");
}

/**
 * zip の中の `name` を取り出して Buffer で返す。
 * 見つからない・未対応の圧縮方式ならエラー(黙って空を返さない。
 * 辞書が静かに減るのがいちばん困るため)。
 */
export function readZipEntry(zipPath: string, name: string): Buffer {
  const buf = readFileSync(zipPath);
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // セントラルディレクトリの先頭

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error("zip の目次が壊れています");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const entry = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (entry === name) {
      // ローカルヘッダは名前・拡張フィールドの長さが目次と違うことがあるので読み直す
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const from = localOff + 30 + lNameLen + lExtraLen;
      const body = buf.subarray(from, from + compSize);
      if (method === 0) return Buffer.from(body); // 無圧縮
      if (method === 8) return inflateRawSync(body); // deflate
      throw new Error(`zip の圧縮方式 ${method} には対応していません: ${name}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip の中に ${name} がありません: ${zipPath}`);
}
