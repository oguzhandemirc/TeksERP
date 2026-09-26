// =============================================================================
// ALAN BAZLI yazı ayarı katalogları — 6 belge için (tek kaynak)
// =============================================================================
// Fason çekide açılan kapı (bkz. `fason-ceki.fields.ts`) diğer belgelere de
// taşındı: belge geneli `fontScale`/`fontWeight` tek kolu çevirir, bu ise TEK
// BİR ALANI ayarlar ("tablo başlıkları büyük olsun ama gövde küçük kalsın",
// "toplam satırı iri bassın").
//
// Katalog `key → (seçici, taban punto, taban kalınlık)` eşlemesidir; taban
// YOĞUNLUK PROFİLİNDEN gelir (`doc-density.ts`, A4/A5 ayrı), kullanıcı ayarı
// mutlak px'tir ve ikisini de ezer.
//
// ⚠️ FASON ÇEKİDEKİ ÜÇ KURAL BURADA DA GEÇERLİ:
//  1. Override yoksa TEK BAYT CSS basılmaz → ayara dokunmamış belgenin çıktısı
//     birebir korunur.
//  2. calc()/var() KULLANILMAZ — `doc-style.scaleDocCss` yazı ölçeğini
//     `font-size:\s*([\d.]+)px` regex'iyle uyguluyor; calc() o desene takılmaz ve
//     genel ölçek ayarı tam da elle ayarlanmış alanlarda SESSİZCE ölürdü.
//  3. Her seçici `.sheet ` ile öneklenir → ortak chrome kurallarından her zaman
//     daha özgül olur ve CSS sırasından BAĞIMSIZ kazanır.
//
// ⚠️ Electron paneli bu katalogun AYNASINI taşır (`services/documentConfig.ts`,
// `DOC_FIELD_CATALOGS`) — ayrı proje, import edemez. İki taraf birlikte değişir;
// bekçi (`test_doc_fields.ts`) birebirliği mekanik doğrular.
// =============================================================================

import { DOC_FIELD_WEIGHTS, type DocFieldStyle } from "./doc-style";
import type { DocDensity } from "./doc-density";
import { cssFixed } from "./fmt-num";

export interface DocFieldDef {
  key: string;
  label: string;
  group: "header" | "boxes" | "table" | "footer";
  selector: string;
  base: (d: DocDensity) => number;
  weight: number;
}

