// =============================================================================
// SİPARİŞ SERVİSİ KAYNAĞI — metin/AST tarayan bekçilerin TEK okuma noktası
// =============================================================================
// `order.service.ts` 2026-11-08'de cephe + `services/order/*.ts`
// alan modüllerine bölündü (davranış aynı). Eskiden tek dosyayı okuyan bekçi
// artık AİLEYİ okur: cephe + dizindeki her `.ts` (dizin canlı taranır — yeni alan
// dosyası eklenince kapsam kendiliğinden genişler, hiçbir bekçi daralmaz).
// Emsal: `is-emri-servis-kaynak.ts` (workorder), `sevkiyat-servis-kaynak.ts` (shipping).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..", "..", "src");
/** Cephe (çağıranların import yolu). */
export const SIPARIS_SERVIS_CEPHE = path.join(SRC, "services", "order.service.ts");
/** Alan modülleri dizini. */
export const SIPARIS_SERVIS_DIZINI = path.join(SRC, "services", "order");
/** `src/`e göre cephe yolu (ileri eğik çizgi) — "yalnız sipariş servisinde" kümelerinin TEK etiketi. */
export const SIPARIS_SERVIS_REL = "services/order.service.ts";

/** Cephe + alan modülleri, mutlak yol, belirlenimli sıra (cephe önce). */
export function siparisServisDosyalari(): string[] {
  const alt = fs.existsSync(SIPARIS_SERVIS_DIZINI)
    ? fs.readdirSync(SIPARIS_SERVIS_DIZINI).filter((f) => f.endsWith(".ts")).sort().map((f) => path.join(SIPARIS_SERVIS_DIZINI, f))
    : [];
  return [SIPARIS_SERVIS_CEPHE, ...alt];
}

/** Ailenin `src/`e göre yolları (ileri eğik çizgi), cephe önce. */
export function siparisServisRelYollari(): string[] {
  return siparisServisDosyalari().map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

/** Ailenin birleşik metni — tek dosyayı okuyan regex/AST bekçileri bunu okur. */
export function siparisServisMetni(): string {
  return siparisServisDosyalari().map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Yol (mutlak ya da `src/`e/`Teks-Erp/`ye göreli, `/` ya da `\\`) sipariş servisi ailesinden mi? */
export function siparisServisDosyasiMi(yol: string): boolean {
  const y = yol.split(path.sep).join("/").replace(/\\/g, "/");
  return y.endsWith("services/order.service.ts") || /(^|\/)services\/order\/[^/]+\.ts$/.test(y);
}

/** Aileden bir yolu cephe etiketine katlar (diğer yollar aynen) — "yalnız şu dosyalarda" listeleri için. */
export function siparisServisEtiketi(rel: string): string {
  if (!siparisServisDosyasiMi(rel)) return rel;
  const y = rel.split(path.sep).join("/");
  const i = y.indexOf("services/");
  return y.slice(0, i) + SIPARIS_SERVIS_REL;
}

/**
 * `ad` adlı fonksiyon/metot bildiriminin metni (imza + gövde). Cephedeki ince delegasyon da aynı adı
 * taşıdığından GÖVDESİ EN UZUN bildirim seçilir (taşınan asıl gövde); yoksa "".
 */
export function siparisServisUyeMetni(ad: string): string {
  let en = "";
  for (const f of siparisServisDosyalari()) {
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
export function siparisServisTanimDosyasi(ad: string): string {
  let en = "";
  let dosya = SIPARIS_SERVIS_CEPHE;
  for (const f of siparisServisDosyalari()) {
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
