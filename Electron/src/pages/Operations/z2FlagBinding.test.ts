// BEKÇİ — Z2 bayrak bağı: 01'in üç "zorunlu" ayarı panelde ilgili seçiciye `required` olarak BAĞLI kalsın.
// Kanca var ama prop geçilmemişse ayar açılır, sunucu 400 verir, panel alanı isteğe bağlı gösterir (ayrışan yüzey).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("Z2 bayrak bağı (kaynak taraması)", () => {
  it("Dokuma İşi formu: useDokumaOrderLineLinkRequired → WeavingOrderLinesSection required", () => {
    const s = src("WeavingOrders/WeavingOrderFormDialog.tsx");
    expect(s).toMatch(/const (\w+) = useDokumaOrderLineLinkRequired\(\);/);
    const name = s.match(/const (\w+) = useDokumaOrderLineLinkRequired\(\);/)![1];
    expect(s).toMatch(new RegExp(`<WeavingOrderLinesSection[^>]*required=\\{${name}\\}`));
  });

  it("Levent plan + Sar: useDevereBeamWeavingLinkRequired → dokuma işi seçicisi required", () => {
    for (const [file, tag] of [["WarpBeams/WarpBeamFormDialog.tsx", "WeavingOrderField"], ["WarpBeams/WindDialog.tsx", "WeavingOrderPicker"]] as const) {
      const s = src(file);
      const m = s.match(/const (\w+) = useDevereBeamWeavingLinkRequired\(\);/);
      expect(m, file).not.toBeNull();
      expect(s, file).toMatch(new RegExp(`<${tag}[^>]*required=\\{${m![1]}\\}`));
    }
  });

  it("Dokuma İşi formu: çözgü kartı seçici useWarpSpecEnabled'a (devere ∨ dokuma) bağlı; levent ön-dolumu devere kapısında", () => {
    const fields = src("WeavingOrders/WeavingOrderFormFields.tsx");
    const m = fields.match(/const (\w+) = useWarpSpecEnabled\(\);/);
    expect(m).not.toBeNull();
    expect(fields).toMatch(new RegExp(`\\{${m![1]} && \\(\\s*<FormField label="Çözgü kartı"`));
    expect(fields).toContain(`useItemWarpSpecPrefill(form, ${m![1]});`);
    expect(fields).not.toMatch(/devereEnabled/);
    const dialog = src("WeavingOrders/WeavingOrderFormDialog.tsx");
    expect(dialog).toMatch(/\{devereEnabled && <BeamPrefillField /);
  });

  it("üç kanca bayrak anahtarını fail-closed okur (yüklenene dek false)", () => {
    const s = src("../../hooks/usePricingEnabled.ts");
    for (const key of ["devereBeamWeavingLinkRequired", "dokumaRunWeavingOrderRequired", "dokumaOrderLineLinkRequired"]) {
      expect(s).toContain(`return q.data?.data?.${key} ?? false;`);
    }
  });
});
