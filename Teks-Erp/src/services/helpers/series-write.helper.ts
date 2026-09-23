// =============================================================================
// NUMARA SERİSİ — PANELE BAKAN YAZMA YÜZEYİ (2026-09-23)
// =============================================================================
// `number-series.service.ts`ten AYRILDI (boyut tavanı). Bölme ekseni
// `series-panel.helper`in AYNASI: orada panelin OKUDUĞU, burada panelin
// YAZDIĞI. Servis numarayı ÜRETİR ve önbelleği tutar; bu dosya "bu seriye
// dokunulabilir mi" ve "önerilen DEĞER geçerli mi" sorularını cevaplar.
//
// ⚠️ TEK YÖNLÜ BAĞ: bu dosya servisi import eder, servis BUNU ETMEZ. Ters bağ
// döngü kurardı; yazma yüzeyi zaten üretimin ÜSTÜNDE bir katman.
//
// ⚠️ İKİ YAZMA UCU, İKİ AYRI KİLİT ve bu bilinçli: biçim (C0 sayacın kapsamı +
// C0b eski istemci) ile sayacın kendisi (`ownCounter`) farklı sorulardır.
// `workOrder` biçimi YAPISAL kilitli ama sayacı mevcut kodların maksimumundan
// türüyor, yani başlangıç/adım/sınır orada ANLAMLI. Tek uçta birleşselerdi
// kullanıcı sayacı değiştirmek için biçim kilidinin kalkmasını beklerdi.
// =============================================================================
import type { NumberSeries } from "@prisma/client";

import {
  FAZ_B_ONCESI,
  FAZ_D_ONCESI,
  scanningClientsMissingPhases,
} from "../../config/client-version-policy";
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { NUMBER_SERIES_CODE_CAPACITY } from "../../constants/number-series-capacity";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../number-series.service";
import {
  matchesSeries,
  previewSeriesCode,
  seriesPrefix,
  type NumberSeriesFormat,
} from "./series-format.helper";
import { retiredPrefixesAfterChange, seriesPrefixUsage } from "./series-retired.helper";

// ── KAPI ────────────────────────────────────────────────────────────────────

/** Okutulan kodların ön eki: ASCII, büyük harf, 1-6 — Code128 + istemci `toUpperCase()`. */
const SCANNED_PREFIX_RE = /^[A-Z0-9]{1,6}$/;
/** Okutulmayan seriler tire/alt çizgi taşıyabilir (STK-, PRT-), Türkçe harf yine yasak. */
const PLAIN_PREFIX_RE = /^[A-Z0-9_-]{1,6}$/;

/**
 * Biçim kapısı — fail-closed. Üç ayaklı:
 *   ① karakter kümesi (Türkçe harf barkodu bozar, `code-format.ts:167` gerekçesi),
 *   ② hane aralığı (DB CHECK'in uygulama tarafı ikizi),
 *   ③ ÖN EK ÇAKIŞMASI — yalnız TARAMA UZAYINDA küresel.
 *
 * ⚠️ ③'ün dar olması bilinçli ve ÖLÇÜLDÜ: bugün `KS` (kartela sevk + kasa kodu),
 * `IADE` (iade belgesi + iade sebebi) ve `P` (üretim partisi + sevk partisi adı)
 * zaten çakışıyor ve zararsız — ayrı tablolarda yaşıyorlar ve OKUTULMUYORLAR.
 * Kapı küresel olsaydı doğduğu gün üç yanlış kırmızı verirdi.
 */
