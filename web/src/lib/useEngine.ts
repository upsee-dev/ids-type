"use client";

import { useEffect, useState } from "react";
import { Engine } from "./engine";

/**
 * 辞書(約2.4MB / gzip 0.8MB)を読んで Engine を組み立てる。
 * 入力画面と一覧画面で同じ処理なのでここにまとめている。
 * ブラウザが同じURLをキャッシュするので、画面を行き来しても再ダウンロードは起きない。
 */
export function useEngine(): { engine: Engine | null; loadError: boolean } {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/data/kanji-data.json")
      .then((r) => r.json())
      .then((raw) => {
        if (alive) setEngine(new Engine(raw));
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { engine, loadError };
}
