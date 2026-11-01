// =============================================================================
// CARİ BİRLEŞTİRME VİRMANI (K3d, kullanıcı kararı 2026-10-30) — TEK YAZICI
// =============================================================================
// Aynı kartın İKİ hareketli hesabı (kart hesabı + eski fason bacağı) DEFTER TAŞIYARAK değil VİRMANLA birleşir
// (SAP transfer posting / cari virman fişi): kaynağın her para birimindeki açık kalemleri bugünün tarihli
// `CARI_TRANSFER` bacak çiftleriyle (kaynakta kapatan, hedefte açan; tek `transferGroupId`) asıl hesaba aktarılır,
// kalemin efektif vadesi hedef bacağında (`dueDate`) donar; kalemsiz bakiye (devir, avans) tek çift. Geçmiş
// satırlar YERİNDE kalır; kaynak sıfır bakiyede pasif + `mergedIntoId`. KUR DÖNÜŞÜMÜ YOK (para birimi başına).
// Ters yol `cari-merge-revert.helper.ts`. Yazan tek yer burası (bekçi `test_cari_birlestirme_virman`).
// =============================================================================
import { createHash, randomUUID } from "node:crypto";
import { CariTxnSource, ChequeStatus, Currency, InvoiceStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { collectAgingRows } from "../reports/finance-aging.report";
import { factoryDayStart } from "../../constants/time";
import { D, D0, applyCariBalanceTx } from "./finance.helper";
import { activeHoldByCari } from "./cari-hold.helper";
import { assertPeriodsOpenTx, periodDayKey } from "./period-guard.helper";

/** İki hesapta FARKLI dolu ise birleştirme DURUR (K3a kuralı); hedefte boşsa kaynaktan taşınır. */
const TERM_FIELDS = ["paymentTermDays", "taxOffice", "riskLimit", "serviceBillingTrigger", "notes", "vatRate", "withholdingEnabled", "withholdingNumerator", "withholdingDenominator"] as const;
/** Sonuçlanmamış çek: hâlâ cariye hareket yazabilir (tahsil/karşılıksız/iade) → birleştirme DURUR. */
const OPEN_CHEQUE_STATUSES: ChequeStatus[] = [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK, ChequeStatus.ENDORSED, ChequeStatus.ISSUED];

const ACCOUNT_SELECT = {
  id: true, isActive: true, mergedIntoId: true, customerId: true, subcontractorId: true, defaultCurrency: true,
  paymentTermDays: true, taxOffice: true, riskLimit: true, serviceBillingTrigger: true, notes: true,
  vatRate: true, withholdingEnabled: true, withholdingNumerator: true, withholdingDenominator: true,
  customer: { select: { code: true, name: true, mergedIntoId: true } },
  subcontractor: { select: { code: true, name: true, customerId: true } },
} as const;
type AccountRow = Prisma.CariAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export interface CariMergeItem {
  currency: Currency;
  /** Faturalı kalem; kalemsiz bakiyede (devir · avans) null. */
  invoiceId: string | null;
  docNo: string;
  /** Kaynaktaki İŞARETLİ açık tutar (pozitif = cari bize borçlu). */
  signedAmount: string;
  /** Kaynaktaki efektif vade (yaşlandırma çekirdeğinden); hedef bacağına donar. */
  dueDate: string | null;
}

export interface CariMergePlan {
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  /** Kaynak zaten bu hedefe birleşmiş — idempotent: yazım yok. */
  alreadyMerged: boolean;
  /** Boş değilse birleştirme YAPILMAZ (fail-closed); her satır kullanıcıya okunur gerekçe. */
  blockers: string[];
  /** Kaynak, birleşmiş (mezar taşı) bir kartın hesabıysa o kartın survivor'ı — claim bu bağı yeniden sorar. */
  sourceTombstoneOf?: string | null;
  balances: Array<{ currency: Currency; source: string; target: string }>;
  items: CariMergeItem[];
  termsToCopy: Record<string, unknown>;
  draftInvoices: number;
}

const label = (a: AccountRow): string => {
  const p = a.customer ?? a.subcontractor;
  return p ? `${p.code} ${p.name}` : a.id;
};
/**
 * Hesabın KİMLİĞİ: kart hesabında kart — ana veri birleştirmesinin mezar taşında kalan hesabı (KEEP_ON_SOURCE)
 * mezar taşının survivor'ına çözülür (tek düzey; survivor'ın kendisi birleşmişse zincir izlenmez → farklı kimlik).
 */
const cardOf = (a: AccountRow): string | null =>
  a.customerId ? (a.customer?.mergedIntoId ?? a.customerId) : (a.subcontractor?.customerId ?? null);
/** Mezar taşındaki kart hesabı: `customerId @unique` mezar taşında kalır, kaynak olması kilit doğurmaz. */
const onTombstone = (a: AccountRow): string | null => (a.customerId ? (a.customer?.mergedIntoId ?? null) : null);

function termDecision(source: AccountRow, target: AccountRow): { copy: Record<string, unknown>; conflicts: string[] } {
  const copy: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const f of TERM_FIELDS) {
    const s = source[f];
    const t = target[f];
    if (s == null) continue;
    if (t == null) copy[f] = s;
    else if (String(s) !== String(t)) conflicts.push(f);
  }
  if (source.defaultCurrency !== Currency.TRY) {
    if (target.defaultCurrency === Currency.TRY) copy.defaultCurrency = source.defaultCurrency;
    else if (target.defaultCurrency !== source.defaultCurrency) conflicts.push("defaultCurrency");
  }
  return { copy, conflicts };
}