export function assertSeriesFormatAllowed(key: string, fmt: NumberSeriesFormat): void {
  const entry = numberSeriesCatalogEntry(key);
  if (entry.lockedReason) {
    throw AppError.badRequest(`Bu serinin biçimi değiştirilemez: ${entry.lockedReason}`, {
      code: "NUMBER_SERIES_LOCKED",
      key,
    });
  }
  const re = entry.kind ? SCANNED_PREFIX_RE : PLAIN_PREFIX_RE;
  if (!re.test(fmt.prefix)) {
    throw AppError.badRequest(
      entry.kind
        ? "Okutulan kodların ön eki yalnız İngiliz alfabesi harfleri ve rakam olabilir (en çok 6 karakter)."
        : "Ön ek yalnız İngiliz alfabesi harfleri, rakam, tire ve alt çizgi olabilir (en çok 6 karakter).",
      { code: "NUMBER_SERIES_PREFIX_INVALID", key },
    );
  }
  if (!Number.isInteger(fmt.digits) || fmt.digits < 1 || fmt.digits > 8) {
    throw AppError.badRequest("Hane sayısı 1 ile 8 arasında olmalı.", {
      code: "NUMBER_SERIES_DIGITS_INVALID",
      key,
    });
  }
  // ⚠️ KOD KOLONA SIĞIYOR MU? Kapı bugüne kadar YALNIZ haneye bakıyordu ve
  // hedef kolonun genişliğini hiç sormuyordu (ölçüldü 2026-09-23: `packingLotCode`
  // + 8 hane = 17 karakter, `PackingGroup.code` = VarChar(16) ⇒ o ayardan sonra
  // HİÇBİR sevk partisi açılamazdı ve hata yazma anında, sahada patlardı).
  // Kapasite anahtarı OLMAYAN seride kontrol YAPILMAZ: "bilmiyorum" hâlinde
  // reddetmek gerçekten sınırsız olan kolonu boşuna daraltırdı.
  const kapasite = NUMBER_SERIES_CODE_CAPACITY[key];
  if (kapasite !== undefined) {
    // En kısa kod bile sığmalı: sabit baş + DOLGULU sıra (taşma daha da uzatır).
    const sabitBas = seriesPrefix({ ...fmt, prefix: fmt.prefix }, new Date()).length;
    const enKisa = sabitBas + (entry.infix ? 1 : 0) + fmt.digits;
    if (enKisa > kapasite) {
      throw AppError.badRequest(
        `Bu biçimle üretilecek kod ${enKisa} karakter, ama "${entry.label}" kodunun kolonu ` +
          `${kapasite} karakter alıyor. Ön eki kısaltın ya da hane sayısını düşürün.`,
        { code: "NUMBER_SERIES_CODE_TOO_LONG", key, uzunluk: enKisa, kapasite },
      );
    }
  }
  for (const ayrac of [fmt.separator, fmt.separator2 ?? ""]) {
    if (!["", "-", "_", "/", "."].includes(ayrac)) {
      throw AppError.badRequest("Ayraç boş ya da - _ / . olabilir.", {
        code: "NUMBER_SERIES_SEPARATOR_INVALID",
        key,
      });
    }
  }
  // ③ Tarama uzayında ön ek çakışması — biri diğerinin BAŞLANGICI olamaz, çünkü
  // istemci sınıflandırması ön-ek çapalıdır (`CV` varken `CV2` ilk kurala takılır).
  const mine = entry.kind ? [fmt.prefix, ...fmt.retiredPrefixes] : [];
  for (const other of NUMBER_SERIES_CATALOG) {
    if (other.key === key || !other.kind) continue;
    const theirs = (() => {
      const f = resolveSeriesFormat(other.key);
      return [f.prefix, ...f.retiredPrefixes];
    })();
    for (const a of mine) {
      for (const b of theirs) {
        if (a.startsWith(b) || b.startsWith(a)) {
          throw AppError.conflict(
            `"${a}" ön eki "${other.label}" serisinin "${b}" ön ekiyle çakışıyor: biri ötekinin ` +
              "başlangıcı olduğu için okutulan kodun hangi kayda ait olduğu anlaşılamaz. " +
              "Ön eki, o serinin ön ekiyle başlamayacak biçimde değiştirin.",
            { code: "NUMBER_SERIES_PREFIX_COLLISION", key, conflictsWith: other.key },
          );
        }
      }
    }
  }

  // ③a SONUÇ KAPISI — ÖN EK EŞİTLİĞİNE DEĞİL, ÜRETİLECEK KODUN NEYE ÇÖZÜLDÜĞÜNE
  // bakar (1e kararı 2026-09-23). Ön ek karşılaştırması bu soruyu SORAMIYORDU:
  // okutulmayan bir seri (`PRT`, sevk partisi) ön ekini `T` yapabiliyor ve
  // ürettiği kod tabletlerde TOP barkodu sanılıyordu — ölçüldü: okutulmayan 43
  // seri × okutulan ön ekler = 215 deneme, ÇAKIŞMA REDDİ 0. Kapı tarama
  // uzayında küreseldi ve orada doğruydu; eksik olan, okutulmayan serilerin
  // ürettiği kodun tarama uzayına DÜŞEBİLMESİYDİ.
  //
  // ⚠️ İKİ KOD DENENİR: ilk sıra ve HANE TAŞMIŞ bir sıra. Taşma kodu uzatır
  // (`\d{digits,}`) ve uzun kod, daha AZ haneli başka bir seriye de uyabilir —
  // yalnız ilk sırayı denemek bu ekseni kör bırakırdı.
  assertScanOutcomeAllowed(key, fmt);
}

