import Link from "next/link";

/**
 * ストア提出に必要な静的ページ（プライバシーポリシー・アカウント削除・
 * サポート・マーケティング）の共通の枠。
 * 入力画面と違ってスクロールする普通のページなので、body の overflow を上書きする。
 */
export function StorePage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <header className="mb-8 border-b border-stone-200 pb-6 dark:border-stone-800">
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-indigo-600 dark:text-stone-400"
          >
            ← 漢字カタチ入力
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-wide">{title}</h1>
          {updated && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              最終更新: {updated}
            </p>
          )}
        </header>

        <main className="space-y-8 text-sm leading-relaxed">{children}</main>

        <footer className="mt-12 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-200 pt-6 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          <Link href="/privacy" className="hover:text-indigo-600">
            プライバシーポリシー
          </Link>
          <Link href="/account-deletion" className="hover:text-indigo-600">
            アカウント削除
          </Link>
          <Link href="/support" className="hover:text-indigo-600">
            サポート
          </Link>
          <Link href="/about" className="hover:text-indigo-600">
            漢字カタチ入力について
          </Link>
          <span className="ml-auto">Upsee Inc.</span>
        </footer>
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-stone-700 [&_a]:text-indigo-600 [&_a]:underline [&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_li]:ml-5 [&_li]:list-disc dark:text-stone-300 dark:[&_code]:bg-stone-800">
        {children}
      </div>
    </section>
  );
}