async function accountBlockers(source: AccountRow, target: AccountRow): Promise<string[]> {
  const b: string[] = [];
  if (source.id === target.id) b.push("Kaynak ve hedef aynı hesap.");
  if (source.mergedIntoId) b.push(`Kaynak hesap zaten başka bir hesaba birleşmiş (${source.mergedIntoId}).`);
  else if (!source.isActive) b.push("Kaynak hesap pasif — önce aktifleştirin.");
  // Zincir kurulmaz: kendisine başka hesap birleşmiş hesap kaynak olursa ilk birleşmenin geri alması hedefsiz kalır.
  const mergedIntoSource = await prisma.cariAccount.count({ where: { mergedIntoId: source.id } });
  if (mergedIntoSource > 0) b.push(`Kaynak hesaba daha önce ${mergedIntoSource} hesap birleşmiş — bu hesap kaynak olamaz, hedef seçin.`);
  if (target.mergedIntoId) b.push("Hedef hesap kendisi birleşmiş — asıl hesabı hedef seçin.");
  else if (!target.isActive) b.push("Hedef hesap pasif — önce aktifleştirin.");
  if (onTombstone(target)) b.push("Hedef, birleşmiş (kaldırılmış) bir kartın hesabı — kalan kartın hesabını hedef seçin.");
  // Kart hesabı kaynak olursa `customerId @unique` kaynakta kalır ve eski bacağın karta çevrilmesi kilitlenir.
  if (source.customerId && !onTombstone(source)) b.push("Kaynak kartın kendi hesabı — birleştirme eski bacaktan kart hesabına yapılır (yönü çevirin).");
  const card = cardOf(source);
  if (!card || card !== cardOf(target)) b.push("Hesaplar aynı karta ait değil — farklı kimlikler birleştirilmez.");
  const { conflicts } = termDecision(source, target);
  if (conflicts.length > 0) b.push(`Terim çatışması (${conflicts.join(", ")}) — hangi değerin kalacağı kullanıcı kararı.`);
  const ids = [source.id, target.id];
  // Kilit yüklemi tek kaynak (cari-hold.helper); iki hesap sırayla sorulur.
  let holds = 0;
  for (const id of ids) if (await activeHoldByCari(prisma, id)) holds++;
  if (holds > 0) b.push(`Aktif cari kilidi var (${holds}) — önce kilidi açın.`);
  const cheques = await prisma.cheque.findMany({
    where: { status: { in: OPEN_CHEQUE_STATUSES }, OR: [{ cariId: source.id }, { endorsedToCariId: source.id }] },
    select: { docNo: true, status: true },
    orderBy: { docNo: "asc" },
  });
  if (cheques.length > 0) b.push(`Sonuçlanmamış çek/senet: ${cheques.map((c) => `${c.docNo} (${c.status})`).join(", ")}.`);
  // Mutabakat mektubu kesit tarihindeki bakiyeyi ilan eder; kesiti bugünü kapsayan aktif mektup virmanla çelişir.
  const letters = await prisma.reconciliationLetter.findMany({ where: { cariId: source.id, status: "ACTIVE", asOf: { gte: factoryDayStart() } }, select: { docNo: true } });
  if (letters.length > 0) b.push(`Açık mutabakat mektubu: ${letters.map((l) => l.docNo).join(", ")}.`);
  const closed = await prisma.cariPeriodClose.findMany({ where: { cariId: { in: ids }, reopenedAt: null, periodEnd: { gte: periodDayKey(new Date()) } }, select: { currency: true } });
  if (closed.length > 0) b.push(`Bugün kapalı dönemde (${[...new Set(closed.map((c) => c.currency))].join(", ")}) — virman bugüne yazılır.`);
  return b;
}