// ── YAZMA ───────────────────────────────────────────────────────────────────

/**
 * "BU SERİYE BUGÜN DOKUNULABİLİR Mİ" — DEĞERDEN BAĞIMSIZ üç kapı.
 *
 * `assertSeriesFormatAllowed`tan AYRI bir sorudur: orası "önerilen DEĞER
 * geçerli mi" (karakter kümesi, hane, kapasite, çakışma), burası "bu seri
 * düzenlenebilir mi" (yapısal kilit, sayaç hazırlığı, eski istemci). İkisi
 * farklı gün kalkar ve farklı kişiye iş çıkarır.
 *
 * ⚠️ AYRI FONKSİYON OLMASININ SEBEBİ İKİNCİ ÇAĞIRANDIR (D6): yapılandırma
 * paketi içe aktarımı, YAZMADAN ÖNCE aynı kapıların cevabını önizlemede
 * göstermek zorunda. Kopyalanmış bir kontrol listesi "türetilmiş alan /
 * ayrışan yüzey" sınıfına girerdi: önizleme "uygulanacak" der, yazma 400
 * döner — ya da tersi, ki o daha kötü.
 */
export function assertSeriesFormatWritable(key: string): void {
  // ⚠️ KONFİGÜRASYON SINIRI (C0): sayacı biçim değişimine HAZIR OLMAYAN seri
  // düzenlenemez. Üretim yolu kapatılmaz — çuval açılamaz hâle gelirdi; asıl
  // engellenmesi gereken riskli AYAR değişikliğidir. Beyan katalogdadır.
  const katalog = numberSeriesCatalogEntry(key);
  // ① YAPISAL kilit EN ÖNCE — hiç kalkmayabilir. `assertSeriesFormatAllowed`
  // aynı kontrolü taşır (önizleme yolu da ondan geçer), ama orası EN SONDA
  // koşar: "önerilen DEĞER geçerli mi" sorusu, "bu seriye dokunulabilir mi"
  // sorusundan sonra gelir.
  if (katalog.lockedReason) {
    throw AppError.badRequest(`Bu serinin biçimi değiştirilemez: ${katalog.lockedReason}`, {
      code: "NUMBER_SERIES_LOCKED",
      key,
    });
  }
  // ⚠️ KAPI SIRASI LOAD-BEARING — hata mesajının KİME iş çıkardığına göre:
  // önce kullanıcının ÇÖZEMEYECEĞİ engeller söylenir. `scopedCounter` bizim iç
  // hazırlığımızdır (çağrı yeri zengin biçime geçmemiş); C0b ise fabrikanın
  // eyleme geçebileceği bir durumdur (istemcileri güncelle). Ters sırada, ikisi
  // birden engelliyorken fabrika bir gün harcayıp bütün tabletleri günceller ve
  // İKİNCİ duvara toslardı.
  if (!katalog.scopedCounter) {
    throw AppError.badRequest(
      `Bu serinin sayacı biçim değişimine hazır değil: ${katalog.label}. ` +
        "Numara üreten yol kapsam damgasına geçirilmeden biçim değiştirilemez.",
      { code: "NUMBER_SERIES_COUNTER_NOT_SCOPED", key },
    );
  }
  // ⚠️ C0b — ESKİ İSTEMCİ KAPISI, `lockedReason`dan AYRI bir cümledir:
  // `lockedReason` "bu serinin biçimi YAPISAL olarak değişemez" der (top
  // barkodunun faz harfi), bu kapı "BUGÜN değişemez çünkü saha hazır değil"
  // der. İkisi farklı gün kalkar, bu yüzden biri ötekinin yerine geçmez.
  // Okutulan bir serinin ön eki değişirse, Faz B'yi taşımayan istemci kendi
  // SABİT regex'iyle okumaya devam eder ve kodu SESSİZCE yanlış türe çözer.
  // ⚠️ İKİ EŞİK, TEK KAPI (D4②): Faz B "biçimi tablodan oku" der, Faz D
  // "tablodaki EMEKLİ BİÇİMLERİ de dene" der ve biri ötekini KAPSAMAZ. Faz B'li
  // ama Faz D'siz bir tablet, hane değiştiği gün dünkü etiketi okuyamaz
  // (ölçüldü 2026-09-23, `test_number_series §13a`). "minVersion yükseldi" tek
  // başına bu kilidi AÇMAZ.
  const missingPhases = katalog.kind ? scanningClientsMissingPhases() : [];
  if (missingPhases.length > 0) {
    const esik = missingPhases.includes("B") ? FAZ_B_ONCESI : FAZ_D_ONCESI;
    throw AppError.badRequest(
      `Okutulan serilerin biçimi, sahadaki panel ve tabletler güncellenmeden değiştirilemez: ${katalog.label}. ` +
        `En düşük sürüm eşiği panelde ${esik.electron}, tablette ${esik.mobil} üstüne çıkmalı.`,
      { code: "NUMBER_SERIES_CLIENT_TOO_OLD", key, missingPhases },
    );
  }
}

