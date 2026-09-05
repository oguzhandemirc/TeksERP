// =============================================================================
// CARİ YAŞLANDIRMA (AGING) — "kimden ne kadar alacağım var ve NE KADAR ESKİ"
// =============================================================================
// YENİ TABLO YOK: bu rapor tamamen salt-okumadır. Kaynakları `invoices`,
// `payments`, `payment_allocations`, `cari_transactions`, `cari_balances`.
//
// ── EFEKTİF VADE: UYDURMA VADE BASILMAZ ───────────────────────────────────────
// Sıra: `Invoice.dueDate` → yoksa `issueDate + CariAccount.paymentTermDays` →
// ikisi de yoksa satır **"Vadesiz" kovasına** düşer. Boş vadeye "bugün" ya da
// "issueDate" yazmak, hiç kararlaştırılmamış bir vadeyi rapora GERÇEKMİŞ gibi
// bastırır ve muhasebeci o rakama dayanarak müşteriyi arar. Satırın hangi yoldan
// vade aldığı `dueSource` ile açıkça döner (DOCUMENT | PAYMENT_TERM | NONE).
//
// ── TEK FORMÜL, İKİ DİSİPLİN ─────────────────────────────────────────────────
// Açık tutar DAİMA `grandTotal − paidTotal`'dır. Kapamaya bağlanmamış tahsilat/
// çek fazlası ise RAPOR ANINDA, en eski açık faturadan başlayarak FIFO ile
// **SANAL** mahsup edilir (`virtualOffset` kolonu + dipnot) — deftere ya da
// `PaymentAllocation`'a HİÇBİR ŞEY yazılmaz.
//   • Kapama disiplini olan caride sanal mahsup sıfırdır → gerçek fatura yaşı.
//   • Kapama yapmayan caride Logo'nun otomatik FIFO'suyla aynı sonuç.
// İki ayrı rapor modu (ör. "kapamaya göre" / "FIFO'ya göre") AÇILMAZ: aynı
// soruya iki cevap üreten bir rapor, ikisi ayrıştığı gün ikisine de güveni
// bitirir. Sanal mahsup toplamı DEĞİŞTİRMEZ, yalnız kovalar arası DAĞILIMI
// değiştirir — büyük mutabakat her iki durumda da aynı sonucu verir.
//
// ── `asOf` BİR KESİTTİR, ARALIK DEĞİL ────────────────────────────────────────
// Yaşlandırma "şu ana kadar birikmiş açık"ı sorar; tarih aralığı anlamsızdır
// (1-15 Ağustos arası yaşlandırma diye bir şey yoktur). Kesit HER kaynağa aynı
// şekilde uygulanır — biri kesilip diğeri kesilmezse mutabakat kesitin tam
// üstünde bozulur:
//   • Fatura: `issueDate <= asOf` (defter satırının `txnDate`'i ISSUE DATE'tir,
//     `confirmedAt` DEĞİL — geriye tarihli onaylanan fatura deftere kendi belge
//     tarihiyle düşer; kriter oraya bakmazsa iki yol kesitte ayrışır).
//   • Belge iptali: iptal defter satırı `txnDate = now` taşır → `asOf`'tan SONRA
//     iptal edilmiş belge, `asOf` itibarıyla HÂLÂ AÇIKTIR ve rapora girer.
//   • Kapama: `asOf`'tan sonra yazılmış allocation'lar geri sarılır
//     (`paidAsOf = paidTotal − Σ(allocation.createdAt > asOf)`). Bu ikinci bir
//     formül DEĞİL, aynı formülün kesite çekilmiş hâlidir; `asOf` bugünü
//     kapsadığında düzeltme sıfırdır ve sonuç `grandTotal − paidTotal` ile
//     BİREBİR aynıdır.
//
// ── PARA BİRİMİ BAZINDA AYRI BLOK ────────────────────────────────────────────
// 1000 USD alacak ile 30.000 TL alacak toplanamaz. Her para birimi kendi
// bloğunda yaşar; TL karşılığı **rapor günü kuruyla** ve DİPNOTLU verilir. Kur
// bulunamazsa TL kolonu `null` döner — uydurma kur, 30 kat yanlış bir toplamı
// sessizce doğru gösterirdi (`resolveExchangeRateTx`'in "sessizce 1'e düşme"
// yasağıyla aynı gerekçe).
//
// ── İŞARET SÖZLEŞMESİ ────────────────────────────────────────────────────────
// Tutarlar `CariBalance` ile AYNI işaret sözleşmesini taşır: POZİTİF = cari bize
// borçlu (alacağımız), NEGATİF = biz ona borçluyuz. Fason carisinin kovalarında
// negatif sayılar görülür ve bu doğrudur — ikinci bir işaret sözleşmesi
// (alacak/borç raporlarını ayrı pozitif ölçeklerde basmak) mutabakatı iki ayrı
// kurala bağlardı.
//
// ── BÜYÜK MUTABAKAT ──────────────────────────────────────────────────────────
//     Σ(kovalar) − kapanmamış kredi = cari bakiyesi
// Sol taraf `invoices`/`payments` BELGE tablolarından, sağ taraf
// `cari_transactions` DEFTERİNDEN gelir. İki yol ayrışırsa raporlardan biri
// yalan söylüyordur; fark `reconDiff` olarak SATIR BAZINDA döner ve gizlenmez.
// Farkın matematiksel karşılığı tam olarak şudur:
//     reconDiff = Σ(işaretli grandTotal) − (fatura defter neti)
//                 + (Σ allocation − Σ paidTotal)
// yani (a) onaylanmış faturanın defter satırının eksik/yanlış işaretli/yanlış
// tutarlı yazılması ve (b) `paidTotal` denormalize sayacının allocation'lardan
// ayrışması. Bu ikisi, bu modülün sessizce bozulabileceği iki yerdir.
//
// ⚠️ TUTARLAR JSON'A **STRING** OLARAK ÇIKAR (2 hane). Para `number`'a
// çevrilirse 1234.56 + 0.1 gibi toplamlar 1234.6600000000001 üretir ve muhasebe
// ekranında "1 kuruş tutmuyor" olarak görünür. Gün/adet alanları `number`.
//
// ── ÇEKİRDEK PAYLAŞILIR: `collectAgingRows` (H2, 2026-08-14) ─────────────────
// Cari LİSTESİNİN "Gecikmiş" kolonu da AYNI çekirdekten okur
// (`cari.service.list({ withOverdue })` → `collectAgingRows` → `overdueTotal`).
// Efektif vade + açık tutar + sanal FIFO mahsup kuralını burada değiştirirsen
// iki yüzey BİRLİKTE değişir; kuralı cari listesi için ayrıca yazmak YASAK —
// iki formül bir gün ayrışır ve aynı cariye iki farklı "gecikmiş" rakamı
// basılır (bekçi: `test_finance_reports` §11 eşitliği fixture üzerinde ölçer).
// =============================================================================

