// =============================================================================
// AYAR SERVİSİ KAYNAĞI — metin/AST tarayan bekçilerin TEK okuma noktası
// =============================================================================
// `system-setting.service.ts` 2026-11-08'de cephe + `services/system-setting/*.ts`
// alan modüllerine bölündü (davranış aynı). Eskiden tek dosyayı okuyan bekçi
// artık AİLEYİ okur: cephe + dizindeki her `.ts` (dizin canlı taranır — yeni alan
// dosyası eklenince kapsam kendiliğinden genişler, hiçbir bekçi daralmaz).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "..", "..", "src");
/** Cephe (çağıranların import yolu). */
export const AYAR_SERVIS_CEPHE = path.join(SRC, "services", "system-setting.service.ts");
/** Alan modülleri dizini. */
export const AYAR_SERVIS_DIZINI = path.join(SRC, "services", "system-setting");
/** `src/`e göre cephe yolu (ileri eğik çizgi) — "yalnız ayar servisinde" kümelerinin TEK etiketi. */
export const AYAR_SERVIS_REL = "services/system-setting.service.ts";

/** Cephe + alan modülleri, mutlak yol, belirlenimli sıra (cephe önce). */
export function ayarServisDosyalari(): string[] {
  const alt = fs.existsSync(AYAR_SERVIS_DIZINI)
    ? fs.readdirSync(AYAR_SERVIS_DIZINI).filter((f) => f.endsWith(".ts")).sort().map((f) => path.join(AYAR_SERVIS_DIZINI, f))
    : [];
  return [AYAR_SERVIS_CEPHE, ...alt];
}

/** Ailenin birleşik metni — tek dosyayı okuyan regex/AST bekçileri bunu okur. */
export function ayarServisMetni(): string {
  return ayarServisDosyalari().map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Yol (mutlak ya da `src/`e/`Teks-Erp/`ye göreli, `/` ya da `\\`) ayar servisi ailesinden mi? */
export function ayarServisDosyasiMi(yol: string): boolean {
  const y = yol.split(path.sep).join("/");
  return y.endsWith("services/system-setting.service.ts") || /(^|\/)services\/system-setting\/[^/]+\.ts$/.test(y);
}

/** Aileden bir yolu cephe etiketine katlar (diğer yollar aynen) — "yalnız şu dosyalarda" listeleri için. */
export function ayarServisEtiketi(rel: string): string {
  return ayarServisDosyasiMi(rel) ? AYAR_SERVIS_REL : rel;
}

/**
 * `ad` adlı üst düzey fonksiyonun (function bildirimi ya da `const ad =`) tanımlandığı aile dosyası;
 * bulunamazsa cephe (çağıran analiz "bulunamadı" der — sessiz yeşil yok).
 */
export function ayarServisTanimDosyasi(ad: string): string {
  for (const f of ayarServisDosyalari()) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === ad) return f;
      if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === ad)) return f;
    }
  }
  return AYAR_SERVIS_CEPHE;
}

/**
 * `ad` adlı fonksiyon/metot bildiriminin metni (imza + gövde). Cephedeki ince delegasyon da aynı adı
 * taşıdığından GÖVDESİ EN UZUN bildirim seçilir (taşınan asıl gövde); yoksa "".
 */
export function ayarServisUyeMetni(ad: string): string {
  let en = "";
  for (const f of ayarServisDosyalari()) {
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
