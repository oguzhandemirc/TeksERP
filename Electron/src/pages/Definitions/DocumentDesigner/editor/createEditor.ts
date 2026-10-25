import type { Component, Editor, EditorConfig } from "grapesjs";
import { checkImageFile, checkImageSrc } from "./assetGuard";
import { BASIC_BLOCKS } from "./blocks";
import { colorPropertyPlugin } from "./colorProperty";
import { frameSandboxPlugin } from "./frameSandbox";
import { I18N_CONFIG, TR_ADDITIONS } from "./locale-tr";
import { documentComponentsPlugin } from "./documentComponents";
import { GUIDE_STYLE_ID, deviceId, guideCss, pageDevices, pageDimensions, type GuideRegions, type Orientation, type PageMargins, type PaperSize } from "./pageCanvas";
import { STYLE_SECTORS } from "./styleSectors";

/** Editörün çizileceği kaplar — paneller GrapesJS'in değil, sayfanın yerleşimindedir. */
export interface EditorTargets {
  readonly container: HTMLElement;
  readonly blocks: HTMLElement;
  readonly styles: HTMLElement;
  readonly selectors: HTMLElement;
  readonly layers: HTMLElement;
  readonly traits: HTMLElement;
}

export interface EditorHooks {
  /** Kullanıcıya Türkçe uyarı (toast). */
  notify: (message: string) => void;
  /** Güvenlik ayarı tutmadı — editör durdurulur. */
  onFatal: (message: string) => void;
}

/** Metin araç çubuğu: bağlantı ve sarmalama YOK (dış href şablona giremez); ipuçları Türkçe. */
export const RTE_ACTIONS = [
  { name: "bold", icon: "<b>K</b>", attributes: { title: "Kalın" }, cmd: "bold" },
  { name: "italic", icon: "<i>E</i>", attributes: { title: "Eğik" }, cmd: "italic" },
  { name: "underline", icon: "<u>A</u>", attributes: { title: "Altı çizili" }, cmd: "underline" },
  { name: "strikethrough", icon: "<s>Ü</s>", attributes: { title: "Üstü çizili" }, cmd: "strikeThrough" },
].map(({ cmd, ...a }) => ({ ...a, result: (rte: { exec: (c: string) => void }) => rte.exec(cmd) }));

export const DEFAULT_PAPER: PaperSize = "A4";
export const DEFAULT_ORIENTATION: Orientation = "portrait";

/** Saf yapılandırma — testler bunu doğrudan ölçer. */
export function buildEditorConfig(targets: EditorTargets, hooks: EditorHooks): EditorConfig {
  return {
    container: targets.container,
    height: "100%",
    width: "auto",
    // Varsayılanı AÇIK: app.grapesjs.com'a istek atar; panel CSP'si https'e izin verdiği için kapatılmazsa çıkar.
    telemetry: false,
    // Varsayılanı font-awesome CDN'i — boş dize dış stil sayfasını hiç yüklemez.
    cssIcons: "",
    storageManager: false,
    avoidInlineStyle: true,
    showOffsets: true,
    i18n: I18N_CONFIG,
    parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false } },
    canvas: { scripts: [], styles: [] },
    panels: { defaults: [] },
    // Yerleşik eylemler İngilizce ipucu ve bağlantı eylemi taşır; boş liste + `rtePlugin` Türkçe dördü ekler.
    richTextEditor: { actions: [] },
    deviceManager: { default: deviceId(DEFAULT_PAPER, DEFAULT_ORIENTATION), devices: pageDevices() },
    blockManager: { appendTo: targets.blocks, blocks: BASIC_BLOCKS },
    styleManager: { appendTo: targets.styles, sectors: STYLE_SECTORS },
    // `appendTo` verilirse paket seçiciyi aynı hedefe İKİ kez ekliyor (e2e BT2 ölçtü) → elle tek kez.
    selectorManager: { componentFirst: true },
    layerManager: { appendTo: targets.layers },
    traitManager: { appendTo: targets.traits },
    assetManager: {
      upload: false,
      embedAsBase64: true,
      multiUpload: false,
      showUrlInput: false,
      assets: [],
      // `false` yüklemeyi iptal eder; dosya FileReader'a hiç girmez.
      beforeUpload: (files: FileList | File[]): false | void => {
        for (const f of Array.from(files)) {
          const v = checkImageFile(f);
          if (!v.ok) {
            hooks.notify(v.message);
            return false;
          }
        }
      },
    },
    // Eklentiler ilk çizimden ÖNCE koşar: Türkçe ekler ve sandbox kancası panel/kanvas doğmadan yerleşir.
    plugins: [localePlugin, documentComponentsPlugin, rtePlugin, frameSandboxPlugin(hooks.onFatal), colorPropertyPlugin, (ed: Editor) => assetGuardPlugin(ed, hooks)],
  };
}

function rtePlugin(editor: Editor): void {
  for (const a of RTE_ACTIONS) editor.RichTextEditor.add(a.name, a);
}

function localePlugin(editor: Editor): void {
  editor.I18n.addMessages({ tr: TR_ADDITIONS });
}

/** Dış adresli/büyük görsel varlığı ve görsel bileşen kaynağı reddedilir. */
function assetGuardPlugin(editor: Editor, hooks: EditorHooks): void {
  editor.on("asset:add", (asset: { getSrc: () => string }) => {
    const v = checkImageSrc(asset.getSrc());
    if (!v.ok) {
      editor.Assets.remove(asset as never);
      hooks.notify(v.message);
    }
  });
  const guardImage = (c: Component) => {
    if (c.get("type") !== "image") return;
    const src = String(c.get("src") ?? "");
    if (!src) return;
    const v = checkImageSrc(src);
    if (!v.ok) {
      c.set("src", "");
      hooks.notify(v.message);
    }
  };
  editor.on("component:add", guardImage);
  editor.on("component:update:src", guardImage);
}

/** Kanvasa kâğıt kılavuzlarını yazar; şablon CSS'ine girmez (ayrı <style>). */
export function applyPageGuides(
  editor: Editor,
  size: PaperSize,
  orientation: Orientation,
  guides: { margins?: PageMargins; regions?: GuideRegions } = {},
): void {
  const doc = editor.Canvas.getDocument();
  if (!doc?.head) return;
  let style = doc.getElementById(GUIDE_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = GUIDE_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = guideCss(pageDimensions(size, orientation), guides.margins, guides.regions);
}

type GrapesInit = { init: (config: EditorConfig) => Editor };

export function createEditor(grapesjs: GrapesInit, targets: EditorTargets, hooks: EditorHooks): Editor {
  const editor = grapesjs.init(buildEditorConfig(targets, hooks));
  targets.selectors.replaceChildren(editor.Selectors.render([]));
  return editor;
}
