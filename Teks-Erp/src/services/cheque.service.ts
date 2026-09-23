// =============================================================================
// ÇEK / SENET PORTFÖY SERVİSİ (Paket C1)
// =============================================================================
// ⚠️ NEDEN `Payment` DEĞİL: `Payment` bir ANDIR — para o an el değiştirir ve
// kayıt aynı anda kapanır. Çek bir VARLIKTIR: haftalarca yaşar, elde durur,
// bankaya verilir, ciro edilir, tahsil olur ya da karşılıksız çıkar. Bu
// yaşam döngüsünü `PaymentMethod`'a bir `CHEQUE` değeri ekleyerek taşımak,
// sistemin EN HASSAS yoluna (para + cari defter) sessiz bir `if` sokmak
// olurdu. Logo/Mikro da aynı ayrımı yapar (Çek/Senet ayrı modül).
//
// ⚠️ DEFTER ANI (kilitli karar): çek ALINDIĞI AN cari alacaklanır — Logo'nun
// "Çek Giriş Bordrosu" davranışı. Müşteri çeki verdiğinde ticari olarak
// ÖDEMİŞTİR; ekstre aksini söylerse iki taraf iki gerçekle çalışır ve
// mutabakat imkânsızlaşır. Karşılıksız riski, kaydı GECİKTİRMENİN değil TERS
// KAYITLA geri almanın gerekçesidir (append-only defter felsefesi).
// ⚠️ "ALINDIĞI AN" = `postingDate` (İŞLEM tarihi, SAP Buchungsdatum) — KEŞİDE
// tarihi DEĞİL (2026-08-14 SINIF 1). Keşide kâğıdın üzerindeki tarihtir: ileri
// keşide standart pratik, geçmiş keşideli çek almak olağan. Kur çözümü, belge
// numarasının GGAAYY'si, defter `txnDate`i ve doğuş olayının tarihi DÖRDÜ DE
// `postingDate`ten okunur; dönem kilidi de onu kapılar. `issueDate` kâğıdın
// hukuki verisi olarak KALIR (TTK 796 ibraz süresi keşideden hesaplanır).
//
// OLAY → DEFTER TABLOSU (tek kaynak, aşağıdaki metotlar bunu uygular):
//   RECEIVE  → müşteri CREDIT (borcu azaldı)
//   COLLECT  → YALNIZ banka/kasa +amount; cari İKİNCİ KEZ OYNAMAZ
//   ENDORSE  → ciro edilen cariye DEBIT (ona olan borcumuz azaldı)
//   BOUNCE   → müşteriye DEBIT + ENDORSED'dan geldiyse ciro carisine ters CREDIT
//   RETURN   → çekin defter etkisi ters kayıtla geri alınır (iki yönde de)
//   ISSUE    → cariye DEBIT (borcumuz azaldı) · PAY → YALNIZ banka/kasa −amount
//   COLLECT_CANCEL → YALNIZ banka/kasa −amount (tahsil stornosu, K-2); cari
//                    yine OYNAMAZ — COLLECT oynatmamıştı, tersi de oynatmaz
//
// STORNOLAR — her ileri olayın tipli tersi; ileri satırı SİLMEZ, bugüne ters
// satır yazar (`reversesTxnId`), durumu ileri olayın `fromStatus`una döndürür:
//   ENDORSE_CANCEL → ciro carisine ALACAK (CHEQUE_ENDORSE_CANCEL)
//   BOUNCE_CANCEL  → BOUNCE'un bir ya da iki satırının tersi (CHEQUE_BOUNCE_CANCEL)
//   RETURN_CANCEL  → RETURN'ün satırının tersi (CHEQUE_RETURN_CANCEL)
//   PAY_CANCEL     → YALNIZ banka/kasa +amount; PAY cari yazmamıştı, tersi de yazmaz
//   DEPOSIT_CANCEL → hiçbir defter oynamaz (DEPOSIT de oynatmamıştı); durum PORTFOLIO,
//                    başlık bankası düşer — dönem kapısı/8028 kilidi ÇAĞRILMAZ
//
// ⚠️ Kasa/banka bakiyesini oynatan ÜÇ DEFTER var (CashTransaction — ödeme satırları dahil · ChequeEvent · backfill
// öncesi satırsız Payment); bakiye YAZIMI ise tek yerde: `helpers/cash-ledger.helper.moveAccountBalanceTx`.
// `scripts/test_consistency.ts` §23/§24 formülü üçünü birlikte toplar (ödeme terimi yalnız satırsız ödemeler).
// =============================================================================
import {
  Prisma,
  CariTxnSource,
  ChequeDocType,
  ChequeEventType,
  ChequeKind,
  ChequeStatus,
  Currency,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { formatSeriesCode, resolveSeriesFormat, seriesPrefix, seriesSeqFrom } from "./number-series.service";
import { factoryDaySql, factoryYmd } from "../constants/time";
import { D, D0, applyCariBalanceTx, ensureCariAccountTx, resolveExchangeRateTx } from "./helpers/finance.helper";
import { assertPeriodOpenTx, assertPeriodsOpenTx } from "./helpers/period-guard.helper";
import { assertCashPeriodOpenTx } from "./helpers/cash-period-guard.helper";
import { assertCashBalanceCoversTx } from "./helpers/cash-balance-guard.helper";
import { buildTurkishSearch } from "../utils/query-parser";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import type { ApiResponse } from "../types/api.types";
import { moveAccountBalanceTx as moveLedgerAccountBalanceTx } from "./helpers/cash-ledger.helper";

// -----------------------------------------------------------------------------
// BELGE NUMARASI
// -----------------------------------------------------------------------------

/**
 * Ön ek TÜR × YÖN kombinasyonundan gelir.
 *
 * ⚠️ Tek "CK" ön eki kullanmak, aldığımız ve verdiğimiz çekleri AYNI sayaçta
 * karıştırırdı; muhasebeci "CK1408260007 hangisiydi" sorusunu belge
 * numarasından cevaplayamazdı (`INVOICE_PREFIX` ile aynı gerekçe).
 */
const DOC_SERIES: Record<ChequeKind, Record<ChequeDocType, string>> = {
  RECEIVED: { CHEQUE: "chequeReceived", PROMISSORY_NOTE: "noteReceived" },
  ISSUED: { CHEQUE: "chequeIssued", PROMISSORY_NOTE: "noteIssued" },
};

/**
 * Günlük sıralı belge numarası — PREFIX + GGAAYY + NNNN.
 *
 * ⚠️ `orderBy` ile DEĞİL, JS'te sayısal max ile (glibc collation lexicographic
 * ve sıra 9→10 geçişinde bozulur — `nextInvoiceNoTx` kanıtlı deseni). Çağıran
 * `withBarcodeRetry` ile sarmalar: yarışta P2002 hâlâ mümkündür ve doğru cevap
 * tekrar denemektir.
 */
async function nextChequeNo(
  tx: Prisma.TransactionClient,
  kind: ChequeKind,
  docType: ChequeDocType,
  date: Date,
): Promise<string> {
  const seriesKey = DOC_SERIES[kind][docType];
  const fmt = resolveSeriesFormat(seriesKey);
  const full = seriesPrefix(fmt, date);
  const rows = await tx.cheque.findMany({
    where: { docNo: { gte: full, startsWith: full } },
    select: { docNo: true },
  });
  return formatSeriesCode(fmt, seriesSeqFrom(fmt, rows.map((r) => r.docNo), full), date);
}

// -----------------------------------------------------------------------------
// DURUM MAKİNESİ
// -----------------------------------------------------------------------------

/**
 * TERMİNAL durumlar — normal AKIŞ olayları bunlardan sonra YOKTUR.
 *
 * Tek çıkış TİPLİ STORNODUR (`*_CANCEL`) ve `loadForTransition`'a durumu AÇIKÇA
 * `allowedFrom` olarak verir; bu liste "genel geçiş kapısı" olmayı sürdürür.
 * `CANCELLED` stornonun kendisidir, çıkışı yoktur.
 */
const TERMINAL_STATUSES: readonly ChequeStatus[] = [
  ChequeStatus.COLLECTED,
  ChequeStatus.BOUNCED,
  ChequeStatus.RETURNED,
  ChequeStatus.PAID,
  ChequeStatus.CANCELLED,
];

/**
 * Ekranda ve hata mesajında okunan durum adları (tek kaynak).
 *
 * ⚠️ EXPORT EDİLDİ (2026-08-15): `payment-allocation.service` çekle fatura
 * kapatmayı reddederken ham enum basıyordu ("durumu BOUNCED"). Sözlüğün kendi
 * yorumu zaten "tek kaynak" diyordu; eksik olan yalnız dışa açılmasıydı.
 * Kopyalama — ikinci bir sözlük, aynı durumun iki adla anılması demektir.
 */
export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  PORTFOLIO: "portföyde",
  AT_BANK: "bankada (tahsilde)",
  ENDORSED: "ciro edildi",
  COLLECTED: "tahsil edildi",
  BOUNCED: "karşılıksız",
  RETURNED: "iade edildi",
  ISSUED: "verildi",
  PAID: "ödendi",
  CANCELLED: "iptal edildi",
};

/** Yanlış kaydın çıkış yolu — "yapılamaz" mesajı yolu gösterir (çıkmaz 409 yasak). */
const REVERSAL_HINT: Partial<Record<ChequeStatus, string>> = {
  COLLECTED: '"Tahsilatı Geri Al" (tahsil stornosu)',
  ENDORSED: '"Ciroyu Geri Al" (ciro stornosu)',
  BOUNCED: '"Karşılıksızı Geri Al" (karşılıksız stornosu)',
  RETURNED: '"İadeyi Geri Al" (iade stornosu)',
  PAID: '"Ödemeyi Geri Al" (ödeme stornosu)',
  AT_BANK: '"Bankaya Vermeyi Geri Al" (bankaya verme stornosu)',
};

/** Belge türü etiketi — hata mesajı "çek" mi "senet" mi demeli. */
const DOCTYPE_LABEL: Record<ChequeDocType, string> = {
  CHEQUE: "Çek",
  PROMISSORY_NOTE: "Senet",
};

/** Bir geçişte okunması gereken asgari başlık alanları. */
const TRANSITION_SELECT = {
  id: true,
  docNo: true,
  kind: true,
  docType: true,
  status: true,
  cariId: true,
  endorsedToCariId: true,
  currency: true,
  exchangeRate: true,
  amount: true,
  amountTry: true,
  allocatedTotal: true,
} satisfies Prisma.ChequeSelect;

type TransitionRow = Prisma.ChequeGetPayload<{ select: typeof TRANSITION_SELECT }>;

/** Cari referansı — ad, bağlı olduğu taraftan okunur (`partyName` sözleşmesi). */
const CARI_REF_SELECT = {
  select: {
    id: true,
    customer: { select: { code: true, name: true } },
    subcontractor: { select: { code: true, name: true } },
  },
} as const;

/**
 * LİSTE yüzeyi — `list()` bunu kullanır; DETAIL_SELECT bunun üstüne kurulur
 * (tek kaynak: liste ile detay aynı satır için farklı şey söyleyemez).
 */
const LIST_SELECT = {
  id: true,
  docNo: true,
  kind: true,
  docType: true,
  status: true,
  currency: true,
  amount: true,
  amountTry: true,
  // İKİ TARİH BİRDEN döner: `postingDate` işlem (defter) tarihi,
  // `issueDate` keşide. Panel tablosu postingDate'i opsiyonel bekler ve
  // "alan gelirse kendiliğinden gösterir" (Cheques/service.ts notu) —
  // yalnız keşideyi dönmek, listede defter tarihini görünmez bırakırdı.
  postingDate: true,
  issueDate: true,
  dueDate: true,
  serialNo: true,
  bankName: true,
  drawerName: true,
  allocatedTotal: true,
  bankAccount: { select: { id: true, name: true } },
  cari: CARI_REF_SELECT,
  endorsedToCari: CARI_REF_SELECT,
} as const;

