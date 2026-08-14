// =============================================================================
// KASA/BANKA DÖNEM KAPANIŞI GUARD'I — kapalı döneme kasa hareketi KİLİTTİR (K-1)
// =============================================================================
// `period-guard.helper`ın (cari, C3) HESAP-bazlı ikizi. Tek iş yapar: "bu
// kasa/banka hesabı için bu TARİHE hareket yazılabilir mi".
//
// ── NEDEN VAR (2026-08-14 sağlamlık tasarımı, Sınıf 1'in sessiz üyesi) ──────
// `CashTransaction.txnDate` kullanıcı girdisidir ve kasa/banka bakiyesine yazan
// ÜÇ yazarın (Payment · CashTransaction · ChequeEvent COLLECT/PAY) hiçbirinde
// dönem kilidi yoktu: geçmişe tarihli bir hareket, yazdırılıp Excel'e alınmış
// kasa defteri sayfasını SESSİZCE değiştirebiliyordu. Cari dönem kapanışı
// kasayı KAPSAMAZ (boyutları farklı: cari × para birimi ↔ hesap).
//
// ── BOYUT: HESAP — para birimi YOK ──────────────────────────────────────────
// Kasa/banka hesabı TEK para birimlidir (CashBox/BankAccount şema kararı),
// kasa sayımı da hesap hesap yapılır → kapanışın doğal ekseni hesabın
// kendisidir. Cari guard'ındaki `currency` parametresinin burada karşılığı
// bilinçli olarak YOKTUR.
//
// ── ÇAĞIRMASI GEREKEN ÜÇ YAZAR (dikiş ANA OTURUMDA — dosya sahipliği) ───────
//   1. payment.service          → create (paymentDate) · cancel (⚠️ ORİJİNAL
//      paymentDate ile: kasa iptali cari stornosu gibi bugüne satır EKLEMEZ,
//      satırı CANCELLED'a çekip toplamdan GERİYE DÖNÜK düşürür — bugünle
//      guard'lamak kapalı dönemin fotoğrafını sessizce değiştirtirdi)
//   2. cash-transaction.service → create · transfer (İKİ hesap → ÇOĞUL helper!)
//      · cancel (⚠️ yine ORİJİNAL txnDate ile, virmanda iki bacak birden)
//   3. cheque.service           → collect · pay (eventDate; K-2 gelince
//      collectCancel de — ORİJİNAL COLLECT hesabına ters hareket yazar)
// Guard'ı ATLAYAN tek bir yazar kilidin tamamını sessizce delik yapar;
// `verify` driftı görünür kılar ama ÖNLEMEZ.
// =============================================================================

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { periodDayKey, formatDayKeyTr } from "./period-guard.helper";

/**
 * Kasa/banka dönem kapanışı advisory lock namespace'i (2 ARGÜMANLI form).
 *
 * Uzay envanteri: 8021 KK1 mükerrer giriş · 8022 parti no üreteci ·
 * 8023 sevkiyat kapsamı · 8024 oturum kaydı · 8025 yetki (son-admin) ·
 * 8026 cari dönem kapanışı · 8027 alış siparişi karşılanma ·
 * **8028 kasa/banka dönem kapanışı**.
 *
 * ⚠️ 8026'DAN AYRI uzay: aynı uzay kullanılsaydı `hashtext` çakışması bir kasa
 * kapanışını ilgisiz bir CARİ yazarıyla sessizce serileştirebilirdi (ve tersi).
 * İki kilit ayrı soruları korur; anahtar uzayları da ayrı durur.
 *
 * `: number` BİLEREK — literal tipe daralırsa bekçideki "namespace'ler farklı"
 * karşılaştırması TS2367 ile derlenmez (PERIOD_CLOSE_LOCK_NS emsali).
 */
export const CASH_PERIOD_CLOSE_LOCK_NS: number = 8028;

/** Kasa VEYA banka — Payment/CashTransaction/CashPeriodClose XOR sözleşmesi. */
export interface CashAccountRef {
  cashBoxId?: string | null;
  bankAccountId?: string | null;
}

