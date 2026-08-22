import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BENZER-AD UYARISI KAPSAMI — "uç var ama form kullanmıyor" boşluğunun bekçisi.
 *
 * ⚠️ Bu SOYUT bir risk değil, ÖLÇÜLDÜ (2026-08-22): `cbd273a5` özelliği ONBİR
 * rotaya bağlamıştı ama uyarı yalnız İKİ formda (Müşteri, Kumaş) çiziliyordu.
 * Backend hazırdı, sahadaki kullanıcı hiçbir yerde görmüyordu ve özelliği
 * "yok" sanıp yeniden istedi. Yarısı bağlanmış bir özellik, olmayan bir
 * özellikten daha kötüdür: maliyeti ödenmiş, faydası alınmamıştır.
 *
 * Kural: ad alanı (`register("name")`) taşıyan HER form dialog'u ya
 * `SimilarNamesWarning` çizer ya da MUAF listesinde GEREKÇESİYLE durur.
 * Yeni bir tanım formu yazan kişi, yazdığı gün bu testi kırmızı görür.
 */

const PAGES = resolve(__dirname, "../../pages");

/** Ad alanı olduğu hâlde uyarı çizmeyen formlar — her biri GEREKÇELİ. */
const EXEMPT: Record<string, string> = {
  "Access/Templates/TemplateFormDialog.tsx":
    "yetki şablonu — ana veri değil, benzer-ad ucu yok (rol adı serbest metindir)",
  "Customers/BranchFormDialog.tsx":
    "şube adı YALNIZ müşteri içinde tekil; kapsamlı uç henüz yok (bkz. takip)",
  "SubcontractorCategories/SubcontractorCategoryFormDialog.tsx":
    "fason kategorisi — similar-names ucu henüz yok (bkz. takip)",
  "Subcontractors/SubcontractorFormDialog.tsx":
    "fason firma — similar-names ucu henüz yok (bkz. takip)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = resolve(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/FormDialog\.tsx$/.test(e)) out.push(full);
  }
  return out;
}

interface Form {
  rel: string;
  src: string;
  hasName: boolean;
  hasWarning: boolean;
}

const forms: Form[] = walk(PAGES).map((full) => {
  const src = readFileSync(full, "utf8");
  return {
    rel: full.replace(PAGES + "/", ""),
    src,
    hasName: /register\("name"\)/.test(src),
    hasWarning: /SimilarNamesWarning/.test(src),
  };
});

describe("benzer-ad uyarısı kapsamı", () => {
  it("körlük zemini — tarayıcı gerçekten form buluyor", () => {
    // Klasör düzeni/adlandırma değişirse "ihlal yok" ile "hiçbir şeye
    // bakılmadı" aynı yeşile çıkar. Bugün 15 ad alanlı form var.
    expect(forms.filter((f) => f.hasName).length).toBeGreaterThan(10);
  });

  it("ad alanı olan her form ya uyarı çizer ya MUAF listesindedir", () => {
    const missing = forms
      .filter((f) => f.hasName && !f.hasWarning && !(f.rel in EXEMPT))
      .map((f) => f.rel);
    expect(
      missing,
      "backend ucu hazırken formu bağlamamak, özelliği sahada YOK gösterir",
    ).toEqual([]);
  });

  it("muaf listesi bayat değil — her muaf hâlâ ad alanlı ve uyarısız", () => {
    const stale = Object.keys(EXEMPT).filter((rel) => {
      const f = forms.find((x) => x.rel === rel);
      return !f || !f.hasName || f.hasWarning;
    });
    expect(stale, "ölü muaf, gerçek bir boşluğu sessizce kapsam dışında tutar").toEqual([]);
  });

  it("uyarı çizen her form `excludeId` geçirir (düzenlemede kendi ikizine çarpmasın)", () => {
    const bad = forms
      .filter((f) => f.hasWarning && !/excludeId=/.test(f.src))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});