import { Prisma, CariKind, Currency, InvoiceType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D, D0, invoiceLedgerSide } from "../helpers/finance.helper";
import { factoryDayKeyUtcMidnight } from "../../constants/time";

const DAY_MS = 86_400_000;

// -----------------------------------------------------------------------------
// KOVALAR
// -----------------------------------------------------------------------------
// ⚠️ `notDue` (vadesi gelmemiş) BİLİNÇLİ olarak listede: gecikme merdiveni
// (0-30 / 31-60 / 61-90 / 90+) GECİKMİŞ GÜN sayar. Bu kova olmadan, bugün
// kesilmiş 30 gün vadeli bir fatura "0-30 gün gecikmiş" kovasına düşer ve rapor
// olmayan bir gecikmeyi ihbar eder. "Vadesiz" ise vade BİLGİSİ olmayan satırdır
// — ikisi farklı sorulardır ve tek kovaya katlanamazlar.
export const AGING_BUCKETS = ["notDue", "d0_30", "d31_60", "d61_90", "d90plus", "noDueDate"] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  notDue: "Vadesi gelmemiş",
  d0_30: "0-30 gün",
  d31_60: "31-60 gün",
  d61_90: "61-90 gün",
  d90plus: "90+ gün",
  noDueDate: "Vadesiz",
};

/** Gecikme gününü kovaya çevirir. TEK KAYNAK — sınırlar başka yerde tekrarlanmaz. */
export function bucketOfDaysOverdue(daysOverdue: number | null): AgingBucketKey {
  if (daysOverdue === null) return "noDueDate";
  if (daysOverdue < 0) return "notDue";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
}

type BucketMap = Record<AgingBucketKey, Prisma.Decimal>;
const emptyBuckets = (): BucketMap => ({
  notDue: D0(),
  d0_30: D0(),
  d31_60: D0(),
  d61_90: D0(),
  d90plus: D0(),
  noDueDate: D0(),
});
const bucketsToStrings = (b: BucketMap): Record<AgingBucketKey, string> => ({
  notDue: b.notDue.toFixed(2),
  d0_30: b.d0_30.toFixed(2),
  d31_60: b.d31_60.toFixed(2),
  d61_90: b.d61_90.toFixed(2),
  d90plus: b.d90plus.toFixed(2),
  noDueDate: b.noDueDate.toFixed(2),
});

// -----------------------------------------------------------------------------
// GİRDİ / ÇIKTI
// -----------------------------------------------------------------------------

export interface AgingParams {
  /** KESİT anı (aralık değil). */
  asOf: Date;
  cariId?: string;
  kind?: CariKind;
  currency?: Currency;
  /** Yalnız vadesi geçmiş bakiyesi olan cariler. */
  onlyOverdue?: boolean;
  /** Fatura kırılımı — ekranda drill-down. Tek cari seçiliyken anlamlıdır. */
  includeDetail?: boolean;
}

export interface AgingOpenItem {
  /** DEVİR/düzeltme satırında `null` — o satırın faturası yoktur. */
  invoiceId: string | null;
  docNo: string;
  /** `InvoiceType` ya da "ADJUSTMENT". */
  type: string;
  issueDate: string;
  effectiveDueDate: string | null;
  dueSource: "DOCUMENT" | "PAYMENT_TERM" | "NONE";
  grandTotal: string;
  paid: string;
  /** İşaretli açık tutar (sanal mahsup ÖNCESİ). */
  open: string;
  virtualOffset: string;
  netOpen: string;
  daysOverdue: number | null;
  bucket: AgingBucketKey;
}

