// =============================================================================
// DÖNEM KAPANIŞI GUARD'I — kapalı döneme kayıt KİLİTTİR (C3)
// =============================================================================
// Burası cari defterine yazan HER yolun ortak kapısıdır. Tek iş yapar: "bu
// (cari, para birimi) için bu TARİHE kayıt açılabilir mi".
//
// ── NEDEN KİLİT, UYARI DEĞİL ────────────────────────────────────────────────
// Kapanmış dönem RESMİ bir rakamdır: beyanname verilmiş, mutabakat imzalanmış,
// ekstre müşteriye gönderilmiştir. Üç seçenek vardı ve ikisi yanlıştır:
//   • UYARI  — okunmaz. Vardiya ortasında çıkan sarı bant "tamam"la geçilir ve
//              geçmiş rakam sessizce değişir; sonra kimse ne zaman değiştiğini
//              bulamaz.
//   • SESSİZ YENİDEN HESAP — en kötüsü. Kapanış fotoğrafını tazelemek, kimsenin
//              istemediği bir anda resmi rakamı değiştirmek demektir.
//   • KİLİT (409) — kullanıcı DURUR ve iki gerçek yoldan birini seçer: kaydın
//              tarihini cari döneme çeker, ya da dönemi AÇIKÇA yeniden açar
//              (iz bırakarak). Sektör standardı da budur (Logo/Mikro "dönem
//              kilidi", SAP "posting period").
//
// ── STORNO'LAR DOĞAL OLARAK SIZMAZ ──────────────────────────────────────────
// Fatura/tahsilat iptali ters satırı `txnDate = now` ile yazar (silmez), yani
// CARİ döneme düşer. Bu yüzden "geçmiş dönemin faturasını iptal edemiyorum"
// diye bir çıkmaz doğmaz: iptal her zaman bugüne yazılır ve guard'a takılmaz.
// ⚠️ Bir gün biri "storno kaydı asıl faturanın tarihine yazılsın" derse, o
// değişiklik BU guard'ı da kapalı dönemde tetikler — ikisi birlikte düşünülmeli.
//
// ── ÇAĞIRAN BEŞ YOL (hepsi satır YAZMADAN ÖNCE çağırır) ─────────────────────
//   1. invoice.service   → confirm  (INVOICE satırı)
//   2. invoice.service   → cancel   (INVOICE_CANCEL satırı)
//   3. payment.service   → create   (PAYMENT satırı)
//   4. payment.service   → cancel   (PAYMENT_CANCEL satırı)
//   5. cheque.service    → olaylar  (RECEIVE/ENDORSE/BOUNCE… — C1)
// (+ cari.service → setOpeningBalance: devir de bir defter satırıdır ve geçmiş
//  tarihli girilebildiği için tam da kapalı döneme düşme adayıdır.)
// Yeni bir defter yazarı doğarsa listeye eklenir; guard'ı ATLAYAN bir yazar,
// kilidin tamamını sessizce delik yapar.
//
// ── ADVISORY KİLİT UZAYI ENVANTERİ — TEK KAYNAK ─────────────────────────────
// Repo genelindeki `pg_advisory_xact_lock(UZAY, anahtar)` uzaylarının TEK
// kaydı burasıdır; başka dosyada kopya liste TUTULMAZ (kopya sessizce bayatlar
// ve iki alt sistem aynı numaraya oturur). Satır biçimi MAKİNE OKUR — bekçi
// `scripts/test_advisory_lock_namespaces.ts` bu bloğu ayrıştırıp koddaki
// `*_LOCK_NS` sabitleriyle İKİ YÖNLÜ karşılaştırır:
//   `//   <numara>  <SABİT_ADI>  <src-göreli dosya>  <amaç>`
// ENVANTER:
//   8021  DUPLICATE_GUARD_LOCK_NS    services/helpers/duplicate-guard.helper.ts    KK1 mükerrer-top tuzağı
//   8022  BATCH_NUMBER_LOCK_NS       services/batch.service.ts                     parti numarası sayacı
//   8023  SHIPMENT_LOCK_NS           services/helpers/shipment-locks.helper.ts     sevkiyat kapsamı
//   8024  SESSION_REGISTRY_LOCK_NS   services/session-registry.service.ts          oturum kayıt defteri
//   8025  PERM_ADMIN_LOCK_NS         services/permission-management.service.ts     yetki (son-admin) guard'ı
//   8026  PERIOD_CLOSE_LOCK_NS       services/helpers/period-guard.helper.ts       cari dönem kapanışı
//   8027  PURCHASE_ORDER_LOCK_NS     services/purchase-order.service.ts            alış siparişi karşılanma
//   8028  CASH_PERIOD_CLOSE_LOCK_NS  services/helpers/cash-period-guard.helper.ts  kasa/banka dönem kapanışı
//   8029  CODE_UNIQUE_LOCK_NS        services/helpers/code-unique.helper.ts        kod tekilliği (harf-duyarsız)
//   8030  MERGE_LOCK_NS              services/master-data-merge.service.ts         master-data birleştirme
// İKİ KURAL: ① Aynı uzaydan birden çok kilit alan tx anahtarları SIRALI alır
// (aşağıdaki `assertPeriodsOpenTx` bunun tek meşru kapısıdır — tekil guard'ı
// bir tx'te İKİ KEZ elle çağırmak YASAK ve `cheque.bounce` vakasında canlı
// deadlock üretti). ② Bir tx birden çok UZAYDAN kilit alacaksa uzay numarası
// ARTAN sırada alınır — bugünkü tek çapraz-uzay çifti `inventory.service`
// (8021 mükerrer tuzağı → 8030 birleştirme) ve ARTAN.
// =============================================================================

