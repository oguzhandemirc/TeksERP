// =============================================================================
// KALEM FİYATI — SAF TÜRETME KATMANI
// =============================================================================
// NEDEN AYRI DOSYA: bu ekranın anlattığı model iki durumludur ve ikisi de
// kolayca birbirine karışır —
//
//     customerId = null  →  KART VARSAYILANI  ("herkese uygulanır")
//     customerId = uuid  →  MÜŞTERİ İSTİSNASI ("yalnız o müşteriye")
//
// Ayrımı bileşen içindeki bir `&&` zincirinde bırakmak, tersine çevrildiğinde
// hiçbir testin kırılmaması demektir (projenin yazılı deseni: `canQuickShip`,
// `resolveRollTabs`, `orders-regime.ts`). Burası saf: girdi satırlar, çıktı
// görüntü modeli — bekçisi `prices.test.ts`.
//
// ⚠️ BURASI ÇÖZÜM SIRASINI UYGULAMAZ. "Hangi fiyat geçerli" sorusunun tek
// cevabı backend'in `/resolve` ucudur (bkz. `service.ts` başlığı). Aşağıdaki
// `baseFor` yalnız EKRANDA "istisnanın karşılaştırıldığı varsayılan" satırını
// gösterir; fatura hiçbir zaman bu hesaba bakmaz.
//
// ⚠️ "YOK" SIFIR DEĞİLDİR. Satır bulunamadığında `null` döner ve çağıran
// "Fiyat girilmemiş" basar. Sıfır bir FİYATTIR (promosyon/numune) ve ikisini
// aynı göstermek, faturayı sessizce bedavaya onaylatan yolun ilk adımıdır.
// =============================================================================
import {
  CURRENCIES,
  PRICE_KINDS,
  PRICE_KIND_LABEL,
  priceText,
  toNum,
  type Currency,
  type ItemPriceRow,
  type PriceKind,
} from "./service";

/** Bir satırın kimliği: hangi kalem/müşteri/yön/para birimi kutusuna düşer. */
export interface PriceSelector {
  /** `null` = kart varsayılanı. */
  customerId: string | null;
  kind: PriceKind;
  currency: Currency;
}

/** Varsayılan matrisinin bir hücresi. `row: null` → "fiyat girilmemiş". */
export interface PriceCell {
  kind: PriceKind;
  currency: Currency;
  row: ItemPriceRow | null;
}

/** İstisna satırının ekran modeli — yanında karşılaştırma tabanıyla. */
export interface ExceptionView {
  row: ItemPriceRow;
  /** Aynı yön + para birimindeki kart varsayılanı; yoksa `null`. */
  base: ItemPriceRow | null;
  /** Varsayılana göre yüzde fark. Taban yok/0 ise `null` (bkz. `deltaPercent`). */
  deltaPct: number | null;
  customerLabel: string;
}

/** ⚠️ Modelin tamamı bu tek satırda: müşterisi olmayan satır VARSAYILANDIR. */
export function isDefaultRow(row: ItemPriceRow): boolean {
  return row.customerId === null;
}

export function splitRows(rows: ItemPriceRow[]): {
  defaults: ItemPriceRow[];
  exceptions: ItemPriceRow[];
} {
  return {
    defaults: rows.filter(isDefaultRow),
    exceptions: rows.filter((r) => !isDefaultRow(r)),
  };
}

/** Müşteri adı — kod + ad; ilişki gelmediyse dürüst bir yer tutucu. */
export function customerLabelOf(row: ItemPriceRow): string {
  if (!row.customerId) return "Kart varsayılanı";
  if (!row.customer) return "Müşteri (kaydı okunamadı)";
  return `${row.customer.code} — ${row.customer.name}`;
}

/**
 * Ekranda gösterilecek para birimleri.
 *
 * ⚠️ TRY HER ZAMAN VARDIR (fabrikanın/firmanın günlük birimi; boş bir "Alış /
 * Satış" satırı görmek, fiyatın hiç girilmediğini söyleyen tek yüzeydir).
 * Diğerleri VERİDEN gelir — istisnalar da sayılır: USD'de yalnız bir müşteri
 * istisnası varsa, USD varsayılanının BOŞ olduğu görünmelidir; aksi halde o
 * istisna "sebepsiz yere yalnız" durur ve kullanıcı neden karşılaştırma
 * yapılamadığını anlamaz.
 */
export function currenciesInPlay(rows: ItemPriceRow[]): Currency[] {
  const present = new Set<Currency>(["TRY"]);
  for (const r of rows) present.add(r.currency);
  return CURRENCIES.filter((c) => present.has(c));
}

export function findRow(rows: ItemPriceRow[], sel: PriceSelector): ItemPriceRow | undefined {
  return rows.find(
    (r) => r.customerId === sel.customerId && r.kind === sel.kind && r.currency === sel.currency,
  );
}

/** Aynı yön + para birimindeki kart varsayılanı (istisnanın karşılaştırma tabanı). */
export function baseFor(rows: ItemPriceRow[], row: ItemPriceRow): ItemPriceRow | null {
  return findRow(rows, { customerId: null, kind: row.kind, currency: row.currency }) ?? null;
}

