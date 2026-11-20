import { app } from "../../scripts/app.js";
import { injectStudioStyles } from "./styles.js";
import { AnimaSetStudioModal } from "./views/studio_modal.js";

const LAUNCH_BUTTON_ID = "anima-set-studio-launch-btn";

app.registerExtension({
    name: "AnimaSetStudio.extension",

    async setup() {
        injectStudioStyles();
        const modal = new AnimaSetStudioModal();

        if (!document.getElementById(LAUNCH_BUTTON_ID)) {
            const btn = document.createElement("button");
            btn.id = LAUNCH_BUTTON_ID;
            btn.type = "button";
            btn.className = "ass-launch-btn";
            btn.innerHTML = "<span>🎨</span><span>Anima SetStudio</span>";
            btn.title = "Anima SetStudio を開く（セット保存 & イラスト集一括生成 / Alt+S）";
            btn.onclick = () => modal.toggle();
            document.body.appendChild(btn);
        }

        window.addEventListener("keydown", (event) => {
            if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "s") {
                event.preventDefault();
                modal.toggle();
            }
        });

        window.__animaSetStudio = modal;
    },
});
