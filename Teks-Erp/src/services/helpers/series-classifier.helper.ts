// =============================================================================
// OKUTULAN KODUN SINIFLANDIRILMASI — sunucunun TEK sınıflandırıcısı
// =============================================================================
// `number-series.service.ts`ten AYRILDI (boyut tavanı, 2026-09-23). Bölme ekseni
// SORU: orada "sıradaki numara NE olacak" (üretim), burada "elimdeki kod NEYİN
// numarası" (okuma). İki soru ayrı ayrı büyüyor ve tek dosyada tutmanın verdiği
// tek şey ortak `import` listesiydi.
//
// ⚠️ İÇE AKTARMA YOLU DEĞİŞMEDİ: servis bu dosyayı yeniden dışa veriyor.
// =============================================================================
import type { NumberSeries } from "@prisma/client";
import {
  NUMBER_SERIES_CATALOG,
  type NumberSeriesCatalogEntry,
  type NumberSeriesKind,
} from "../../constants/number-series-catalog";
import { matchesSeries, type NumberSeriesFormat } from "./series-format.helper";
import { normalizeScanCode } from "../../utils/code-format";
// ⚠️ BAĞIMLILIK TEK YÖNLÜ OLMAK ZORUNDA: bu dosya servisin önbellek okuyucusunu
// çağırır, servis ise bu dosyayı YENİDEN İHRAÇ ETMEZ. 2026-09-24'e kadar ediyordu
// ve "bilinçli döngü, modül yüklenirken kod koşmuyor" diye yazılıydı — `test_import_cycles`
// o gerekçeyi kabul etmedi ve HAKLIYDI: döngünün bugün zararsız olması, yarın
// birinin modül düzeyine bir çağrı eklemesini engellemez (`test_seri_modul_yuklemesi`
// tam o kazayı ölçüyor). ⇒ Çağıranlar bu helper'ı DOĞRUDAN import eder.
import { resolveSeriesFormat } from "../number-series.service";

export interface SeriesClassifierRow {
  key: string;
  kind: NumberSeriesKind;
  /** Yürürlükteki ön ek ÖNCE, emekliler sonra — eski etiket de çözülsün diye. */
  prefixes: string[];
  dateSegment: NumberSeries["dateSegment"];
  digits: number;
  separator: string;
  /**
   * TARİH ile SAYAÇ arasındaki ayraç — yoksa `separator` geçerlidir (D5②).
   *
   * ⚠️ ALAN EKLENDİ: Faz D'siz eski istemci bunu tanımaz ve iki eklemde de
   * `separator` kurar ⇒ `separator2 !== separator` olan OKUTULAN bir seride
   * kodu sessizce çözemez. Bu yüzden okutulan serilerin biçimi C0b iki eşikli
   * kilidin arkasındadır (`series-write.helper.ts`, `test_number_series_panel §10a`).
   */
  separator2?: string | null;
  /** Tarih ile sıra arasındaki sabit parça (regex); istemci tam-format regex'ini bundan kurar. */
  infix?: string;
  /**
   * EMEKLİ BİÇİMLER — her biri KENDİ segment/hane/ayracıyla (D4②).
   *
   * ⚠️ ALAN EKLENDİ, `prefixes` DEĞİŞTİRİLMEDİ ve bu bilinçli: eski istemci
   * (Faz B taşıyan ama Faz D taşımayan) bu alanı TANIMAZ ve görmezden gelir —
   * davranışı bugünküyle birebir aynı kalır (emekli ön ekleri yürürlükteki
   * hane ile dener). Alanı `prefixes`in yerine koysaydık eski istemci emekli
   * ön eki HİÇ tanımaz olurdu; sözleşme kıran değişiklik, alan EKLEMEK değil
   * var olanı DEĞİŞTİRMEKTİR.
   */
  retiredFormats?: Array<{
    prefix: string;
    dateSegment: NumberSeries["dateSegment"];
    digits: number;
    separator: string;
    separator2?: string | null;
  }>;
}

function classifierRow(entry: NumberSeriesCatalogEntry): SeriesClassifierRow {
  const fmt = resolveSeriesFormat(entry.key);
  return {
    key: entry.key,
    kind: entry.kind as NumberSeriesKind,
    prefixes: [fmt.prefix, ...fmt.retiredPrefixes],
    dateSegment: fmt.dateSegment,
    digits: fmt.digits,
    separator: fmt.separator,
    ...(fmt.separator2 != null ? { separator2: fmt.separator2 } : {}),
    ...(fmt.infix ? { infix: fmt.infix } : {}),
    ...(fmt.retiredFormats && fmt.retiredFormats.length > 0
      ? { retiredFormats: fmt.retiredFormats }
      : {}),
  };
}

/** İstemcilerin barkod sınıflandırması için okuduğu tablo. */
export function seriesClassifierTable(): SeriesClassifierRow[] {
  return NUMBER_SERIES_CATALOG.filter((e) => e.kind !== undefined).map(classifierRow);
}

/**
 * Okutulan kodun HANGİ seriye ait olduğu — emekli ön ekler dahil; tanınmazsa null.
 *
 * Sunucudaki TEK sınıflandırıcıdır: `/api/scan/resolve` de `search.service`in
 * tam-format hızlı yolu da bunu çağırır (boğaz ikiz). Ön ek bir gün değişirse
 * ikisi birden değişir; elle yazılmış ikinci bir regex tablosu geride kalmaz.
 *
 * Sıra sonucu ETKİLEMEZ: okutulan serilerde "biri ötekinin ön eki olamaz" kuralı
 * `assertSeriesFormatAllowed ③` ile zaten sağlanıyor, yani bir kod en çok bir
 * seriye uyar.
 */
export function classifyScannedCode(code: string): SeriesClassifierRow | null {
  const upper = normalizeScanCode(code);
  if (upper === "") return null;
  for (const entry of NUMBER_SERIES_CATALOG) {
    if (!entry.kind) continue;
    if (matchesSeries(resolveSeriesFormat(entry.key), upper)) return classifierRow(entry);
  }
  return null;
}