/** Panelin yazdığı tek uç. Eski ön ek EMEKLİYE ayrılır (geçmiş kod okunmaya devam eder). */
export async function updateSeriesFormat(
  key: string,
  next: Omit<NumberSeriesFormat, "retiredPrefixes" | "infix" | "formatChangedAt">,
  userId?: string,
  /**
   * İLERİ TARİHLİ GEÇİŞ (D4③): "1 Ocak'tan itibaren şu biçim".
   *
   * ⚠️ GEÇMİŞ TARİH YAZILAMAZ (400): biçim geçmişi bir DEFTERDİR — o tarihte
   * üretilmiş numaraların hangi rejimde doğduğu bilgisi düzeltilmez.
   * ⚠️ İleri tarihli yazma YÜRÜRLÜKTEKİ biçime DOKUNMAZ: satır yazılır, kolonlar
   * (önbellek) olduğu gibi kalır ve vadesi gelince `activateDueLines` alır.
   */
  effectiveFrom?: Date,
): Promise<NumberSeries> {
  assertSeriesFormatWritable(key);
  const current = resolveSeriesFormat(key);
  // ⚠️ SAYIM TX DIŞINDA ve bilerek: emekli liste bir YAPILANDIRMA kararıdır,
  // defter değil; sayım anı ile yazma anı arasında doğan bir kayıt yalnız "ön ek
  // emekliye ayrılsın mı" sorusunu etkiler ve o soru yanlış cevaplanırsa fazladan
  // bir emekli ön ek kalır (zararsız yön). Tx'i bir COUNT için uzatmak, tx kısa
  // tutma kuralını çiğnerdi.
  const kullanim = current.prefix === next.prefix ? null : await seriesPrefixUsage(key, current.prefix);
  const retired = retiredPrefixesAfterChange({
    mevcutEmekliler: current.retiredPrefixes,
    mevcutOnEk: current.prefix,
    yeniOnEk: next.prefix,
    mevcutOnEkKullanimi: kullanim,
  });
  assertSeriesFormatAllowed(key, { ...next, retiredPrefixes: retired });

  // ⚠️ TEK YAZAR, TEK TX: biçim artık İKİ yerde duruyor — zaman çizgisi
  // (`number_series_lines`, gerçek kaynak) ve `number_series` kolonları
  // (yürürlükteki satırın ÖNBELLEĞİ). İkisini ayrı yazmak, aralarında bir hata
  // olduğunda "satır yeni biçimde ama önbellek eskide" diye AYRIŞAN BİR YÜZEY
  // bırakırdı; tx ikisini birlikte ya yazar ya yazmaz.
  const simdi = new Date();
  const at = effectiveFrom ?? simdi;
  // ⚠️ 60 sn'lik pay SAAT SAPMASINA değil, çağrının kendi gecikmesine verildi
  // ("şimdi" hesaplandıktan sonra ağ/doğrulama süresi). Daha geniş bir pay,
  // "dün"ü bugün diye kabul etmenin kapısı olurdu.
  if (at.getTime() < simdi.getTime() - 60_000) {
    throw AppError.badRequest(
      "Biçim geçişi GEÇMİŞ bir tarihe yazılamaz: o tarihte üretilmiş numaraların hangi biçimde doğduğu değişmez.",
      { code: "NUMBER_SERIES_EFFECTIVE_FROM_PAST", key },
    );
  }
  const isFuture = at.getTime() > simdi.getTime() + 60_000;
  const row = await prisma.$transaction(async (tx) => {
    // ⚠️ AYNI TARİHE YENİDEN KAYIT = BEKLEYEN SATIRI DEĞİŞTİRME: kullanıcı aynı
    // günü ikinci kez kaydettiğinde ham bir tekillik hatası ("Bu 'effectiveFrom'
    // değeri zaten mevcut") görüyordu (d3 ölçtü 2026-09-23). Vadesi GELMEMİŞ satır
    // hiç yürürlüğe girmedi, yani bir TASLAKTIR: silinmesi hiçbir raporlanan sayıyı
    // değiştirmez (defter.md ④). Silme ATOMİK CLAIM'lidir — `effectiveFrom > now`
    // koşulu WHERE'in içinde, yani yürürlüğe girmiş bir satır bu yoldan SİLİNEMEZ.
    if (isFuture) {
      await tx.numberSeriesLine.deleteMany({
        where: { seriesKey: key, effectiveFrom: { equals: at, gt: simdi } },
      });
    }
    await tx.numberSeriesLine.create({
      data: { seriesKey: key, ...next, effectiveFrom: at, isSentinel: false, origin: "RECORDED" },
    });
    // İLERİ TARİHLİ: yalnız SATIR yazılır; yürürlükteki biçim (kolonlar) DEĞİŞMEZ
    // ve `formatChangedAt`e dokunulmaz — sayaç kapsamı bugün kaymamalı.
    if (isFuture) {
      return tx.numberSeries.update({ where: { key }, data: { updatedById: userId ?? null } });
    }
    return tx.numberSeries.update({
      where: { key },
      // `formatChangedAt` sayacın KAPSAM sınırıdır: bundan sonraki numaralar yalnız
      // bu andan sonra doğan kodlara bakar (eski rejim sayaca giremez). Yürürlükteki
      // satırın `effectiveFrom`u ile AYNI an olmak zorunda — ikisi ayrışırsa sayaç
      // kapsamı ile biçim geçişi farklı anlardan başlardı.
      data: { ...next, retiredPrefixes: retired, formatChangedAt: at, updatedById: userId ?? null },
    });
  });
  await refreshNumberSeriesCache();
  // Biçim değişikliği bir İŞ KARARIDIR (bundan sonraki her belgenin numarası değişir),
  // bu yüzden denetim defterine yazılır — tx DIŞINDA, best-effort.
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "NumberSeries",
    recordId: row.id,
    oldData: { ...current },
    newData: { ...next, retiredPrefixes: retired },
  });
  return row;
}

