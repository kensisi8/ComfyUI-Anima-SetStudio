# ComfyUI-Anima-SetStudio 実装タスクリスト (TASKS.md)

進捗管理用チェックリストです。上から順に1ステップずつ実装・テスト検証しながら進めます。

---

## フェーズ1：土台＆バックエンド構築（ローカル単体テスト完結）
- [x] **Task 1: プロジェクト骨格＆永続化ストレージ (`backend/storage.py`)**
  - `.gitignore`、パッケージ骨格（`__init__.py`, `backend/__init__.py`）を作成。
  - `ComfyUI/user/anima_set_studio/` へのセットCRUD（一覧・保存・更新・複製・削除）と `state.json` 保存/読込を実装。
  - IDサニタイズ、アトミック書き込み（一時ファイル経由置換）を実装。
  - `tests/test_storage.py` を作成し、`unittest` で全パス確認。

- [x] **Task 2: 合成ロジック＆ComfyUIワークフロー生成 (`backend/composer.py`)**
  - 除外カテゴリの判定（前後空白・大文字小文字の正規化対応）とセット側プロンプト抽出。
  - 案Bルール（共通プロンプト先頭 ＋ 各セットの有効・非除外カテゴリを上から順）の合成。
  - 共通LoRA ＋ セットLoRAの合体（同名重複時はセット側優先、無効LoRA除外）。
  - `AnimaMultiLoraLoader` + `AnimaPromptPlusClipEncode` を使用した ComfyUI API `/prompt` 用ワークフローJSON生成（＋未導入時の標準ノードフォールバック）および複数枚数ごとのユニークシード発行。
  - `tests/test_composer.py` を作成し、`unittest` で全パス確認。

- [x] **Task 3: バックエンドHTTP APIルート (`backend/routes.py`, `__init__.py`)**
  - `PromptServer.instance.routes` に `/anima-set-studio/api/*` エンドポイント（`sets`, `state`, `options`, `build-jobs`）を登録。
  - `folder_paths` / `comfy.samplers` / `nodes.NODE_CLASS_MAPPINGS` から利用可能モデル・サンプラー・`Comfyui-Anima-Tools` 導入有無を動的取得。
  - ルートハンドラの単体テスト（`tests/test_routes.py`）＆ `py_compile` 検証。

---

## フェーズ2：フロントエンド連携＆UI構築
- [x] **Task 4: `Comfyui-Anima-Tools` 連携ブリッジ (`js/api.js`, `js/bridge_anima_tools.js`)**
  - `Anima Prompt Plus` の `openBoxSelector`（`Select` ポップアップ）を動的 `import` して呼び出すブリッジ実装。
  - `Anima Multi LoRA Loader` の仮想ノード経由で本家 `LoRA Manager` ポップアップを開き双方向同期するブリッジ実装（未導入時のフォールバック含む）。
  - `node --check` 構文検証。

- [x] **Task 5: `Anima Prompt Plus` ＆ `Anima Multi LoRA Loader` 完全互換UI部品 (`js/components/`)**
  - `prompt_boxes.js`: カテゴリ名クリック編集、ドラッグ並び替え、無効化、ランダムメニュー、クリア、コピー、`Select` ボタン、削除、`+ Add Text Box`、除外カテゴリ自動非表示対応。
  - `lora_list.js`: サムネイル、ON/OFFトグル、強度スライダー＋数値入力、トリガーワードコピー、削除、LoRA追加ボタン（`LoRA Manager` 起動）。
  - `settings.js`: ネガティブプロンプト、解像度（プリセット付き）、1セットあたり枚数、折りたたみ詳細設定（モデル/CLIP/VAE/Shift/Steps/CFG/Sampler/Scheduler/保存プレフィックス）。
  - `node --check` 構文検証。

- [x] **Task 6: メイン画面（セット管理タブ ＆ イラスト集作成タブ）(`js/views/`, `js/styles.js`, `js/index.js`)**
  - ComfyUI画面上の起動ボタン（左下フローティングボタン＋`Alt+S`ショートカット）および大型モーダル画面。
  - **セット管理タブ**: セット一覧・検索・新規作成（6カテゴリ雛形あり）・編集・名前変更・複製・削除・保存・イラスト集への追加。
  - **イラスト集作成タブ**:
    1. 複数セット呼出・並替・削除・個別枚数設定
    2. 全セットから集計した「使わない（隠す）カテゴリ」選択チップ（＋「共通と同名を隠す」ボタン）→ 選択カテゴリを全セットカードから即時非表示
    3. 呼び出した各セットカードでの一時編集（＋「上書き」「別名保存」）
    4. 共通プロンプト＆共通LoRA＆生成設定入力（自動保存）
    5. `[実行]` ボタンで全セット分のジョブを生成し ComfyUI `/prompt` へ一括投入＆進捗表示
  - `node --check` 構文検証。

---

## フェーズ3：統合検証・ドキュメント・Colab連携
- [x] **Task 7: 全体テスト・ドキュメント (`README.md`) 作成**
  - 全Python単体テスト・全JS構文チェック・機密情報混入チェックを実行。
  - `README.md` にインストール方法・使い方を記載。

- [x] **Task 8: Colabノートブック (`../ComfyUI_Anima_Colab.ipynb`) への自動セットアップ組み込み**
  - GitHub URL（`SET_STUDIO_REPO_URL`）からの自動 `git clone` / `pull` および Googleドライブ配置フォルダからの読み込みに対応し、JSON/AST構文検証を完了。