export interface AgingCariRow {
  cariId: string;
  code: string;
  name: string;
  kind: CariKind;
  currency: Currency;
  /** Sanal FIFO mahsup ÖNCESİ kovalar. */
  gross: Record<AgingBucketKey, string>;
  /** Sanal FIFO mahsup SONRASI kovalar — ekranın varsayılan gösterdiği. */
  net: Record<AgingBucketKey, string>;
  virtualOffset: string;
  /** Σ(net kovalar). */
  openTotal: string;
  /** Mahsup sonrası artan kredi (avans / kapatılmamış tahsilat). */
  unappliedCredit: string;
  /** Vadesi geçmiş kovaların toplamı (notDue ve noDueDate hariç). */
  overdueTotal: string;
  /** `cari_transactions` toplamı (asOf kesitiyle). */
  ledgerBalance: string;
  /** `cari_balances` denormalize kolonu — yalnız kesit bugünü kapsıyorsa anlamlı. */
  storedBalance: string | null;
  /** openTotal − unappliedCredit − ledgerBalance → SIFIR OLMALI. */
  reconDiff: string;
  /** ledgerBalance − storedBalance → SIFIR OLMALI (kesit bugünü kapsıyorsa). */
  storedDiff: string | null;
  oldestDueDate: string | null;
  oldestDaysOverdue: number | null;
  items?: AgingOpenItem[];
}

export interface AgingCurrencyBlock {
  currency: Currency;
  /** Rapor GÜNÜ kuru — yoksa `null` ve TL kolonları da `null`. */
  tryRate: string | null;
  rateDate: string | null;
  rows: AgingCariRow[];
  totals: {
    gross: Record<AgingBucketKey, string>;
    net: Record<AgingBucketKey, string>;
    virtualOffset: string;
    openTotal: string;
    unappliedCredit: string;
    overdueTotal: string;
    ledgerBalance: string;
  };
  /** TL karşılığı — kur yoksa `null` (uydurma kurla toplam BASILMAZ). */
  totalsTry: { openTotal: string; unappliedCredit: string; overdueTotal: string } | null;
}

export interface AgingReport {
  asOf: string;
  /** Kova etiketleri TEK KAYNAKTAN — istemci kendi listesini kurmasın. */
  buckets: Array<{ key: AgingBucketKey; label: string }>;
  blocks: AgingCurrencyBlock[];
  notes: string[];
  reconciliation: {
    rowsChecked: number;
    mismatchedRows: number;
    /** En büyük sapmalar — sessizce yutulmaz, ekranda bant olarak basılır. */
    samples: Array<{ cariId: string; name: string; currency: Currency; diff: string }>;
    /** `Invoice.paidTotal` ↔ Σ`PaymentAllocation` sayaç sapması (adet). */
    allocationDriftInvoices: number;
    /** `Payment.allocatedTotal` ↔ Σ`PaymentAllocation` sayaç sapması (adet). */
    allocationDriftPayments: number;
  };
}

// -----------------------------------------------------------------------------
// HAM SORGU SATIR TİPLERİ
// -----------------------------------------------------------------------------

interface CariRow {
  id: string;
  kind: string;
  paymentTermDays: number | null;
  code: string | null;
  name: string | null;
}
interface InvoiceRow {
  id: string;
  cariId: string;
  currency: string;
  docNo: string;
  type: string;
  issueDate: Date;
  dueDate: Date | null;
  grandTotal: string;
  paidAsOf: string;
  paymentTermDays: number | null;
}
interface InvoiceAggRow {
  cariId: string;
  currency: string;
  signedGrand: string;
  signedPaid: string;
}
interface PaymentAggRow {
  cariId: string;
  currency: string;
  direction: string;
  unallocated: string;
}
interface LedgerRow {
  cariId: string;
  currency: string;
  net: string;
  chqNet: string;
  adjNet: string;
}
interface BalanceRow {
  cariId: string;
  currency: string;
  balance: string;
}
interface ChequeAllocRow {
  cariId: string;
  currency: string;
  signedAlloc: string;
}
interface RateRow {
  currency: string;
  rate: string;
  rateDate: Date;
}

// -----------------------------------------------------------------------------
// SERVİS
// -----------------------------------------------------------------------------

/** İşaret: fatura türü BORÇ yazıyorsa +1, ALACAK yazıyorsa −1. */
function signOfInvoiceType(type: string): number {
  return invoiceLedgerSide(type as InvoiceType) === "debit" ? 1 : -1;
}

/** `collectAgingRows` girdisi — rapor parametreleri + liste yüzeyinin sayfa kümesi. */
export interface AgingRowsParams extends AgingParams {
  /**
   * Yalnız bu carilerin satırları (cari LİSTESİ sayfası için). `cariId` ile
   * birlikte verilirse tekil filtre kazanır. Boş dizi → boş sonuç (sorgu
   * koşmaz — `IN ()` sözdizimi de zaten geçersizdir).
   */
  cariIds?: string[];
}

/**
 * YAŞLANDIRMANIN ÇEKİRDEĞİ — cari×para-birimi satırlarını üretir.
 *
 * `getAgingReport` (blok/kur/mutabakat zarfı) ve `cari.service.list`'in
 * "Gecikmiş" kolonu (yalnız `overdueTotal`) AYNI bu fonksiyondan okur.
 * İkinci bir formül yazmak yasak — dosya başlığındaki not.
 */