// ── SAYAÇ AYARLARI (D2②) ────────────────────────────────────────────────────

/** Panelin yazdığı sayaç alanları; `null` = AYARI KALDIR (bugünkü davranışa dön). */
export interface SeriesCounterInput {
  startValue: number | null;
  step: number | null;
  maxValue: number | null;
}

/**
 * Sayaç ayarı kapısı — fail-closed.
 *
 * ⚠️ BİÇİM KİLİDİNDEN AYRI BİR SORU ve bu bilinçli: `workOrder` biçimi YAPISAL
 * kilitli (kart no + sahadaki `RK` etiketleri) ama sayacı mevcut kodların
 * maksimumundan türüyor, yani başlangıç/adım/sınır orada ANLAMLIDIR. Kilitleri
 * birleştirmek, çözülebilir bir ayarı çözülemez bir gerekçeyle kapatırdı.
 */
export function assertSeriesCounterAllowed(key: string, next: SeriesCounterInput): void {
  const entry = numberSeriesCatalogEntry(key);
  // ① KENDİ MEKANİZMASI — ayar hiçbir şey yapmazdı ve bu SESSİZ olurdu.
  // ① KENDİ MEKANİZMASI — ayar hiçbir şey yapmazdı ve bu SESSİZ olurdu.
  if (entry.ownCounter) {
    throw AppError.badRequest(
      `Bu serinin sayacı kendi mekanizmasına sahip, ayarlanamaz: ${entry.ownCounter.not}`,
      { code: "NUMBER_SERIES_COUNTER_OWN", key },
    );
  }
  // ② DEĞER DOĞRULAMASI — DB CHECK'lerinin uygulama ikizi (çift yüklem).
  for (const [ad, deger, etiket] of [
    ["startValue", next.startValue, "Başlangıç değeri"],
    ["step", next.step, "Artış adımı"],
    ["maxValue", next.maxValue, "Üst sınır"],
  ] as const) {
    if (deger === null) continue;
    if (!Number.isInteger(deger) || deger < 1) {
      throw AppError.badRequest(`${etiket} 1 veya daha büyük bir tam sayı olmalı.`, {
        code: "NUMBER_SERIES_COUNTER_INVALID",
        key,
        field: ad,
      });
    }
  }
  if (next.maxValue !== null && next.startValue !== null && next.maxValue < next.startValue) {
    throw AppError.badRequest("Üst sınır, başlangıç değerinden küçük olamaz.", {
      code: "NUMBER_SERIES_COUNTER_RANGE_INVALID",
      key,
    });
  }
}

