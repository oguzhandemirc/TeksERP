// Çek/senet portföyü içe aktarım adaptörü — toplu açılış aktarımı.
//
// Yazım TEK KAYNAKTAN: `chequeService.create` (belge no · kur · defter satırı · olay · dönem kilidi) —
// tekil formla aynı satırları yazar. Anahtar yön + cari + seri no; aynı carinin aynı seri numaralı canlı
// (iptal edilmemiş) belgesi varsa satır HATA. Geri sarma belgeyi SİLMEZ: `cancel` ters kaydı bugüne yazar.
import { ChequeDocType, ChequeKind, ChequeStatus, Currency } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { chequeService } from "../../cheque.service";
import { resolveExchangeRateTx } from "../../helpers/finance.helper";
import { factoryDateTr } from "../../../constants/time";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import {
  CARI_COLUMNS,
  CURRENCY_VALUES,
  cardKey,
  checkPeriodOpen,
  claimInFile,
  joinKey,
  resolveCari,
  revertBranchMessage,
  type ResolvedCari,
} from "./opening-import.shared";

const REVERT_REASON = "İçe aktarım geri sarması";
/** `chequeService.cancel`ın kabul ettiği durumlar — önizleme engeli bunun aynası. */
const CANCELLABLE: readonly ChequeStatus[] = [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK, ChequeStatus.ISSUED];

const COLUMNS: ImportColumn[] = [
  {
    key: "kind",
    label: "Yön",
    type: "enum",
    required: true,
    enumValues: [
      { value: ChequeKind.RECEIVED, label: "Alınan" },
      { value: ChequeKind.ISSUED, label: "Verilen" },
    ],
    example: "Alınan",
  },
  {
    key: "docType",
    label: "Belge Türü",
    type: "enum",
    enumValues: [
      { value: ChequeDocType.CHEQUE, label: "Çek" },
      { value: ChequeDocType.PROMISSORY_NOTE, label: "Senet" },
    ],
    help: "Boş = Çek.",
    example: "Çek",
  },
  ...CARI_COLUMNS,
  { key: "serialNo", label: "Seri No", type: "text", required: true, maxLen: 64, help: "Kâğıdın üzerindeki seri/senet no.", example: "1234567" },
  { key: "amount", label: "Tutar", type: "number", required: true, example: "25000" },
  { key: "currency", label: "Para Birimi", type: "enum", required: true, enumValues: CURRENCY_VALUES, example: "TRY" },
  { key: "exchangeRate", label: "Kur", type: "number", help: "Boş = işlem tarihindeki kayıtlı kur (TRY'de 1).", example: "" },
  { key: "dueDate", label: "Vade", type: "date", required: true, example: "15.02.2027" },
  { key: "issueDate", label: "Keşide Tarihi", type: "date", help: "Boş = bugün.", example: "" },
  { key: "postingDate", label: "İşlem Tarihi", type: "date", help: "Defter tarihi; boş = bugün.", example: "" },
  { key: "bankName", label: "Banka", type: "text", maxLen: 100, example: "Ziraat" },
  { key: "branchName", label: "Şube", type: "text", maxLen: 100, example: "" },
  { key: "drawerName", label: "Keşideci", type: "text", maxLen: 150, example: "Örnek Tekstil" },
  { key: "notes", label: "Not", type: "text", maxLen: 500, example: "" },
];

const resolved = new WeakMap<PreparedRow, ResolvedCari>();

