# GEMINI.md - ComfyUI-Anima-SetStudio 開発ルール

## 基本方針
- ユーザーへの回答・コメント・UI文言は **日本語** を基本とする。
- 実装・変更を行う前に必ず [SPEC.md](./SPEC.md) と [TASKS.md](./TASKS.md) を参照し、仕様から逸脱しないこと。
- 仕様変更や新しい設計判断が必要になった場合は、先に `SPEC.md` を更新してから実装する。
- タスクを完了したら [TASKS.md](./TASKS.md) の該当チェックボックスを更新する。

## 技術・コード制約
- **ゼロ外部依存**: Python は標準ライブラリおよび ComfyUI 同梱ライブラリ（`aiohttp`, `folder_paths`, `server` 等）のみ使用する。新しい `pip` パッケージ依存を追加しない。
- **ビルド不要のフロントエンド**: JavaScript はネイティブ ES Modules（Vanilla JS）で書き、Webpack / Vite / npm ビルドを必要としない構成を保つ。
- **`Comfyui-Anima-Tools` との互換性維持**:
  - `loras` 配列は `AnimaMultiLoraLoader` の `lora_list_json` スキーマと完全互換にする。
  - `prompt_boxes` 配列は `AnimaPromptPlus` の `prompt_boxes` スキーマ（`id`, `label`, `text`, `disabled`, `random`, `picks`）と完全互換にする。
  - `Comfyui-Anima-Tools` が未導入・またはAPI変更時でもエラーで画面がクラッシュしないフォールバックを用意する。
- **セキュリティ・公開リポジトリ前提**:
  - Civitai APIキー、Googleドライブの個人アカウント固有パス、トークン類をコード内に一切ハードコードしない。
  - ファイル保存時はセットID等のサニタイズを行い、パストラバーサルを防止する。

## 検証・テストルール（必須）
コードを変更したら完了報告の前に必ず以下を実行してパスすることを確認する：
1. **Python 構文 & 単体テスト**:
   - `python -m unittest discover -s tests -v` が全件パスすること。
   - `python -m py_compile` で全 `.py` ファイルに構文エラーがないこと。
2. **JavaScript 構文チェック**:
   - 変更した全 `.js` ファイルに対して `node --check <file>` がエラーゼロで通ること。
3. **Colab ノートブック連携時**:
   - `../ComfyUI_Anima_Colab.ipynb` を変更した場合は、`json.load` と `ast.parse` で構文検証すること。