/** ÖN İZLEME — yazmaz. Kalemler yaşlandırma çekirdeğinden (efektif vade + açık tutar TEK kaynak). */
export async function planCariMerge(sourceId: string, targetId: string): Promise<CariMergePlan> {
  const [source, target] = [
    await prisma.cariAccount.findUnique({ where: { id: sourceId }, select: ACCOUNT_SELECT }),
    await prisma.cariAccount.findUnique({ where: { id: targetId }, select: ACCOUNT_SELECT }),
  ];
  if (!source || !target) throw AppError.notFound("Cari hesap bulunamadı.");
  const base = { sourceId, targetId, sourceLabel: label(source), targetLabel: label(target) };
  if (source.mergedIntoId === targetId) {
    return { ...base, alreadyMerged: true, blockers: [], balances: [], items: [], termsToCopy: {}, draftInvoices: 0 };
  }
  const blockers = await accountBlockers(source, target);
  const sourceTombstoneOf = onTombstone(source);
  const bal = await prisma.cariBalance.findMany({ where: { cariId: { in: [sourceId, targetId] } }, select: { cariId: true, currency: true, balance: true } });
  const currencies = [...new Set(bal.filter((r) => !D(r.balance).isZero()).map((r) => r.currency))].sort();
  const balanceOf = (id: string, c: Currency): Prisma.Decimal => D(bal.find((r) => r.cariId === id && r.currency === c)?.balance ?? 0);

  const rows = await collectAgingRows({ asOf: new Date(), cariId: sourceId, includeDetail: true });
  const items: CariMergeItem[] = [];
  for (const row of rows) {
    if (row.storedDiff && !D(row.storedDiff).isZero()) blockers.push(`${row.currency} defter toplamı ile saklı bakiye ayrışmış (fark ${row.storedDiff}) — önce mutabakat.`);
    let rest = D(row.ledgerBalance);
    for (const it of row.items ?? []) {
      if (!it.invoiceId || D(it.open).isZero()) continue;
      items.push({ currency: row.currency, invoiceId: it.invoiceId, docNo: it.docNo, signedAmount: D(it.open).toFixed(2), dueDate: it.effectiveDueDate });
      rest = rest.minus(D(it.open));
    }
    if (!rest.isZero()) items.push({ currency: row.currency, invoiceId: null, docNo: "Kalemsiz bakiye", signedAmount: rest.toFixed(2), dueDate: null });
  }
  for (const c of currencies) {
    const sum = items.filter((i) => i.currency === c).reduce((s, i) => s.plus(D(i.signedAmount)), D0());
    if (!sum.equals(balanceOf(sourceId, c))) blockers.push(`${c} kalem toplamı (${sum.toFixed(2)}) kaynak bakiyesine (${balanceOf(sourceId, c).toFixed(2)}) eşit değil.`);
  }
  const draftInvoices = await prisma.invoice.count({ where: { cariId: sourceId, status: InvoiceStatus.DRAFT } });
  return {
    ...base,
    alreadyMerged: false,
    blockers,
    sourceTombstoneOf,
    balances: currencies.map((c) => ({ currency: c, source: balanceOf(sourceId, c).toFixed(2), target: balanceOf(targetId, c).toFixed(2) })),
    items,
    termsToCopy: termDecision(source, target).copy,
    draftInvoices,
  };
}

/**
 * Ön izleme SÜRÜM DAMGASI — kullanıcıya gösterilen kayıt kümesinin özeti. Uygula ucu damgayı yeniden hesaplar;
 * farklıysa (arada fatura/ödeme/terim/engel değişti) 409 `CARI_MERGE_STALE` — onaylanmamış küme yazılmaz.
 */