/** Çözülmüş hesap kapsamı — hangi kolon, hangi id. */
export interface CashAccountScope {
  field: "cashBoxId" | "bankAccountId";
  accountId: string;
}

/**
 * XOR doğrulaması + kapsam çözümü. İkisi birden ya da hiçbiri → 400.
 *
 * DB'deki `cash_period_close_account_xor` CHECK'i son seddir; burada anlamlı
 * Türkçe mesaj üretilir (sed kullanıcıya "constraint ihlali" derdi).
 */
export function resolveCashAccountScope(ref: CashAccountRef): CashAccountScope {
  const hasCash = Boolean(ref.cashBoxId);
  const hasBank = Boolean(ref.bankAccountId);
  if (hasCash === hasBank) {
    throw AppError.badRequest("Kasa VEYA banka hesabı seçilmeli (ikisi birden değil).");
  }
  return hasCash
    ? { field: "cashBoxId", accountId: ref.cashBoxId as string }
    : { field: "bankAccountId", accountId: ref.bankAccountId as string };
}

/**
 * Kapanış tablosu için hesap süzgeci. XOR gereği tek kolona filtre yeter
 * (kasa satırında banka kolonu NULL'dur) — iki kolonu birden yazmak, dinamik
 * anahtar üzerinden tip güvenliğini de kaybettirirdi.
 */
export function cashScopeWhere(ref: CashAccountRef): Prisma.CashPeriodCloseWhereInput {
  const s = resolveCashAccountScope(ref);
  return s.field === "cashBoxId" ? { cashBoxId: s.accountId } : { bankAccountId: s.accountId };
}

/**
 * Bir hesabı tx ömrü boyunca kilitle.
 *
 * ⚠️ NEDEN SATIR KİLİDİ YETMEZ: korunan şey henüz OLMAYAN satırlardır
 * (phantom) — cari guard'ındaki gerekçenin birebir aynısı. Kapanış "şu ana
 * kadarki hareketler" diye SAYAR; yazar da "kapanış var mı" diye SORAR. İkisi
 * kilitsiz koşarsa READ COMMITTED altında kapalı dönemde, fotoğrafta OLMAYAN
 * bir hareket doğar. Hata yok, log yok; yalnız `txnCount` bir gün tutmaz.
 *
 * ⚠️ SIRA LOAD-BEARING: kilit, koruduğu OKUMADAN önce alınır. Sonrasına
 * konursa hiçbir şey kazanılmaz (KK1 tuzağında birebir yaşandı).
 *
 * Anahtar HESAP id'sidir: kasa ve banka id'leri ayrı tablolardan gelen
 * UUID'lerdir, çakışmaları pratikte imkânsız — kolon adı anahtara katılmaz.
 */
export async function lockCashPeriodScopeTx(tx: Prisma.TransactionClient, ref: CashAccountRef): Promise<void> {
  const { accountId } = resolveCashAccountScope(ref);
  // void dönüşü gizlenir — pg adapter void kolonu deserialize edemiyor.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CASH_PERIOD_CLOSE_LOCK_NS}::int, hashtext(${accountId}))`;
}

export interface CashPeriodWriteRef extends CashAccountRef {
  /** Hareketin tarihi — hangi döneme düştüğünü BU belirler (paymentDate /
   *  txnDate / eventDate; iptalde ORİJİNAL satırın tarihi). */
  txnDate: Date;
}

/**
 * TEK YÜKLEM — kapalı döneme kasa/banka hareketi yazmayı 409 ile durdurur.
 *
 * Çağıran, hareketi yazacağı TX'İN İÇİNDE ve yazmadan ÖNCE çağırır. Tx dışında
 * çağırmak koruma sağlamaz (kilit tx ömürlüdür) ve kontrol ile yazım arasında
 * kapanış commit edebilir.
 *
 * Gün çevirisi cari guard'la BİREBİR aynı kaynaktan (`periodDayKey` → fabrika
 * takvim günü): yerel 00:00–03:00 arasındaki hareket UTC ile kesilseydi bir
 * önceki güne düşer, kapanış gününün gecesindeki tahsilat kapalı döneme sızardı.
 */