/**
 * DETAY yüzeyi (I4, 2026-08-14) — `include` DEĞİL `select`.
 *
 * ⚠️ Çıplak `include` TÜM skaler kolonları döndürüyordu: `clientToken`
 * (idempotency iç anahtarı) + çıplak iç FK'ler (`cariId`/`endorsedToCariId`/
 * `bankAccountId`/`cancelledById`/`createdById`). Panel (`Cheques/service.ts
 * ChequeDetail`) bunların hiçbirini okumuyor — iç kimlikler ilişkinin KENDİ
 * `id`'siyle taşınır. Kural: LIST_SELECT + detay alanları + ilişkiler.
 *
 * ⚠️ Alan kümesi bekçiyle SABİTLENDİ (`test_cheque_portfolio` detay bölümü).
 */
const DETAIL_SELECT = {
  ...LIST_SELECT,
  exchangeRate: true,
  branchName: true,
  notes: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  events: {
    // Olay defteri KRONOLOJİK okunur — "ne zaman ne oldu" sorusunun
    // cevabı sıralamadır; ters sıralamak zinciri okunamaz yapardı.
    orderBy: [{ eventDate: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      id: true,
      type: true,
      fromStatus: true,
      toStatus: true,
      eventDate: true,
      // Storno onayı "en yeni ileri olayı" backend gibi yazım sırasıyla seçsin.
      createdAt: true,
      notes: true,
      counterCari: CARI_REF_SELECT,
      bankAccount: { select: { id: true, name: true } },
      cashBox: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ChequeSelect;

// -----------------------------------------------------------------------------
// ORTAK YARDIMCILAR
// -----------------------------------------------------------------------------

export interface AccountRef {
  cashBoxId?: string | null;
  bankAccountId?: string | null;
}

/**
 * Kasa VEYA banka hesabını çözer + aktifliğini ve para birimini doğrular.
 *
 * ⚠️ Kural `cash-transaction.service.loadAccount` ile BİREBİR aynıdır (kasa XOR
 * banka · aktiflik · para birimi eşleşmesi). Ortak yardımcıya çıkarılmadı:
 * `finance.helper` bu çalışma penceresinde başka bir iş paketinin elinde ve
 * çakışma riski, üç satırlık tekrardan pahalı. ÜÇÜNCÜ kopya doğduğu gün
 * `finance.helper`'a taşınmalı.
 */
async function loadAccountTx(
  tx: Prisma.TransactionClient,
  ref: AccountRef,
  expectedCurrency: Currency,
): Promise<{ name: string }> {
  const hasCash = Boolean(ref.cashBoxId);
  const hasBank = Boolean(ref.bankAccountId);
  if (hasCash === hasBank) {
    throw AppError.badRequest("Kasa VEYA banka hesabı seçilmeli (ikisi birden değil).");
  }

  let currency: Currency;
  let name: string;
  if (hasCash) {
    const box = await tx.cashBox.findUnique({
      where: { id: ref.cashBoxId as string },
      select: { currency: true, name: true, isActive: true },
    });
    if (!box) throw AppError.badRequest("Kasa bulunamadı.");
    if (!box.isActive) throw AppError.badRequest(`"${box.name}" kasası pasif durumda.`);
    currency = box.currency;
    name = box.name;
  } else {
    const acc = await tx.bankAccount.findUnique({
      where: { id: ref.bankAccountId as string },
      select: { currency: true, name: true, isActive: true },
    });
    if (!acc) throw AppError.badRequest("Banka hesabı bulunamadı.");
    if (!acc.isActive) throw AppError.badRequest(`"${acc.name}" hesabı pasif durumda.`);
    currency = acc.currency;
    name = acc.name;
  }

  // Kasa tek para birimlidir; USD çeki TL kasasına tahsil etmek "kasada ne var"
  // sorusunu cevaplanamaz yapardı (bakiye iki birimin toplamı olurdu).
  if (currency !== expectedCurrency) {
    throw AppError.badRequest(
      `"${name}" ${currency} hesabıdır — ${expectedCurrency} çek/senet bu hesaba işlenemez. Aynı para biriminde bir kasa/hesap seçin.`,
    );
  }
  return { name };
}

/** Kasa/banka bakiyesi TEK YAZARDAN oynar (`cash-ledger.helper`); çekin defteri `ChequeEvent`tir, bakiye primitifi ortaktır. */
async function moveAccountBalanceTx(tx: Prisma.TransactionClient, ref: AccountRef, delta: Prisma.Decimal): Promise<void> {
  await moveLedgerAccountBalanceTx(tx, ref, delta);
}

/** Cari referansını çözer: doğrudan `cariId` ya da müşteri/fason üzerinden lazy açılış. */
async function resolveCariTx(
  tx: Prisma.TransactionClient,
  ref: { cariId?: string | null; customerId?: string | null; subcontractorId?: string | null },
  label: string,
): Promise<{ id: string }> {
  if (ref.cariId) {
    const cari = await tx.cariAccount.findUnique({
      where: { id: ref.cariId },
      select: { id: true, isActive: true },
    });
    if (!cari) throw AppError.badRequest(`${label}: cari hesap bulunamadı.`);
    if (!cari.isActive) throw AppError.badRequest(`${label}: cari hesap pasif durumda.`);
    return { id: cari.id };
  }
  return ensureCariAccountTx(tx, {
    customerId: ref.customerId ?? null,
    subcontractorId: ref.subcontractorId ?? null,
  });
}

/**
 * Cari deftere satır yazar + denormalize bakiyeyi AYNI tx'te oynatır.
 *
 * ⚠️ Yön sözleşmesi projedeki tek kural: bakiye POZİTİF = cari BİZE borçlu.
 * BORÇ (debit) satırı bakiyeyi ARTIRIR, ALACAK (credit) AZALTIR. Bu eşleme
 * kopyalanırsa bir gün biri ters yazar ve bakiye iki kat sapar (hata çıkmadan).
 *
 * ⚠️ C3 (dönem kapanışı) devreye girdiğinde `assertPeriodOpenTx` çağrısının
 * yeri BURASIDIR — satır yazan tek nokta burası olduğu için çek tarafında beş
 * ayrı yola dokunmak gerekmez.
 */
async function writeChequeLedgerTx(
  tx: Prisma.TransactionClient,
  input: {
    cariId: string;
    currency: Currency;
    txnDate: Date;
    side: "debit" | "credit";
    amount: Prisma.Decimal;
    amountTry: Prisma.Decimal;
    exchangeRate: Prisma.Decimal;
    sourceType: CariTxnSource;
    chequeId: string;
    description: string;
    userId?: string;
    /** Storno satırında terslenen orijinal — `@unique`, bir satır bir kez terslenir. */
    reversesTxnId?: string;
  },
): Promise<void> {
  // ⚠️ DÖNEM KİLİDİ — satır YAZILMADAN ÖNCE, ve çek tarafında TEK yer burasıdır
  // (dosyanın başındaki not bu noktayı işaretlemişti). Beş geçişin hepsi bu
  // yardımcıdan geçtiği için kilit tek satırla tam kapsanır; geçişlere tek tek
  // eklemek, yeni bir geçiş yazıldığı gün sessizce atlanan bir kapı bırakırdı.
  await assertPeriodOpenTx(tx, {
    cariId: input.cariId,
    currency: input.currency,
    txnDate: input.txnDate,
  });

  const isDebit = input.side === "debit";
  await tx.cariTransaction.create({
    data: {
      cariId: input.cariId,
      currency: input.currency,
      txnDate: input.txnDate,
      debit: isDebit ? input.amount : D0(),
      credit: isDebit ? D0() : input.amount,
      amountTry: input.amountTry,
      exchangeRate: input.exchangeRate,
      sourceType: input.sourceType,
      chequeId: input.chequeId,
      reversesTxnId: input.reversesTxnId ?? null,
      description: input.description.slice(0, 300),
      createdById: input.userId ?? null,
    },
  });
  await applyCariBalanceTx(
    tx,
    input.cariId,
    input.currency,
    isDebit ? input.amount : input.amount.negated(),
  );
}

/** Olay defterine satır — başlıkla AYNI tx'te (ayrışmaları yapısal olarak imkânsız). */
async function writeEventTx(
  tx: Prisma.TransactionClient,
  input: {
    chequeId: string;
    type: ChequeEventType;
    fromStatus: ChequeStatus | null;
    toStatus: ChequeStatus;
    eventDate: Date;
    counterCariId?: string | null;
    bankAccountId?: string | null;
    cashBoxId?: string | null;
    notes?: string | null;
    userId?: string;
  },
): Promise<void> {
  await tx.chequeEvent.create({
    data: {
      chequeId: input.chequeId,
      type: input.type,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      eventDate: input.eventDate,
      counterCariId: input.counterCariId ?? null,
      bankAccountId: input.bankAccountId ?? null,
      cashBoxId: input.cashBoxId ?? null,
      notes: input.notes?.trim() || null,
      createdById: input.userId ?? null,
    },
  });
}

// -----------------------------------------------------------------------------
// STORNO YARDIMCILARI — dört ters yolun ortak parçaları
// -----------------------------------------------------------------------------

function requireReversalReason(reason: string | undefined, label: string): string {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) throw AppError.badRequest(`${label} için sebep zorunludur — defter ters kayıtla düzeltiliyor.`);
  return trimmed;
}

/**
 * Terslenecek ileri olay — EN YENİSİ `createdAt` ile: `eventDate` kullanıcı
 * girdisidir ve geriye tarihlenebilir, zincirin gerçek sırası yazım sırasıdır.
 * FAIL-CLOSED: olay ya da tükettiği durum yoksa neyin geri kurulacağı bilinemez.
 */
async function loadForwardEventTx(
  tx: Prisma.TransactionClient,
  row: TransitionRow,
  type: ChequeEventType,
  label: string,
): Promise<{ fromStatus: ChequeStatus; counterCariId: string | null; cashBoxId: string | null; bankAccountId: string | null }> {
  const event = await tx.chequeEvent.findFirst({
    where: { chequeId: row.id, type },
    orderBy: { createdAt: "desc" },
    select: { fromStatus: true, counterCariId: true, cashBoxId: true, bankAccountId: true },
  });
  if (!event?.fromStatus) {
    throw AppError.conflict(
      `${row.docNo} için geri alınacak olay kaydı bulunamadı — ${label} otomatik yapılamaz, kaydı süpervizörle inceleyin.`,
    );
  }
  return { ...event, fromStatus: event.fromStatus };
}

const REVERSIBLE_TXN_SELECT = {
  id: true, cariId: true, currency: true, debit: true, credit: true, amountTry: true, exchangeRate: true,
} satisfies Prisma.CariTransactionSelect;

type ReversibleTxn = Prisma.CariTransactionGetPayload<{ select: typeof REVERSIBLE_TXN_SELECT }>;

/** İleri olayın cari satırı: terslenmemiş, beklenen tarafta, en yenisi. FAIL-CLOSED. */
async function loadReversibleTxnTx(
  tx: Prisma.TransactionClient,
  row: TransitionRow,
  ref: { sourceType: CariTxnSource; cariId: string; side: "debit" | "credit" },
  label: string,
): Promise<ReversibleTxn> {
  const txn = await tx.cariTransaction.findFirst({
    where: {
      chequeId: row.id,
      cariId: ref.cariId,
      sourceType: ref.sourceType,
      reversedBy: { is: null },
      ...(ref.side === "debit" ? { debit: { gt: 0 } } : { credit: { gt: 0 } }),
    },
    orderBy: { createdAt: "desc" },
    select: REVERSIBLE_TXN_SELECT,
  });
  if (!txn) {
    throw AppError.conflict(
      `${row.docNo} için terslenecek cari defter satırı bulunamadı — ${label} otomatik yapılamaz, kaydı süpervizörle inceleyin.`,
    );
  }
  return txn;
}

/** Birebir ters satır: borç↔alacak yer değiştirir, TL karşılığı ve kur orijinalden. */
async function writeChequeReversalTx(
  tx: Prisma.TransactionClient,
  original: ReversibleTxn,
  input: { sourceType: CariTxnSource; chequeId: string; txnDate: Date; description: string; userId?: string },
): Promise<void> {
  const wasDebit = D(original.debit).gt(0);
  try {
    await writeChequeLedgerTx(tx, {
      cariId: original.cariId,
      currency: original.currency,
      txnDate: input.txnDate,
      side: wasDebit ? "credit" : "debit",
      amount: wasDebit ? D(original.debit) : D(original.credit),
      amountTry: D(original.amountTry),
      exchangeRate: D(original.exchangeRate),
      sourceType: input.sourceType,
      chequeId: input.chequeId,
      reversesTxnId: original.id,
      description: input.description,
      userId: input.userId,
    });
  } catch (e) {
    // Atomik claim ikinci stornoyu önden keser; bu, claim atlanırsa kalan DB seddi.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw AppError.conflict("Bu defter satırı zaten terslenmiş. Ekranı yenileyip tekrar deneyin.");
    }
    throw e;
  }
}

// -----------------------------------------------------------------------------
// GİRDİ TİPLERİ
// -----------------------------------------------------------------------------

export interface CreateChequeInput {
  kind: ChequeKind;
  docType?: ChequeDocType;
  /** Cari doğrudan (id) YA DA taraf üzerinden (müşteri/fason lazy açılışı). */
  cariId?: string | null;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  exchangeRate?: Prisma.Decimal.Value | null;
  amount: Prisma.Decimal.Value;
  /** KEŞİDE tarihi — kâğıdın üzerindeki tarih (hukuki veri, TTK 796). */
  issueDate?: Date;
  /**
   * İŞLEM tarihi — DEFTER ÇIPASI (kur · belge no · txnDate · doğuş olayı ·
   * dönem kilidi). Verilmezse BUGÜN: "işlem tarihi kullanıcınındır, kilit
   * kapılar" (payment emsali). Eski panel bu alanı göndermez → bugüne düşer;
   * bu DOĞRU davranıştır (çek bugün işleniyor).
   */
  postingDate?: Date;
  dueDate: Date;
  serialNo?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  drawerName?: string | null;
  notes?: string | null;
  clientToken?: string | null;
}

export interface ChequeEventInput {
  eventDate?: Date;
  notes?: string | null;
}

export interface ChequeAccountEventInput extends ChequeEventInput, AccountRef {}

export interface EndorseInput extends ChequeEventInput {
  toCariId?: string | null;
  toCustomerId?: string | null;
  toSubcontractorId?: string | null;
}

// -----------------------------------------------------------------------------
// VADE TAKVİMİ (H4) — kovalar + haftalık/aylık takvim
// -----------------------------------------------------------------------------
// ⚠️ EKSEN VADE TARİHİDİR, işlem tarihi DEĞİL. Portföyün defter tarafı
// `postingDate`ten okunur (SINIF 1) ama "sırada ne var, ne zaman para girecek"
// sorusu yalnız `dueDate` ile cevaplanır. İkisini karıştıran bir takvim, ileri
// keşideli çeki bugüne yazardı.
//
// ⚠️ KAPSAM = PARA BEKLENEN ÇEK. Tahsil edilmiş / karşılıksız / iade / iptal
// çekler GİRMEZ (beklenen bir hareket yok) — takvime alınsalardı "önümüzdeki
// hafta 400.000 TL girecek" rakamının içinde geçen ay çoktan tahsil edilmiş
// para olurdu ve kimse farkı göremezdi.
//
// ⚠️ CİRO EDİLEN (`ENDORSED`) ÇEK DE GİRMEZ ve bu bir eksiklik değil KARARDIR:
// alacak ciroyla üçüncü tarafa geçmiştir, o çekten artık bize para girmez.
// Karşılıksız dönerse `bounce` alacağı yeni bir olayla geri açar ve çek o an
// yeniden canlanır. Kapsam yanıtta `liveStatuses` ile AÇIKÇA söylenir + notlara
// yazılır: sessizce dışarıda bırakılan bir kova, eksik rakamın en sessiz hâlidir.

/** Vade kovaları — SIRA anlamlıdır (geçmiş → yakın → uzak). */
export const CHEQUE_DUE_BUCKETS = ["OVERDUE", "SOON", "MONTH", "LATER", "NO_DUE"] as const;
export type ChequeDueBucket = (typeof CHEQUE_DUE_BUCKETS)[number];

/**
 * "Yaklaşan" penceresi (gün).
 *
 * ⚠️ Panelin satır rengiyle (`Cheques/dates.dueTone` → `soon`) BİREBİR aynı
 * olmak ZORUNDA: kart "3 çek yaklaşıyor" derken listede 4 satır amber
 * yanıyorsa kullanıcı hangisinin doğru olduğunu bilemez. Değer yanıtta
 * `soonDays` olarak DÖNER — istemci kendi "7"sini yazmaz.
 */
export const CHEQUE_DUE_SOON_DAYS = 7;

/**
 * PARA BEKLENEN durumlar — kapsamın TEK KAYNAĞI.
 * SQL süzgeci de bu tablodan üretilir (aşağı); ikinci bir literal liste,
 * kovalar ile listenin sessizce ayrışması demekti.
 */
export const CHEQUE_DUE_LIVE_STATUSES: Record<ChequeKind, ChequeStatus[]> = {
  RECEIVED: [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK],
  ISSUED: [ChequeStatus.ISSUED],
};

export interface ChequeDueBucketRow {
  bucket: ChequeDueBucket;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  /** Kendi para biriminde — TL karşılığı TOPLANMAZ (`summary` ile aynı gerekçe). */
  amount: string;
}

export interface ChequeDueCalendarRow {
  /** Hafta: pazartesi günü (`YYYY-MM-DD`) · Ay: `YYYY-MM`. */
  key: string;
  /** Kapsanan ilk/son takvim günü — etiketi İSTEMCİ biçimler (yerel ay adları). */
  start: string;
  end: string;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  amount: string;
}

export interface ChequeDueSummary {
  /** Fabrika takvim günü (`YYYY-MM-DD`) — kova sınırlarının çıpası. */
  today: string;
  soonDays: number;
  /** Portföyün TAMAMI — takvim penceresinden BAĞIMSIZ. */
  buckets: ChequeDueBucketRow[];
  /** Takvimin kapsadığı pencere (`YYYY-MM-DD`, iki uç da DAHİL). */
  window: { from: string; to: string };
  weeks: ChequeDueCalendarRow[];
  months: ChequeDueCalendarRow[];
  liveStatuses: Record<ChequeKind, ChequeStatus[]>;
  notes: string[];
}

const DUE_DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC gece yarısı ms. Takvim anahtarı aritmetiği tz'siz yapılır. */
function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** UTC ms → `YYYY-MM-DD` (yalnız takvim anahtarı üretir, saat taşımaz). */
function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Takvim gününün ait olduğu haftanın PAZARTESİ'si.
 *
 * ⚠️ Hafta pazartesi başlar (TR/ISO). `getUTCDay()` pazarı 0 döndürür; ham
 * kullanılırsa hafta pazar başlar ve pazartesi vadeli bir çek bir ÖNCEKİ
 * haftanın satırına yazılır — planlamacı "bu hafta" derken geçen haftayı okur.
 */
function weekStartYmd(ymd: string): string {
  const ms = ymdToUtcMs(ymd);
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return utcMsToYmd(ms - back * DUE_DAY_MS);
}

/**
 * AYNI TOKEN, FARKLI GÖVDE → 409 (2026-09-01). Gerekçe:
 * `cash-transaction.service.ts` → `assertCashTxnReplay` başlığı.
 * ⚠️ `currency`/`issueDate`/`postingDate` varsayılan alır → kıyaslamaya GİRMEZ.
 */
const CHEQUE_REPLAY_SELECT = {
  // ⚠️ customerId/subcontractorId KOLONU YOK — taraf `cariId` ile bağlanır.
  id: true, docNo: true, kind: true, amount: true, cariId: true,
} as const;

function assertChequeReplay(
  existing: {
    id: string; kind: ChequeKind; amount: Prisma.Decimal;
    cariId: string | null;
  },
  input: CreateChequeInput,
): void {
  assertReplayPayloadMatches(
    [
      { ad: "kind", mevcut: existing.kind, gelen: input.kind },
      { ad: "amount", mevcut: existing.amount, gelen: input.amount },
      // `cariId` YALNIZ girdide de doğrudan verilmişse kıyaslanır; müşteri/fason
      // üzerinden lazy çözülen hâlde girdi `undefined`dır ve o durumda bu alan
      // kıyaslamaya girmez (null ≡ undefined kuralı).
      { ad: "cariId", mevcut: input.cariId == null ? null : existing.cariId, gelen: input.cariId },
    ],
    "Bu istemci anahtarı FARKLI bir çek/senet için kullanılmış. Ekranı yenileyip tekrar deneyin.",
    { chequeId: existing.id },
  );
}

export class ChequeService {
  // ---------------------------------------------------------------------------
  // DOĞUŞ
  // ---------------------------------------------------------------------------

  /**
   * Çek/senet girişi (RECEIVED) ya da çıkışı (ISSUED).
   *
   * ⚠️ DOĞUŞ DURUMUNU `kind` BELİRLER (şemada `@default` YOK): sabit bir
   * varsayılan, iki yönden birini sessizce yanlış durumda doğururdu.
   */
  async create(input: CreateChequeInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const amount = D(input.amount);
    if (amount.lte(0)) throw AppError.badRequest("Tutar sıfırdan büyük olmalı.");

    if (input.clientToken) {
      const existing = await prisma.cheque.findUnique({
        where: { clientToken: input.clientToken },
        select: CHEQUE_REPLAY_SELECT,
      });
      if (existing) {
        assertChequeReplay(existing, input);
        return { success: true, data: { id: existing.id, docNo: existing.docNo }, message: "Kayıt zaten oluşturulmuş." };
      }
    }

    const kind = input.kind;
    const docType = input.docType ?? ChequeDocType.CHEQUE;
    const issueDate = input.issueDate ?? new Date();
    // İŞLEM TARİHİ — defter çıpası (SINIF 1, 2026-08-14). Kur, belge no, defter
    // `txnDate`i ve doğuş olayının tarihi DÖRDÜ DE buradan okunur; dönem kilidi
    // `writeChequeLedgerTx` içinde otomatik izler.
    const postingDate = input.postingDate ?? new Date();
    const dueDate = input.dueDate;
    const currency = input.currency ?? Currency.TRY;

    // ⚠️ `dueDate >= issueDate` DAYATILMAZ: vadesi geçmiş çek almak sektörde
    // olağandır (gecikmiş müşteri elindeki eski çeki verir) ve bunu bloklamak
    // gerçek bir tahsilatı sisteme sokulamaz yapardı.
    // ⚠️ `postingDate` ile `dueDate` arasında da KISIT YOK: ileri keşideli çek
    // BUGÜNE işlenir, vadesi gelecektedir — meşru ve olağan.

    // ⚠️ ÖN KONTROL (yukarıdaki findUnique) TEK BAŞINA YETMEZ (check-then-act):
    // aynı token'la İKİ PARALEL istek ikisi de "token yok" görür, ikisi de
    // INSERT eder ve biri `clientToken` unique'ine çarpar. O P2002 RETRY
    // EDİLMEZ — retry her turda AYNI token'ı yazacağı için 5 tur boşa döner ve
    // kullanıcı yanıltıcı "Barkod üretimi 5 denemede başarısız" 409'u alırdı.
    // Doğru cevap, çarpan tarafın İLK kaydı cached yanıt olarak dönmesidir
    // (purchase-order.create emsali; kural kaynağı `utils/p2002.ts`).
    let result: { id: string; docNo: string };
    try {
      result = await withBarcodeRetry(
        async () =>
          prisma.$transaction(async (tx) => {
            const cari = await resolveCariTx(tx, input, "Çek/senet");

        const rate =
          input.exchangeRate != null ? D(input.exchangeRate) : await resolveExchangeRateTx(tx, currency, postingDate);
        if (rate == null) {
          throw AppError.badRequest(
            `${currency} için ${postingDate.toLocaleDateString("tr-TR")} tarihli kur bulunamadı — Kurlar ekranından girin veya elle belirtin.`,
          );
        }
        if (rate.lte(0)) throw AppError.badRequest("Kur sıfır veya negatif olamaz.");

        const amountTry = amount.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const docNo = await nextChequeNo(tx, kind, docType, postingDate);
        const isReceived = kind === ChequeKind.RECEIVED;

        const cheque = await tx.cheque.create({
          data: {
            docNo,
            kind,
            docType,
            postingDate,
            status: isReceived ? ChequeStatus.PORTFOLIO : ChequeStatus.ISSUED,
            cariId: cari.id,
            currency,
            exchangeRate: rate,
            amount,
            amountTry,
            issueDate,
            dueDate,
            serialNo: input.serialNo?.trim() || null,
            bankName: input.bankName?.trim() || null,
            branchName: input.branchName?.trim() || null,
            drawerName: input.drawerName?.trim() || null,
            notes: input.notes?.trim() || null,
            createdById: userId ?? null,
            clientToken: input.clientToken ?? null,
          },
          select: { id: true, docNo: true },
        });

        // DEFTER ANI — dosya başlığındaki kilitli karar. Alınan çek müşteriyi
        // ALACAKLANDIRIR (borcu azaldı), verilen çek bizim borcumuzu azaltır.
        // Satır İŞLEM tarihine düşer (postingDate) — keşideye değil.
        await writeChequeLedgerTx(tx, {
          cariId: cari.id,
          currency,
          txnDate: postingDate,
          side: isReceived ? "credit" : "debit",
          amount,
          amountTry,
          exchangeRate: rate,
          sourceType: isReceived ? CariTxnSource.CHEQUE_RECEIVE : CariTxnSource.CHEQUE_ISSUE,
          chequeId: cheque.id,
          description: `${docNo} ${DOCTYPE_LABEL[docType]} ${isReceived ? "girişi" : "çıkışı"}${
            input.serialNo ? ` — ${input.serialNo}` : ""
          }`,
          userId,
        });

        await writeEventTx(tx, {
          chequeId: cheque.id,
          type: isReceived ? ChequeEventType.RECEIVE : ChequeEventType.ISSUE,
          fromStatus: null,
          toStatus: isReceived ? ChequeStatus.PORTFOLIO : ChequeStatus.ISSUED,
          eventDate: postingDate,
          notes: input.notes ?? null,
          userId,
        });

        return cheque;
          }),
        undefined,
        // Belge numarası yarışı (P2002 `docNo`) RETRY EDİLİR — sonraki tur taze
        // sırayı okur. `clientToken` P2002'si retry EDİLMEZ, aşağıdaki catch
        // onu cached yanıta çevirir.
        (err) => !isClientTokenP2002(err),
      );
    } catch (err) {
      // Catch tx DIŞINDA — PG'nin "aborted transaction" tuzağına girilmez
      // (purchase-order.create emsali). Cached yanıt ön kontroldekiyle AYNI
      // ŞEKİL ve AYNI MESAJ taşır: istemci, ardışık ve eşzamanlı replay'i
      // ayırt edemez (sözleşme bozulmaz).
      if (input.clientToken && isClientTokenP2002(err)) {
        const existing = await prisma.cheque.findUnique({
          where: { clientToken: input.clientToken },
          select: CHEQUE_REPLAY_SELECT,
        });
        if (existing) {
          // Ön kontrolle AYNI kapı: yarışı kaybeden istek de farklı gövdeyse 409 alır.
          assertChequeReplay(existing, input);
          return { success: true, data: { id: existing.id, docNo: existing.docNo }, message: "Kayıt zaten oluşturulmuş." };
        }
      }
      throw err;
    }

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CHEQUE",
      recordId: result.id,
      newData: { docNo: result.docNo, kind, docType, amount: amount.toString(), currency },
    });
    return { success: true, data: result, message: `${result.docNo} kaydedildi.` };
  }

  // ---------------------------------------------------------------------------
  // GEÇİŞLER
  // ---------------------------------------------------------------------------

  /**
   * Geçiş için başlığı okur ve ÖN KOŞULLARI doğrular.
   *
   * ⚠️ Bu okuma bir "kontrol et sonra güncelle" DEĞİLDİR: yalnız hangi durumun
   * tüketileceğini ve anlamlı hata mesajını belirler. Gerçek koruma
   * `claimTx`'teki atomik claim'dir — arada başka bir istek geçişi yaparsa
   * claim 0 satır günceller ve 409 döner.
   */
  private async loadForTransition(
    tx: Prisma.TransactionClient,
    id: string,
    allowedFrom: readonly ChequeStatus[],
    kind: ChequeKind | null,
    action: string,
  ): Promise<TransitionRow> {
    const row = await tx.cheque.findUnique({ where: { id }, select: TRANSITION_SELECT });
    if (!row) throw AppError.notFound("Çek/senet bulunamadı.");

    if (kind !== null && row.kind !== kind) {
      throw AppError.badRequest(
        row.kind === ChequeKind.RECEIVED
          ? `${row.docNo} ALINAN bir ${DOCTYPE_LABEL[row.docType].toLowerCase()} — "${action}" yalnız verdiğimiz çek/senet için yapılır.`
          : `${row.docNo} VERDİĞİMİZ bir ${DOCTYPE_LABEL[row.docType].toLowerCase()} — "${action}" yalnız aldığımız çek/senet için yapılır.`,
      );
    }

    if (!allowedFrom.includes(row.status)) {
      // Terminal ile "sırası değil" ayrı mesajlar: ilki geri dönüşü olmayan bir
      // durumu, ikincisi eksik bir adımı anlatır. Tek mesaj kullanıcıyı yanlış
      // yöne (destek çağırmaya) gönderirdi.
      const isTerminal = TERMINAL_STATUSES.includes(row.status);
      const hint = REVERSAL_HINT[row.status];
      const hintText = hint ? ` Kayıt HATALIYSA önce ${hint} yapın.` : "";
      throw AppError.conflict(
        isTerminal
          ? `${row.docNo} zaten ${CHEQUE_STATUS_LABEL[row.status]} — bu kayıt kapanmıştır, "${action}" yapılamaz.${hintText}`
          : `${row.docNo} şu an ${CHEQUE_STATUS_LABEL[row.status]}; "${action}" bu durumda yapılamaz.${hintText}`,
      );
    }
    return row;
  }

  /**
   * ATOMİK CLAIM — beklenen durumu bir kez tüketir.
   *
   * ⚠️ `findUnique → if → update` YASAK: iki eşzamanlı "tahsil et" isteği banka
   * bakiyesini İKİ KEZ artırırdı ve fark hiçbir yerde log'lanmazdı. `updateMany`
   * WHERE'i durumu da içerdiği için ikinci istek 0 satır günceller.
   *
   * ⚠️ `requireUnallocated` (SINIF 4 — çift yönlü CAS'ın geçiş tarafı): yalnız
   * PARA-YOK-EDEN üç geçiş (bounce · iade · iptal) ister — kapama sayacını da
   * kendi atomik WHERE'ine koyar (`allocatedTotal: 0`). Ön yoldaki
   * `assertNotAllocated` bir HIZLI-YOL kontrolüdür (UX: mesaj claim'e gelmeden
   * verilir) ama kilitsiz `findUnique` üzerinden koşar; `allocate` ile yarışta
   * kapama, kontrol ile claim ARASINDA doğabilir ve eski WHERE onu görmezdi —
   * sonuç "kapalı görünen ama parası yok olmuş fatura" olurdu. DİĞER geçişler
   * bunu KULLANMAZ: kapamalı çekin tahsili MEŞRUDUR (müşterinin ödemesi
   * gerçekleşiyor), blanket eklemek onu 409'a düşürürdü. Üçüncü katman DB
   * CHECK'idir (`cheques_terminal_not_allocated`) — uygulama yüklemi bir gün
   * atlanırsa satırın kendisi direnir.
   */
  private async claimTx(
    tx: Prisma.TransactionClient,
    row: TransitionRow,
    to: ChequeStatus,
    extra: Prisma.ChequeUncheckedUpdateManyInput = {},
    requireUnallocated?: { action: string },
  ): Promise<void> {
    const claimed = await tx.cheque.updateMany({
      where: {
        id: row.id,
        status: row.status,
        ...(requireUnallocated ? { allocatedTotal: 0 } : {}),
      },
      data: { status: to, ...extra },
    });
    if (claimed.count === 0) {
      if (requireUnallocated) {
        // Tanı tx İÇİNDE taze okumayla: claim'i düşüren DURUM mu, KAPAMA mı?
        // Durum hâlâ beklenense düşüren kapamadır (yarışta doğdu) — mesaj
        // `assertNotAllocated`'ın "kapamayı kaldırın" cümlesi, TAZE tutarla.
        const fresh = await tx.cheque.findUnique({ where: { id: row.id }, select: TRANSITION_SELECT });
        if (fresh && fresh.status === row.status) {
          this.assertNotAllocated(fresh, requireUnallocated.action);
        }
      }
      throw AppError.conflict(
        `${row.docNo} bu sırada başka bir kullanıcı tarafından güncellendi. Ekranı yenileyip tekrar deneyin.`,
      );
    }
  }

  /**
   * Faturaya kapatılmış çekin defter etkisini geri almadan önceki kapı.
   *
   * ⚠️ FAIL-CLOSED. Kapama satırı dururken çeki karşılıksıza/iptale çekmek
   * "kapalı görünen ama parası yok olmuş fatura" üretirdi — yaşlandırma
   * raporunun sessizce yalan söylediği tek senaryo budur. C2 (PaymentAllocation)
   * kapamayı OTOMATİK çözmeyi getirdiğinde bu kapı o çözümle DEĞİŞTİRİLİR;
   * o güne kadar kullanıcıya somut iş adımını söyleyerek durur.
   */
  private assertNotAllocated(row: TransitionRow, action: string): void {
    if (D(row.allocatedTotal).gt(0)) {
      throw AppError.conflict(
        `${row.docNo} ${row.allocatedTotal} ${row.currency} tutarında faturaya kapatılmış — "${action}" öncesinde kapamayı kaldırın.`,
      );
    }
  }

  /**
   * TAHSİLE / TEMİNATA VERME — portföyden bankaya.
   *
   * ⚠️ PARA HAREKETİ YOK ve bu bilinçlidir: çek bankaya verildiğinde henüz
   * tahsil edilmemiştir. Bakiyeyi burada artırmak, vadesi gelmemiş çeki nakit
   * saymak olurdu (ve karşılıksız çıkarsa banka bakiyesi geriye düzeltilirdi).
   */
  async deposit(
    id: string,
    input: { bankAccountId: string } & ChequeEventInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO],
        ChequeKind.RECEIVED,
        "bankaya verme",
      );
      await loadAccountTx(tx, { bankAccountId: input.bankAccountId }, row.currency);
      await this.claimTx(tx, row, ChequeStatus.AT_BANK, { bankAccountId: input.bankAccountId });
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.DEPOSIT,
        fromStatus: row.status,
        toStatus: ChequeStatus.AT_BANK,
        eventDate,
        bankAccountId: input.bankAccountId,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "DEPOSIT", docNo: result.docNo, bankAccountId: input.bankAccountId },
    });
    return { success: true, data: result, message: `${result.docNo} bankaya verildi.` };
  }

  /**
   * TAHSİL — para hesaba geçti.
   *
   * ⚠️ CARİ DEFTERE SATIR YAZILMAZ. Müşterinin borcu çek ALINDIĞINDA kapandı;
   * burada ikinci bir alacak satırı yazmak aynı tahsilatı İKİ KEZ sayardı ve
   * cari bakiyesi tam tutar kadar eksi tarafa kayardı.
   *
   * Elden tahsil de meşrudur (kasa) — o yüzden hesap kasa VEYA banka.
   */
  async collect(
    id: string,
    input: ChequeAccountEventInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK],
        ChequeKind.RECEIVED,
        "tahsil",
      );
      const ref: AccountRef = { cashBoxId: input.cashBoxId ?? null, bankAccountId: input.bankAccountId ?? null };
      await loadAccountTx(tx, ref, row.currency);

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1): tahsil, hesap bakiyesinin ÜÇÜNCÜ
      // yazarıdır (Payment · CashTransaction · burası) ve `eventDate` geçmişe
      // girilebilir — kapalı kasa sayfasına para akıtmak yasak.
      await assertCashPeriodOpenTx(tx, { ...ref, txnDate: eventDate });

      await this.claimTx(tx, row, ChequeStatus.COLLECTED, {
        // Tahsil bankadan olduysa hesabı başlığa da yaz — portföy listesi
        // "hangi hesaba girdi" sorusunu satırdan cevaplayabilsin.
        ...(ref.bankAccountId ? { bankAccountId: ref.bankAccountId } : {}),
      });

      await moveAccountBalanceTx(tx, ref, D(row.amount));

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.COLLECT,
        fromStatus: row.status,
        toStatus: ChequeStatus.COLLECTED,
        eventDate,
        bankAccountId: ref.bankAccountId,
        cashBoxId: ref.cashBoxId,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo, amount: row.amount.toString(), currency: row.currency };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "COLLECT", docNo: result.docNo, amount: result.amount },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} tahsil edildi.`,
    };
  }

  /**
   * TAHSİL STORNOSU (K-2) — yanlış COLLECT işaretlenen çek geri açılır.
   *
   * ⚠️ TERMİNALDEN TEK MEŞRU ÇIKIŞ budur ve TİPLİDİR (`COLLECT_CANCEL`):
   * para AYNI hesaptan ters hareketle geri çekilir, durum COLLECT olayının
   * tükettiği duruma (`fromStatus`: PORTFOLIO ya da AT_BANK) döner, olay
   * defterine sebep zorunlu satır yazılır. Sonrasında çek yeniden tahsil
   * edilebilir ya da gerçekte olan neyse (karşılıksız / iade) o kaydedilir.
   *
   * ⚠️ CARİ DEFTERE DOKUNULMAZ: COLLECT cari yazmıyordu (dosya başındaki
   * tablo), tersi de yazmaz. KAPAMALARA DA DOKUNULMAZ: tahsil stornosu çekin
   * varlığını yok etmez, faturaya kapama meşru kalır (DB CHECK'i de izin
   * verir — PORTFOLIO/AT_BANK terminal-parasız durum değildir).
   *
   * ⚠️ HESAP PASİFLEŞMİŞ OLSA DA GEÇER — `loadAccountTx` BİLEREK çağrılmaz:
   * aktiflik kontrolü YENİ para kabulünü kapılar; var olan yanlış parayı geri
   * çekmeyi kapılamaz (para gerçeği ekran kuralından önce gelir).
   */
  async cancelCollect(
    id: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    if (!reason?.trim()) {
      throw AppError.badRequest("Tahsil stornosu için sebep zorunludur — para hareketi geri alınıyor.");
    }
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.COLLECTED],
        ChequeKind.RECEIVED,
        "tahsil stornosu",
      );

      // Hesap ve önceki durum COLLECT olayından okunur (başlık `bankAccountId`
      // kasadan tahsili hiç taşımaz). EN YENİ COLLECT alınır: olay defteri
      // append-only olduğu için storno + yeniden tahsil zincirinde birden çok
      // COLLECT satırı meşrudur.
      // ⚠️ SIRALAMA `createdAt` — `eventDate` DEĞİL: eventDate KULLANICI
      // girdisidir ve geriye tarihlenebilir ("dün tahsil ettim, bugün
      // giriyorum"). eventDate ile sıralansaydı storno + GERİYE TARİHLİ
      // yeniden tahsil zincirinde en yeni satır İLK tahsil sanılır ve para
      // YANLIŞ hesaptan geri çekilirdi (bekçi §19n bunu kilitler). Zincirin
      // gerçek sırası append-only defterin yazım sırasıdır = `createdAt`.
      const collectEvent = await tx.chequeEvent.findFirst({
        where: { chequeId: row.id, type: ChequeEventType.COLLECT },
        orderBy: { createdAt: "desc" },
        select: { fromStatus: true, cashBoxId: true, bankAccountId: true },
      });
      if (!collectEvent || (!collectEvent.cashBoxId && !collectEvent.bankAccountId)) {
        // FAIL-CLOSED: parayı NEREDEN geri çekeceğimizi bilmeden storno yapmak
        // bir bakiyeyi körlemesine oynatmak olurdu.
        throw AppError.conflict(
          `${row.docNo} tahsil edilmiş görünüyor ama tahsil olayının hesap kaydı bulunamadı — storno otomatik yapılamaz, kaydı süpervizörle inceleyin.`,
        );
      }
      const backTo = collectEvent.fromStatus ?? ChequeStatus.PORTFOLIO;

      // Başlık hesabı geri kurulur: PORTFOLIO'ya dönüşte tahsilin damgaladığı
      // banka SİLİNİR (tahsil öncesi başlıkta banka yoktu); AT_BANK'a dönüşte
      // "hangi bankada" sorusunun cevabı DEPOSIT olayından geri okunur — tahsil
      // farklı bir hesaba yapılmış olabilir.
      let headerBankId: string | null = null;
      if (backTo === ChequeStatus.AT_BANK) {
        // `createdAt desc` — COLLECT aramasıyla AYNI gerekçe: DEPOSIT'in
        // eventDate'i de kullanıcı girdisidir, kronoloji çıpası yazım sırasıdır.
        const depositEvent = await tx.chequeEvent.findFirst({
          where: { chequeId: row.id, type: ChequeEventType.DEPOSIT },
          orderBy: { createdAt: "desc" },
          select: { bankAccountId: true },
        });
        headerBankId = depositEvent?.bankAccountId ?? collectEvent.bankAccountId;
      }

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1) — çıpa `now` (storno sözleşmesi):
      // olay defteri append-only olduğu için ters satır BUGÜNE düşer ve kapalı
      // kasa sayfası DEĞİŞMEZ; guard yine de sorulur ("pratikte düşmez" bir
      // invariant değildir — bugünün de kapalı olabileceği teorik köşe dahil).
      await assertCashPeriodOpenTx(tx, {
        cashBoxId: collectEvent.cashBoxId,
        bankAccountId: collectEvent.bankAccountId,
        txnDate: now,
      });

      // Atomik claim {id, status: COLLECTED} — iki eşzamanlı storno isteğinden
      // yalnız biri geçer; ikincisi 409 alır (para İKİ KEZ geri çekilmez).
      await this.claimTx(tx, row, backTo, { bankAccountId: headerBankId });

      const ref: AccountRef = { cashBoxId: collectEvent.cashBoxId, bankAccountId: collectEvent.bankAccountId };
      await moveAccountBalanceTx(tx, ref, D(row.amount).negated());

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.COLLECT_CANCEL,
        fromStatus: ChequeStatus.COLLECTED,
        toStatus: backTo,
        eventDate: now,
        bankAccountId: collectEvent.bankAccountId,
        cashBoxId: collectEvent.cashBoxId,
        notes: reason,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "COLLECT_CANCEL", docNo: result.docNo, reason },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} tahsil stornosu yapıldı — para hesaptan geri çekildi, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * CİRO — aldığımız çeki borcumuza karşılık başkasına devrederiz.
   *
   * ⚠️ TEK OLAY, İKİ CARİ. Çeki VEREN cariye burada DOKUNULMAZ (onun borcu
   * çek alındığında kapandı); satır CİRO EDİLEN cariye yazılır: ona olan
   * borcumuz azaldı → BORÇ. İkinci bir satırı ilk cariye yazmak, aynı çeki iki
   * kez tahsil etmiş gibi görünmek olurdu.
   */
  async endorse(
    id: string,
    input: EndorseInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK],
        ChequeKind.RECEIVED,
        "ciro",
      );
      const target = await resolveCariTx(
        tx,
        { cariId: input.toCariId, customerId: input.toCustomerId, subcontractorId: input.toSubcontractorId },
        "Ciro edilen taraf",
      );
      if (target.id === row.cariId) {
        // Çeki veren kişiye geri vermek CİRO değil İADEdir; defter etkisi de
        // terstir (ciro üçüncü tarafa borç kapatır, iade alacağı geri açar).
        throw AppError.badRequest(
          `${row.docNo} çeki veren cariye geri veriliyorsa bu bir ciro değil İADE'dir — "Sahibine İade" işlemini kullanın.`,
        );
      }

      await this.claimTx(tx, row, ChequeStatus.ENDORSED, { endorsedToCariId: target.id });

      await writeChequeLedgerTx(tx, {
        cariId: target.id,
        currency: row.currency,
        txnDate: eventDate,
        side: "debit",
        amount: D(row.amount),
        amountTry: D(row.amountTry),
        exchangeRate: D(row.exchangeRate),
        sourceType: CariTxnSource.CHEQUE_ENDORSE,
        chequeId: row.id,
        description: `${row.docNo} ciro`,
        userId,
      });

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.ENDORSE,
        fromStatus: row.status,
        toStatus: ChequeStatus.ENDORSED,
        eventDate,
        counterCariId: target.id,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "ENDORSE", docNo: result.docNo },
    });
    return { success: true, data: result, message: `${result.docNo} ciro edildi.` };
  }

  /**
   * CİRO STORNOSU — yanlış girilen ciro geri alınır; `cancel()` genişletilmedi
   * çünkü ciro gerçek bir ticari olaydır ve "hiç olmamış" sayılamaz.
   *
   * ⚠️ `endorsedToCariId` null'a döner: o alan damga değil "çek şu an kimde"
   * işaretçisidir. Ciro gerçeği defterde kalır — ENDORSE ve ENDORSE_CANCEL
   * satırlarının ikisi de `counterCariId` taşır.
   */
  async cancelEndorse(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const why = requireReversalReason(reason, "Ciro stornosu");
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.ENDORSED], ChequeKind.RECEIVED, "ciro stornosu");
      if (!row.endorsedToCariId) {
        throw AppError.conflict(`${row.docNo} ciro edilmiş görünüyor ama ciro carisi yok — kaydı süpervizörle inceleyin.`);
      }
      const endorsee = row.endorsedToCariId;
      const event = await loadForwardEventTx(tx, row, ChequeEventType.ENDORSE, "ciro stornosu");
      const original = await loadReversibleTxnTx(
        tx, row, { sourceType: CariTxnSource.CHEQUE_ENDORSE, cariId: endorsee, side: "debit" }, "ciro stornosu",
      );

      await this.claimTx(tx, row, event.fromStatus, { endorsedToCariId: null });
      await writeChequeReversalTx(tx, original, {
        sourceType: CariTxnSource.CHEQUE_ENDORSE_CANCEL,
        chequeId: row.id,
        txnDate: now,
        description: `${row.docNo} ciro stornosu — ${why}`,
        userId,
      });
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.ENDORSE_CANCEL,
        fromStatus: ChequeStatus.ENDORSED,
        toStatus: event.fromStatus,
        eventDate: now,
        counterCariId: endorsee,
        notes: why,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo: event.fromStatus };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "ENDORSE_CANCEL", docNo: result.docNo, reason: why },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} ciro stornosu yapıldı — ciro carisine ters kayıt yazıldı, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * KARŞILIKSIZ — alışın kapattığı alacak geri açılır; kayıt yanlışsa `cancelBounce`.
   *
   * ⚠️ İKİ CARİ BİRDEN etkilenebilir: çeki veren müşterinin borcu geri doğar
   * (DEBIT) ve çek CİRO EDİLMİŞSE ciro ettiğimiz cariye olan borcumuz da geri
   * doğar (ters CREDIT) — çünkü onun eline geçen çek ödenmedi. İkincisi
   * atlanırsa tedarikçiye borcumuz sistemde kapanmış görünür ve fark ancak
   * mutabakat toplantısında ortaya çıkar.
   *
   * ⚠️ PARA HAREKETİ YOK: karşılıksız çek hiç tahsil edilmedi (tahsil edilmiş
   * olsaydı durumu COLLECTED = terminal olurdu).
   */
  async bounce(
    id: string,
    input: ChequeEventInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK, ChequeStatus.ENDORSED],
        ChequeKind.RECEIVED,
        "karşılıksız kaydı",
      );
      // HIZLI-YOL (UX): kapama varsa mesaj claim'e gelmeden verilir. Gerçek
      // koruma claim'in `requireUnallocated` yüklemidir — bu kontrol kilitsizdir.
      this.assertNotAllocated(row, "karşılıksız kaydı");

      const cameFromEndorsed = row.status === ChequeStatus.ENDORSED;
      await this.claimTx(tx, row, ChequeStatus.BOUNCED, {}, { action: "karşılıksız kaydı" });

      // SINIF 3 — ÇOK CARİLİ tek olay: iki dönem kilidi DETERMİNİSTİK sırayla
      // ÖNDEN alınır (`assertPeriodsOpenTx` anahtara göre sıralar). Ayna-ciro
      // çiftinde (A'nın çeki B'ye, B'ninki A'ya ciro edilmiş; ikisi aynı anda
      // karşılıksız) iki tx kilitleri TERS sırada isteyip PG deadlock'una
      // (40P01 → anlamsız 500) düşüyordu — canlı sondayla üretildi. İçteki
      // tekil guard'lar AYNEN kalır: advisory xact kilidin yeniden-alımı bedava
      // ve "satır yazan nokta guard taşır" kapsama garantisi bozulmaz.
      if (cameFromEndorsed && row.endorsedToCariId) {
        await assertPeriodsOpenTx(tx, [
          { cariId: row.cariId, currency: row.currency, txnDate: eventDate },
          { cariId: row.endorsedToCariId, currency: row.currency, txnDate: eventDate },
        ]);
      }

      await writeChequeLedgerTx(tx, {
        cariId: row.cariId,
        currency: row.currency,
        txnDate: eventDate,
        side: "debit",
        amount: D(row.amount),
        amountTry: D(row.amountTry),
        exchangeRate: D(row.exchangeRate),
        sourceType: CariTxnSource.CHEQUE_BOUNCE,
        chequeId: row.id,
        description: `${row.docNo} KARŞILIKSIZ${input.notes ? ` — ${input.notes}` : ""}`,
        userId,
      });

      if (cameFromEndorsed && row.endorsedToCariId) {
        await writeChequeLedgerTx(tx, {
          cariId: row.endorsedToCariId,
          currency: row.currency,
          txnDate: eventDate,
          side: "credit",
          amount: D(row.amount),
          amountTry: D(row.amountTry),
          exchangeRate: D(row.exchangeRate),
          sourceType: CariTxnSource.CHEQUE_BOUNCE,
          chequeId: row.id,
          description: `${row.docNo} KARŞILIKSIZ — ciro geri alındı`,
          userId,
        });
      }

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.BOUNCE,
        fromStatus: row.status,
        toStatus: ChequeStatus.BOUNCED,
        eventDate,
        counterCariId: cameFromEndorsed ? row.endorsedToCariId : null,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "BOUNCE", docNo: result.docNo },
    });
    return {
      success: true,
      data: result,
      message: `${result.docNo} karşılıksız olarak kaydedildi ve defter ters kayıtla geri alındı.`,
    };
  }

  /**
   * KARŞILIKSIZ STORNOSU — yanlış girilen karşılıksız kaydı geri alınır.
   *
   * BOUNCE'un yazdığı her cari satır tersiyle kapanır (ciro edilmişse iki cari)
   * ve durum BOUNCE'un tükettiği duruma döner. Kapama kontrolü gerekmez:
   * BOUNCED çekte kapama DB CHECK'iyle zaten sıfırdır.
   */
  async cancelBounce(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const why = requireReversalReason(reason, "Karşılıksız stornosu");
    const now = new Date();
    const label = "karşılıksız stornosu";
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.BOUNCED], ChequeKind.RECEIVED, label);
      const event = await loadForwardEventTx(tx, row, ChequeEventType.BOUNCE, label);
      const endorsee = event.fromStatus === ChequeStatus.ENDORSED ? row.endorsedToCariId : null;
      if (event.fromStatus === ChequeStatus.ENDORSED && !endorsee) {
        throw AppError.conflict(`${row.docNo} cirodan karşılıksız dönmüş ama ciro carisi yok — kaydı süpervizörle inceleyin.`);
      }
      const drawerTxn = await loadReversibleTxnTx(
        tx, row, { sourceType: CariTxnSource.CHEQUE_BOUNCE, cariId: row.cariId, side: "debit" }, label,
      );
      const endorseeTxn = endorsee
        ? await loadReversibleTxnTx(tx, row, { sourceType: CariTxnSource.CHEQUE_BOUNCE, cariId: endorsee, side: "credit" }, label)
        : null;

      await this.claimTx(tx, row, event.fromStatus);
      // SINIF 3 — iki cari varsa dönem kilitleri deterministik sırayla ÖNDEN (bounce ile aynı).
      if (endorsee) {
        await assertPeriodsOpenTx(tx, [
          { cariId: row.cariId, currency: row.currency, txnDate: now },
          { cariId: endorsee, currency: row.currency, txnDate: now },
        ]);
      }
      const base = { sourceType: CariTxnSource.CHEQUE_BOUNCE_CANCEL, chequeId: row.id, txnDate: now, userId };
      await writeChequeReversalTx(tx, drawerTxn, { ...base, description: `${row.docNo} karşılıksız stornosu — ${why}` });
      if (endorseeTxn) {
        await writeChequeReversalTx(tx, endorseeTxn, { ...base, description: `${row.docNo} karşılıksız stornosu — ciro borcu geri kapandı` });
      }
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.BOUNCE_CANCEL,
        fromStatus: ChequeStatus.BOUNCED,
        toStatus: event.fromStatus,
        eventDate: now,
        counterCariId: endorsee,
        notes: why,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo: event.fromStatus };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "BOUNCE_CANCEL", docNo: result.docNo, reason: why },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} karşılıksız stornosu yapıldı — cari satırları ters kayıtla kapandı, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * SAHİBİNE İADE — çek geri verildi (müşteri nakit ödedi ve çekini geri istedi,
   * ya da verdiğimiz çeki tedarikçi bize geri verdi).
   *
   * ⚠️ Bu bir HATA STORNOSU DEĞİLDİR — gerçek bir ticari olaydır; ama defter
   * etkisi aynıdır: çekin doğuşta yazdığı satır ters çevrilir. Kaynak
   * `CHEQUE_CANCEL` olarak yazılır çünkü `CariTxnSource`'ta "çekin defter
   * etkisinin geri alınması" için ayrı bir değer yok ve `CHEQUE_BOUNCE`
   * kullanmak karşılıksız çek raporunu kirletirdi (iade karşılıksızlık değildir).
   * Ayrımı `ChequeEvent.type = RETURN` taşır.
   */
  async returnToDrawer(
    id: string,
    input: ChequeEventInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK, ChequeStatus.ISSUED],
        null,
        "iade",
      );
      // HIZLI-YOL (UX) — gerçek koruma claim'in `requireUnallocated` yüklemi.
      this.assertNotAllocated(row, "iade");
      const isReceived = row.kind === ChequeKind.RECEIVED;

      await this.claimTx(tx, row, ChequeStatus.RETURNED, {}, { action: "iade" });

      // Doğuşun TERSİ: alınan çek CREDIT yazmıştı → iade DEBIT; verilen çek
      // DEBIT yazmıştı → iade CREDIT.
      await writeChequeLedgerTx(tx, {
        cariId: row.cariId,
        currency: row.currency,
        txnDate: eventDate,
        side: isReceived ? "debit" : "credit",
        amount: D(row.amount),
        amountTry: D(row.amountTry),
        exchangeRate: D(row.exchangeRate),
        sourceType: CariTxnSource.CHEQUE_CANCEL,
        chequeId: row.id,
        description: `${row.docNo} İADE${input.notes ? ` — ${input.notes}` : ""}`,
        userId,
      });

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.RETURN,
        fromStatus: row.status,
        toStatus: ChequeStatus.RETURNED,
        eventDate,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "RETURN", docNo: result.docNo },
    });
    return { success: true, data: result, message: `${result.docNo} iade edildi ve defter geri alındı.` };
  }

  /**
   * İADE STORNOSU — yanlış girilen iade geri alınır (alınan ve verilen çekte).
   * RETURN'ün `CHEQUE_CANCEL` satırı tersiyle kapanır, durum RETURN'ün tükettiği
   * duruma döner. BOUNCED gibi RETURNED'da da kapama DB CHECK'iyle sıfırdır.
   */
  async cancelReturn(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const why = requireReversalReason(reason, "İade stornosu");
    const now = new Date();
    const label = "iade stornosu";
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.RETURNED], null, label);
      const event = await loadForwardEventTx(tx, row, ChequeEventType.RETURN, label);
      // İade doğuşu tersine çevirmişti: alınan çekte BORÇ, verilen çekte ALACAK.
      const side = row.kind === ChequeKind.RECEIVED ? "debit" : "credit";
      const original = await loadReversibleTxnTx(
        tx, row, { sourceType: CariTxnSource.CHEQUE_CANCEL, cariId: row.cariId, side }, label,
      );

      await this.claimTx(tx, row, event.fromStatus);
      await writeChequeReversalTx(tx, original, {
        sourceType: CariTxnSource.CHEQUE_RETURN_CANCEL,
        chequeId: row.id,
        txnDate: now,
        description: `${row.docNo} iade stornosu — ${why}`,
        userId,
      });
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.RETURN_CANCEL,
        fromStatus: ChequeStatus.RETURNED,
        toStatus: event.fromStatus,
        eventDate: now,
        notes: why,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo: event.fromStatus };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "RETURN_CANCEL", docNo: result.docNo, reason: why },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} iade stornosu yapıldı — cari satırı ters kayıtla kapandı, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * KENDİ ÇEKİMİZ ÖDENDİ — banka/kasa −amount.
   *
   * ⚠️ CARİ DEFTERE SATIR YAZILMAZ: borcumuz çeki VERDİĞİMİZDE kapandı. Burada
   * ikinci bir borç satırı yazmak, aynı ödemeyi iki kez saymak olurdu.
   *
   * ⚠️ "Kendi çekimizin karşılıksız çıkması" diye bir GEÇİŞ YOK ve bu bilinçli:
   * banka ödemediyse çek hâlâ ödenmemiştir, yani doğru kayıt `ISSUED` durumunda
   * BEKLEMEKTİR. Ayrı bir durum eklemek, portföyde anlamı olmayan bir kova açardı.
   */
  async pay(
    id: string,
    input: ChequeAccountEventInput,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const eventDate = input.eventDate ?? new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.ISSUED], ChequeKind.ISSUED, "ödeme");
      const ref: AccountRef = { cashBoxId: input.cashBoxId ?? null, bankAccountId: input.bankAccountId ?? null };
      await loadAccountTx(tx, ref, row.currency);

      // ⚠️ KASA/BANKA DÖNEM KİLİDİ (K-1) — collect ile aynı gerekçe: para
      // hesaptan ÇIKAR ve `eventDate` geçmişe girilebilir.
      await assertCashPeriodOpenTx(tx, { ...ref, txnDate: eventDate });

      await this.claimTx(tx, row, ChequeStatus.PAID, {
        ...(ref.bankAccountId ? { bankAccountId: ref.bankAccountId } : {}),
      });

      // ⚠️ EKSİ KASA ENGELİ (finance.blockNegativeCashEnabled, default KAPALI):
      // İLERİ yolların dördüncüsü — kendi çekimiz KASADAN ödeniyorsa bakiye
      // eksiye düşemez; banka MUAF (helper süzer). `collect` (para GİRER) ve
      // `cancelCollect` (STORNO — para gerçeği ekran kuralından önce gelir)
      // BİLEREK guard'sız. Guard FOR UPDATE ile okur; decrement aynı tx'te.
      await assertCashBalanceCoversTx(tx, { cashBoxId: ref.cashBoxId, amount: D(row.amount) });

      await moveAccountBalanceTx(tx, ref, D(row.amount).negated());

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.PAY,
        fromStatus: row.status,
        toStatus: ChequeStatus.PAID,
        eventDate,
        bankAccountId: ref.bankAccountId,
        cashBoxId: ref.cashBoxId,
        notes: input.notes ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "PAY", docNo: result.docNo },
    });
    return { success: true, data: result, message: `${result.docNo} ödendi.` };
  }

  /**
   * ÖDEME STORNOSU — yanlış PAY geri alınır: para AYNI hesaba geri girer.
   *
   * ⚠️ CARİ DEFTERE DOKUNULMAZ: `pay()` `writeChequeLedgerTx` çağırmaz (borç
   * doğuşta `CHEQUE_ISSUE` ile kapandı), tersi de çağırmaz. Hesap pasifleşmiş
   * olsa da geçer ve eksi kasa guard'ı sorulmaz — para GİRİYOR (cancelCollect emsali).
   */
  async cancelPay(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const why = requireReversalReason(reason, "Ödeme stornosu");
    const now = new Date();
    const label = "ödeme stornosu";
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.PAID], ChequeKind.ISSUED, label);
      const event = await loadForwardEventTx(tx, row, ChequeEventType.PAY, label);
      if (!event.cashBoxId && !event.bankAccountId) {
        throw AppError.conflict(`${row.docNo} ödeme olayının hesap kaydı yok — ${label} otomatik yapılamaz, kaydı süpervizörle inceleyin.`);
      }
      const ref: AccountRef = { cashBoxId: event.cashBoxId, bankAccountId: event.bankAccountId };

      // Ters hareket BUGÜNE düşer — kapalı kasa sayfası değişmez, guard bugünü sorar.
      await assertCashPeriodOpenTx(tx, { ...ref, txnDate: now });
      // Verilen çekin başlık bankası yalnız PAY'den doğar; PAY öncesi boştu.
      await this.claimTx(tx, row, event.fromStatus, { bankAccountId: null });
      await moveAccountBalanceTx(tx, ref, D(row.amount));
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.PAY_CANCEL,
        fromStatus: ChequeStatus.PAID,
        toStatus: event.fromStatus,
        eventDate: now,
        bankAccountId: ref.bankAccountId,
        cashBoxId: ref.cashBoxId,
        notes: why,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo: event.fromStatus };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "PAY_CANCEL", docNo: result.docNo, reason: why },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} ödeme stornosu yapıldı — para hesaba geri girdi, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * BANKAYA VERME STORNOSU — yanlış bankaya verilen çek tahsil edilmeden portföye döner.
   *
   * Beş kardeşiyle aynı kalıp (tipli olay, ileri satır silinmez, ters kayıt bugüne, durum
   * DEPOSIT'in `fromStatus`una, atomik claim ikinci stornoyu keser). Farkı: DEPOSIT para
   * oynatmamıştı ⇒ bakiye DEĞİŞMEZ, `assertCashPeriodOpenTx`/8028 kilidi ÇAĞRILMAZ. Başlık
   * bankası DEPOSIT'te doğmuştu, düşer. Tahsil edilmiş çekte 409 bu metottan değil
   * claim'den doğar (COLLECT → COLLECTED); COLLECT_CANCEL ile AT_BANK'a dönen çek için
   * en yeni DEPOSIT olayı okunur ve storno MEŞRUDUR.
   */
  async cancelDeposit(id: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const why = requireReversalReason(reason, "Bankaya verme stornosu");
    const now = new Date();
    const label = "bankaya verme stornosu";
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(tx, id, [ChequeStatus.AT_BANK], ChequeKind.RECEIVED, label);
      const event = await loadForwardEventTx(tx, row, ChequeEventType.DEPOSIT, label);
      await this.claimTx(tx, row, event.fromStatus, { bankAccountId: null });
      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.DEPOSIT_CANCEL,
        fromStatus: ChequeStatus.AT_BANK,
        toStatus: event.fromStatus,
        eventDate: now,
        // Hangi bankadan geri alındığı defterde kalsın — başlıktan silindi.
        bankAccountId: event.bankAccountId,
        notes: why,
        userId,
      });
      return { id: row.id, docNo: row.docNo, backTo: event.fromStatus };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "DEPOSIT_CANCEL", docNo: result.docNo, reason: why },
    });
    return {
      success: true,
      data: { id: result.id, docNo: result.docNo },
      message: `${result.docNo} bankaya verme stornosu yapıldı — para oynamadı, çek ${CHEQUE_STATUS_LABEL[result.backTo]} durumuna döndü.`,
    };
  }

  /**
   * KAYIT HATASI STORNOSU — çek hiç var olmamış gibi defter geri alınır.
   *
   * ⚠️ SATIR SİLİNMEZ (fiziksel DELETE yok): iptal edilmiş çek portföyde
   * "İPTAL" olarak durur; kayıt hatasının kendisi de denetimde görülmelidir.
   *
   * ⚠️ CİRO EDİLMİŞ çek iptal EDİLEMEZ: kâğıt fiziksel olarak üçüncü tarafın
   * elindedir ve "hiç olmamış" sayılamaz. Ciro kaydı yanlışsa `cancelEndorse`,
   * doğruysa karşılıksız kaydı.
   */
  async cancel(
    id: string,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; docNo: string }>> {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await this.loadForTransition(
        tx,
        id,
        [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK, ChequeStatus.ISSUED],
        null,
        "iptal",
      );
      // HIZLI-YOL (UX) — gerçek koruma claim'in `requireUnallocated` yüklemi.
      this.assertNotAllocated(row, "iptal");
      const isReceived = row.kind === ChequeKind.RECEIVED;

      await this.claimTx(
        tx,
        row,
        ChequeStatus.CANCELLED,
        {
          cancelledAt: now,
          cancelledById: userId ?? null,
          cancelReason: reason ?? null,
        },
        { action: "iptal" },
      );

      await writeChequeLedgerTx(tx, {
        cariId: row.cariId,
        currency: row.currency,
        txnDate: now,
        side: isReceived ? "debit" : "credit",
        amount: D(row.amount),
        amountTry: D(row.amountTry),
        exchangeRate: D(row.exchangeRate),
        sourceType: CariTxnSource.CHEQUE_CANCEL,
        chequeId: row.id,
        description: `${row.docNo} İPTAL${reason ? ` — ${reason}` : ""}`,
        userId,
      });

      await writeEventTx(tx, {
        chequeId: row.id,
        type: ChequeEventType.CANCEL,
        fromStatus: row.status,
        toStatus: ChequeStatus.CANCELLED,
        eventDate: now,
        notes: reason ?? null,
        userId,
      });
      return { id: row.id, docNo: row.docNo };
    });

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CHEQUE",
      recordId: id,
      newData: { event: "CANCEL", docNo: result.docNo, reason },
    });
    return { success: true, data: result, message: `${result.docNo} iptal edildi ve ters kayıtla geri alındı.` };
  }

  // ---------------------------------------------------------------------------
  // OKUMA
  // ---------------------------------------------------------------------------

  async list(params: {
    page?: number;
    pageSize?: number;
    kind?: ChequeKind;
    docType?: ChequeDocType;
    status?: ChequeStatus[];
    cariId?: string;
    currency?: Currency;
    bankAccountId?: string;
    dueFrom?: Date;
    dueTo?: Date;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const where: Prisma.ChequeWhereInput = {};
    if (params.kind) where.kind = params.kind;
    if (params.docType) where.docType = params.docType;
    if (params.status?.length) where.status = { in: params.status };
    if (params.currency) where.currency = params.currency;
    if (params.bankAccountId) where.bankAccountId = params.bankAccountId;
    // ⚠️ Cari süzgeci CİRO EDİLENİ DE kapsar: "bu firmanın çeki" sorusu hem
    // "ondan aldıklarım" hem "ona ciro ettiklerim" anlamına gelir ve ikincisini
    // dışarıda bırakmak, ciro edilmiş çeki hiçbir cari ekranında göstermezdi.
    if (params.cariId) where.OR = [{ cariId: params.cariId }, { endorsedToCariId: params.cariId }];
    if (params.dueFrom || params.dueTo) {
      where.dueDate = {
        ...(params.dueFrom ? { gte: params.dueFrom } : {}),
        ...(params.dueTo ? { lte: params.dueTo } : {}),
      };
    }
    if (params.search?.trim()) {
      // ⚠️ TÜRKÇE-DUYARLI: keşideci/banka adı serbest metindir ve Türkçe harf
      // taşır; düz ILIKE onları katlamaz → "şeker bankası" hiç eşleşmez.
      // ⚠️ `AND` sarmalayıcı KORUNUR: `where.OR` yukarıda cari filtresine ait
      // (`cariId` ∨ `endorsedToCariId`) — aynı anahtara yazmak onu EZERDİ.
      where.AND = [
        { OR: buildTurkishSearch(params.search, ["docNo", "serialNo", "drawerName", "bankName"]) },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.cheque.findMany({
        where,
        select: LIST_SELECT,
        // VADE birinci anahtar: portföy ekranının tek sorusu "sırada ne var".
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.cheque.count({ where }),
    ]);
    return { data, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async findById(id: string) {
    // I4: `include` → `select` (gerekçe DETAIL_SELECT başlığında — clientToken
    // ve çıplak iç FK'ler yanıtta gezmez).
    const cheque = await prisma.cheque.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!cheque) throw AppError.notFound("Çek/senet bulunamadı.");
    return { success: true, data: cheque };
  }

  /**
   * Portföy özeti — durum × para birimi kırılımında adet ve tutar.
   *
   * ⚠️ TL karşılığı TOPLANMAZ: her satır kendi para biriminde döner. Farklı
   * birimleri damgalanmış kurlarla toplayıp tek sayı basmak, ekranda "bugünkü
   * kurla" sanılan ama aslında geçmiş kurların karışımı olan bir rakam üretirdi.
   */
  async summary(params: { kind?: ChequeKind } = {}) {
    const rows = await prisma.cheque.groupBy({
      by: ["status", "currency", "kind"],
      where: params.kind ? { kind: params.kind } : undefined,
      _sum: { amount: true, amountTry: true },
      _count: { _all: true },
    });
    return {
      success: true,
      data: rows.map((r) => ({
        kind: r.kind,
        status: r.status,
        currency: r.currency,
        count: r._count._all,
        amount: r._sum.amount ?? D0(),
        amountTry: r._sum.amountTry ?? D0(),
      })),
    };
  }

  /**
   * VADE TAKVİMİ (H4) — vade kovaları + haftalık/aylık nakit takvimi.
   *
   * Yukarıdaki bölüm başlığındaki üç kural (eksen = vade · kapsam = para
   * beklenen · ciro dışarıda) BURADA uygulanır. Ek olarak:
   *
   * ⚠️ İKİ ZAMAN ANLAYIŞI TEK YANITTA (WIP karnesi emsali): **kovalar** portföyün
   * TAMAMINI kapsar ve pencereden BAĞIMSIZDIR ("elimde toplam ne var, ne kadarı
   * gecikmiş"), **takvim** ise yalnız seçilen pencereyi ("önümüzdeki 30 günde
   * hangi hafta ne girecek"). Kovaları da pencereye kısmak, tarih aralığını
   * daraltan kullanıcıya "vadesi geçmiş çekim kalmadı" derdi.
   *
   * ⚠️ GÜN SINIRI FABRİKA TAKVİMİNDEN (`factoryDaySql` + `factoryYmd`). UTC'de
   * kesilseydi Türkiye'de yerel 00:00–03:00 arasında vadesi dolan her çek bir
   * ÖNCEKİ güne düşer, yani bugün vadesi gelen çek "vadesi GEÇMİŞ" kovasına
   * yazılırdı — hata yok, log yok, yalnız yanlış kova.
   *
   * ⚠️ GÜN ANAHTARI SQL'den **METİN** olarak alınır (`TO_CHAR`), `date` kolonu
   * olarak DEĞİL: sürücünün `date` → JS `Date` dönüşümü gece yarısını UTC'de mi
   * yerelde mi kurduğuna bağlıdır ve o varsayım kırılırsa TÜM seri bir gün
   * kayar. Metin böyle bir varsayım taşımaz.
   *
   * ⚠️ PARA BİRİMLERİ TOPLANMAZ; her satır kendi biriminde döner. TL karşılığı
   * da üretilmez — çekler kendi DAMGALANMIŞ kurlarını taşır ve onları toplamak
   * "bugünkü kurla" sanılan ama geçmiş kurların karışımı olan bir sayı üretirdi
   * (`summary` ile aynı karar).
   *
   * PERF: tek `groupBy` sorgusu, `cheques(status, dueDate)` index'i üzerinden;
   * satır sayısı canlı çek sayısıyla değil, farklı (yön × birim × vade GÜNÜ)
   * kombinasyonuyla sınırlıdır. Kova/hafta/ay üçü de AYNI satırlardan türetilir
   * — üç ayrı sorgu, üç ayrı rakam demekti.
   */
  async dueSummary(params: { from?: Date; to?: Date } = {}): Promise<ApiResponse<ChequeDueSummary>> {
    const today = factoryYmd(new Date());
    const todayMs = ymdToUtcMs(today);

    // Varsayılan pencere İLERİ bakar: bugün + 30 gün. Rapor sözleşmesindeki
    // "son 30 gün" geriye bakar ve burada anlamsızdır — vade takviminin sorusu
    // geçmişte ne olduğu değil, ÖNÜMÜZDE ne olduğudur.
    const fromYmd = params.from ? factoryYmd(params.from) : today;
    const toYmd = params.to ? factoryYmd(params.to) : utcMsToYmd(todayMs + 30 * DUE_DAY_MS);

    // Kapsam süzgeci TEK KAYNAKTAN (`CHEQUE_DUE_LIVE_STATUSES`) üretilir.
    // Elle yazılmış ikinci bir `status IN (...)` listesi, sabit güncellenip
    // SQL unutulduğunda sessizce ayrışırdı.
    const liveWhere = Prisma.join(
      (Object.keys(CHEQUE_DUE_LIVE_STATUSES) as ChequeKind[]).map(
        (kind) => Prisma.sql`(c.kind::text = ${kind} AND c.status::text IN (${Prisma.join(
          CHEQUE_DUE_LIVE_STATUSES[kind].map((s) => Prisma.sql`${s}`),
        )}))`,
      ),
      " OR ",
    );

    const rows = await prisma.$queryRaw<
      Array<{ kind: string; currency: string; day: string | null; cnt: number; amount: string | null }>
    >(Prisma.sql`
      SELECT c.kind::text     AS kind,
             c.currency::text AS currency,
             TO_CHAR(${factoryDaySql('c."dueDate"')}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int    AS cnt,
             SUM(c.amount)::text AS amount
        FROM cheques c
       WHERE (${liveWhere})
       GROUP BY 1, 2, 3
    `);

    type Acc = { count: number; amount: Prisma.Decimal };
    const bump = (map: Map<string, Acc>, key: string, count: number, amount: Prisma.Decimal): void => {
      const cur = map.get(key);
      if (cur) {
        cur.count += count;
        cur.amount = cur.amount.plus(amount);
      } else {
        map.set(key, { count, amount });
      }
    };

    const buckets = new Map<string, Acc>();
    const weeks = new Map<string, Acc>();
    const months = new Map<string, Acc>();

    for (const r of rows) {
      const kind = r.kind as ChequeKind;
      const currency = r.currency as Currency;
      const count = Number(r.cnt);
      const amount = D(r.amount ?? 0);
      // `dueDate` bugün NOT NULL — bu dal ölü görünür ama bilinçli duruyor:
      // kolon bir gün nullable olursa satırlar kovalardan SESSİZCE düşmek
      // yerine `NO_DUE` kovasında görünür (kaybolmak, yanlış görünmekten kötü).
      const day: string | null = r.day ?? null;

      let bucket: ChequeDueBucket;
      if (day === null) {
        bucket = "NO_DUE";
      } else {
        const diffDays = Math.round((ymdToUtcMs(day) - todayMs) / DUE_DAY_MS);
        if (diffDays < 0) bucket = "OVERDUE";
        else if (diffDays <= CHEQUE_DUE_SOON_DAYS) bucket = "SOON";
        else if (day.slice(0, 7) === today.slice(0, 7)) bucket = "MONTH";
        else bucket = "LATER";
      }
      bump(buckets, `${bucket}|${kind}|${currency}`, count, amount);

      // TAKVİM yalnız pencereye düşen günleri sayar (kovalar zaten tamamını
      // saydı). Sınırların İKİSİ DE DAHİLDİR — `<` yazmak, kullanıcının seçtiği
      // son günün çeklerini sessizce düşürürdü.
      if (day !== null && day >= fromYmd && day <= toYmd) {
        const ws = weekStartYmd(day);
        bump(weeks, `${ws}|${kind}|${currency}`, count, amount);
        bump(months, `${day.slice(0, 7)}|${kind}|${currency}`, count, amount);
      }
    }

    const bucketRows: ChequeDueBucketRow[] = [...buckets.entries()]
      .map(([key, acc]) => {
        const [bucket, kind, currency] = key.split("|");
        return {
          bucket: bucket as ChequeDueBucket,
          kind: kind as ChequeKind,
          currency: currency as Currency,
          count: acc.count,
          amount: acc.amount.toFixed(2),
        };
      })
      .sort(
        (a, b) =>
          CHEQUE_DUE_BUCKETS.indexOf(a.bucket) - CHEQUE_DUE_BUCKETS.indexOf(b.bucket) ||
          a.kind.localeCompare(b.kind) ||
          a.currency.localeCompare(b.currency),
      );

    const calendarRows = (map: Map<string, Acc>, kindOf: "week" | "month"): ChequeDueCalendarRow[] =>
      [...map.entries()]
        .map(([key, acc]) => {
          const [period, kind, currency] = key.split("|");
          const p = period as string;
          const start = kindOf === "week" ? p : `${p}-01`;
          const end =
            kindOf === "week"
              ? utcMsToYmd(ymdToUtcMs(p) + 6 * DUE_DAY_MS)
              : // Ayın son günü: ERTESİ ayın 1'inden bir gün geri. Sabit 30/31
                // yazmak şubatı ve artık yılı yanlışlardı.
                utcMsToYmd(
                  Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 1) - DUE_DAY_MS,
                );
          return {
            key: p,
            start,
            end,
            kind: kind as ChequeKind,
            currency: currency as Currency,
            count: acc.count,
            amount: acc.amount.toFixed(2),
          };
        })
        .sort(
          (a, b) =>
            a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency),
        );

    const notes = [
      `Eksen VADE tarihidir — işlem (defter) tarihi değil. Bugün: ${today} (fabrika takvimi).`,
      "Takvim yalnız PARA BEKLENEN çekleri sayar: aldığımız çeklerden elimizde ve bankada (tahsilde) olanlar, verdiğimiz çeklerden henüz ödenmemiş olanlar.",
      "Tahsil edilmiş · karşılıksız · iade edilmiş · iptal edilmiş çekler GİRMEZ — bunlarda beklenen bir para hareketi yoktur.",
      "CİRO EDİLEN çek de girmez: alacak ciroyla üçüncü tarafa geçmiştir. Çek karşılıksız dönerse alacak yeni bir olayla geri doğar ve o an takvimde yeniden görünür.",
      `Kovalar portföyün TAMAMINI kapsar; haftalık/aylık takvim yalnız ${fromYmd} – ${toYmd} penceresini. Pencereyi daraltmak kovaları DEĞİŞTİRMEZ.`,
      `"Yaklaşan" penceresi ${CHEQUE_DUE_SOON_DAYS} gündür (bugün dahil) ve liste satırlarındaki vade uyarısıyla aynı eşiktir.`,
      "Para birimleri TOPLANMAZ — her satır kendi biriminde okunur; çekler kendi damgalanmış kurlarını taşır.",
      "Gün sınırı fabrika takvimine göre çizilir (Europe/Istanbul): gece yarısından sonra vadesi dolan çek bir önceki güne yazılmaz.",
    ];

    return {
      success: true,
      data: {
        today,
        soonDays: CHEQUE_DUE_SOON_DAYS,
        buckets: bucketRows,
        window: { from: fromYmd, to: toYmd },
        weeks: calendarRows(weeks, "week"),
        months: calendarRows(months, "month"),
        liveStatuses: CHEQUE_DUE_LIVE_STATUSES,
        notes,
      },
    };
  }
}

export const chequeService = new ChequeService();
