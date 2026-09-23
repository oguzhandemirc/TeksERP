// =============================================================================
// SONUÇ KAPISI — "bu biçimle üretilen kod NEYE ÇÖZÜLÜR?"
// =============================================================================
// `series-write.helper.ts`ten AYRILDI (dosya boyutu tavanı). Bölme ekseni SORU:
// orada "önerilen DEĞER geçerli mi" (karakter kümesi, hane, kapasite, ayraç),
// burada "o değerin SONUCU ne" — üretilen kod başka bir okutulan serinin
// biçimine düşüyor mu. İkisi farklı gün de değişir: biri kolon genişleyince,
// öteki katalogda yeni bir okutulan seri doğunca.
// =============================================================================
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { AppError } from "../../utils/app-error";
import { matchesSeries, previewSeriesCode, type NumberSeriesFormat } from "./series-format.helper";
import { resolveSeriesFormat } from "../number-series.service";

/**
 * ③a SONUÇ KAPISI — ön ek eşitliğine DEĞİL, üretilecek kodun NEYE ÇÖZÜLDÜĞÜNE bakar
 * (1e kararı 2026-09-23). Ön ek karşılaştırması bu soruyu SORAMIYORDU: okutulmayan
 * bir seri, okutulan bir türün biçimine düşen kod üretebiliyor ve kapı susuyordu
 * (ölçüldü 2026-09-23: okutulmayan 43 seri × okutulan ön ekler = 215 deneme,
 * çakışma reddi 0).
 *
 * AYRI FONKSİYON: `assertSeriesFormatAllowed` boyut tavanını aştı ve bölme ekseni
 * doğal — orası "değer geçerli mi", burası "bu değerin SONUCU ne".
 */
export function assertScanOutcomeAllowed(key: string, fmt: NumberSeriesFormat): void {
  const entry = numberSeriesCatalogEntry(key);
  // ⚠️ KAPI YENİ İHLALİ ENGELLER, BUGÜNKÜ DURUMU YASAKLAMAZ: ölçüldü 2026-09-23 —
  // `cashAccount` (kasa kodu, okutulmaz) bugün `KS` ön ekiyle doğuyor ve ürettiği
  // kod `kartelaDispatch` (KS, okutulur) biçimine UYUYOR. Bu çakışma yıllardır var,
  // zararsız sayılmış ve alan kural dosyasında BEYANLI. Kapıyı koşulsuz yazsaydık
  // o serinin hane sayısını bile değiştiremezdiniz — yeni bir kural, var olan
  // yapılandırmayı bir anda "kaydedilemez" yapamaz. Bu yüzden ölçüt FARKTIR:
  // adayın düştüğü tür, BUGÜNKÜ biçimin de düştüğü türse geçmişten devralınmıştır.
  const adayFmt: NumberSeriesFormat = { ...fmt, ...(entry.infix ? { infix: entry.infix.re } : {}) };
  const cozulenTurler = (f: NumberSeriesFormat): Set<string> => {
    const out = new Set<string>();
    for (const kod of [previewSeriesCode(f, 1), previewSeriesCode(f, 10 ** f.digits)]) {
      for (const other of NUMBER_SERIES_CATALOG) {
        if (other.key === key || !other.kind) continue;
        if (matchesSeries(resolveSeriesFormat(other.key), kod)) out.add(`${other.key}\u0000${kod}`);
      }
    }
    return out;
  };
  const devralinan = new Set(
    seriesKnownFormats(key).flatMap((f) =>
      [...cozulenTurler({ ...f, ...(entry.infix ? { infix: entry.infix.re } : {}) })].map(
        (x) => x.split("\u0000")[0],
      ),
    ),
  );
  for (const bulgu of cozulenTurler(adayFmt)) {
    const [otherKey, kod] = bulgu.split("\u0000") as [string, string];
    if (devralinan.has(otherKey)) continue;
    const other = NUMBER_SERIES_CATALOG.find((e) => e.key === otherKey)!;
    throw AppError.conflict(
      `Bu biçimle üretilen kod ("${kod}") barkod okutmada "${other.label}" sanılır; ` +
        "farklı bir ön ek ya da ayraç seçin.",
      { code: "NUMBER_SERIES_SCAN_COLLISION", key, conflictsWith: otherKey, ornekKod: kod },
    );
  }
}

