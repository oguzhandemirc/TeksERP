// =============================================================================
// BEKÇİ — cari tipi: etiket TEK STANDART (kullanıcı kararı 2026-09-17) + `type`ten SON KOPUŞ (rol modeli faz 2, C)
// =============================================================================
// İki dil vardı: rol dili ("Müşteri · Tedarikçi") + yön dili ("Alıcı + Satıcı"). Tek standart ROL dilidir ve
// kaynağı `lib/partnerRoles` (`partnerRoleLabels` · `DIRECTION_OPTIONS`); eski `companyTypeLabels` SİLİNDİ
// (tüketicisi 0'dı). `Customer.type` TÜRETİLMİŞ ve panelde OPSİYONEL: yanıtta gelir, cari kodu ne okur ne yazar.
//
// ⭐ §1 `types/enums.ts` `companyTypeLabels` dışa vermez; `CompanyType` yalnız tip (Customer.type? için).
// ⭐ §2 kaynak taraması: yön dili sözcüğü "Alıcı" Electron/src'de test dışı 0.
// ⭐ §3 kaynak taraması (cari dosya kümesi + mobil PlanModal): `filters: { … type:` · `type: "CUSTOMER|SUPPLIER|BOTH"` ·
//    `.type ===` · `companyTypeLabels` 0 — cari süzgeci `role`/bayrak parametresiyle sorulur, `type` okunmaz.
//    Küme cari dosyalarıyla SINIRLI (`Item.type`, etiket şablonu `type`ları karışmasın).
// Negatif sonda (kırmızı görüldü): `ColorFormDialog` süzgeci `type: "CUSTOMER"`a döndürülünce §3 ❌;
// `companyTypeLabels` geri eklenince §1 ❌.
// =============================================================================
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { partnerRoleLabels } from "@/lib/partnerRoles";

const SRC = resolve(process.cwd(), "src");
const TARANAN_UZANTI = /\.(ts|tsx|css|json|md|html)$/;
/** Testler karar cümlesini alıntılar; sürüm notu kopyası geçmiş maddeyi taşır (elle düzenlenmez). */
const KAPSAM_DISI = (rel: string) => /\.test\.tsx?$/.test(rel) || rel === "data/surum-notlari.json";
const YON_DILI = /Alıcı/;

/** Cari dosya kümesi — `type` okuyucu/yazıcı taraması yalnız burada (1e sınırı). */
const CARI_KUMESI: readonly string[] = [
  "pages/Customers",
  "pages/Definitions",
  "pages/Subcontractors",
  "pages/Colors/ColorFormDialog.tsx",
  "components/forms",
  "lib/partnerRoles.ts",
];
const CARI_DOSYA = (rel: string) =>
  CARI_KUMESI.some((k) => rel === k || rel.startsWith(`${k}/`)) &&
  (!rel.startsWith("pages/Definitions/") || /Cariler/.test(rel)) &&
  (!rel.startsWith("components/forms/") || /Supplier|Customer|supplierPicker/.test(rel));
const MOBIL_PLAN_MODAL = resolve(process.cwd(), "..", "mobil", "src", "screens", "Modules", "Devere", "PlanModal.tsx");
const TIP_OKUYUCU = /filters:\s*\{[^}]*\btype:|\btype:\s*["'](CUSTOMER|SUPPLIER|BOTH)["']|\.type\s*===|companyTypeLabels/;

function dosyalar(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dosyalar(p, out);
    else if (TARANAN_UZANTI.test(e.name)) out.push(p);
  }
  return out;
}
function ihlaller(files: string[], desen: RegExp, kok: string): string[] {
  const out: string[] = [];
  for (const f of files) {
    const rel = relative(kok, f);
    readFileSync(f, "utf8").split("\n").forEach((satir, i) => {
      if (desen.test(satir)) out.push(`${rel}:${i + 1}: ${satir.trim()}`);
    });
  }
  return out;
}

describe("cari tipi — tek standart etiket, `type`ten son kopuş", () => {
  it("⭐ §1 `types/enums.ts` `companyTypeLabels` dışa vermez; rol etiketi kaynağı `lib/partnerRoles`", () => {
    const enums = readFileSync(join(SRC, "types", "enums.ts"), "utf8");
    expect(enums).not.toMatch(/companyTypeLabels/);
    expect(enums).toMatch(/export type CompanyType = "CUSTOMER" \| "SUPPLIER" \| "BOTH"/);
    expect(partnerRoleLabels).toEqual({ customer: "Müşteri", supplier: "Tedarikçi", subcontractor: "Fason" });
  });

  it("⭐ §2 yön dili (\"Alıcı\") Electron/src'de test dışı 0 — kopya literal kaynağa dönmez", () => {
    const files = dosyalar(SRC).filter((f) => !KAPSAM_DISI(relative(SRC, f)));
    expect(ihlaller(files, YON_DILI, SRC), "yön dili etiketi geri geldi — kaynak `lib/partnerRoles`, kopya yazma").toEqual([]);
  });

  it("⭐ §3 cari dosya kümesinde `type` okuyucu/yazıcı 0 (süzgeç `role`/bayrak ile; `Customer.type` opsiyonel, okunmaz)", () => {
    const files = dosyalar(SRC).filter((f) => {
      const rel = relative(SRC, f);
      return !KAPSAM_DISI(rel) && CARI_DOSYA(rel);
    });
    expect(files.length, "cari kümesi boş — tarama vakum").toBeGreaterThanOrEqual(8);
    expect(ihlaller(files, TIP_OKUYUCU, SRC)).toEqual([]);
    const tip = readFileSync(join(SRC, "pages", "Customers", "types.ts"), "utf8");
    expect(tip).toMatch(/type\?: CompanyType/);
    // Mobil PlanModal: aynı kural (dosya yoksa ÖLÇÜLEMEDİ — kırmızı değil, beyanlı).
    if (existsSync(MOBIL_PLAN_MODAL) && statSync(MOBIL_PLAN_MODAL).isFile()) {
      expect(ihlaller([MOBIL_PLAN_MODAL], TIP_OKUYUCU, resolve(process.cwd(), ".."))).toEqual([]);
      const model = readFileSync(resolve(process.cwd(), "..", "mobil", "src", "types", "models.ts"), "utf8");
      expect(model).toMatch(/type\?: CompanyType/);
    } else {
      console.warn("⏭ mobil PlanModal bulunamadı — mobil kolu ÖLÇÜLMEDİ");
    }
  });
});
