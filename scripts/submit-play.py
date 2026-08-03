#!/usr/bin/env python3
"""ローカルでビルドした AAB を Google Play へ上げる。

    python3 scripts/submit-play.py native/android/app/build/outputs/bundle/release/app-release.aab

EAS を使わずこのマシンだけで完結させる。認証は store/AuthKey/GPC_AuthKey.json
（Play Console のサービスアカウント・.gitignore 済み）。

Play の更新は「edit（編集セッション）」を1つ作り、その中で
アップロード → トラックへ割り当て → commit の順に進める。commit するまでは
Play 側に何も反映されないので、途中で失敗しても中途半端な状態にはならない。

既定の投入先は internal（内部テスト）。ここから Play Console で
クローズドβ→製品版へ「昇格」させる運用（eas.json の submit 設定と同じ）。
"""

import json
import sys
from pathlib import Path

import google.auth.transport.requests
import requests
from google.oauth2 import service_account

ROOT = Path(__file__).resolve().parent.parent
KEY = ROOT / "store/AuthKey/GPC_AuthKey.json"
PACKAGE = "com.upsee.idskanjitype"
TRACK = "internal"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"使い方: {sys.argv[0]} <path-to.aab> [リリースノート]")
    aab = Path(sys.argv[1])
    if not aab.exists():
        sys.exit(f"AAB がありません: {aab}")
    notes = sys.argv[2] if len(sys.argv) > 2 else ""

    if not KEY.exists():
        sys.exit(f"サービスアカウント鍵がありません: {KEY}")

    creds = service_account.Credentials.from_service_account_file(
        str(KEY), scopes=[SCOPE]
    )
    creds.refresh(google.auth.transport.requests.Request())
    auth = {"Authorization": f"Bearer {creds.token}"}

    def check(r: requests.Response, what: str) -> dict:
        if not r.ok:
            sys.exit(f"{what} に失敗 ({r.status_code}):\n{r.text}")
        return r.json() if r.content else {}

    # 1. 編集セッションを開く
    edit = check(
        requests.post(f"{API}/{PACKAGE}/edits", headers=auth, timeout=60),
        "編集セッションの作成",
    )
    eid = edit["id"]
    print(f"edit {eid} を開始")

    # 2. AAB を上げる（66MB あるので時間がかかる）
    print(f"アップロード中: {aab.name} ({aab.stat().st_size / 1024 / 1024:.0f} MB)")
    with aab.open("rb") as f:
        up = check(
            requests.post(
                f"{UPLOAD}/{PACKAGE}/edits/{eid}/bundles?uploadType=media",
                headers={**auth, "Content-Type": "application/octet-stream"},
                data=f,
                timeout=1800,
            ),
            "AAB のアップロード",
        )
    version_code = up["versionCode"]
    print(f"versionCode {version_code} として受理された")

    # 3. トラックに割り当てる
    release = {"versionCodes": [str(version_code)], "status": "completed"}
    if notes:
        release["releaseNotes"] = [{"language": "ja-JP", "text": notes}]
    check(
        requests.put(
            f"{API}/{PACKAGE}/edits/{eid}/tracks/{TRACK}",
            headers={**auth, "Content-Type": "application/json"},
            data=json.dumps({"track": TRACK, "releases": [release]}),
            timeout=120,
        ),
        f"{TRACK} トラックへの割り当て",
    )
    print(f"{TRACK} トラックに割り当てた")

    # 4. 確定（ここで初めて Play に反映される）
    check(
        requests.post(
            f"{API}/{PACKAGE}/edits/{eid}:commit", headers=auth, timeout=300
        ),
        "commit",
    )
    print(f"完了: versionCode {version_code} を {TRACK} で公開した")


if __name__ == "__main__":
    main()