/** Altı belgenin ORTAK chrome'undaki alanlar — hepsinde aynı seçici, aynı taban. */
const COMMON: DocFieldDef[] = [
  { key: "company", label: "Firma adı", group: "header", selector: ".company", base: (d) => d.company, weight: 800 },
  { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header", selector: ".lh-line", base: (d) => d.lhLine, weight: 400 },
  { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header", selector: ".sayin", base: (d) => d.sayin, weight: 400 },
  { key: "sayin", label: "Müşteri / firma adı", group: "header", selector: ".sayin b", base: (d) => d.sayinB, weight: 700 },
  { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header", selector: ".sub", base: (d) => d.sub, weight: 400 },
  { key: "title", label: "Belge başlığı", group: "header", selector: ".title", base: (d) => d.title, weight: 800 },
  { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header", selector: ".hr .ln", base: (d) => d.ln, weight: 400 },
  { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header", selector: ".hr .ln b", base: (d) => d.lnB, weight: 700 },
  { key: "vehicle", label: "Araç / referans satırı", group: "header", selector: ".meta-row", base: (d) => d.metaRow, weight: 400 },

  { key: "secHead", label: "Tablo başlıkları", group: "table", selector: ".sec thead th", base: (d) => d.secHead, weight: 700 },
  { key: "secCell", label: "Tablo hücreleri", group: "table", selector: ".sec tbody td", base: (d) => d.secCell, weight: 400 },
  { key: "secTot", label: "TOPLAM satırı", group: "table", selector: ".sec tbody tr.tot td", base: (d) => d.secCell, weight: 800 },

  { key: "note", label: "Not / alt bilgi", group: "footer", selector: ".note", base: (d) => d.note, weight: 400 },
  { key: "signLabel", label: "İmza etiketleri", group: "footer", selector: ".sign-lbl", base: (d) => d.signLbl, weight: 400 },
  { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer", selector: ".stamps-l", base: () => 9, weight: 400 },
];

/** Bilgi kutusu taşıyan belgeler (fasondan sevk · fason kabul · kartela · iade). */
const BOXES: DocFieldDef[] = [
  { key: "boxTitle", label: "Kutu başlığı", group: "boxes", selector: ".box-t", base: (d) => d.boxT, weight: 700 },
  { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes", selector: ".box .row", base: (d) => d.boxRow, weight: 400 },
];

/** Tablo üstü başlık taşıyan belgeler. */
const TBL_CAP: DocFieldDef = {
  key: "tblCap", label: "Tablo üstü başlık", group: "table", selector: ".tbl-cap", base: (d) => d.tblCap, weight: 700,
};

/** Tablo İÇİ geniş başlık hücresi (ÜRÜN LİSTESİ / İADE EDİLEN TOPLAR …). */
const SEC_CAPTION: DocFieldDef = {
  key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table", selector: ".sec th.caption", base: (d) => d.secCaption, weight: 800,
};

/**
 * BEYAN/RİCA metni (`.decl`) — belgenin hukuki cümlesi, opsiyonel bir not DEĞİL
 * (bkz. `finance-doc.renderFinanceDoc` → `declaration`). Kalite sertifikası,
 * mutabakat mektubu ve çek teslim bordrosu üçü de basar; tek nesne olarak
 * paylaşılır ki üç katalogda üç farklı taban/kalınlık doğmasın.
 */
const DECL: DocFieldDef = {
  key: "decl", label: "Beyan metni", group: "footer", selector: ".decl", base: (d) => d.note, weight: 400,
};

/**
 * Belge → alan kataloğu. Anahtarlar `DOC_CONFIG_KEYS` ile aynı (fasonSevk hariç —
 * onun kendi kataloğu var, `fason-ceki.fields.ts`).
 *
 * ⚠️ KATALOG `DOC_CONFIG_KEYS` KADAR GENİŞ DEĞİLDİR ve olmak zorunda da değil:
 * `docFieldCss` katalog bulamazsa boş string döner (kural 1 — override yoksa tek
 * bayt CSS basılmaz). Ama bir belge buraya eklenecekse Electron aynası
 * (`services/documentConfig.ts` → `DOC_FIELD_CATALOGS`) AYNI commit'te
 * güncellenir: `scripts/test_doc_density_fields.ts` §5 birebirliği SIRA DAHİL
 * mekanik doğrular ve yalnız bir tarafı eklemek bekçiyi anında kırmızıya çevirir.
 *
 * ⚠️ BİLİNEN BORÇ (2026-08-15, dört ön muhasebe belgesi): `finance-doc` chrome'u
 * `.sayin` / `.sub` / `.meta-row` / `.box-t` elemanlarını HİÇ basmaz (taraf
 * bilgisi `.box .row` içinde durur) — yani `sayinLabel · sayin · subLine ·
 * vehicle · boxTitle` satırları o dört belgede panelde GÖRÜNÜR ama karşılığı
 * YOKTUR. Yeni iki belge bilerek AİLEYLE aynı listeyi taşıyor: aynı renderer
 * içinde iki farklı katalog felsefesi, sonradan bakan için hangisinin doğru
 * olduğunu belirsiz yapardı. Temizlenecekse DÖRDÜ BİRDEN temizlenmeli — baskı
 * çıktısı değişmez (o seçiciler zaten hiçbir şeye uymuyor), yalnız panelden
 * beş ölü satır düşer.
 */
export const DOC_FIELD_CATALOGS: Record<string, DocFieldDef[]> = {
  shipmentDispatch: [
    ...COMMON,
    SEC_CAPTION,
    { key: "wrapCell", label: "Açıklama hücresi (çuval yorumu)", group: "table", selector: ".sec td.wrap", base: (d) => Number(cssFixed(10 * d.fontK, 2)), weight: 400 },
  ],
  fasonDirectShip: [...COMMON, ...BOXES, TBL_CAP],
  fasonKabul: [...COMMON, ...BOXES, TBL_CAP],
  kartelaCeki: [...COMMON, ...BOXES, TBL_CAP],
  kaliteSertifikasi: [...COMMON, TBL_CAP, DECL],
  iadeIrsaliyesi: [...COMMON, ...BOXES, SEC_CAPTION],
  // Ticaret paketi — iç depo belgeleri (iade irsaliyesiyle aynı iskelet).
  depoTransfer: [...COMMON, ...BOXES, SEC_CAPTION],
  malKabul: [...COMMON, ...BOXES, SEC_CAPTION],
  // Stok sayım tutanağı (2026-08-15, J2 #19) — AYNI depo belgesi ailesi
  // (`warehouse-doc.html.ts` üçünü de tek gövdeden basıyor), dolayısıyla alan
  // listesi de aynı. ⚠️ Bu satır Electron aynasıyla (`services/documentConfig.ts`
  // → `DOC_FIELD_CATALOGS.stokSayimi`) AYNI commit'te eklendi:
  // `test_doc_density_fields` §5 birebirliği SIRA DAHİL ölçer ve yalnız bir
  // tarafı eklemek bekçiyi anında kırmızıya çevirir.
  stokSayimi: [...COMMON, ...BOXES, SEC_CAPTION],
  // Ön muhasebe çıktıları — aynı iskelet (başlık · kutu · tablo · imza).
  fatura: [...COMMON, ...BOXES, SEC_CAPTION],
  tahsilatMakbuzu: [...COMMON, ...BOXES, SEC_CAPTION],
  // Resmi ön muhasebe belgeleri (2026-08-15, J2 #18) — aynı iskelet + BEYAN
  // bloğu. Fatura/makbuzda beyan YOKTUR (`declaration` verilmezse tek bayt CSS
  // basılmaz), bu ikisinde belgenin KENDİSİDİR.
  mutabakatMektubu: [...COMMON, ...BOXES, SEC_CAPTION, DECL],
  cekTeslimBordrosu: [...COMMON, ...BOXES, SEC_CAPTION, DECL],
};

/**
 * Alan override'larından CSS üretir. Override yoksa **boş string** (kural 1).
 * Bilinmeyen anahtar sessizce atlanır — eski bir ayar kaydı yeni sürümde baskıyı
 * düşürmemeli (belge basmak vardiyayı durdurmayacak kadar kritiktir).
 */
export function docFieldCss(
  fields: Record<string, DocFieldStyle> | undefined,
  defs: DocFieldDef[] | undefined,
  d: DocDensity,
): string {
  if (!fields || !defs) return "";
  const rules: string[] = [];
  // Katalog sırasında dolaş (nesne anahtar sırası DEĞİL) — çıktı deterministik
  // olmalı, yoksa aynı ayar iki kayıtta farklı CSS üretir.
  for (const def of defs) {
    const cfg = fields[def.key];
    if (!cfg) continue;
    const decls: string[] = [];
    if (cfg.size != null) decls.push(`font-size: ${Number(cssFixed(cfg.size, 2))}px`); // düz px — calc() YASAK
    if (cfg.weight != null) decls.push(`font-weight: ${DOC_FIELD_WEIGHTS[cfg.weight]}`);
    if (!decls.length) continue;
    const sel = def.selector
      .split(",")
      .map((s) => `.sheet ${s.trim()}`)
      .join(", ");
    rules.push(`${sel} { ${decls.join("; ")}; }`);
  }
  void d; // taban çözümü panel önizlemesinde kullanılıyor; imza ileriye dönük
  return rules.join("\n  ");
}

/** Bir alanın çözülmüş (nihai) punto/kalınlığı — bekçi ve panel için. */
export function resolveDocField(
  docKey: string,
  key: string,
  fields: Record<string, DocFieldStyle> | undefined,
  d: DocDensity,
): { size: number; weight: number } | null {
  const def = DOC_FIELD_CATALOGS[docKey]?.find((f) => f.key === key);
  if (!def) return null;
  const cfg = fields?.[key];
  return {
    size: cfg?.size ?? def.base(d),
    weight: cfg?.weight != null ? DOC_FIELD_WEIGHTS[cfg.weight] : def.weight,
  };
}