/**
 * Varsayılan matrisi — para birimi büyük grup, içinde Alış/Satış.
 *
 * ⚠️ BOŞ HÜCRE DE ÜRETİLİR (`row: null`). Yalnız var olan satırları listelemek,
 * "satış fiyatı hiç girilmemiş" gerçeğini EKRANDAN SİLERDİ; kullanıcı listede
 * göremediği şeyi eksik değil YOK sanır.
 */
export function buildDefaultCells(rows: ItemPriceRow[]): PriceCell[] {
  const out: PriceCell[] = [];
  for (const currency of currenciesInPlay(rows)) {
    for (const kind of PRICE_KINDS) {
      out.push({ kind, currency, row: findRow(rows, { customerId: null, kind, currency }) ?? null });
    }
  }
  return out;
}

/**
 * Yüzde fark. Taban yoksa ya da taban **0** ise `null`.
 *
 * ⚠️ Sıfır tabanda oran matematiksel olarak tanımsızdır; `Infinity`/`%NaN`
 * basmak yerine hücre "varsayılan yok/0" der. Uydurma bir yüzde, bu ekranın
 * tek işi olan "istisna varsayılandan ne kadar sapıyor" sorusuna yanlış cevap
 * verirdi.
 */
export function deltaPercent(
  price: ItemPriceRow["price"],
  base: ItemPriceRow["price"] | null | undefined,
): number | null {
  if (base === null || base === undefined) return null;
  const b = toNum(base);
  if (b === 0) return null;
  return ((toNum(price) - b) / b) * 100;
}

/**
 * İstisna listesi — müşteri adına, sonra yön ve para birimine göre.
 *
 * Sıra bilinçli: kullanıcı "bu müşteriye ne veriyoruz" diye bakar, "hangi
 * yönde istisna var" diye değil.
 */
export function buildExceptionViews(rows: ItemPriceRow[]): ExceptionView[] {
  const { exceptions } = splitRows(rows);
  return exceptions
    .map<ExceptionView>((row) => {
      const base = baseFor(rows, row);
      return {
        row,
        base,
        deltaPct: deltaPercent(row.price, base?.price ?? null),
        customerLabel: customerLabelOf(row),
      };
    })
    .sort(
      (a, b) =>
        a.customerLabel.localeCompare(b.customerLabel, "tr") ||
        a.row.kind.localeCompare(b.row.kind) ||
        a.row.currency.localeCompare(b.row.currency),
    );
}

/** Aynı kutuya ikinci kez yazılıyor mu — form "üzerine yazılacak" desin diye. */
export function findExisting(
  rows: ItemPriceRow[],
  sel: PriceSelector,
): ItemPriceRow | undefined {
  return findRow(rows, sel);
}

/**
 * SİLME ONAYININ METNİ — somut, sayılı, sonucu söyleyen.
 *
 * Kök kural: yıkıcı işlemde onay somut olmalı; "1 kayıt silinecek" gibi soyut
 * bir sayı YETMEZ. Burada üç şey söylenir ve üçü de kullanıcının gerçekten
 * merak ettiği şeydir:
 *   ① tam olarak hangi satır (yön / para birimi / tutar),
 *   ② silindikten SONRA ne olacak (varsayılana düşer mi, boş mu kalır),
 *   ③ geçmiş belgelerin etkilenmediği — silme FİZİKSEL olduğu için bu soru
 *      mutlaka akla gelir ve cevabı verilmezse kullanıcı işlemi yapmaz.
 */
export function describeRemoval(
  row: ItemPriceRow,
  rows: ItemPriceRow[],
  itemLabel: string,
): string {
  const what = `${PRICE_KIND_LABEL[row.kind]} / ${row.currency}`;
  const amount = priceText(row.price, row.currency);
  const frozen =
    "Geçmiş faturalar ve mal kabul kayıtları fiyatı KENDİ satırlarında dondurduğu için etkilenmez.";

  if (isDefaultRow(row)) {
    const affected = splitRows(rows).exceptions.filter(
      (r) => r.kind === row.kind && r.currency === row.currency,
    ).length;
    const exceptionsLine =
      affected > 0
        ? `\n\nBu yön/para biriminde tanımlı ${affected} müşteri istisnası ETKİLENMEZ — o müşteriler kendi fiyatlarını kullanmaya devam eder.`
        : "";
    return (
      `«${itemLabel}» kaleminin ${what} VARSAYILAN fiyatı (${amount}) kaldırılacak.` +
      `\n\nBundan sonra bu kalemin fiyatı BOŞ gelir — sıfır değil, “girilmemiş”. Fatura/mal kabul satırında fiyat elle yazılır.` +
      exceptionsLine +
      `\n\n${frozen}`
    );
  }

  const base = baseFor(rows, row);
  const after = base
    ? `\n\nBu müşteri bundan sonra kart varsayılanını (${priceText(base.price, base.currency)}) kullanır.`
    : `\n\nBu kalemde ${what} kart varsayılanı YOK — kaldırıldıktan sonra bu müşteride fiyat BOŞ gelir (sıfır değil, “girilmemiş”).`;

  return (
    `«${itemLabel}» kalemi için «${customerLabelOf(row)}» müşterisine tanımlı ${what} İSTİSNASI (${amount}) kaldırılacak.` +
    after +
    `\n\n${frozen}`
  );
}