export async function collectAgingRows(params: AgingRowsParams): Promise<AgingCariRow[]> {
  const asOf = params.asOf;
  if (params.cariIds && params.cariIds.length === 0) return [];

  // Filtreler HER sorguya aynı şekilde uygulanır — biri kesilip diğeri
  // kesilmezse mutabakat "fark" raporlar ve fark UYDURMADIR.
  const fCari = params.cariId
    ? Prisma.sql`AND ca.id = ${params.cariId}::uuid`
    : params.cariIds && params.cariIds.length > 0
      ? Prisma.sql`AND ca.id IN (${Prisma.join(params.cariIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;
  const fKind = params.kind ? Prisma.sql`AND ca.kind::text = ${params.kind}` : Prisma.empty;
  const fCurInv = params.currency ? Prisma.sql`AND i.currency::text = ${params.currency}` : Prisma.empty;
  const fCurPay = params.currency ? Prisma.sql`AND p.currency::text = ${params.currency}` : Prisma.empty;
  const fCurTxn = params.currency ? Prisma.sql`AND t.currency::text = ${params.currency}` : Prisma.empty;
  const fCurBal = params.currency ? Prisma.sql`AND b.currency::text = ${params.currency}` : Prisma.empty;

  // `asOf` KESİTİ İTİBARIYLA AKTİF FATURA: belge tarihi kesitten önce VE
  // (onaylı VEYA kesitten SONRA iptal edilmiş). `confirmedAt IS NOT NULL` şart:
  // hiç onaylanmamış (dolayısıyla deftere satır yazmamış) bir belge rapora
  // girerse mutabakat tam o tutar kadar sapar.
  const invoiceActive = Prisma.sql`
    i."issueDate" <= ${asOf}
    AND i."confirmedAt" IS NOT NULL
    AND (i.status = 'CONFIRMED' OR (i.status = 'CANCELLED' AND i."cancelledAt" > ${asOf}))`;

  // Kesitten SONRA yazılmış kapamalar geri sarılır (bkz. dosya başlığı).
  const allocAfterInvoice = Prisma.sql`
    LEFT JOIN (
      SELECT "invoiceId", SUM(amount) AS amt
        FROM payment_allocations WHERE "createdAt" > ${asOf} GROUP BY 1
    ) al ON al."invoiceId" = i.id`;

  const [cariRows, invoiceRows, invoiceAgg, paymentAgg, ledgerRows, balanceRows, chequeAlloc] =
    await Promise.all([
      prisma.$queryRaw<CariRow[]>(Prisma.sql`
        SELECT ca.id, ca.kind::text AS kind, ca."paymentTermDays",
               COALESCE(cu.code, sc.code) AS code,
               COALESCE(cu.name, sc.name) AS name
          FROM cari_accounts ca
          LEFT JOIN customers cu ON cu.id = ca."customerId"
          LEFT JOIN subcontractors sc ON sc.id = ca."subcontractorId"
         WHERE TRUE ${fCari} ${fKind}
      `),

      // AÇIK FATURA SATIRLARI (kovalanacak olanlar).
      // `paidTotal < grandTotal` ana süzgeç — `invoices_open` partial index'inin
      // hedeflediği yol. EXISTS dalı yalnız GEÇMİŞ tarihli kesitte devreye
      // girer: bugünü kapsayan kesitte alt sorgu boş döner ve planlayıcı index'i
      // kullanmaya devam eder.
      prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
        SELECT i.id, i."cariId" AS "cariId", i.currency::text AS currency, i."docNo" AS "docNo",
               i.type::text AS type, i."issueDate" AS "issueDate", i."dueDate" AS "dueDate",
               i."grandTotal"::text AS "grandTotal",
               (i."paidTotal" - COALESCE(al.amt, 0))::text AS "paidAsOf",
               ca."paymentTermDays" AS "paymentTermDays"
          FROM invoices i
          JOIN cari_accounts ca ON ca.id = i."cariId"
          ${allocAfterInvoice}
         WHERE ${invoiceActive} ${fCari} ${fKind} ${fCurInv}
           AND (i."paidTotal" < i."grandTotal"
                OR EXISTS (SELECT 1 FROM payment_allocations pa
                            WHERE pa."invoiceId" = i.id AND pa."createdAt" > ${asOf}))
      `),

      // TÜM aktif faturaların işaretli toplamı — mutabakatın fatura ayağı.
      // Kapanmış faturalar kovalara 0 katkı verir ama defter netinde vardırlar;
      // yalnız açık satırlara bakan bir mutabakat, kapanmış faturanın defter
      // satırındaki bir hatayı GÖREMEZ.
      prisma.$queryRaw<InvoiceAggRow[]>(Prisma.sql`
        SELECT i."cariId" AS "cariId", i.currency::text AS currency,
               SUM(CASE WHEN i.type IN ('SALES','PURCHASE_RETURN')
                        THEN i."grandTotal" ELSE -i."grandTotal" END)::text AS "signedGrand",
               SUM(CASE WHEN i.type IN ('SALES','PURCHASE_RETURN')
                        THEN (i."paidTotal" - COALESCE(al.amt, 0))
                        ELSE -(i."paidTotal" - COALESCE(al.amt, 0)) END)::text AS "signedPaid"
          FROM invoices i
          JOIN cari_accounts ca ON ca.id = i."cariId"
          ${allocAfterInvoice}
         WHERE ${invoiceActive} ${fCari} ${fKind} ${fCurInv}
         GROUP BY 1, 2
      `),

      // KAPANMAMIŞ TAHSİLAT/ÖDEME — BELGE tarafından (mutabakatın ikinci ayağı).
      // İptal edilen tahsilatın defter satırı `txnDate = now` taşır; kesitten
      // sonra iptal edilmiş tahsilat, kesit itibarıyla HÂLÂ geçerlidir.
      prisma.$queryRaw<PaymentAggRow[]>(Prisma.sql`
        SELECT p."cariId" AS "cariId", p.currency::text AS currency, p.direction::text AS direction,
               SUM(p.amount - p."allocatedTotal" + COALESCE(al.amt, 0))::text AS "unallocated"
          FROM payments p
          JOIN cari_accounts ca ON ca.id = p."cariId"
          LEFT JOIN (
            SELECT "paymentId", SUM(amount) AS amt
              FROM payment_allocations
             WHERE "createdAt" > ${asOf} AND "paymentId" IS NOT NULL GROUP BY 1
          ) al ON al."paymentId" = p.id
         WHERE p."paymentDate" <= ${asOf}
           AND (p.status = 'ACTIVE' OR (p.status = 'CANCELLED' AND p."cancelledAt" > ${asOf}))
           ${fCari} ${fKind} ${fCurPay}
         GROUP BY 1, 2, 3
      `),

      // DEFTER — mutabakatın sağ tarafı. Çek ve düzeltme netleri ayrı çıkar:
      // ⚠️ ÇEK KATKISI DEFTERDEN OKUNUR, çekin DURUMUNDAN türetilmez. Çekin
      // yaşam döngüsü dört yola sapıyor (tahsil · ciro · karşılıksız · iade) ve
      // her birinin defter işareti `cheque.service`'te yaşıyor; o eşlemeyi
      // burada İKİNCİ KEZ yazmak, iki kopyanın ayrıştığı gün raporu sessizce
      // yanlışlardı (karşılıksız çıkan çek "hâlâ kredi veriyor" görünürdü).
      // Defter ne yazdıysa o okunur — ters kayıt otomatik olarak krediyi siler.
      // ⚠️ DEVİR NETİ STORNO'YU DA KAPSAR: `adjNet` = ADJUSTMENT − ADJUSTMENT_CANCEL
      // (ters satır debit/credit'i yer değiştirmiş yazar, SUM kendiliğinden
      // netler). CANCEL süzgeçten düşürülürse iptal edilmiş devir raporda
      // "hâlâ açık DEVİR" görünür ve `reconDiff` tam devir tutarı kadar sahte
      // "defter uyuşmuyor" bandı basar — bekçide kilitli (test_finance_opening).
      prisma.$queryRaw<LedgerRow[]>(Prisma.sql`
        SELECT t."cariId" AS "cariId", t.currency::text AS currency,
               SUM(t.debit - t.credit)::text AS "net",
               (SUM(t.debit - t.credit) FILTER (WHERE t."sourceType"::text LIKE 'CHEQUE%'))::text AS "chqNet",
               (SUM(t.debit - t.credit) FILTER (WHERE t."sourceType" IN ('ADJUSTMENT','ADJUSTMENT_CANCEL')))::text AS "adjNet"
          FROM cari_transactions t
          JOIN cari_accounts ca ON ca.id = t."cariId"
         WHERE t."txnDate" <= ${asOf} ${fCari} ${fKind} ${fCurTxn}
         GROUP BY 1, 2
      `),

      prisma.$queryRaw<BalanceRow[]>(Prisma.sql`
        SELECT b."cariId" AS "cariId", b.currency::text AS currency, b.balance::text AS balance
          FROM cari_balances b
          JOIN cari_accounts ca ON ca.id = b."cariId"
         WHERE TRUE ${fCari} ${fKind} ${fCurBal}
      `),

      // Çekten gelen kapamaların İŞARETLİ toplamı (fatura yönüne göre).
      prisma.$queryRaw<ChequeAllocRow[]>(Prisma.sql`
        SELECT i."cariId" AS "cariId", i.currency::text AS currency,
               SUM(CASE WHEN i.type IN ('SALES','PURCHASE_RETURN') THEN pa.amount ELSE -pa.amount END)::text
                 AS "signedAlloc"
          FROM payment_allocations pa
          JOIN invoices i ON i.id = pa."invoiceId"
          JOIN cari_accounts ca ON ca.id = i."cariId"
         WHERE pa."chequeId" IS NOT NULL AND pa."createdAt" <= ${asOf} ${fCari} ${fKind} ${fCurInv}
         GROUP BY 1, 2
      `),
    ]);

  const cariById = new Map(cariRows.map((c) => [c.id, c]));
  const key = (cariId: string, currency: string): string => `${cariId}|${currency}`;

  interface Acc {
    cariId: string;
    currency: Currency;
    items: Array<{ item: AgingOpenItem; signedOpen: Prisma.Decimal; sortDue: number }>;
    signedGrand: Prisma.Decimal;
    signedPaid: Prisma.Decimal;
    creditFromPayments: Prisma.Decimal;
    chqNet: Prisma.Decimal;
    chqSignedAlloc: Prisma.Decimal;
    adjNet: Prisma.Decimal;
    ledger: Prisma.Decimal;
    stored: Prisma.Decimal | null;
  }
  const acc = new Map<string, Acc>();
  const touch = (cariId: string, currency: string): Acc => {
    const k = key(cariId, currency);
    let a = acc.get(k);
    if (!a) {
      a = {
        cariId,
        currency: currency as Currency,
        items: [],
        signedGrand: D0(),
        signedPaid: D0(),
        creditFromPayments: D0(),
        chqNet: D0(),
        chqSignedAlloc: D0(),
        adjNet: D0(),
        ledger: D0(),
        stored: null,
      };
      acc.set(k, a);
    }
    return a;
  };

  // ── AÇIK FATURA SATIRLARI → KOVALAR ────────────────────────────────────────
  for (const r of invoiceRows) {
    const grand = D(r.grandTotal);
    const paid = D(r.paidAsOf);
    const open = grand.minus(paid);
    if (open.isZero()) continue;
    const sign = signOfInvoiceType(r.type);
    const signedOpen = open.mul(sign);

    // EFEKTİF VADE — uydurma vade basılmaz (bkz. dosya başlığı).
    let effectiveDue: Date | null = null;
    let dueSource: AgingOpenItem["dueSource"] = "NONE";
    if (r.dueDate) {
      effectiveDue = r.dueDate;
      dueSource = "DOCUMENT";
    } else if (r.paymentTermDays !== null && r.paymentTermDays !== undefined) {
      effectiveDue = new Date(r.issueDate.getTime() + r.paymentTermDays * DAY_MS);
      dueSource = "PAYMENT_TERM";
    }

    // tz-ok: gecikme İKİ AN arasındaki mutlak farktır (takvim günü sorusu
    // değil) — fabrika saat dilimine kesilmez.
    const daysOverdue =
      effectiveDue === null ? null : Math.floor((asOf.getTime() - effectiveDue.getTime()) / DAY_MS);

    const a = touch(r.cariId, r.currency);
    a.items.push({
      item: {
        invoiceId: r.id,
        docNo: r.docNo,
        type: r.type,
        issueDate: r.issueDate.toISOString(),
        effectiveDueDate: effectiveDue ? effectiveDue.toISOString() : null,
        dueSource,
        grandTotal: grand.toFixed(2),
        paid: paid.toFixed(2),
        open: signedOpen.toFixed(2),
        virtualOffset: "0.00",
        netOpen: signedOpen.toFixed(2),
        daysOverdue,
        bucket: bucketOfDaysOverdue(daysOverdue),
      },
      signedOpen,
      // FIFO sırası: en eski vade önce. Vadesizler EN SONA — yaşları
      // ispatlanamayan satırı "en eski" sayıp krediyi ona harcamak, gerçekten
      // geciken faturayı raporda geciktirmeye devam ettirirdi.
      sortDue: effectiveDue ? effectiveDue.getTime() : Number.POSITIVE_INFINITY,
    });
  }

  for (const r of invoiceAgg) {
    const a = touch(r.cariId, r.currency);
    a.signedGrand = a.signedGrand.plus(D(r.signedGrand ?? 0));
    a.signedPaid = a.signedPaid.plus(D(r.signedPaid ?? 0));
  }

  // Kapanmamış tahsilat "alacağı azaltan" yönde POZİTİF sayılır: IN tahsilat
  // alacağı düşürür (+), OUT ödeme borcumuzu düşürür (−).
  for (const r of paymentAgg) {
    const a = touch(r.cariId, r.currency);
    const v = D(r.unallocated ?? 0);
    a.creditFromPayments = a.creditFromPayments.plus(r.direction === "IN" ? v : v.negated());
  }

  for (const r of ledgerRows) {
    const a = touch(r.cariId, r.currency);
    a.ledger = a.ledger.plus(D(r.net ?? 0));
    a.chqNet = a.chqNet.plus(D(r.chqNet ?? 0));
    a.adjNet = a.adjNet.plus(D(r.adjNet ?? 0));
  }
  for (const r of chequeAlloc) {
    const a = touch(r.cariId, r.currency);
    a.chqSignedAlloc = a.chqSignedAlloc.plus(D(r.signedAlloc ?? 0));
  }
  for (const r of balanceRows) {
    const a = touch(r.cariId, r.currency);
    a.stored = D(r.balance);
  }

  // ── SATIRLARI KUR ──────────────────────────────────────────────────────────
  const rows: AgingCariRow[] = [];
  for (const a of acc.values()) {
    const cari = cariById.get(a.cariId);
    // Filtre kümesinin dışında kalan cari (ör. `kind` süzgeci) — sessizce atla.
    if (!cari) continue;

    // DEVİR / ELLE DÜZELTME: faturası olmayan defter hareketi. Pozitifse açık
    // bir alacaktır ve VADESİZ kovasına düşer (devrin vadesi yoktur); negatifse
    // avanstır ve kredi kolonuna gider. Bu satır olmadan devir girilmiş her
    // caride mutabakat tam devir tutarı kadar sapardı.
    if (!a.adjNet.isZero()) {
      if (a.adjNet.gt(0)) {
        a.items.push({
          item: {
            invoiceId: null,
            docNo: "DEVİR",
            type: "ADJUSTMENT",
            issueDate: asOf.toISOString(),
            effectiveDueDate: null,
            dueSource: "NONE",
            grandTotal: a.adjNet.toFixed(2),
            paid: "0.00",
            open: a.adjNet.toFixed(2),
            virtualOffset: "0.00",
            netOpen: a.adjNet.toFixed(2),
            daysOverdue: null,
            bucket: "noDueDate",
          },
          signedOpen: a.adjNet,
          sortDue: Number.POSITIVE_INFINITY,
        });
      }
    }

    // Çek kredisi DEFTERDEN türetilir: (çekin defter neti) alacağı ne kadar
    // azalttıysa o kadar kredi verir; bundan çekle yapılmış kapamalar düşülür.
    const creditFromCheques = a.chqNet.negated().minus(a.chqSignedAlloc);
    const creditFromAdjustment = a.adjNet.lt(0) ? a.adjNet.negated() : D0();
    const credit = a.creditFromPayments.plus(creditFromCheques).plus(creditFromAdjustment);

    // ── SANAL FIFO MAHSUP ────────────────────────────────────────────────────
    // Kredi yalnız AYNI İŞARETLİ açık satırları kapatır: müşteriden alınan fazla
    // tahsilat (pozitif kredi) bir alacak faturasını kapatır, borcumuzu değil.
    a.items.sort((x, y) => x.sortDue - y.sortDue || x.item.docNo.localeCompare(y.item.docNo, "tr"));
    let remaining = credit;
    let offsetTotal = D0();
    for (const entry of a.items) {
      if (remaining.isZero()) break;
      const so = entry.signedOpen;
      let off = D0();
      if (remaining.gt(0) && so.gt(0)) off = Prisma.Decimal.min(remaining, so);
      else if (remaining.lt(0) && so.lt(0)) off = Prisma.Decimal.max(remaining, so);
      if (off.isZero()) continue;
      remaining = remaining.minus(off);
      offsetTotal = offsetTotal.plus(off);
      entry.item.virtualOffset = off.toFixed(2);
      entry.item.netOpen = so.minus(off).toFixed(2);
    }

    const gross = emptyBuckets();
    const net = emptyBuckets();
    let oldestDue: number | null = null;
    let oldestDays: number | null = null;
    for (const entry of a.items) {
      const b = entry.item.bucket;
      gross[b] = gross[b].plus(entry.signedOpen);
      net[b] = net[b].plus(D(entry.item.netOpen));
      if (entry.item.daysOverdue !== null && entry.item.daysOverdue >= 0 && !D(entry.item.netOpen).isZero()) {
        const t = entry.sortDue;
        if (oldestDue === null || t < oldestDue) {
          oldestDue = t;
          oldestDays = entry.item.daysOverdue;
        }
      }
    }

    const openTotal = AGING_BUCKETS.reduce((s, k) => s.plus(net[k]), D0());
    const overdueTotal = net.d0_30.plus(net.d31_60).plus(net.d61_90).plus(net.d90plus);
    const reconDiff = openTotal.minus(remaining).minus(a.ledger);
    const storedDiff = a.stored ? a.ledger.minus(a.stored) : null;

    // Hiç açık kalemi, hiç kredisi ve hiç bakiyesi olmayan cari listeyi
    // doldurmasın.
    //
    // ⚠️ Ölçüt "toplam sıfır" DEĞİL, "gösterilecek bir şey yok": açık faturası
    // duran ama üstünde eşit tutarda kapatılmamış tahsilat/çek bulunan cari
    // NET SIFIR verir — ve raporun asıl söylemek istediği şey tam olarak odur
    // ("para geldi ama hiçbir faturaya bağlanmamış"). Toplama bakan bir süzgeç
    // o cariyi sessizce gizler ve kapama disiplinsizliği hiçbir ekranda
    // görünmez olurdu. Gerçekten kapanmış cari zaten kalemsiz kalır ve düşer.
    if (a.items.length === 0 && credit.isZero() && a.ledger.isZero()) continue;
    if (params.onlyOverdue && overdueTotal.isZero()) continue;

    rows.push({
      cariId: a.cariId,
      code: cari.code ?? "—",
      name: cari.name ?? "—",
      kind: cari.kind as CariKind,
      currency: a.currency,
      gross: bucketsToStrings(gross),
      net: bucketsToStrings(net),
      virtualOffset: offsetTotal.toFixed(2),
      openTotal: openTotal.toFixed(2),
      unappliedCredit: remaining.toFixed(2),
      overdueTotal: overdueTotal.toFixed(2),
      ledgerBalance: a.ledger.toFixed(2),
      storedBalance: a.stored ? a.stored.toFixed(2) : null,
      reconDiff: reconDiff.toFixed(2),
      storedDiff: storedDiff ? storedDiff.toFixed(2) : null,
      oldestDueDate: oldestDue !== null && Number.isFinite(oldestDue) ? new Date(oldestDue).toISOString() : null,
      oldestDaysOverdue: oldestDays,
      ...(params.includeDetail ? { items: a.items.map((e) => e.item) } : {}),
    });
  }

  return rows;
}

