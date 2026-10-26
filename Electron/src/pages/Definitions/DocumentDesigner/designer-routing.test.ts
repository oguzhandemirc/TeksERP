import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_DESIGN_READ } from "@/lib/permissions";
import { documentTiles } from "@/pages/Documents/tile-config";
import { DESIGNER_DISABLED_TITLE, designerSettingPath, designerSettingTrail, isDocumentDesignerEnabled } from "./designer-flag";

const ROUTES_SRC = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");

function routeBlock(path: string): string {
  const i = ROUTES_SRC.indexOf(`path: "${path}"`);
  if (i < 0) return "";
  const next = ROUTES_SRC.indexOf("path: ", i + 6);
  return ROUTES_SRC.slice(i, next < 0 ? undefined : next);
}

describe("Belge Tasarımcısı karo ↔ rota", () => {
  const tile = documentTiles.find((t) => t.key === "document-designer");

  it("karo Belgeler kökünde (UX-2 K2), visibleWhen YOK (P-c: her zaman görünür)", () => {
    expect(tile).toBeDefined();
    expect(tile).toMatchObject({ to: "/definitions/document-designer", title: "Belge Tasarımcısı" });
    expect(tile && "visibleWhen" in tile ? tile.visibleWhen : undefined).toBeUndefined();
  });

  it("⭐ karo izni = iki rotanın izni (DOCUMENT_DESIGN_READ)", () => {
    expect(tile?.permissionAny).toBe(DOCUMENT_DESIGN_READ);
    for (const p of ["definitions/document-designer", "definitions/document-designer/:id"]) {
      const b = routeBlock(p);
      expect(b, p).toContain("requireAnyPermission={DOCUMENT_DESIGN_READ}");
      expect(b, p).toContain("<DocumentDesignerPage />");
    }
  });

  it("GrapesJS rota dosyasına statik girmez (ayrı parça)", () => {
    expect(ROUTES_SRC).not.toMatch(/from "grapesjs"/);
    const page = readFileSync(resolve(__dirname, "DocumentDesignerPage.tsx"), "utf8");
    expect(page).not.toMatch(/from "grapesjs"|from "\.\/useDesignerEditor"|from "\.\/editor\//);
    expect(page).toContain('lazy(() => import("./DesignerWorkspace"))');
  });
});

describe("tasarımcı bayrağı (fail-closed)", () => {
  it("yalnız açıkça true açar; alan yok/yanıt yok/yanlış tür kapalı", () => {
    expect(isDocumentDesignerEnabled({ documentDesignerEnabled: true })).toBe(true);
    for (const v of [undefined, null, {}, { documentDesignerEnabled: "true" }, { documentDesignerEnabled: 1 }, { documentDesignerEnabled: false }]) {
      expect(isDocumentDesignerEnabled(v)).toBe(false);
    }
  });

  it("kapalı metni plan P-c ile birebir", () => {
    expect(DESIGNER_DISABLED_TITLE).toBe("Belge tasarımcısı kapalı");
    // Ayar satırı kayıttan bulunur (T1C "Belgeler"); bulunamazsa Sistem hub'ı — elle yol yok.
    expect(designerSettingPath()).toBe("/system/printing?tab=belgeler");
    expect(designerSettingTrail()).toMatch(/Belgeler$/);
  });
});