export const chequePortfolioImportAdapter: ImportAdapter = {
  entity: "chequePortfolio",
  label: "Çek/Senet Portföyü",
  tableName: "CHEQUE",
  writePermission: "finance:cheque",
  readPermission: "finance:read",
  module: "finans",
  keyColumns: ["serialNo"],
  columns: COLUMNS,
  rowKey: (v) => joinKey(v, ["kind", "cariType", "cariCode", "serialNo"]),
  notes: [
    "Her satır bir çek/senettir; alınanlar PORTFÖYDE, verilenler VERİLDİ durumunda doğar. Yalnız YENİ kayıt yazılır.",
    "Çek girişi cari defterine işler (tekil çek girişiyle aynı): alınan çek cariyi alacaklandırır.",
    "Bankaya verilmiş çeki portföyde aktarıp sonra Bankaya Ver ile işleyin.",
  ],

  async findExisting() {
    return new Map();
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    if (v.amount === 0) row.result.errors.push({ column: "amount", message: "Tutar sıfırdan büyük olmalı." });
    if (v.exchangeRate === 0) row.result.errors.push({ column: "exchangeRate", message: "Kur sıfır olamaz." });
    const cari = await resolveCari(row, ctx);
    if (!cari || typeof v.serialNo !== "string" || typeof v.kind !== "string") return;
    resolved.set(row, cari);
    claimInFile(ctx, row, { key: `${v.kind}|${cardKey(cari.card)}|${importKey(v.serialNo)}`, column: "serialNo", message: "Aynı seri no dosyada iki kez var" });
    const currency = v.currency as Currency | undefined;
    const postingDate = (v.postingDate as Date | undefined) ?? new Date();
    if (currency && currency !== Currency.TRY && v.exchangeRate === undefined && !(await resolveExchangeRateTx(prisma, currency, postingDate))) {
      row.result.errors.push({ column: "exchangeRate", message: `${currency} için ${factoryDateTr(postingDate)} tarihli kur yok — Kur sütununu doldurun ya da Kurlar ekranından girin.` });
    }
    if (!cari.account) return;
    const dup = await prisma.cheque.findFirst({
      where: { cariId: cari.account.id, kind: v.kind as ChequeKind, serialNo: { equals: v.serialNo, mode: "insensitive" }, status: { not: ChequeStatus.CANCELLED } },
      select: { docNo: true },
    });
    if (dup) row.result.errors.push({ column: "serialNo", message: `Bu seri no bu caride zaten kayıtlı (${dup.docNo}).` });
    if (currency) await checkPeriodOpen(row, cari, { currency, txnDate: postingDate, column: "postingDate" });
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    const cari = resolved.get(row);
    if (!cari) throw new Error("Cari çözümü önizlemede yapılmadı.");
    const out = await chequeService.create(
      {
        kind: v.kind as ChequeKind,
        docType: (v.docType as ChequeDocType | undefined) ?? undefined,
        customerId: cari.party.customerId,
        subcontractorId: cari.party.subcontractorId,
        currency: v.currency as Currency,
        exchangeRate: v.exchangeRate !== undefined && v.exchangeRate !== null ? String(v.exchangeRate) : null,
        amount: String(v.amount),
        issueDate: v.issueDate as Date | undefined,
        postingDate: v.postingDate as Date | undefined,
        dueDate: v.dueDate as Date,
        serialNo: v.serialNo as string,
        bankName: (v.bankName as string | undefined) ?? null,
        branchName: (v.branchName as string | undefined) ?? null,
        drawerName: (v.drawerName as string | undefined) ?? null,
        notes: (v.notes as string | undefined) ?? null,
      },
      ctx.userId,
    );
    return { id: out.data!.id };
  },

  async updateOne() {
    throw new Error("Çek/senet içe aktarımla güncellenmez.");
  },

  async exportRows() {
    const rows = await prisma.cheque.findMany({
      where: { status: { in: [ChequeStatus.PORTFOLIO, ChequeStatus.ISSUED] } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: {
        kind: true, docType: true, serialNo: true, amount: true, currency: true, exchangeRate: true, dueDate: true, issueDate: true,
        postingDate: true, bankName: true, branchName: true, drawerName: true, notes: true,
        cari: { select: { customer: { select: { code: true } }, subcontractor: { select: { code: true } } } },
      },
    });
    return rows.map((r) => ({
      kind: r.kind === ChequeKind.RECEIVED ? "Alınan" : "Verilen",
      docType: r.docType === ChequeDocType.CHEQUE ? "Çek" : "Senet",
      cariType: r.cari.customer ? "Müşteri" : "Fason",
      cariCode: r.cari.customer?.code ?? r.cari.subcontractor?.code ?? "",
      serialNo: r.serialNo ?? "",
      amount: r.amount.toString(),
      currency: r.currency,
      exchangeRate: r.exchangeRate.toString(),
      dueDate: factoryDateTr(r.dueDate),
      issueDate: factoryDateTr(r.issueDate),
      postingDate: factoryDateTr(r.postingDate),
      bankName: r.bankName ?? "",
      branchName: r.branchName ?? "",
      drawerName: r.drawerName ?? "",
      notes: r.notes ?? "",
    }));
  },

  async reverseBlockers(records) {
    const out = new Map<string, string>();
    for (const r of records) {
      if (!CANCELLABLE.includes(r.status as ChequeStatus)) out.set(String(r.id), `Belge ilerlemiş (${String(r.status)}) — önce ilgili hareketi geri alın`);
    }
    return out;
  },

  async revertVersion(line, userId) {
    try {
      await chequeService.cancel(line.recordId, REVERT_REASON, userId);
      return null;
    } catch (e) {
      const msg = revertBranchMessage(e);
      if (msg) return msg;
      throw e;
    }
  },
};
