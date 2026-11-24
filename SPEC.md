# ComfyUI-Anima-SetStudio 設計書 (SPEC.md)

## 1. 目的とターゲット
- **ターゲット**: Google Colab / ローカル環境で ComfyUI ＋ Anima モデル（`One obsession_Anima v5.0` 等）＋ `Comfyui-Anima-Tools` を使用して、キャラクターイラスト集を効率よく量産したいクリエイター。
- **解決する課題**:
  1. `Anima Multi LoRA Loader`（LoRA構成）と `Anima Prompt Plus`（カテゴリ別プロンプト）のペアを毎回手作業で並べて管理するのが大変。
  2. 「共通のキャラ（または衣装・画風）」に対して複数の衣装・ポーズ・背景セットを組み合わせてイラスト集を作るとき、重複カテゴリの無効化・一時編集・セットごとのLoRA切替一括実行ができない。
- **設計方針**:
  - **`Anima Multi LoRA Loader` および `Anima Prompt Plus` の全機能と使用感を100%維持**する（インストール済みの `Comfyui-Anima-Tools` のUI部品・ポップアップ・データ形式を直接連携・共有する）。
  - 機密情報（APIキーや個人ファイルパス等）は一切含めず、GitHub公開リポジトリから Colab ノートブック経由で `git clone` できる汎用カスタムノード拡張として設計する。

---

## 2. 機能範囲

### MVP（最小限の実装範囲・第1弾）

#### A. セット管理（やりたいこと1：LoRA / プロンプトセット）
- 以下のペアに名前を付けて **1つのセット** として保存・一覧表示・検索・編集・複製・削除できる。
  1. **LoRAリスト**（`Anima Multi LoRA Loader` 完全互換）
     - サムネイル表示、ON/OFFトグル、強度スライダー（数値入力・ダブルクリックリセット）、トリガーワードコピー、削除、追加ボタン
     - **`LoRA Manager` ポップアップ連携**: 本家 `Comfyui-Anima-Tools` の `Anima Multi LoRA Loader` ポップアップ（ローカル一覧・フォルダツリー・Civitai Anima LoRA検索＆ダウンロード・お気に入り・詳細パネル）をそのまま開いて編集可能。
  2. **カテゴリ別プロンプト**（`Anima Prompt Plus` 完全互換）
     - 複数テキスト枠の追加（`+ Add Text Box`）、カテゴリ名クリック編集、ドラッグ並び替え、一時無効化（`ban`）、実行時ランダム設定（`shuffle`）、クリア、コピー、削除、区切り文字（`separator`）
     - **`Select` ポップアップ連携**: 本家 `Comfyui-Anima-Tools` の `openBoxSelector`（画師・キャラ・衣装・ポーズ・背景・コミュニティTag庫・`My Tags`）をそのまま開いて選択可能。
  3. **画像からのセット読み取り（インポート）**
     - セット管理タブで PNG / WebP / JPEG 画像を選択またはドラッグ＆ドロップすると、画像に埋め込まれた生成メタデータから **カテゴリ別プロンプト** と **LoRAリスト** を自動抽出してセット編集欄へ取り込める。
     - **ComfyUI 画像（`prompt` / `workflow` チャンク）**:
       - `KSampler` 等の `positive` / `model` 入力から実行ルートを逆追跡し、実際に使用されたプロンプトとLoRAのみを抽出する（未接続の別ノードを誤検出しない）。
       - `AnimaPromptPlus` / `AnimaPromptPlusClipEncode` がある場合は `prompt_boxes`（カテゴリ名・本文・無効状態・ランダム設定・picks）と `separator` をそのまま完全復元する。
       - `Anima*Selector`（画師・キャラ・衣装・ポーズ・背景）チェーンがある場合は各ノード種別ごとのカテゴリ枠として復元する。
       - `AnimaMultiLoraLoader`（`lora_list_json`）、`LoraLoader` / `LoraLoaderModelOnly`、`Power Lora Loader (rgthree)` から LoRA・強度・ON/OFF を復元する。
     - **単一テキストプロンプト画像（`CLIPTextEncode` や A1111 `parameters` 形式）**:
       - `<lora:name:weight>` 記法があれば LoRAリストへ分離抽出する。
       - タグをルールベースでカテゴリ別（`品質`, `画師`, `キャラ`, `体格`, `衣装`, `ポーズ`, `背景`, `その他`）へ自動仕分けして読み込み、必要に応じて「1枠のまま」とワンクリック切替できる。

#### B. イラスト集作成＆一括生成（やりたいこと2）
ComfyUI画面内の起動ボタン（フローティングボタン／サイドバー）から大きく見やすい専用画面を開き、以下の5ステップで操作できる。
1. **複数セット呼び出し**:
   - 保存済みセット一覧から、今回のイラスト集に使うセットを複数追加できる（同一セットの複数追加・順番入れ替え・削除が可能）。
   - 各セットごとに生成枚数の個別上書きもできる（未指定時は共通の「1セットあたり生成枚数」を使用）。
