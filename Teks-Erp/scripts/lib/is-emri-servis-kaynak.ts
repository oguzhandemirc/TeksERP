// =============================================================================
// İŞ EMRİ SERVİSİ KAYNAĞI — metin/AST tarayan bekçilerin TEK okuma noktası
// =============================================================================
// `workorder.service.ts` 2026-11-08'de cephe + `services/workorder/*.ts`
// alan modüllerine bölündü (davranış aynı). Eskiden tek dosyayı okuyan bekçi
// artık AİLEYİ okur: cephe + dizindeki her `.ts` (dizin canlı taranır — yeni alan
// dosyası eklenince kapsam kendiliğinden genişler, hiçbir bekçi daralmaz).
// Emsal: `fason-servis-kaynak.ts` (subcontractor bölmesi), `ayar-servis-kaynak.ts` (system-setting).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..", "..", "src");
/** Cephe (çağıranların import yolu). */
export const IS_EMRI_SERVIS_CEPHE = path.join(SRC, "services", "workorder.service.ts");
/** Alan modülleri dizini. */
export const IS_EMRI_SERVIS_DIZINI = path.join(SRC, "services", "workorder");
/** `src/`e göre cephe yolu (ileri eğik çizgi) — "yalnız iş emri servisinde" kümelerinin TEK etiketi. */
export const IS_EMRI_SERVIS_REL = "services/workorder.service.ts";

/** Cephe + alan modülleri, mutlak yol, belirlenimli sıra (cephe önce). */
export function isEmriServisDosyalari(): string[] {
  const alt = fs.existsSync(IS_EMRI_SERVIS_DIZINI)
    ? fs.readdirSync(IS_EMRI_SERVIS_DIZINI).filter((f) => f.endsWith(".ts")).sort().map((f) => path.join(IS_EMRI_SERVIS_DIZINI, f))
    : [];
  return [IS_EMRI_SERVIS_CEPHE, ...alt];
}

/** Ailenin `src/`e göre yolları (ileri eğik çizgi), cephe önce. */
export function isEmriServisRelYollari(): string[] {
  return isEmriServisDosyalari().map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

/** Ailenin birleşik metni — tek dosyayı okuyan regex/AST bekçileri bunu okur. */
export function isEmriServisMetni(): string {
  return isEmriServisDosyalari().map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Yol (mutlak ya da `src/`e/`Teks-Erp/`ye göreli, `/` ya da `\\`) iş emri servisi ailesinden mi? */
export function isEmriServisDosyasiMi(yol: string): boolean {
  const y = yol.split(path.sep).join("/").replace(/\\/g, "/");
  return y.endsWith("services/workorder.service.ts") || /(^|\/)services\/workorder\/[^/]+\.ts$/.test(y);
}

/** Aileden bir yolu cephe etiketine katlar (diğer yollar aynen) — "yalnız şu dosyalarda" listeleri için. */
export function isEmriServisEtiketi(rel: string): string {
  if (!isEmriServisDosyasiMi(rel)) return rel;
  const y = rel.split(path.sep).join("/");
  const i = y.indexOf("services/");
  return y.slice(0, i) + IS_EMRI_SERVIS_REL;
}

/**
 * `ad` adlı fonksiyon/metot bildiriminin metni (imza + gövde). Cephedeki ince delegasyon da aynı adı
 * taşıdığından GÖVDESİ EN UZUN bildirim seçilir (taşınan asıl gövde); yoksa "".
 */
export function isEmriServisUyeMetni(ad: string): string {
  let en = "";
  for (const f of isEmriServisDosyalari()) {
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
export function isEmriServisTanimDosyasi(ad: string): string {
  let en = "";
  let dosya = IS_EMRI_SERVIS_CEPHE;
  for (const f of isEmriServisDosyalari()) {
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