/**
 * Sayaç ayarlarını yazar. Biçim yazma ucundan AYRI tutuldu: ikisi farklı
 * kilitlere tabi (biçim C0/C0b, sayaç `ownCounter`) ve tek bir uçta birleşirlerse
 * kullanıcı sayacı değiştirmek için biçim kilidinin kalkmasını beklerdi.
 *
 * ⚠️ `formatChangedAt`e DOKUNMAZ: sayaç ayarı biçimi değiştirmez, yani kapsam
 * sınırını oynatmak için bir sebep yoktur. Damgayı ileri almak sayacı SIFIRLAMAZ
 * (ölçüldü 2026-09-23: aynı dizgi uzayında atlama döngüsü eski maksimuma yürüyor),
 * yalnız kapsamı boşaltıp sessiz bir "hiçbir şey olmadı" üretirdi.
 */
export async function updateSeriesCounter(
  key: string,
  next: SeriesCounterInput,
  userId?: string,
): Promise<NumberSeries> {
  assertSeriesCounterAllowed(key, next);
  const current = resolveSeriesFormat(key);
  const row = await prisma.numberSeries.update({ where: { key }, data: { ...next } });
  await refreshNumberSeriesCache();
  // Sayaç ayarı bir İŞ KARARIDIR (bundan sonraki her numara etkilenir) ⇒ denetim
  // defterine, tx DIŞINDA, best-effort.
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "NumberSeries",
    recordId: row.id,
    oldData: { startValue: current.startValue ?? null, step: current.step ?? null, maxValue: current.maxValue ?? null },
    newData: { ...next },
  });
  return row;
}