2. **使わないプロンプトのカテゴリを選択（自動非表示）**:
   - 呼び出した全セットに含まれるカテゴリ名（例：`品質`, `体格`, `キャラ`, `衣装`, `ポーズ`, `背景` 等）を自動で集計し、除外選択チップとして一覧表示する。
   - 選択（チェック）したカテゴリは、**呼び出した全セットのカード上から即座に隠れ（非表示になり）**、生成時のプロンプト合成からも除外される。
3. **特定セットの一時編集**:
   - 呼び出した各セットカード内で、残っているカテゴリプロンプトやLoRA（ON/OFF・強度・追加/削除）をその場限りで編集できる。
   - 一時編集は元の保存セットを書き換えない（明示的に「元セットに上書き保存」「別名でセット保存」ボタンを押した時のみ永続化）。
4. **共通セクション入力**:
   - **共通プロンプト**: `Anima Prompt Plus` と同じカテゴリ枠UI（`Select`・`+ Add Text Box`・ON/OFF・ランダム対応）。
   - **共通LoRA**: `Anima Multi LoRA Loader` と同じUI（例：キャラLoRAを共通側に入れてセット側の画風・衣装LoRAと合体）。
   - **ネガティブプロンプト**: テキスト入力欄。
   - **基本生成設定**: 解像度（幅 × 高さ、よく使うプリセットボタン付）、1セットあたりの生成枚数。
   - **詳細生成設定（折りたたみ）**:
     - 拡散モデル（デフォルト：`oneObsessionAnima_v50.safetensors`）
     - CLIP（デフォルト：`qwen_3_06b_base.safetensors` / タイプ：`lumina2`）
     - VAE（デフォルト：`qwen_image_vae.safetensors`）
     - モデルサンプリング（`ModelSamplingAuraFlow` シフト：デフォルト `3.00`）
     - Kサンプラー（ステップ：`30`、CFG：`4.0`、サンプラー：`er_sde` / `res_multistep` 等、スケジューラ：`simple` / `beta` 等、ノイズ除去：`1.00`）
     - 保存ファイル名プレフィックス（デフォルト：`%date:yyyyMMdd%/%date:yyyyMMdd%`）
   - 共通セクションの設定値は自動保存され、次回画面を開いた時に復元される。
5. **一括実行 (`[実行]` ボタン)**:
   - 呼び出した全セット × 各セットの生成枚数ぶんのジョブを順番に ComfyUI `/prompt` API へ投入する。
   - **プロンプト結合ルール（案B）**:
     - **先頭**: 共通プロンプト（有効なボックスを上から順に結合）
     - **後ろ**: 各セット内の「除外カテゴリに含まれない ＆ 無効化されていない」ボックスを上から順に結合
   - **LoRA合体ルール**:
     - 共通LoRA（有効なもの）＋ 各セットのLoRA（有効なもの）を順に適用。
     - 同一LoRAが両方にある場合は、セット側の強度・設定を優先して重複適用を防ぐ。
   - **シード処理**: 1枚ごとに異なるランダムシードを自動発行し、全枚数がユニークに生成されるようにする。
   - 投入進捗表示および ComfyUI キューへの反映を行う。

### 第2弾（MVP完成後の拡張候補）
- キャンバス上の既存 `Anima Multi LoRA Loader` ＋ `Anima Prompt Plus` ノードからのワンクリック取込／反映
- イラスト集レシピ（複数セット選択＋除外カテゴリ＋共通設定の組み合わせ）の名前付き保存
- セットのタグ分類・サムネイル設定

---

## 3. 技術スタックとアーキテクチャ
- **バックエンド**: Python 3（標準ライブラリ + ComfyUI内蔵の `aiohttp` / `PromptServer` / `folder_paths` のみ。外部 `pip` 依存ゼロ）
- **フロントエンド**: Vanilla HTML / CSS / ES Modules JS（ビルド不要。ComfyUIのテーマCSS変数を継承）
- **Comfyui-Anima-Tools 連携方式**:
  1. **プロンプト `Select` ポップアップ**: ComfyUIが配信する `/extensions/Comfyui-Anima-Tools/anima_gallery_selector.js` 等の ES Module を動的 `import` し、`openBoxSelector` を直接呼び出す。
  2. **LoRA `LoRA Manager` ポップアップ**: `LiteGraph.createNode("AnimaMultiLoraLoader")` でグラフ非所属の仮想ブリッジノードを生成し、本家の `LoRA Manager` ポップアップをそのまま起動して双方向同期する（未導入時は ComfyUI `/object_info` を使う簡易フォールバックを提供）。
  3. **実行時パイプライン**: 生成する ComfyUI API ワークフロー JSON に `AnimaMultiLoraLoader` と `AnimaPromptPlusClipEncode` を組み込むことで、本家の「実行時ランダム（`box.random`）」やパス解決を100%再現する（未導入時は標準 `LoraLoaderModelOnly` + `CLIPTextEncode` に自動フォールバック）。