export function cariMergePlanStamp(plan: CariMergePlan): string {
  const body = { s: plan.sourceId, t: plan.targetId, m: plan.alreadyMerged, b: plan.blockers, bal: plan.balances, i: plan.items, terms: plan.termsToCopy, d: plan.draftInvoices };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

export interface CariMergeApplyOptions {
  /** Panel yolu: ön izlemedeki damga; verilmezse (betik) kontrol yok. */
  expectedStamp?: string;
  /** Panel yolu: virman bacaklarının grup kimliği = istemcinin clientToken'ı (replay okuyucusu bacaklardan bulur). */
  transferGroupId?: string;
}

export interface CariMergeResult {
  alreadyMerged: boolean;
  transferGroupId: string | null;
  legs: number;
  movedDrafts: number;
}

/**
 * Birleştirmeyi YAZAR (tek tx). ENGEL varsa 409 `CARI_MERGE_BLOCKED` + liste, sıfır yazım. Kaynak zaten bu hedefe
 * birleşmişse 0 yazım. Kilit: iki hesabın her para biriminin dönem kilidi (sıralı) tx'in ilk ifadesi.
 */
export async function applyCariMerge(sourceId: string, targetId: string, userId?: string, opts: CariMergeApplyOptions = {}): Promise<CariMergeResult> {
  const plan = await planCariMerge(sourceId, targetId);
  if (plan.alreadyMerged) return { alreadyMerged: true, transferGroupId: null, legs: 0, movedDrafts: 0 };
  if (opts.expectedStamp !== undefined && opts.expectedStamp !== cariMergePlanStamp(plan)) {
    throw AppError.conflict("Ön izlemeden sonra kayıtlar değişti — ön izlemeyi yenileyin.", { code: "CARI_MERGE_STALE" });
  }
  if (plan.blockers.length > 0) {
    throw AppError.conflict(`Cari birleştirme yapılamaz: ${plan.blockers.join(" · ")}`, { code: "CARI_MERGE_BLOCKED", blockers: plan.blockers });
  }
  const groupId = plan.items.length > 0 ? (opts.transferGroupId ?? randomUUID()) : null;
  const result = await prisma.$transaction((tx) => applyCariMergeTx(tx, plan, groupId, userId));
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "CARI_ACCOUNT",
    recordId: sourceId,
    // Tutar yükte YOK (sır/para hijyeni) — kimlik + sayılar.
    newData: { event: "CARI_MERGE", mergedIntoId: targetId, transferGroupId: groupId, legs: result.legs, currencies: plan.balances.map((b) => b.currency), movedDrafts: result.movedDrafts, copiedTerms: Object.keys(plan.termsToCopy) },
  });
  return result;
}

