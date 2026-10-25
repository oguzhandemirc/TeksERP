import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ASSET_MESSAGES } from "./assetGuard";
import { RTE_ACTIONS, buildEditorConfig, type EditorTargets } from "./createEditor";

function targets(): EditorTargets {
  const mk = () => document.body.appendChild(document.createElement("div"));
  return { container: mk(), blocks: mk(), styles: mk(), selectors: mk(), layers: mk(), traits: mk() };
}
const hooks = () => ({ notify: vi.fn(), onFatal: vi.fn() });

describe("paket sözleşmesi", () => {
  it("grapesjs TAM SABİT 0.23.8 ve `dependencies`te (0.x: yama sürümü olay adlarını değiştirebilir)", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../../../../package.json"), "utf8"));
    expect(pkg.dependencies.grapesjs).toBe("0.23.8");
    expect(pkg.dependencies["@grapesjs/react"]).toBeUndefined();
  });
});

describe("editör yapılandırması (saf)", () => {
  const cfg = buildEditorConfig(targets(), hooks());

  it("⭐ dışarı istek yok: telemetri kapalı, CDN ikon CSS'i boş, kanvasa dış script/stil yok", () => {
    expect(cfg.telemetry).toBe(false);
    expect(cfg.cssIcons).toBe("");
    expect(cfg.canvas).toEqual({ scripts: [], styles: [] });
  });

  it("⭐ ayrıştırıcı script ve tehlikeli öznitelik/değer kabul etmez", () => {
    expect(cfg.parser?.optionsHtml).toMatchObject({ allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false });
  });

  it("depolama KAPALI (kayıt T1B uçlarıyla), satır içi stil yok, varsayılan paneller yok", () => {
    expect(cfg.storageManager).toBe(false);
    expect(cfg.avoidInlineStyle).toBe(true);
    expect(cfg.panels).toEqual({ defaults: [] });
  });

  it("varlık yöneticisi: URL girişi gizli, sunucuya yükleme yok, gömülü base64", () => {
    expect(cfg.assetManager).toMatchObject({ showUrlInput: false, upload: false, embedAsBase64: true, assets: [] });
  });

  it("metin araç çubuğunda bağlantı eylemi yok; ipuçları Türkçe", () => {
    expect(cfg.richTextEditor).toEqual({ actions: [] });
    expect(RTE_ACTIONS.map((a) => a.name)).toEqual(["bold", "italic", "underline", "strikethrough"]);
    expect(RTE_ACTIONS.map((a) => a.attributes.title)).toEqual(["Kalın", "Eğik", "Altı çizili", "Üstü çizili"]);
  });

  it("büyük dosya yüklemeden ÖNCE reddedilir", () => {
    const h = hooks();
    const c = buildEditorConfig(targets(), h);
    const big = new File([new Uint8Array(301 * 1024)], "logo.png", { type: "image/png" });
    expect(c.assetManager?.beforeUpload?.([big])).toBe(false);
    expect(h.notify).toHaveBeenCalledWith(ASSET_MESSAGES.size);
  });
});

// Editör yükleme/etkileşim (sandbox özniteliği, varlık kapısı, Türkçe arayüz) jsdom'da ölçülmez (D6):
// e2e/guzergah/adimlar-belge-tasarimci.mjs BT2/BT4 gerçek Electron'da ölçer.