/**
 * SERİNİN TANIDIĞI BİÇİMLER — yürürlükteki + emekli + katalog tohumu.
 *
 * ⚠️ DEVRALINAN ÇAKIŞMA KÜMESİ BUNDAN DOĞAR, yalnız BUGÜNDEN değil (K24, d3
 * ölçtü 2026-09-23): kasa kodu `KS → KSZ` yapıldıktan sonra `KS`e GERİ
 * DÖNÜLEMİYORDU, çünkü kıyas yalnız yürürlükteki biçime bakıyordu ve seri `KSZ`
 * iken `KS` "yeni çakışma" sayılıyordu. Ölçüt: o biçimle üretilmiş kodlar
 * dünyada ZATEN VAR (emekli satır) ya da varsayılan olarak VAR OLABİLİR (tohum)
 * — oraya dönmek yeni bir belirsizlik doğurmaz.
 */
function seriesKnownFormats(key: string): NumberSeriesFormat[] {
  const entry = numberSeriesCatalogEntry(key);
  const yururlukteki = resolveSeriesFormat(key);
  return [
    yururlukteki,
    ...(yururlukteki.retiredFormats ?? []).map((r) => ({
      ...yururlukteki,
      prefix: r.prefix, dateSegment: r.dateSegment, digits: r.digits,
      separator: r.separator, separator2: r.separator2,
    })),
    {
      ...yururlukteki,
      prefix: entry.seedPrefix, dateSegment: entry.seedDateSegment,
      digits: entry.seedDigits, separator: entry.seedSeparator, separator2: null,
    },
  ];
}

/**
 * ④ AYNI KOLONU PAYLAŞAN SERİLER — ön ek NE EŞİT NE DE BİRİNİN BAŞLANGICI olabilir.
 *
 * ⚠️ SONUÇ KAPISINDAN AYRI UZAY: yukarısı TARAMA uzayını korur ("okutulan kod
 * hangi kayda ait"), burası SAYAÇ uzayını. Fatura · ödeme · çek/senet serileri
 * aynı `docNo` kolonunu ÖN EKLE bölüyor (`kapsam: "seri-onekli"`) ve üreteç
 * sırayı `startsWith: <ön ek + tarih>` taramasıyla buluyor. İki seri aynı ön eke
 * düşerse kapsam damgaları AYRIŞIR: farklı damgalar farklı satır kümesi görür,
 * ikisi aynı kodu üretebilir ve `@unique` P2002 verir. Atlama döngüsü bunu
 * kapatır ama numarada boşluk bırakır ve sınırda 409'a döner.
 *
 * ⚠️ EMEKLİ ÖN EKLER DE KARŞILAŞTIRILIR: bir faturanın YENİ ön eki, kardeş
 * serinin DÜNKÜ ön ekiyse kardeşin eski belgeleri yeni serinin sayacına ve etki
 * sayımına karışır. Aynı sınıf, yalnız zamanı farklı.
 */
export function assertSharedTablePrefixUnique(key: string, fmt: NumberSeriesFormat): void {
  const entry = numberSeriesCatalogEntry(key);
  const tablo = entry.countTable;
  if (!tablo) return;
  const benimkiler = [fmt.prefix, ...fmt.retiredPrefixes];
  for (const other of NUMBER_SERIES_CATALOG) {
    if (other.key === key) continue;
    if (other.countTable?.model !== tablo.model || other.countTable.field !== tablo.field) continue;
    // BEYANLI İKİZ: rejimler birbirini dışlıyorsa aynı kolonda aynı ön ek
    // zararsızdır. Beyan İKİ YÖNLÜ aranır — tek yönlüsü kapıyı çağrı yönüne
    // göre bir açıp bir kapardı.
    if (entry.exclusiveWith?.key === other.key && other.exclusiveWith?.key === key) continue;
    const of = resolveSeriesFormat(other.key);
    for (const a of benimkiler) {
      for (const b of [of.prefix, ...of.retiredPrefixes]) {
        if (!a.startsWith(b) && !b.startsWith(a)) continue;
        throw AppError.conflict(
          `"${a}" ön eki "${other.label}" serisinin "${b}" ön ekiyle AYNI kolonu paylaşıyor; ` +
            "iki seri aynı numarayı üretebilir. Ön eki, o serinin ön ekiyle başlamayacak " +
            "biçimde değiştirin.",
          { code: "NUMBER_SERIES_SHARED_TABLE_PREFIX", key, conflictsWith: other.key },
        );
      }
    }
  }
}