export async function getAgingReport(params: AgingParams): Promise<AgingReport> {
  const asOf = params.asOf;

  // Satırlar TEK çekirdekten (yukarı bak) — burada yalnız zarf kurulur:
  // para birimi blokları, rapor günü kuru, mutabakat sayaçları, dipnotlar.
  const rows = await collectAgingRows(params);

  // Rapor GÜNÜ kuru — kesitin fabrika takvim gününe göre.
  const rateRows = await prisma.$queryRaw<RateRow[]>(Prisma.sql`
    SELECT DISTINCT ON (currency) currency::text AS currency, rate::text AS rate, "rateDate" AS "rateDate"
      FROM exchange_rates
     WHERE "rateDate" <= ${factoryDayKeyUtcMidnight(asOf)}
     ORDER BY currency, "rateDate" DESC
  `);

  // ── PARA BİRİMİ BLOKLARI ───────────────────────────────────────────────────
  const rateByCurrency = new Map(rateRows.map((r) => [r.currency, r]));
  const byCurrency = new Map<string, AgingCariRow[]>();
  for (const r of rows) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push(r);
    byCurrency.set(r.currency, list);
  }

  const blocks: AgingCurrencyBlock[] = [];
  for (const [cur, list] of byCurrency) {
    // Vadesi en çok geçmiş en büyük alacak en üstte — muhasebecinin ilk baktığı
    // satır o. Eşitlikte ada göre: aynı istek aynı sırayı üretsin.
    list.sort(
      (x, y) =>
        Math.abs(Number(y.overdueTotal)) - Math.abs(Number(x.overdueTotal)) ||
        Math.abs(Number(y.openTotal)) - Math.abs(Number(x.openTotal)) ||
        x.name.localeCompare(y.name, "tr"),
    );

    const tg = emptyBuckets();
    const tn = emptyBuckets();
    let tOffset = D0();
    let tOpen = D0();
    let tCredit = D0();
    let tOverdue = D0();
    let tLedger = D0();
    for (const r of list) {
      for (const k of AGING_BUCKETS) {
        tg[k] = tg[k].plus(D(r.gross[k]));
        tn[k] = tn[k].plus(D(r.net[k]));
      }
      tOffset = tOffset.plus(D(r.virtualOffset));
      tOpen = tOpen.plus(D(r.openTotal));
      tCredit = tCredit.plus(D(r.unappliedCredit));
      tOverdue = tOverdue.plus(D(r.overdueTotal));
      tLedger = tLedger.plus(D(r.ledgerBalance));
    }

    // TL karşılığı: TRY bloğunda kur 1'dir ve kur tablosuna BAKILMAZ
    // (`resolveExchangeRateTx` ile aynı sözleşme).
    const rate = cur === Currency.TRY ? D(1) : rateByCurrency.has(cur) ? D(rateByCurrency.get(cur)!.rate) : null;
    const rateDate =
      cur === Currency.TRY ? null : rateByCurrency.get(cur)?.rateDate.toISOString().slice(0, 10) ?? null;

    blocks.push({
      currency: cur as Currency,
      tryRate: rate ? rate.toFixed(6) : null,
      rateDate,
      rows: list,
      totals: {
        gross: bucketsToStrings(tg),
        net: bucketsToStrings(tn),
        virtualOffset: tOffset.toFixed(2),
        openTotal: tOpen.toFixed(2),
        unappliedCredit: tCredit.toFixed(2),
        overdueTotal: tOverdue.toFixed(2),
        ledgerBalance: tLedger.toFixed(2),
      },
      totalsTry: rate
        ? {
            openTotal: tOpen.mul(rate).toFixed(2),
            unappliedCredit: tCredit.mul(rate).toFixed(2),
            overdueTotal: tOverdue.mul(rate).toFixed(2),
          }
        : null,
    });
  }
  blocks.sort((a, b) => (a.currency === Currency.TRY ? -1 : b.currency === Currency.TRY ? 1 : a.currency.localeCompare(b.currency)));

  // ── DENORMALİZE SAYAÇ SAPMASI ──────────────────────────────────────────────
  // `Invoice.paidTotal` / `Payment.allocatedTotal` DB seddi (CHECK) taşır ama
  // sedler yalnız ÜST SINIRI korur; sayacın allocation toplamıyla eşitliğini
  // kimse korumaz. Sapma varsa açık tutar yanlış olur ve mutabakat farkı tam
  // buradan doğar — bu yüzden rapor onu ADETLE söyler, gizlemez.
  const [invDrift, payDrift] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM invoices i
        LEFT JOIN (SELECT "invoiceId", SUM(amount) AS amt FROM payment_allocations GROUP BY 1) a
               ON a."invoiceId" = i.id
       WHERE i."paidTotal" <> COALESCE(a.amt, 0)
    `),
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM payments p
        LEFT JOIN (SELECT "paymentId", SUM(amount) AS amt FROM payment_allocations
                    WHERE "paymentId" IS NOT NULL GROUP BY 1) a
               ON a."paymentId" = p.id
       WHERE p."allocatedTotal" <> COALESCE(a.amt, 0)
    `),
  ]);

  const mismatched = rows.filter((r) => !D(r.reconDiff).isZero());
  const notes: string[] = [
    "Efektif vade: belge vadesi → yoksa fatura tarihi + cari vade günü → ikisi de yoksa satır “Vadesiz” kovasına düşer. Uydurma vade basılmaz.",
    "Kapamaya bağlanmamış tahsilat/çek tutarları rapor anında en eski vadeden başlayarak SANAL olarak mahsup edilmiştir; deftere ya da kapama kaydına HİÇBİR ŞEY yazılmaz (bkz. “Sanal mahsup” kolonu).",
    "Tutarlar cari bakiyesiyle aynı işaret sözleşmesini taşır: POZİTİF = cari bize borçlu, NEGATİF = biz ona borçluyuz.",
    "“Vadesi gelmemiş” ile “Vadesiz” ayrı kovalardır: ilki vadesi henüz dolmamış belge, ikincisi vade bilgisi olmayan belge.",
  ];
  for (const b of blocks) {
    if (b.currency !== Currency.TRY) {
      notes.push(
        b.tryRate
          ? `${b.currency} TL karşılığı ${b.rateDate} tarihli ${b.tryRate} kuruyla hesaplandı.`
          : `${b.currency} için rapor günü kuru bulunamadı — TL karşılığı BASILMADI (uydurma kur kullanılmaz).`,
      );
    }
  }
  if (mismatched.length > 0) {
    notes.push(
      `⚠️ ${mismatched.length} satırda yaşlandırma ile cari defteri UYUŞMUYOR. Fatura onayının defter satırı ya da kapama sayaçları bozulmuş olabilir; “Fark” kolonuna bakın.`,
    );
  }

  return {
    asOf: asOf.toISOString(),
    buckets: AGING_BUCKETS.map((k) => ({ key: k, label: AGING_BUCKET_LABELS[k] })),
    blocks,
    notes,
    reconciliation: {
      rowsChecked: rows.length,
      mismatchedRows: mismatched.length,
      samples: mismatched
        .slice()
        .sort((a, b) => Math.abs(Number(b.reconDiff)) - Math.abs(Number(a.reconDiff)))
        .slice(0, 10)
        .map((r) => ({ cariId: r.cariId, name: r.name, currency: r.currency, diff: r.reconDiff })),
      allocationDriftInvoices: Number(invDrift[0]?.n ?? 0),
      allocationDriftPayments: Number(payDrift[0]?.n ?? 0),
    },
  };
}
