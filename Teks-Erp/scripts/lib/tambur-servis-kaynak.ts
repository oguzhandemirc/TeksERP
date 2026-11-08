// =============================================================================
// TAMBUR SERVİSİ KAYNAĞI — metin/AST tarayan bekçilerin TEK okuma noktası
// =============================================================================
// `tambur.service.ts` 2026-11-08'de cephe + `services/tambur/*.ts`
// alan modüllerine bölündü (davranış aynı). Eskiden tek dosyayı okuyan bekçi
// artık AİLEYİ okur: cephe + dizindeki her `.ts` (dizin canlı taranır — yeni alan
// dosyası eklenince kapsam kendiliğinden genişler, hiçbir bekçi daralmaz).
// Emsal: `envanter-servis-kaynak.ts` (inventory), `siparis-servis-kaynak.ts` (order).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..", "..", "src");
/** Cephe (çağıranların import yolu). */
export const TAMBUR_SERVIS_CEPHE = path.join(SRC, "services", "tambur.service.ts");
/** Alan modülleri dizini. */
export const TAMBUR_SERVIS_DIZINI = path.join(SRC, "services", "tambur");
/** `src/`e göre cephe yolu (ileri eğik çizgi) — "yalnız tambur servisinde" kümelerinin TEK etiketi. */
export const TAMBUR_SERVIS_REL = "services/tambur.service.ts";

/** Cephe + alan modülleri, mutlak yol, belirlenimli sıra (cephe önce). */
export function tamburServisDosyalari(): string[] {
  const alt = fs.existsSync(TAMBUR_SERVIS_DIZINI)
    ? fs.readdirSync(TAMBUR_SERVIS_DIZINI).filter((f) => f.endsWith(".ts")).sort().map((f) => path.join(TAMBUR_SERVIS_DIZINI, f))
    : [];
  return [TAMBUR_SERVIS_CEPHE, ...alt];
}

/** Ailenin `src/`e göre yolları (ileri eğik çizgi), cephe önce. */
export function tamburServisRelYollari(): string[] {
  return tamburServisDosyalari().map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

/** Ailenin birleşik metni — tek dosyayı okuyan regex/AST bekçileri bunu okur. */
export function tamburServisMetni(): string {
  return tamburServisDosyalari().map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Yol (mutlak ya da `src/`e/`Teks-Erp/`ye göreli, `/` ya da `\\`) tambur servisi ailesinden mi? */
export function tamburServisDosyasiMi(yol: string): boolean {
  const y = yol.split(path.sep).join("/").replace(/\\/g, "/");
  return y.endsWith("services/tambur.service.ts") || /(^|\/)services\/tambur\/[^/]+\.ts$/.test(y);
}

/** Aileden bir yolu cephe etiketine katlar (diğer yollar aynen) — "yalnız şu dosyalarda" listeleri için. */
export function tamburServisEtiketi(rel: string): string {
  if (!tamburServisDosyasiMi(rel)) return rel;
  const y = rel.split(path.sep).join("/");
  const i = y.indexOf("services/");
  return y.slice(0, i) + TAMBUR_SERVIS_REL;
}

/**
 * `ad` adlı fonksiyon/metot bildiriminin metni (imza + gövde). Cephedeki ince delegasyon da aynı adı
 * taşıdığından GÖVDESİ EN UZUN bildirim seçilir (taşınan asıl gövde); yoksa "".
 */
export function tamburServisUyeMetni(ad: string): string {
  let en = "";
  for (const f of tamburServisDosyalari()) {
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
export function tamburServisTanimDosyasi(ad: string): string {
  let en = "";
  let dosya = TAMBUR_SERVIS_CEPHE;
  for (const f of tamburServisDosyalari()) {
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