export async function assertCashPeriodOpenTx(tx: Prisma.TransactionClient, ref: CashPeriodWriteRef): Promise<void> {
  const scopeWhere = cashScopeWhere(ref);
  await lockCashPeriodScopeTx(tx, ref);

  const dayKey = periodDayKey(ref.txnDate);
  // "Bu günü kapsayan aktif kapanış var mı": kapanış `periodEnd`'e KADAR
  // (dahil) kapatır → gün <= periodEnd ise kapalıdır. `orderBy asc` = kaydın
  // gerçekten düştüğü (en dar kapsayan) dönem — mesaj onu söyler.
  const closed = await tx.cashPeriodClose.findFirst({
    where: { ...scopeWhere, reopenedAt: null, periodEnd: { gte: dayKey } },
    orderBy: { periodEnd: "asc" },
    select: { periodEnd: true },
  });
  // ⚠️ Bu satırın hemen üstünde bir negatif-sonda kalıntısı (`return; // SONDA`)
  // bulundu ve söküldü (2026-08-14): sondayı koşan ajan tam bu anda oturum
  // limitine takılmıştı — guard SESSİZCE körleşmiş hâlde kalmıştı ve tek
  // belirtisi tip hatasıydı (erişilemeyen kod). Sonda yazarken geri-alma
  // işaretini SONDANIN KENDİSİNE koy; "aklımda" güvenilir bir yer değil.
  if (!closed) return;

  throw AppError.conflict(
    `${formatDayKeyTr(dayKey)} tarihli hareket bu hesabın KAPALI dönemine düşüyor ` +
      `(${formatDayKeyTr(closed.periodEnd)} kapanışı). ` +
      `İşlemi bugüne tarihleyin ya da Kasa/Banka Dönem Kapanışı ekranından dönemi yeniden açın ` +
      `(en YENİ kapanıştan başlayarak).`,
  );
}

/**
 * ÇOK HESAPLI tek olay için guard — VİRMAN gibi: tek uç, İKİ hesap.
 *
 * ⚠️ NEDEN AYRI FONKSİYON — DEADLOCK (Sınıf 3 dersi): iki hesaba yazan bir tx
 * iki advisory kilit alır; iki eşzamanlı ayna virman kilitleri TERS sırada
 * alırsa PG deadlock tespit edip birini öldürür. Anahtarlar burada SIRALANDIĞI
 * için tüm çağıranlar aynı sırada kilitlenir ve deadlock yapısal olarak
 * imkânsızdır. Çok hesaplı yazar `assertCashPeriodOpenTx`'i iki kez ELLE
 * çağırmamalı — bunu kullanmalı (cari `assertPeriodsOpenTx` emsali; bekçi
 * `test_period_close` §5 sınıfındaki AST taraması "tek tx'te ≥2 elle tekil
 * çağrı" desenini zaten kırmızıya bağlıyor).
 *
 * Aynı hesap için birden çok tarih verilirse EN ERKENİ ölçülür: kapanış
 * "gün <= periodEnd" ile kapsar, en erken gün açıksa sonrakiler de açıktır.
 */
export async function assertCashPeriodsOpenTx(
  tx: Prisma.TransactionClient,
  refs: CashPeriodWriteRef[],
): Promise<void> {
  const byScope = new Map<string, CashPeriodWriteRef>();
  for (const r of refs) {
    const s = resolveCashAccountScope(r);
    const key = `${s.field}|${s.accountId}`;
    const seen = byScope.get(key);
    if (!seen || r.txnDate.getTime() < seen.txnDate.getTime()) byScope.set(key, r);
  }
  // Deterministik kilit sırası — deadlock'un tek yapısal panzehiri.
  const ordered = [...byScope.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [, ref] of ordered) {
    await assertCashPeriodOpenTx(tx, ref);
  }
}
