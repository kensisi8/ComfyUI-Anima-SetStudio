# ComfyUI-Anima-SetStudio

ComfyUI 上で **Anima モデル** を使ってキャラクターイラスト集を効率よく作成するためのカスタム拡張機能です。
[Comfyui-Anima-Tools](https://github.com/nregret/Comfyui-Anima-Tools) の **`Anima Multi LoRA Loader`** と **`Anima Prompt Plus`** と同じ使用感・全機能を保ったまま、以下を実現します。

## 主な機能

### 1. LoRA / プロンプトセット管理
- `LoRAリスト`（サムネ・ON/OFF・強度スライダー・トリガーコピー・本家 `LoRA Manager` ポップアップ）と `カテゴリ別プロンプト`（自由なカテゴリ名・ドラッグ並替・一時無効化・実行時ランダム・本家 `Select` ポップアップ）を **1つのセット** として名前を付けて保存・複製・削除できます。
- 保存先は `ComfyUI/user/anima_set_studio/sets/`（Colab環境では Googleドライブへ自動永続化）。

### 2. イラスト集作成・一括生成
1. 保存済みセットを複数呼び出し（同一セットの複数追加・順番入れ替え・セット別枚数指定に対応）。
2. **使わないカテゴリ（共通プロンプトで上書きするカテゴリ）** を選択 → 呼び出した全セットのカードから該当カテゴリ欄が自動で隠れ、生成からも除外されます。
3. 呼び出した特定のセットを選んで、元データを壊さずに **その場限りで一時編集** できます（必要なら上書き保存・別名保存も可能）。
4. **共通LoRA**（例：キャラLoRA）・**共通プロンプト**・**ネガティブプロンプト**・**解像度**・**1セットあたり枚数**・**折りたたみ詳細設定（モデル / CLIP / VAE / Shift / Kサンプラー / 保存名）** を設定。
5. **`[実行]`** ボタン1つで、全セット分のジョブ（共通プロンプト先頭＋各セットの非除外カテゴリ、共通LoRA＋セットLoRA合体、1枚ごとユニークシード）を ComfyUI キューへ一括投入します。

---

## インストール方法

### 通常の ComfyUI 環境
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/<あなたのユーザー名>/ComfyUI-Anima-SetStudio.git
```
※追加の `pip install` は不要です（Python標準ライブラリ＋ComfyUI組込ライブラリのみ使用）。
※`Select` や `LoRA Manager` ポップアップの全機能を使うため、`Comfyui-Anima-Tools` との併用を推奨します。

### 起動方法
ComfyUI 起動後、画面左下の **`🎨 Anima SetStudio`** ボタンをクリック（またはショートカット **`Alt + S`**）すると専用画面が開きます。

---

## ローカルテスト実行
```bash
python -m unittest discover -s tests -v
```