- **テスト**: Python `unittest`（コアロジック・API・ワークフローJSON生成）＋ `node --check`（全JS構文チェック）

---

## 4. ディレクトリ構成（予定）
```text
ComfyUI-Anima-SetStudio/
├── SPEC.md                 # 本設計書
├── GEMINI.md               # Antigravity用開発ルール
├── TASKS.md                # 実装チェックリスト
├── README.md               # 導入・使い方ドキュメント
├── .gitignore
├── __init__.py             # ComfyUI拡張エントリポイント（WEB_DIRECTORY登録 & APIルート登録）
├── backend/
│   ├── __init__.py
│   ├── storage.py          # セットJSON・ワークスペース状態の永続化（ComfyUI/user/anima_set_studio/）
│   ├── composer.py         # カテゴリ除外・プロンプト合成(案B)・LoRA合体・APIワークフローJSON生成
│   ├── image_importer.py   # PNG/WebP/JPEGメタデータ解析・カテゴリ別プロンプト＆LoRA抽出
│   └── routes.py           # PromptServer HTTP API (`/anima-set-studio/api/...`)
├── js/
│   ├── index.js            # ComfyUI拡張登録・起動ボタン・パネル開閉
│   ├── api.js              # バックエンド＆ComfyUI APIクライアント
│   ├── bridge_anima_tools.js # Comfyui-Anima-Tools（Select / LoRA Manager）連携ブリッジ
│   ├── components/
│   │   ├── prompt_boxes.js # Anima Prompt Plus 互換UIコンポーネント
│   │   ├── lora_list.js    # Anima Multi LoRA Loader 互換UIコンポーネント
│   │   └── settings.js     # 共通設定・折りたたみ詳細設定UI
│   ├── views/
│   │   ├── studio_modal.js # メインモーダル（イラスト集タブ / セット管理タブ）
│   │   └── set_card.js     # 呼び出し済みセットの一時編集カード
│   └── styles.js           # ComfyUIテーマ追従CSS
└── tests/
    ├── test_storage.py        # 保存・読込・複製・削除・パストラバーサル防止テスト
    ├── test_composer.py       # 除外カテゴリ・案B結合・LoRA合体・ワークフロー生成テスト
    ├── test_image_importer.py # PNG/WebP/JPEGメタデータ解析・カテゴリ別プロンプト＆LoRA抽出テスト
    └── test_routes.py         # HTTP APIディスパッチャ・画像インポートルートテスト
```

---

## 5. データ構造

### 保存先ディレクトリ
- `ComfyUI/user/anima_set_studio/`
  - `sets/<set_id>.json`: 各セットの定義ファイル
  - `state.json`: 共通セクション（共通プロンプト・共通LoRA・ネガティブ・生成設定・最後に選んだセット構成）の自動保存

### セットJSON (`sets/<set_id>.json`)
`Comfyui-Anima-Tools` のデータスキーマと完全互換を保つ。

```json
{
  "id": "set_20261119_a1b2c3",
  "name": "制服衣装セット",
  "separator": ", ",
  "loras": [
    {
      "name": "sample_style_v1.safetensors",
      "display_name": "SampleStyleV1",
      "strength_model": 1.0,
      "enabled": true,
      "storage_root_id": "",
      "preview_url": "",
      "trained_words": []
    }
  ],
  "prompt_boxes": [
    {
      "id": "box001",
      "label": "品質",
      "text": "@sample_artist, masterpiece, best quality,",
      "disabled": false,
      "random": [],
      "picks": {}
    },
    {
      "id": "box002",
      "label": "衣装",
      "text": "school uniform, pleated skirt, ribbon,",
      "disabled": false,
      "random": [],
      "picks": {}
    }
  ],
  "created_at": "2026-11-19T22:45:00Z",
  "updated_at": "2026-11-19T22:45:00Z"
}
```

### APIエンドポイント設計 (`/anima-set-studio/api/...`)
- `GET /sets`: 保存済みセット一覧取得
- `POST /sets`: セット新規作成／更新
- `POST /sets/{id}/duplicate`: セット複製
- `DELETE /sets/{id}`: セット削除
- `GET /state` / `POST /state`: 共通セクション＆ワークスペース状態の取得・保存
- `GET /options`: 利用可能な拡散モデル・CLIP・VAE・サンプラー・スケジューラ・`Comfyui-Anima-Tools` 導入有無の一覧取得
- `POST /build-jobs`: 共通設定＋呼び出し済みセット群＋除外カテゴリから、ComfyUI `/prompt` 投入用のAPIワークフローJSON配列を生成して返す（または直接キュー投入）
- `POST /import-image`: アップロードされた画像（`multipart/form-data` または Base64 JSON）のメタデータからカテゴリ別プロンプト (`prompt_boxes`) と LoRAリスト (`loras`) を抽出して返す