import { Prisma, Currency } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { factoryDayKeyUtcMidnight, factoryDayStart } from "../../constants/time";

/**
 * Cari-dönem kapsamlı advisory lock namespace'i (2 ARGÜMANLI form).
 *
 * Uzay envanteri TEK KAYNAK: bu dosyanın başlığı (§ ADVISORY KİLİT UZAYI
 * ENVANTERİ). Bu uzay **8026 cari dönem kapanışı**dır.
 *
 * ⚠️ 1-argümanlı `pg_advisory_xact_lock(bigint)` AYRI bir uzaydır ve bu kod
 * tabanında HİÇ kullanılmaz; yeni alt sistemi oraya sokmak birbirini görmeyen
 * iki alt sistemi sessizce serileştirir.
 *
 * `: number` BİLEREK — literal tipe daralırsa bekçideki "namespace'ler farklı"
 * karşılaştırması TS2367 ile derlenmez (SHIPMENT_LOCK_NS emsali).
 */
export const PERIOD_CLOSE_LOCK_NS: number = 8026;

/**
 * Bir (cari, para birimi) çiftini tx ömrü boyunca kilitle.
 *
 * ⚠️ NEDEN SATIR KİLİDİ YETMEZ: korunan şey henüz OLMAYAN satırlardır
 * (phantom). Kapanış "şu ana kadarki hareketler" diye SAYAR; defter yazarı da
 * "kapanış var mı" diye SORAR. İkisi kilitsiz koşarsa READ COMMITTED altında
 * şu sıra mümkündür — yazar sorar (kapanış yok) → kapanış commit eder (yeni
 * satırı görmez) → yazar commit eder. Sonuç: kapalı dönemde, fotoğrafta
 * OLMAYAN bir hareket. Hata yok, log yok; yalnız `txnCount` bir gün yeniden
 * türetildiğinde tutmaz.
 *
 * ⚠️ SIRA LOAD-BEARING: kilit, koruduğu OKUMADAN önce alınır. Sonrasına
 * konursa hiçbir şey kazanılmaz (KK1 tuzağında birebir yaşandı).
 */
export async function lockCariPeriodScopeTx(
  tx: Prisma.TransactionClient,
  cariId: string,
  currency: Currency,
): Promise<void> {
  // void dönüşü gizlenir — pg adapter void kolonu deserialize edemiyor.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERIOD_CLOSE_LOCK_NS}::int, hashtext(${`${cariId}|${currency}`}))`;
}

/**
 * Bir ANI, ait olduğu FABRİKA takvim gününün `@db.Date` anahtarına çevirir.
 *
 * ⚠️ `'Europe/Istanbul'` literali BURAYA DA kopyalanmaz — `constants/time.ts`
 * tek kaynaktır. Gün sınırı UTC'de kesilseydi Türkiye'de yerel 00:00–03:00
 * arasındaki her kayıt bir ÖNCEKİ güne düşerdi; kapanış gününün gecesinde
 * girilen bir tahsilat da kapalı dönemin içine sızardı.
 */
export function periodDayKey(at: Date): Date {
  return factoryDayKeyUtcMidnight(at);
}

/**
 * Kapanışın kapsadığı son ANIN DIŞ sınırı: `periodEnd` gününün ERTESİ gününün
 * fabrika 00:00'ı. Yani kapanış "txnDate < cut" olan her şeyi kapsar.
 *
 * Örn. periodEnd = 2025-12-31 → cut = 2025-12-31T21:00:00Z (Istanbul'da
 * 01.01.2026 00:00). `lte periodEnd` ile sorgulamak YANLIŞ olurdu: periodEnd
 * bir GÜN anahtarıdır (UTC gece yarısı) ve o günün 03:00'ından sonraki her
 * hareketi dışarıda bırakırdı.
 *
 * Ara probe olarak ertesi günün UTC ÖĞLEN'i seçilir: `factoryDayStart` o anın
 * hangi takvim gününe düştüğüne bakar ve öğlen, hiçbir saat dilimi kaymasında
 * gün değiştirmez. `Date.UTC` ay/yıl taşmasını kendisi çözer (31 Ara + 1 gün).
 */
