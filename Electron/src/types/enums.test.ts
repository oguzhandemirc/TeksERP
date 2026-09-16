// =============================================================================
// BEKÇİ — cari tipi etiketi TEK STANDART (kullanıcı kararı 2026-09-17)
// =============================================================================
// İki dil vardı: rol dili ("Müşteri · Tedarikçi") + yön dili ("Alıcı + Satıcı").
// Tek standart ROL dilidir: Müşteri · Tedarikçi · Müşteri + Tedarikçi. Enum ve
// backend değişmez; yalnız panel etiketi. Kaynak `companyTypeLabels`; kopyalar
// (`SUPPLIER_ROLE_LABEL`, Cariler süzgeci) oradan türer.
//
// ⭐ §1 etiket literal'i BURADA sabitlenir (karar tek yerde sınanır).
// ⭐ §2 kaynak taraması: yön dili sözcüğü "Alıcı" Electron/src'de test dışı 0 —
//    kopyaya eski literal yazan (ya da rozet/süzgeç anahtarını etikete geri
//    çeviren) commit burada kırmızıdır. Sürüm notu kopyası TARİHTİR, kapsam dışı.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { companyTypeLabels } from "./enums";

const SRC = resolve(process.cwd(), "src");
const TARANAN_UZANTI = /\.(ts|tsx|css|json|md|html)$/;
/** Testler karar cümlesini alıntılar; sürüm notu kopyası geçmiş maddeyi taşır (elle düzenlenmez). */
const KAPSAM_DISI = (rel: string) => /\.test\.tsx?$/.test(rel) || rel === "data/surum-notlari.json";
const YON_DILI = /Alıcı/;

function dosyalar(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dosyalar(p, out);
    else if (TARANAN_UZANTI.test(e.name)) out.push(p);
  }
  return out;
}

describe("cari tipi etiketi — tek standart", () => {
  it("⭐ §1 rol dili: Müşteri · Tedarikçi · Müşteri + Tedarikçi", () => {
    expect(companyTypeLabels).toEqual({ CUSTOMER: "Müşteri", SUPPLIER: "Tedarikçi", BOTH: "Müşteri + Tedarikçi" });
  });

  it("⭐ §2 yön dili (\"Alıcı\") Electron/src'de test dışı 0 — kopya literal kaynağa dönmez", () => {
    const ihlal: string[] = [];
    for (const f of dosyalar(SRC)) {
      const rel = relative(SRC, f);
      if (KAPSAM_DISI(rel)) continue;
      readFileSync(f, "utf8").split("\n").forEach((satir, i) => {
        if (YON_DILI.test(satir)) ihlal.push(`${rel}:${i + 1}: ${satir.trim()}`);
      });
    }
    expect(ihlal, "yön dili etiketi geri geldi — kaynak `companyTypeLabels` (types/enums.ts), kopya yazma").toEqual([]);
  });
});