// ── NUMARA KAYNAĞI (D3①) ────────────────────────────────────────────────────

export type NumberSourceMode = "FREE" | "SYSTEM" | "MANUAL";

/**
 * Numara kaynağı kapısı — fail-closed.
 *
 * ⚠️ Ayar YALNIZ elle yolu olan seride anlamlı (ölçüldü 2026-09-23: 52 serinin
 * DÖRDÜ). Kalan 48'de `MANUAL` seçmek OLMAYAN bir kabul yolunu talep etmek,
 * `SYSTEM` ise zaten bugünkü davranışı yazmak olurdu — yani ayarın hiçbir
 * değeri bir şey yapmazdı. Sessizce kabul etmek, kullanıcıya ETKİSİZ bir düğme
 * vermek demekti; sınır katalogda `manualEntry` ile beyanlı.
 */
export function assertSeriesNumberSourceAllowed(key: string, next: NumberSourceMode): void {
  const entry = numberSeriesCatalogEntry(key);
  if (!entry.manualEntry) {
    throw AppError.badRequest(
      `Bu seride elle numara girişi yok, numara kaynağı ayarlanamaz: ${entry.label}.`,
      { code: "NUMBER_SERIES_NO_MANUAL_PATH", key },
    );
  }
  if (!["FREE", "SYSTEM", "MANUAL"].includes(next)) {
    throw AppError.badRequest("Numara kaynağı 'FREE', 'SYSTEM' ya da 'MANUAL' olabilir.", {
      code: "NUMBER_SERIES_SOURCE_INVALID",
      key,
    });
  }
}

/**
 * Numara kaynağını yazar. Biçim ve sayaç uçlarından AYRI: üçü farklı kilitlere
 * tabi ve üçü farklı gün açılır (biçim C0/C0b · sayaç `ownCounter` · kaynak
 * `manualEntry`).
 */
export async function updateSeriesNumberSource(
  key: string,
  next: NumberSourceMode,
  userId?: string,
): Promise<NumberSeries> {
  assertSeriesNumberSourceAllowed(key, next);
  const current = resolveSeriesFormat(key).numberSource ?? "FREE";
  const row = await prisma.numberSeries.update({ where: { key }, data: { numberSource: next } });
  await refreshNumberSeriesCache();
  // Numara kaynağı bir İŞ KARARIDIR (elle girilen numaralar reddedilmeye
  // başlayabilir) ⇒ denetim defterine, tx DIŞINDA, best-effort.
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "NumberSeries",
    recordId: row.id,
    oldData: { numberSource: current },
    newData: { numberSource: next },
  });
  return row;
}

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
function assertScanOutcomeAllowed(key: string, fmt: NumberSeriesFormat): void {
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
    [...cozulenTurler({ ...resolveSeriesFormat(key), ...(entry.infix ? { infix: entry.infix.re } : {}) })].map(
      (x) => x.split("\u0000")[0],
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