export function periodEndCutExclusive(periodEnd: Date): Date {
  const probe = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate() + 1, 12, 0, 0),
  );
  return factoryDayStart(probe);
}

/** `@db.Date` anahtarını gg.aa.yyyy basar — UTC parçalarından. */
export function formatDayKeyTr(dayKey: Date): string {
  const d = String(dayKey.getUTCDate()).padStart(2, "0");
  const m = String(dayKey.getUTCMonth() + 1).padStart(2, "0");
  return `${d}.${m}.${dayKey.getUTCFullYear()}`;
}

export interface PeriodWriteRef {
  cariId: string;
  currency: Currency;
  /** Defter satırının `txnDate`'i — hangi döneme düştüğünü BU belirler. */
  txnDate: Date;
}

/**
 * TEK YÜKLEM — kapalı döneme yazmayı 409 ile durdurur.
 *
 * Çağıran, satırı yazacağı TX'İN İÇİNDE ve satırı yazmadan ÖNCE çağırır.
 * Tx dışında çağırmak koruma sağlamaz (kilit tx ömürlüdür) ve kontrol ile
 * yazım arasında kapanış commit edebilir.
 *
 * ⚠️ Maliyet: defter yazan her yola bir advisory lock + bir indeksli sorgu
 * ekler. Kilit (cari, para birimi) kapsamlıdır; aynı cariye yazan iki eşzamanlı
 * belge zaten `cari_balances` satır kilidinde serileşiyordu — yeni serileşme
 * penceresi yalnız birkaç ifade uzar. İlgisiz cariler hiç etkilenmez.
 */
export async function assertPeriodOpenTx(tx: Prisma.TransactionClient, ref: PeriodWriteRef): Promise<void> {
  await lockCariPeriodScopeTx(tx, ref.cariId, ref.currency);

  const dayKey = periodDayKey(ref.txnDate);
  // "Bu günü kapsayan aktif kapanış var mı": kapanış `periodEnd`'e KADAR (dahil)
  // kapatır → gün <= periodEnd ise kapalıdır.
  // `orderBy asc` = kaydın GERÇEKTEN düştüğü dönem (en yakın kapanış); mesajın
  // anlaşılır olması için en dar kapsayan dönem söylenir.
  const closed = await tx.cariPeriodClose.findFirst({
    where: {
      cariId: ref.cariId,
      currency: ref.currency,
      reopenedAt: null,
      periodEnd: { gte: dayKey },
    },
    orderBy: { periodEnd: "asc" },
    select: { periodEnd: true },
  });
  if (!closed) return;

  throw AppError.conflict(
    `${formatDayKeyTr(dayKey)} tarihli kayıt KAPALI döneme düşüyor ` +
      `(${ref.currency} — ${formatDayKeyTr(closed.periodEnd)} kapanışı). ` +
      `Kaydın tarihini açık döneme çekin ya da Dönem Kapanışı ekranından dönemi yeniden açın ` +
      `(en YENİ kapanıştan başlayarak).`,
  );
}

/**
 * ÇOK CARİLİ tek olay için guard (çek CİROSU gibi: tek olay, iki cari).
 *
 * ⚠️ NEDEN AYRI FONKSİYON — DEADLOCK: iki cariye yazan bir tx iki advisory
 * kilit alır. İki eşzamanlı ciro işlemi kilitleri TERS sırada alırsa PG
 * deadlock tespit edip birini öldürür (kullanıcıya anlamsız 500). Burada
 * anahtarlar SIRALANDIĞI için tüm çağıranlar aynı sırada kilitlenir ve deadlock
 * yapısal olarak imkânsızdır. Çok carili yazar `assertPeriodOpenTx`'i iki kez
 * ELLE çağırmamalı — bunu kullanmalı.
 *
 * Aynı (cari, para birimi) için birden çok tarih verilirse EN ERKENİ ölçülür:
 * kapanış "gün <= periodEnd" ile kapsar, yani en erken gün açıksa sonrakiler
 * de tanım gereği açıktır.
 */
export async function assertPeriodsOpenTx(
  tx: Prisma.TransactionClient,
  refs: PeriodWriteRef[],
): Promise<void> {
  const byScope = new Map<string, PeriodWriteRef>();
  for (const r of refs) {
    const key = `${r.cariId}|${r.currency}`;
    const seen = byScope.get(key);
    if (!seen || r.txnDate.getTime() < seen.txnDate.getTime()) byScope.set(key, r);
  }
  // Deterministik kilit sırası — deadlock'un tek yapısal panzehiri.
  const ordered = [...byScope.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [, ref] of ordered) {
    await assertPeriodOpenTx(tx, ref);
  }
}
