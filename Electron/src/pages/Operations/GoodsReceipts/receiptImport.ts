// =============================================================================
// MAL KABUL — EXCEL İÇE AKTARMA (saf katman)
// =============================================================================
// Saha isteği (2026-08-13): tedarikçi listesi Excel'de geliyor, elle yazmak
// yerine yüklensin.
//
// ⚠️ ÜÇ KURAL, üçü de bilinçli:
//
// ① **EŞLEŞMEYEN SATIR SESSİZCE ATLANMAZ.** Ayrıştırıcı iki liste döner:
//    kabul edilen satırlar ve REDDEDİLEN satırlar (Excel satır numarası +
//    somut sebep). "18 satır yüklendi" deyip 2'sini yutmak, bu projede en
//    pahalı hata sınıfıdır: operatör malı depoda sanır, envanterde yoktur.
//
// ② **AD İLE EŞLEŞME BELİRSİZSE HATA, TAHMİN DEĞİL.** Kumaş önce KODLA
//    aranır (kimlik odur), bulunamazsa adla; ad birden fazla kayda uyuyorsa
//    satır reddedilir. Yanlış kumaşa mal yazmak, hiç yazmamaktan kötüdür.
//
// ③ **KAT KATALOGDAN DOĞRULANIR.** Tanınmayan kat değeri ham geçirilemez:
//    backend kanonikleştirir ama katalogda olmayan değer sessizce yazılırsa
//    o toplar "4-KAT" filtresinde hiç görünmez (kök CLAUDE.md 2026-08-04
//    dersi — filtre 0 satır döner, hata da log da çıkmaz).
// =============================================================================
import type { DraftLine } from "./ReceiptLineRows";

export interface ImportCatalogEntry {
  id: string;
  code?: string | null;
  name: string;
}

export interface ImportCatalogs {
  items: ImportCatalogEntry[];
  colors: ImportCatalogEntry[];
  /** Kat kataloğu (FabricPropertyValue) — boşsa kat kolonu yok sayılır. */
  folds: Array<{ code: string; name: string }>;
}

export interface ImportRowError {
  /** Excel satır numarası (başlık 1. satır → veri 2'den başlar). */
  row: number;
  reason: string;
}

export interface ImportResult {
  lines: DraftLine[];
  errors: ImportRowError[];
}

/** Şablonun kolon başlıkları — indirilen dosya ile okuyucu TEK kaynaktan. */
export const IMPORT_HEADERS = [
  "Kumaş Kodu",
  "Kumaş Adı",
  "Renk",
  "Metre",
  "En (cm)",
  "Kg",
  "Kat",
  "Birim Fiyat",
  "Adet",
] as const;

const norm = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

/** Büyük/küçük harf ve boşluk duyarsız karşılaştırma anahtarı.
 *  ⚠️ `toLocaleUpperCase("tr")` KULLANILMAZ — "i" → "İ" dönüşümü ASCII yazılmış
 *  kodları eşleşmez yapar (kök CLAUDE.md 2026-08-02 etiket `showIf` dersi). */
const key = (v: string) => v.toUpperCase().replace(/\s+/g, " ");

const toNumber = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Türkçe Excel'de ondalık ayırıcı virgüldür; binlik noktası da olabilir.
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function buildIndex(entries: ImportCatalogEntry[]) {
  const byCode = new Map<string, ImportCatalogEntry>();
  const byName = new Map<string, ImportCatalogEntry[]>();
  for (const e of entries) {
    if (e.code) byCode.set(key(e.code), e);
    const k = key(e.name);
    const list = byName.get(k);
    if (list) list.push(e);
    else byName.set(k, [e]);
  }
  return { byCode, byName };
}

/**
 * Excel satırlarını taslak kalemlere çevirir.
 * @param rows Başlık satırı HARİÇ, kolon adına göre anahtarlanmış ham satırlar.
 */
export function parseReceiptRows(
  rows: Array<Record<string, unknown>>,
  catalogs: ImportCatalogs,
): ImportResult {
  const items = buildIndex(catalogs.items);
  const colors = buildIndex(catalogs.colors);
  const foldByKey = new Map<string, string>();
  for (const f of catalogs.folds) {
    foldByKey.set(key(f.code), f.code);
    foldByKey.set(key(f.name), f.code);
  }

  const lines: DraftLine[] = [];
  const errors: ImportRowError[] = [];

  rows.forEach((raw, i) => {
    const rowNo = i + 2; // 1. satır başlık
    const code = norm(raw["Kumaş Kodu"]);
    const name = norm(raw["Kumaş Adı"]);
    const colorText = norm(raw["Renk"]);
    const foldText = norm(raw["Kat"]);

    // Tamamen boş satır: Excel dosyalarının sonunda olağandır, hata sayılmaz.
    if (!code && !name && !colorText && !norm(raw["Metre"])) return;

    let item = code ? items.byCode.get(key(code)) : undefined;
    if (!item && name) {
      const matches = items.byName.get(key(name)) ?? [];
      if (matches.length > 1) {
        errors.push({ row: rowNo, reason: `"${name}" adını taşıyan ${matches.length} kumaş var — Kumaş Kodu yazın.` });
        return;
      }
      item = matches[0];
    }
    if (!item) {
      errors.push({ row: rowNo, reason: `Kumaş bulunamadı: ${code || name || "(boş)"}` });
      return;
    }

    const qty = toNumber(raw["Metre"]);
    if (qty == null || qty <= 0) {
      errors.push({ row: rowNo, reason: `Metre geçersiz: ${norm(raw["Metre"]) || "(boş)"}` });
      return;
    }

    let colorId: string | null = null;
    if (colorText) {
      const c = colors.byCode.get(key(colorText)) ?? (colors.byName.get(key(colorText)) ?? [])[0];
      if (!c) {
        errors.push({ row: rowNo, reason: `Renk bulunamadı: ${colorText}` });
        return;
      }
      colorId = c.id;
    }

    let foldType: string | null = null;
    if (foldText) {
      const f = foldByKey.get(key(foldText));
      if (!f) {
        errors.push({ row: rowNo, reason: `Kat kataloğunda yok: ${foldText}` });
        return;
      }
      foldType = f;
    }

    const rawCount = toNumber(raw["Adet"]);
    // Adet boşsa 1 — "adet yazmadım" demek "bir top geldi" demektir.
    const count = rawCount == null ? 1 : Math.floor(rawCount);
    if (count < 1) {
      errors.push({ row: rowNo, reason: `Adet geçersiz: ${norm(raw["Adet"])}` });
      return;
    }

    lines.push({
      key: crypto.randomUUID(),
      itemId: item.id,
      colorId,
      initialQty: qty,
      width: toNumber(raw["En (cm)"]),
      weightKg: toNumber(raw["Kg"]),
      foldType,
      unitPrice: toNumber(raw["Birim Fiyat"]),
      propertyIds: [],
      count,
    });
  });

  return { lines, errors };
}
