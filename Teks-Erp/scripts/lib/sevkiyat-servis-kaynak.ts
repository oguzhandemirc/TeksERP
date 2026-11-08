// =============================================================================
// SEVKİYAT SERVİSİ KAYNAĞI — metin/AST tarayan bekçilerin TEK okuma noktası
// =============================================================================
// `shipping.service.ts` 2026-11-08'de cephe + `services/shipping/*.ts`
// alan modüllerine bölündü (davranış aynı). Eskiden tek dosyayı okuyan bekçi
// artık AİLEYİ okur: cephe + dizindeki her `.ts` (dizin canlı taranır — yeni alan
// dosyası eklenince kapsam kendiliğinden genişler, hiçbir bekçi daralmaz).
// Emsal: `is-emri-servis-kaynak.ts` (workorder bölmesi), `fason-servis-kaynak.ts` (subcontractor).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..", "..", "src");
/** Cephe (çağıranların import yolu). */
export const SEVKIYAT_SERVIS_CEPHE = path.join(SRC, "services", "shipping.service.ts");
/** Alan modülleri dizini. */
export const SEVKIYAT_SERVIS_DIZINI = path.join(SRC, "services", "shipping");
/** `src/`e göre cephe yolu (ileri eğik çizgi) — "yalnız sevkiyat servisinde" kümelerinin TEK etiketi. */
export const SEVKIYAT_SERVIS_REL = "services/shipping.service.ts";

/** Cephe + alan modülleri, mutlak yol, belirlenimli sıra (cephe önce). */
export function sevkiyatServisDosyalari(): string[] {
  const alt = fs.existsSync(SEVKIYAT_SERVIS_DIZINI)
    ? fs.readdirSync(SEVKIYAT_SERVIS_DIZINI).filter((f) => f.endsWith(".ts")).sort().map((f) => path.join(SEVKIYAT_SERVIS_DIZINI, f))
    : [];
  return [SEVKIYAT_SERVIS_CEPHE, ...alt];
}

/** Ailenin `src/`e göre yolları (ileri eğik çizgi), cephe önce. */
export function sevkiyatServisRelYollari(): string[] {
  return sevkiyatServisDosyalari().map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

/** Ailenin birleşik metni — tek dosyayı okuyan regex/AST bekçileri bunu okur. */
export function sevkiyatServisMetni(): string {
  return sevkiyatServisDosyalari().map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Yol (mutlak ya da `src/`e/`Teks-Erp/`ye göreli, `/` ya da `\\`) sevkiyat servisi ailesinden mi? */
export function sevkiyatServisDosyasiMi(yol: string): boolean {
  const y = yol.split(path.sep).join("/").replace(/\\/g, "/");
  return y.endsWith("services/shipping.service.ts") || /(^|\/)services\/shipping\/[^/]+\.ts$/.test(y);
}

/** Aileden bir yolu cephe etiketine katlar (diğer yollar aynen) — "yalnız şu dosyalarda" listeleri için. */
export function sevkiyatServisEtiketi(rel: string): string {
  if (!sevkiyatServisDosyasiMi(rel)) return rel;
  const y = rel.split(path.sep).join("/");
  const i = y.indexOf("services/");
  return y.slice(0, i) + SEVKIYAT_SERVIS_REL;
}

/**
 * `ad` adlı fonksiyon/metot bildiriminin metni (imza + gövde). Cephedeki ince delegasyon da aynı adı
 * taşıdığından GÖVDESİ EN UZUN bildirim seçilir (taşınan asıl gövde); yoksa "".
 */
export function sevkiyatServisUyeMetni(ad: string): string {
  let en = "";
  for (const f of sevkiyatServisDosyalari()) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name?.getText(sf) === ad && n.body) {
        const t = n.getText(sf);
        if (t.length > en.length) en = t;
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  return en;
}

/**
 * `ad` adlı üye/fonksiyonun ASIL gövdesinin bulunduğu aile dosyası (mutlak); bulunamazsa cephe
 * (çağıran analiz "bulunamadı" der — sessiz yeşil yok).
 */
export function sevkiyatServisTanimDosyasi(ad: string): string {
  let en = "";
  let dosya = SEVKIYAT_SERVIS_CEPHE;
  for (const f of sevkiyatServisDosyalari()) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name?.getText(sf) === ad && n.body) {
        const t = n.getText(sf);
        if (t.length > en.length) { en = t; dosya = f; }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  return dosya;
}
