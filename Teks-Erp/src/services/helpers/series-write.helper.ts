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

import { FAZ_B_ONCESI, scanningClientsCarryFazB } from "../../config/client-version-policy";
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { NUMBER_SERIES_CODE_CAPACITY } from "../../constants/number-series-capacity";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../number-series.service";
import { seriesPrefix, type NumberSeriesFormat } from "./series-format.helper";

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
  if (!["", "-", "_", "/", "."].includes(fmt.separator)) {
    throw AppError.badRequest("Ayraç boş ya da - _ / . olabilir.", {
      code: "NUMBER_SERIES_SEPARATOR_INVALID",
      key,
    });
  }
  if (!entry.kind) return;

  // ③ Tarama uzayında ön ek çakışması — biri diğerinin BAŞLANGICI olamaz, çünkü
  // istemci sınıflandırması ön-ek çapalıdır (`CV` varken `CV2` ilk kurala takılır).
  const mine = [fmt.prefix, ...fmt.retiredPrefixes];
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
            `"${a}" ön eki "${other.label}" serisinin "${b}" ön ekiyle çakışıyor; okutulan kod hangi kayda ait olduğu anlaşılamaz.`,
            { code: "NUMBER_SERIES_PREFIX_COLLISION", key, conflictsWith: other.key },
          );
        }
      }
    }
  }
}

// ── YAZMA ───────────────────────────────────────────────────────────────────

/** Panelin yazdığı tek uç. Eski ön ek EMEKLİYE ayrılır (geçmiş kod okunmaya devam eder). */
export async function updateSeriesFormat(
  key: string,
  next: Omit<NumberSeriesFormat, "retiredPrefixes" | "infix" | "formatChangedAt">,
  userId?: string,
): Promise<NumberSeries> {
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
  if (katalog.kind && !scanningClientsCarryFazB()) {
    throw AppError.badRequest(
      `Okutulan serilerin biçimi, sahadaki panel ve tabletler güncellenmeden değiştirilemez: ${katalog.label}. ` +
        `En düşük sürüm eşiği panelde ${FAZ_B_ONCESI.electron}, tablette ${FAZ_B_ONCESI.mobil} üstüne çıkmalı.`,
      { code: "NUMBER_SERIES_CLIENT_TOO_OLD", key },
    );
  }
  const current = resolveSeriesFormat(key);
  const retired =
    current.prefix === next.prefix
      ? current.retiredPrefixes
      : [...new Set([...current.retiredPrefixes, current.prefix])];
  assertSeriesFormatAllowed(key, { ...next, retiredPrefixes: retired });

  const row = await prisma.numberSeries.update({
    where: { key },
    // `formatChangedAt` sayacın KAPSAM sınırıdır: bundan sonraki numaralar yalnız
    // bu andan sonra doğan kodlara bakar (eski rejim sayaca giremez).
    data: { ...next, retiredPrefixes: retired, formatChangedAt: new Date(), updatedById: userId ?? null },
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
