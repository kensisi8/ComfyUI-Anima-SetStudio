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

---

## フェーズ4：画像からのセット読み取り機能
- [x] **Task 9: 画像メタデータ解析エンジン＆API (`backend/image_importer.py`, `backend/routes.py`)**
  - PNG (`tEXt`/`iTXt`/`zTXt`)・WebP・JPEG から ComfyUI `prompt` / `workflow` および A1111 `parameters` をゼロ外部依存で抽出。
  - `KSampler` からのグラフ逆追跡により、`AnimaPromptPlus` / `AnimaPromptPlusClipEncode` / `Anima*Selector` / `CLIPTextEncode` のカテゴリ別プロンプトと、`AnimaMultiLoraLoader` / `LoraLoader` / `LoraLoaderModelOnly` / `Power Lora Loader` / `<lora:...>` の LoRAリストを抽出。
  - 単一テキストプロンプト時の自動カテゴリ仕分け（＋1枠保持データ返却）とローカル LoRA パス照合を実装。
  - `POST /anima-set-studio/api/import-image` を登録し、`tests/test_image_importer.py` と `tests/test_routes.py` で単体テストを全パス確認。

- [x] **Task 10: セット管理画面への画像インポートUI追加 (`js/api.js`, `js/views/studio_modal.js`, `js/styles.js`, `README.md`)**
  - セット管理タブに「🖼️ 画像から読み込む」ドロップゾーン＆ファイル選択ボタンを追加（新規セットとして読込／編集中セットへ反映に対応）。
  - 読込結果バナー（復元元種別・LoRA件数・カテゴリ件数・自動仕分け⇔1枠切替ボタン）を実装。
  - `node --check`・全 `unittest`・機密チェックを実行して完了確認。

---

## フェーズ5：LoRA Manager 連携修正＆軽量サムネイル機能
- [x] **Task 11: LoRA Manager `Apply to Node` 時の `this.graph?.canvasAction is not a function` 修正 (`js/bridge_anima_tools.js`)**
  - 仮想 `AnimaMultiLoraLoader` ノードの `graph` スタブに `canvasAction` / `change` / `trigger` 等を実装し、`setDirtyCanvas` から元グラフ描画を呼ばずに安全に SetStudio へ同期するよう修正。

- [x] **Task 12: セット用軽量サムネイルアップロード・保存・表示 (`backend/storage.py`, `backend/routes.py`, `js/api.js`, `js/views/studio_modal.js`, `js/views/set_card.js`, `js/styles.js`)**
  - ブラウザ側Canvas＋バックエンド側Pillowの二段最適化で、長辺最大320px・軽量 `.webp`（フォールバック `.jpg`）へ自動縮小＆変換して保存。
  - セット編集画面のサムネアップローダー（クリック＆ドロップ・削除・変換後サイズ表示）およびセット一覧・呼出モーダル・カードへのサムネ表示を追加。
  - 参照カウント付きクリーンアップ（複製セットのサムネ保護＆不要ファイル自動削除）と単体テストを追加。

---

## フェーズ6：セット別アスペクト比（基準解像度方式・案B）＆ウィンドウ誤閉じ防止
- [x] **Task 13: セット別アスペクト比＆基準解像度計算 (`backend/storage.py`, `backend/composer.py`, `backend/image_importer.py`, `js/aspect_ratio.js`, `js/components/settings.js`, `js/views/set_card.js`, `js/views/studio_modal.js`)**
  - イラスト集作成画面を「生成サイズ感（基準解像度：`ラフ 768` / `標準 1024` / `高画質 1216` / `特大 1408` ＋ 共通デフォルト比率）」入力（案B）へ更新。
  - セット管理画面＆呼び出し済みセットカードにアスペクト比選択（8プリセット＋カスタム比率＋実寸プレビュー表示）を追加し、画像インポート時の縦横比自動検出に対応。
  - SetStudio メインウィンドウを「`✕` ボタンを押した時だけ閉じる」挙動へ修正（背景クリック・Escによる誤閉じを無効化）。

- [x] **Task 14: セット単位での共通プロンプトカテゴリ無効化オプション (`backend/storage.py`, `backend/composer.py`, `js/views/studio_modal.js`, `js/views/set_card.js`, `js/styles.js`)**
  - 各セットに `disabled_common_categories` を保存できるようにし、そのセットの生成時のみ該当カテゴリの共通プロンプトを除外（イラスト集作成の `excluded_categories` によるセット側除外とは完全に独立）。
  - セット編集画面のチップ選択＋任意カテゴリ追加欄、および呼び出し済みセットカード内での一時編集・バッジ表示を実装。

- [x] **Task 15: イラスト集作成タブへの専用セット並び替えモーダル追加 (`js/views/studio_modal.js`, `js/styles.js`, `README.md`)**
  - ツールバーに **`⇅ 並び替え`** ボタンを追加し、サムネ付きコンパクト一覧でドラッグ＆ドロップ・`⤒ ↑ ↓ ⤓`・逆順・元に戻すで並び替え＆適用できる専用画面を実装。

- [x] **Task 16: 生成画像への ComfyUI UI `workflow` メタデータ埋め込み＆Colab 起動高速化 (`backend/composer.py`, `../ComfyUI_Anima_Colab.ipynb`)**
  - `build_single_workflow_ui_graph` を追加し、`extra_pnginfo["workflow"]` に完全な ComfyUI ワークフロー JSON（`AnimaMultiLoraLoader` の `widgets_values` / `widgets_values_named`、`AnimaPromptPlusClipEncode` のカテゴリ枠等）を埋め込むよう修正。
  - Colab ノートブックの FUSE キャッシュ完全無効化を 15 秒 TTL キャッシュへ変更、`ComfyUI` の `--depth 1` 軽量クローン、依存パッケージの一括インストール（`uv` 優先＋スタンプで再実行スキップ）、旧プロセス自動整理＆経過時間ログを追加。
