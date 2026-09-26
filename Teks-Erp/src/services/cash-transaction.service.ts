// =============================================================================
// KASA HAREKETİ SERVİSİ — carisiz para hareketleri
// =============================================================================
// Kapsam: masraf/gelir fişi · kasalar arası virman · açılış (devir) bakiyesi.
//
// ⚠️ NEDEN `Payment` DEĞİL: `Payment`'ın sözleşmesi "cari deftere satır +
// cari bakiye + kasa bakiyesi AYNI tx'te oynar"dır ve bu sözleşme storno,
// kapama ve ekstre yollarının hepsinde varsayılır. Kira ödemesinin carisi
// YOKTUR; `cariId`yi nullable yapmak en hassas yolun her okumasına sessiz bir
// dal eklerdi. Ayrım ekranı da doğru böler: Tahsilat/Ödeme = CARİ hareketi,
// Kasa Hareketleri = kasanın kendi defteri.
//
// ⚠️ KASA BAKİYESİNİN İKİNCİ YAZARI BURASIDIR. `test_consistency` §23/§24
// sorguları Payment + CashTransaction'ı BİRLİKTE toplar — yalnız birine bakan
// bir mutabakat, diğer yazarın hareketlerini "drift" sanardı.
// =============================================================================
import { Prisma, CashTxnKind, PaymentDirection, PaymentStatus, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { D, resolveExchangeRateTx } from "./helpers/finance.helper";
import { assertCashPeriodOpenTx, assertCashPeriodsOpenTx } from "./helpers/cash-period-guard.helper";
import { applyCashTxTx, cancelCashTxTx, KIND_DIRECTION, nextCashNoTx, type AccountRef } from "./helpers/cash-ledger.helper";
import { buildTurkishSearch } from "../utils/query-parser";
import { tokenReplay } from "./helpers/token-replay.helper";
import type { ApiResponse } from "../types/api.types";

// Tür→yön, belge no ve bakiye yazımı TEK YAZAR helper'ında (`cash-ledger.helper`); burada yeniden dışa verilir.
export { KIND_DIRECTION };
export type { AccountRef };

export interface CashTxnInput extends AccountRef {
  kind: Extract<CashTxnKind, "EXPENSE" | "INCOME" | "OPENING">;
  amount: Prisma.Decimal.Value;
  txnDate?: Date;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
  exchangeRate?: Prisma.Decimal.Value | null;
  clientToken?: string | null;
}

export interface TransferInput {
  fromCashBoxId?: string | null;
  fromBankAccountId?: string | null;
  toCashBoxId?: string | null;
  toBankAccountId?: string | null;
  amount: Prisma.Decimal.Value;
  txnDate?: Date;
  description?: string | null;
  clientToken?: string | null;
}

/**
 * AYNI TOKEN, FARKLI GÖVDE → 409 (2026-09-01).
 *
 * `clientToken` bir TEKRAR anahtarıdır, bir "üzerine yaz" anahtarı değil. Kapı
 * olmadan replay okuyucusu bulduğu kaydı KOŞULSUZ döndürüyordu ve sonuç sessiz
 * bir PARA hatasıydı: panelde token diyalog AÇILIŞINDA üretilip `tokenRef`te
 * tutuluyor (`CashTxnFormDialog.tsx` — "TEK MOUNT = TEK MANTIKSAL DENEME"),
 * yani gönderim zaman aşımına uğrayıp kullanıcı TUTARI DEĞİŞTİRİP tekrar
 * gönderdiğinde ikinci istek aynı token'la gelir. Eski davranış ilk kaydı
 * "Kayıt zaten oluşturulmuş" diyerek döndürürdü — kullanıcı yeni tutarın
 * yazıldığını sanırdı.
 *
 * ⚠️ YALNIZ ZORUNLU (varsayılansız) alanlar kıyaslanır. `txnDate`/`currency`
 * gibi servis tarafında varsayılan atanan alanlar buraya KONMAZ: saklanan değer
 * doludur, gelen `undefined`dır ve kapı MEŞRU tekrarları 409'a düşürürdü.
 */
type CashReplayRow = { id: string; docNo: string; kind: CashTxnKind; amount: Prisma.Decimal; cashBoxId: string | null; bankAccountId: string | null; status: PaymentStatus };
const CASH_REPLAY_SELECT = { id: true, docNo: true, kind: true, amount: true, cashBoxId: true, bankAccountId: true, status: true } as const;

/** 4. durum: iptal edilmiş hareketin token'ı "zaten oluşturulmuş" diye dönmez (§5-4). */
function assertCashReplayAlive(rows: Array<{ docNo: string; status: PaymentStatus }>): void {
  const dead = rows.find((r) => r.status === PaymentStatus.CANCELLED);
  if (!dead) return;
  throw AppError.conflict(
    `Bu form daha önce kaydedilmiş ve kayıt İPTAL edilmiş (${dead.docNo}) — aynı gönderim tekrar edilemez. Yeni kayıt için formu kapatıp yeniden açın.`,
    { code: "CASH_TXN_CANCELLED", docNo: dead.docNo },
  );
}

const cashTxnReplay = (input: CashTxnInput) =>
  tokenReplay<CashReplayRow, ApiResponse<{ id: string; docNo: string }>>({
    find: (db, clientToken) => db.cashTransaction.findUnique({ where: { clientToken }, select: CASH_REPLAY_SELECT }),
    alive: (p) => assertCashReplayAlive([p]),
    identity: (p) => [
      { ad: "kind", mevcut: p.kind, gelen: input.kind },
      { ad: "amount", mevcut: p.amount, gelen: input.amount },
      { ad: "cashBoxId", mevcut: p.cashBoxId, gelen: input.cashBoxId },
      { ad: "bankAccountId", mevcut: p.bankAccountId, gelen: input.bankAccountId },
    ],
    collision: "Bu istemci anahtarı FARKLI bir kasa hareketi için kullanılmış. Ekranı yenileyip tekrar deneyin.",
    collisionEk: (p) => ({ cashTransactionId: p.id }),
    respond: (p) => ({ success: true, data: { id: p.id, docNo: p.docNo }, message: "Kayıt zaten oluşturulmuş." }),
  });

type TransferReplayRow = { out: CashReplayRow; legs: CashReplayRow[] };

/** Virman replay'i: token ÇIKAN bacaktadır; gövde kapısı kaynak + hedef + tutar (§5-3), iptal edilmiş grup 409. */
const transferReplay = (from: AccountRef, to: AccountRef, amount: Prisma.Decimal) =>
  tokenReplay<TransferReplayRow, ApiResponse<{ ids: string[]; docNos: string[] }>>({
    find: async (db, clientToken) => {
      const out = await db.cashTransaction.findUnique({ where: { clientToken }, select: { ...CASH_REPLAY_SELECT, transferGroupId: true } });
      if (!out?.transferGroupId) return null;
      const legs = await db.cashTransaction.findMany({ where: { transferGroupId: out.transferGroupId }, select: CASH_REPLAY_SELECT });
      return { out, legs };
    },
    alive: (p) => assertCashReplayAlive(p.legs),
    identity: (p) => {
      const inLeg = p.legs.find((l) => l.kind === CashTxnKind.TRANSFER_IN);
      return [
        { ad: "fromCashBoxId", mevcut: p.out.cashBoxId, gelen: from.cashBoxId },
        { ad: "fromBankAccountId", mevcut: p.out.bankAccountId, gelen: from.bankAccountId },
        { ad: "toCashBoxId", mevcut: inLeg?.cashBoxId ?? null, gelen: to.cashBoxId },
        { ad: "toBankAccountId", mevcut: inLeg?.bankAccountId ?? null, gelen: to.bankAccountId },
        { ad: "amount", mevcut: p.out.amount, gelen: amount },
      ];
    },
    collision: "Bu form daha önce başka bir virman olarak kaydedilmiş. Yeni virman için formu kapatıp yeniden açın.",
    collisionEk: (p) => ({ docNos: p.legs.map((l) => l.docNo) }),
    // Yanıt her zaman [ÇIKAN, GİREN] — sırasız cached yanıt replay'i normal yanıttan ayırt edilebilir yapardı.
    respond: (p) => {
      const rows = [...p.legs].sort((a, b) => (a.kind === CashTxnKind.TRANSFER_OUT ? -1 : b.kind === CashTxnKind.TRANSFER_OUT ? 1 : 0));
      return { success: true, data: { ids: rows.map((r) => r.id), docNos: rows.map((r) => r.docNo) }, message: "Virman zaten kaydedilmiş." };
    },
  });

const nextCashNo = nextCashNoTx;

/** Hesabı çözer + aktifliğini doğrular; para birimini DÖNER (tek kaynak). */
async function loadAccount(
  tx: Prisma.TransactionClient,
  ref: AccountRef,
  label: string,
): Promise<{ currency: Currency; name: string }> {
  const hasCash = Boolean(ref.cashBoxId);
  const hasBank = Boolean(ref.bankAccountId);
  if (hasCash === hasBank) {
    throw AppError.badRequest(`${label}: kasa VEYA banka hesabı seçilmeli (ikisi birden değil).`);
  }
  if (hasCash) {
    const box = await tx.cashBox.findUnique({
      where: { id: ref.cashBoxId as string },
      select: { currency: true, name: true, isActive: true },
    });
    if (!box) throw AppError.badRequest(`${label}: kasa bulunamadı.`);
    if (!box.isActive) throw AppError.badRequest(`${label}: "${box.name}" kasası pasif durumda.`);
    return { currency: box.currency, name: box.name };
  }
  const acc = await tx.bankAccount.findUnique({
    where: { id: ref.bankAccountId as string },
    select: { currency: true, name: true, isActive: true },
  });
  if (!acc) throw AppError.badRequest(`${label}: banka hesabı bulunamadı.`);
  if (!acc.isActive) throw AppError.badRequest(`${label}: "${acc.name}" hesabı pasif durumda.`);
  return { currency: acc.currency, name: acc.name };
}

// Bakiye yazımı TEK yerde: `cash-ledger.helper.moveAccountBalanceTx` (applyCashTxTx / cancelCashTxTx içinden).

/**
 * KANONİK HESAP ANAHTARI — bakiye satır-kilidi SIRASININ tek kaynağı (Sınıf 3).
 *
 * Virman ve iptali AYNI tx'te İKİ hesabın bakiyesini günceller; PG satır
 * kilidini UPDATE sırasıyla alır. Sıra ROL'den gelirse (önce çıkan, sonra
 * giren) ayna çift (A→B ‖ B→A) kilitleri TERS sırada ister → klasik ABBA
 * deadlock'u (40P01) ve operatöre generic 500. Tablo adı + id string
 * karşılaştırması DETERMİNİSTİK TOPLAM SIRA verir: hangi tx hangi yönde olursa
 * olsun aynı iki satır AYNI sırayla kilitlenir, bekleme döngüsü yapısal olarak
 * imkânsızlaşır. `error.middleware`'in sınıf-40 → 409 ağı yalnız YEDEKTİR
 * (öngörülemeyen kombinasyonlar için); asıl önleme burasıdır.
 *
 * ⚠️ Karşılaştırma `<`/`>` kod-noktası sırasıyladır, `localeCompare` DEĞİL:
 * locale'e bağlı sıra iki süreçte/iki makinede farklı çıkabilir ve o gün sıra
 * "deterministik" olmaktan çıkar (2026-08-02 `toLocaleUpperCase` dersinin
 * sıralama ikizi). Tablo adı ön eki, aynı UUID'nin teorik olarak iki tabloda
 * yaşayabilmesine karşı — anahtar uzayları ayrışsın.
 */
function accountLockKey(ref: AccountRef): string {
  return ref.cashBoxId ? `cash_boxes|${ref.cashBoxId}` : `bank_accounts|${ref.bankAccountId ?? ""}`;
}

function compareLockKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class CashTransactionService {
  /**
   * Masraf / gelir / açılış fişi.
   *
   * ⚠️ Para birimi HESAPTAN gelir, girdide SORULMAZ: kasa tek para birimlidir
   * ve iki yerden sormak kullanıcıya sonradan reddedilecek kombinasyon
   * kurdurmaktı (PaymentService ile aynı karar).
   */
  async create(input: CashTxnInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    // R: token her kuraldan önce okunur ve hareket hangi hatayla düşerse düşsün (açılış tekilliği, bakiye,
    // token P2002) yeniden okunur — kaybeden deneme iş kuralı 409'unu değil önceki kaydı alır.
    return cashTxnReplay(input).run(input.clientToken, () => this.createFresh(input, amount, userId));
  }

  private async createFresh(input: CashTxnInput, amount: Prisma.Decimal, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const txnDate = input.txnDate ?? new Date();
    // ⚠️ ÖN KONTROL TEK BAŞINA YETMEZ (check-then-act): aynı token'la İKİ
    // PARALEL istek ikisi de "token yok" görür, ikisi de INSERT eder ve biri
    // `clientToken` unique'ine çarpar. O P2002 RETRY EDİLMEZ (retry aynı
    // token'ı 5 tur boşa yazardı → yanıltıcı "Barkod üretimi ... başarısız"
    // 409'u); boğaz onu önceki kayda çevirir (purchase-order emsali).
    const result = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
      const acc = await loadAccount(tx, input, "Kasa hareketi");

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1, 2026-08-14). `txnDate` kullanıcı
      // girdisidir ve kasa defteri RAPORLANMIŞ bir sayfadır — bu guard
      // gelmeden geçmişe tarihli bir masraf/gelir fişi, Excel'e alınmış kasa
      // defterini sessizce değiştirebiliyordu (Sınıf 1 taramasının "sessiz
      // ikinci üye" bulgusu). Kilit uzayı 8028 (cari 8026'dan ayrı).
      await assertCashPeriodOpenTx(tx, {
        cashBoxId: input.cashBoxId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        txnDate,
      });

      const rate =
        input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRateTx(tx, acc.currency, txnDate);
      if (rate == null) {
        throw AppError.badRequest(
          `${acc.currency} için ${txnDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin.`,
        );
      }
      if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

      // Açılış hesap başına TEK — DB'de partial unique ile kilitli; burada
      // anlamlı mesaj üretilir (sed kullanıcıya "unique ihlali" derdi).
      if (input.kind === CashTxnKind.OPENING) {
        const dup = await tx.cashTransaction.findFirst({
          where: {
            kind: CashTxnKind.OPENING,
            status: { not: PaymentStatus.CANCELLED },
            ...(input.cashBoxId ? { cashBoxId: input.cashBoxId } : { bankAccountId: input.bankAccountId }),
          },
          select: { docNo: true },
        });
        if (dup) {
          throw AppError.conflict(
            `"${acc.name}" için açılış bakiyesi zaten girilmiş (${dup.docNo}). Düzeltmek için önce onu iptal edin.`,
          );
        }
      }

      // Satır + bakiye TEK YAZARDAN (eksi-kasa kapısı çıkan kasa hareketinde ve dönem kapısı helper'ın içinde).
      const row = await applyCashTxTx(tx, {
        kind: input.kind, cashBoxId: input.cashBoxId ?? null, bankAccountId: input.bankAccountId ?? null,
        currency: acc.currency, exchangeRate: rate, amount, txnDate,
        category: input.category, description: input.description, reference: input.reference,
        createdById: userId ?? null, clientToken: input.clientToken ?? null,
      });
      return { id: row.id, docNo: row.docNo };
        }),
      undefined,
      // Belge numarası yarışı (P2002 `docNo`) RETRY EDİLİR; `clientToken`
      // P2002'si retry EDİLMEZ — catch cached yanıta çevirir.
      (err) => !isClientTokenP2002(err),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CASH_TRANSACTION",
      recordId: result.id,
      newData: { docNo: result.docNo, kind: input.kind, amount: amount.toString() },
    });
    return { success: true, data: result, message: `${result.docNo} kaydedildi.` };
  }

  /**
   * VİRMAN — kasadan bankaya / bankadan kasaya.
   *
   * ⚠️ TEK uç, İKİ satır, AYNI tx: çıkan (TRANSFER_OUT) + giren (TRANSFER_IN),
   * `transferGroupId` ile bağlı. İki ayrı fiş olarak yazdırmak, biri patlarsa
   * "para kasadan çıktı ama bankaya girmedi" durumunu üretirdi.
   *
   * ⚠️ Para birimi EŞİT olmalı: farklı birimler arası transfer bir KUR
   * İŞLEMİDİR (alış/satış kuru farkı, kur farkı gelir/gideri) ve onu "virman"
   * diye kaydetmek kur farkını sessizce yok sayardı. Faz 2 işi.
   */
  async transfer(input: TransferInput, userId?: string): Promise<ApiResponse<{ ids: string[]; docNos: string[] }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    const from: AccountRef = { cashBoxId: input.fromCashBoxId ?? null, bankAccountId: input.fromBankAccountId ?? null };
    const to: AccountRef = { cashBoxId: input.toCashBoxId ?? null, bankAccountId: input.toBankAccountId ?? null };
    if (
      (from.cashBoxId && from.cashBoxId === to.cashBoxId) ||
      (from.bankAccountId && from.bankAccountId === to.bankAccountId)
    ) {
      throw AppError.badRequest("Kaynak ve hedef hesap aynı olamaz.");
    }

    // R: virmanın gövde kapısı kaynak + hedef + tutar; iptal edilmiş virmanın token'ı 409.
    return transferReplay(from, to, amount).run(input.clientToken, () => this.transferFresh(input, { from, to, amount }, userId));
  }

  private async transferFresh(
    input: TransferInput,
    { from, to, amount }: { from: AccountRef; to: AccountRef; amount: Prisma.Decimal },
    userId?: string,
  ): Promise<ApiResponse<{ ids: string[]; docNos: string[] }>> {
    const txnDate = input.txnDate ?? new Date();
    // ⚠️ ÖN KONTROL TEK BAŞINA YETMEZ (check-then-act): aynı token'la İKİ
    // PARALEL istek ikisi de "token yok" görür, ikisi de INSERT eder ve biri
    // `clientToken` unique'ine çarpar (token yalnız ÇIKAN bacakta). O P2002
    // RETRY EDİLMEZ; boğaz onu önceki kayda çevirir (PO emsali).
    const result = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
      const fromAcc = await loadAccount(tx, from, "Çıkan hesap");
      const toAcc = await loadAccount(tx, to, "Giren hesap");

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1) — İKİ hesap → ÇOĞUL helper, iki
      // tekil çağrı DEĞİL (Sınıf 3: sırasız çift kilit = ayna virmanda
      // deadlock; çoğul helper anahtarları kendisi sıralar).
      await assertCashPeriodsOpenTx(tx, [
        { ...from, txnDate },
        { ...to, txnDate },
      ]);

      if (fromAcc.currency !== toAcc.currency) {
        throw AppError.badRequest(
          `"${fromAcc.name}" ${fromAcc.currency}, "${toAcc.name}" ${toAcc.currency} — farklı para birimleri arasında virman yapılamaz (kur işlemi ayrı kaydedilmeli).`,
        );
      }

      const rate = await resolveExchangeRateTx(tx, fromAcc.currency, txnDate);
      if (rate == null) {
        throw AppError.badRequest(
          `${fromAcc.currency} için ${txnDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin.`,
        );
      }
      const amountTry = amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const groupId = crypto.randomUUID();
      // İki bacak KANONİK kilit sırasında yazılır (ABBA kapalı); her bacak satır + bakiye tek yazardan.
      // Belge no sırası bacak sırasına göre değişebilir; yanıt her zaman [ÇIKAN, GİREN] döner.
      const legs = [
        { ref: from, kind: CashTxnKind.TRANSFER_OUT, acc: fromAcc, description: input.description?.trim() || `Virman → ${toAcc.name}`, clientToken: input.clientToken ?? null },
        { ref: to, kind: CashTxnKind.TRANSFER_IN, acc: toAcc, description: input.description?.trim() || `Virman ← ${fromAcc.name}`, clientToken: null },
      ].sort((x, y) => compareLockKeys(accountLockKey(x.ref), accountLockKey(y.ref)));
      const written = new Map<CashTxnKind, { id: string; docNo: string }>();
      for (const leg of legs) {
        written.set(leg.kind, await applyCashTxTx(tx, {
          kind: leg.kind, cashBoxId: leg.ref.cashBoxId ?? null, bankAccountId: leg.ref.bankAccountId ?? null,
          currency: leg.acc.currency, exchangeRate: rate, amount, txnDate, description: leg.description,
          transferGroupId: groupId, createdById: userId ?? null, clientToken: leg.clientToken,
        }));
      }
      const outRow = written.get(CashTxnKind.TRANSFER_OUT)!;
      const inRow = written.get(CashTxnKind.TRANSFER_IN)!;
      return { ids: [outRow.id, inRow.id], docNos: [outRow.docNo, inRow.docNo], groupId };
        }),
      undefined,
      // Belge numarası yarışı (P2002 `docNo`) RETRY EDİLİR; `clientToken`
      // P2002'si retry EDİLMEZ — boğaz (`tokenReplay.run`) replay'e çevirir.
      (err) => !isClientTokenP2002(err),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CASH_TRANSACTION",
      recordId: result.ids[0] as string,
      newData: { event: "TRANSFER", docNos: result.docNos, amount: amount.toString() },
    });
    return {
      success: true,
      data: { ids: result.ids, docNos: result.docNos },
      message: `Virman kaydedildi (${result.docNos.join(" / ")}).`,
    };
  }

  /**
   * İptal — STORNO değil SİLME de değil: kayıt CANCELLED işaretlenir ve bakiye
   * ters yönde düzeltilir (Payment.cancel ile aynı sözleşme).
   *
   * ⚠️ VİRMAN İPTALİ İKİ BACAĞI BİRDEN alır: tek bacağı iptal etmek "para
   * kasadan çıktı ama bankaya hiç girmedi" durumunu KALICI hale getirirdi.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<{ ids: string[] }>> {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.cashTransaction.findUnique({
        where: { id },
        select: { id: true, docNo: true, transferGroupId: true, status: true, paymentId: true },
      });
      if (!target) throw AppError.notFound("Kayıt bulunamadı.");
      // Tek yazar: ödemeden doğan satırın iptali ÖDEMENİN iptalidir — buradan iptal edilirse cari defter ile kasa defteri ayrışır.
      if (target.paymentId) {
        throw AppError.conflict(`${target.docNo} bir tahsilat/ödemenin kasa defteri satırıdır — iptali Tahsilat/Ödeme ekranından yapılır.`, { code: "CASH_TXN_FROM_PAYMENT" });
      }

      // Virmansa grubun TAMAMI; değilse yalnız kendisi.
      const scope = target.transferGroupId
        ? await tx.cashTransaction.findMany({
            where: { transferGroupId: target.transferGroupId },
            select: { id: true, docNo: true, direction: true, amount: true, cashBoxId: true, bankAccountId: true, txnDate: true },
          })
        : await tx.cashTransaction.findMany({
            where: { id },
            select: { id: true, docNo: true, direction: true, amount: true, cashBoxId: true, bankAccountId: true, txnDate: true },
          });

      // ⚠️ KİLİT SIRASI KANONİK (Sınıf 3): virman iptali iki hesabın bakiyesine dokunur — yazımla (transfer `legs.sort`)
      // AYNI anahtar uzayı, aynı sıra. Claim (ACTIVE→CANCELLED) + dönem kapısı (çıpa orijinal txnDate) + bakiye geri TEK
      // YAZARDAN (`cancelCashTxTx`); satır silinmez, CANCELLED'a çekilir (DURUM_IPTAL).
      const orderedScope = [...scope].sort((x, y) =>
        compareLockKeys(
          accountLockKey({ cashBoxId: x.cashBoxId, bankAccountId: x.bankAccountId }),
          accountLockKey({ cashBoxId: y.cashBoxId, bankAccountId: y.bankAccountId }),
        ),
      );
      await cancelCashTxTx(tx, orderedScope, {
        reason, userId,
        alreadyMessage: `${target.docNo} zaten iptal edilmiş.`,
        changedMessage: "Virmanın bacakları bu sırada değişti — yenileyip tekrar deneyin.",
      });
      return { ids: scope.map((r) => r.id), docNos: scope.map((r) => r.docNo) };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CASH_TRANSACTION",
      recordId: id,
      newData: { event: "CANCELLED", docNos: result.docNos, reason },
    });
    return {
      success: true,
      data: { ids: result.ids },
      message:
        result.ids.length > 1
          ? `Virman iptal edildi (${result.docNos.join(" / ")}) — her iki bacak da geri alındı.`
          : `${result.docNos[0]} iptal edildi.`,
    };
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    kind?: CashTxnKind;
    status?: PaymentStatus;
    cashBoxId?: string;
    bankAccountId?: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.CashTransactionWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.status) where.status = params.status;
    if (params.cashBoxId) where.cashBoxId = params.cashBoxId;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    if (params.from || params.to) {
      where.txnDate = { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) };
    }
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI (kural + gerekçe: `utils/query-parser`).
      // ⚠️ SERBEST METİN = EN KIRILGAN YÜZEY: açıklama/kategori kullanıcının
      // yazdığı gibi saklanır ("İşçi Avansı", "Şoför avansı") — ne BÜYÜĞE
      // çevrilir ne bir kataloğa bağlıdır. ILIKE noktalı/noktasız i'yi
      // katlamadığı için düz `contains` ile muhasebeci "işçi avansı" arayınca
      // 0 satır alıyor ve gideri İKİNCİ KEZ giriyordu.
      where.OR = buildTurkishSearch(params.search, ["docNo", "category", "description", "reference"]);
    }

    const [data, total] = await Promise.all([
      prisma.cashTransaction.findMany({
        where,
        select: {
          id: true,
          docNo: true,
          kind: true,
          direction: true,
          status: true,
          currency: true,
          amount: true,
          txnDate: true,
          category: true,
          description: true,
          reference: true,
          transferGroupId: true,
          cashBox: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
          paymentId: true,
          payment: { select: { id: true, docNo: true, direction: true, cari: { select: { id: true, customer: { select: { name: true } }, subcontractor: { select: { name: true } } } } } },
        },
        orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cashTransaction.count({ where }),
    ]);
    return { data, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}

export const cashTransactionService = new CashTransactionService();