export async function applyCariMergeTx(tx: Prisma.TransactionClient, plan: CariMergePlan, groupId: string | null, userId?: string): Promise<CariMergeResult> {
  const now = new Date();
  const currencies = plan.balances.map((b) => b.currency);
  // TX'İN İLK İFADESİ: (cari, para birimi) dönem kilidi — iki hesap, sıralı (period-guard ikili kuralı) + kapalı dönem 409.
  await assertPeriodsOpenTx(tx, currencies.flatMap((currency) => [plan.sourceId, plan.targetId].map((cariId) => ({ cariId, currency, txnDate: now }))));
  // Kilit altında taze bakiye = ön izleme; arada yazım olduysa plan bayattır.
  const fresh = await tx.cariBalance.findMany({ where: { cariId: plan.sourceId }, select: { currency: true, balance: true } });
  for (const r of fresh) {
    const expected = plan.balances.find((b) => b.currency === r.currency)?.source ?? "0.00";
    if (!D(r.balance).equals(D(expected))) throw AppError.conflict("Kaynak hesap ön izlemeden sonra değişti — ön izlemeyi yenileyin.", { code: "CARI_MERGE_STALE" });
  }
  // Ön izlemeden sonra konan kilit/çek defter yazmaz (bayatlık görmez) → tx içinde yeniden sorulur.
  for (const id of [plan.sourceId, plan.targetId]) {
    if (await activeHoldByCari(tx, id)) throw AppError.conflict("Ön izlemeden sonra cari kilidi kondu — önce kilidi açın.", { code: "CARI_MERGE_BLOCKED", blockers: ["Aktif cari kilidi var."] });
  }
  const openCheques = await tx.cheque.count({ where: { status: { in: OPEN_CHEQUE_STATUSES }, OR: [{ cariId: plan.sourceId }, { endorsedToCariId: plan.sourceId }] } });
  if (openCheques > 0) throw AppError.conflict("Ön izlemeden sonra sonuçlanmamış çek/senet doğdu.", { code: "CARI_MERGE_BLOCKED", blockers: [`Sonuçlanmamış çek/senet (${openCheques}).`] });
  // ATOMİK CLAIM: aktif ve birleşmemiş kaynak; eşzamanlı ikinci birleştirme 0 satır → 409.
  // Mezar taşı kaynağında kart birleşmesi hâlâ yerinde olmalı (arada ana veri geri alındıysa iki ayrı kimlik → 409).
  const tombstone = plan.sourceTombstoneOf ? { customer: { mergedIntoId: plan.sourceTombstoneOf } } : {};
  const claim = await tx.cariAccount.updateMany({ where: { id: plan.sourceId, isActive: true, mergedIntoId: null, mergedFrom: { none: {} }, ...tombstone }, data: { isActive: false, mergedIntoId: plan.targetId } });
  if (claim.count === 0) throw AppError.conflict("Kaynak hesap bu sırada birleştirildi ya da pasife alındı.", { code: "CARI_MERGE_CONFLICT" });
  const target = await tx.cariAccount.updateMany({ where: { id: plan.targetId, isActive: true, mergedIntoId: null }, data: plan.termsToCopy as Prisma.CariAccountUpdateManyMutationInput });
  if (target.count === 0) throw AppError.conflict("Hedef hesap bu sırada pasife alındı ya da birleşti.", { code: "CARI_MERGE_CONFLICT" });

  const description = `Birleştirme virmanı: ${plan.sourceLabel} → ${plan.targetLabel}`;
  const legs: Prisma.CariTransactionCreateManyInput[] = [];
  for (const it of plan.items) {
    const amt = D(it.signedAmount);
    const abs = amt.abs();
    const common = { currency: it.currency, txnDate: now, amountTry: it.currency === Currency.TRY ? abs : D0(), exchangeRate: D(1), sourceType: CariTxnSource.CARI_TRANSFER, invoiceId: it.invoiceId, transferGroupId: groupId, createdById: userId ?? null };
    const desc = `${description}${it.invoiceId ? ` (${it.docNo})` : ""}`.slice(0, 300);
    // Kaynakta kalemi KAPATAN, hedefte AYNI kalemi açan bacak (vade hedefte donar).
    legs.push({ ...common, cariId: plan.sourceId, debit: amt.lt(0) ? abs : D0(), credit: amt.gt(0) ? abs : D0(), description: desc });
    legs.push({ ...common, cariId: plan.targetId, debit: amt.gt(0) ? abs : D0(), credit: amt.lt(0) ? abs : D0(), dueDate: it.dueDate ? new Date(it.dueDate) : null, description: desc });
  }
  if (legs.length > 0) await tx.cariTransaction.createMany({ data: legs });
  for (const c of currencies) {
    const sum = plan.items.filter((i) => i.currency === c).reduce((s, i) => s.plus(D(i.signedAmount)), D0());
    await applyCariBalanceTx(tx, plan.sourceId, c, sum.negated());
    await applyCariBalanceTx(tx, plan.targetId, c, sum);
  }
  const left = await tx.cariBalance.count({ where: { cariId: plan.sourceId, balance: { not: 0 } } });
  if (left > 0) throw AppError.conflict("Kaynak hesap sıfırlanamadı — birleştirme geri alındı.", { code: "CARI_MERGE_STALE" });
  // Deftere hiç yazmamış TASLAK fatura asıl hesaba taşınır (taslak taşıma değil, henüz belge değil).
  const moved = await tx.invoice.updateMany({ where: { cariId: plan.sourceId, status: InvoiceStatus.DRAFT, confirmedAt: null }, data: { cariId: plan.targetId } });
  return { alreadyMerged: false, transferGroupId: groupId, legs: legs.length, movedDrafts: moved.count };
}
