// Cari açılış (devir) bakiyesi içe aktarım adaptörü — toplu açılış aktarımı.
//
// Yazım TEK KAYNAKTAN: `cariService.setOpeningBalance` (kilit · mükerrer devir · dönem kilidi · bakiye) —
// ikinci defter yazarı yok; tekil uçla aynı satırı yazar. Anahtar cari + döviz; aynı cari+döviz için aktif
// devir varsa ya da dosyada iki kez geçiyorsa satır HATA. Geri sarma devri SİLMEZ: `cancelOpeningBalance`
// ters kaydı bugüne yazar (yalnız içe aktarılan devir hâlâ aktifse).
import { CariTxnSource, type Currency } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { cariService } from "../../cari.service";
import { CARI_STATEMENT_ORDER, ensureCariAccountTx } from "../../helpers/finance.helper";
import { factoryDateTr } from "../../../constants/time";
import { logLegacyLegAdoption } from "../../helpers/cari-account-adopt.helper";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
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

const COLUMNS: ImportColumn[] = [
  ...CARI_COLUMNS,
  { key: "currency", label: "Para Birimi", type: "enum", required: true, enumValues: CURRENCY_VALUES, example: "TRY" },
  { key: "amount", label: "Tutar", type: "number", required: true, help: "Sıfırdan büyük; yön ayrı sütunda.", example: "12500,00" },
  {
    key: "direction",
    label: "Yön",
    type: "enum",
    required: true,
    enumValues: [
      { value: "DEBIT", label: "Borçlu" },
      { value: "CREDIT", label: "Alacaklı" },
    ],
    help: "Borçlu = cari BİZE borçlu (alacağımız); Alacaklı = biz cariye borçluyuz.",
    example: "Borçlu",
  },
  { key: "txnDate", label: "Açılış Tarihi", type: "date", help: "Boş = bugün. Kapalı döneme düşen tarih reddedilir.", example: "31.12.2026" },
  { key: "description", label: "Açıklama", type: "text", maxLen: 300, example: "Devir bakiyesi" },
];

const resolved = new WeakMap<PreparedRow, ResolvedCari>();

export const cariOpeningBalanceImportAdapter: ImportAdapter = {
  entity: "cariOpeningBalance",
  label: "Cari Açılış Bakiyeleri",
  tableName: "CARI_ACCOUNT",
  writePermission: "finance:invoice",
  readPermission: "finance:read",
  module: "finans",
  keyColumns: ["cariCode"],
  columns: COLUMNS,
  rowKey: (v) => joinKey(v, ["cariType", "cariCode", "currency"]),
  notes: [
    "Her satır bir carinin BİR para birimindeki açılış (devir) bakiyesidir; yalnız YENİ kayıt yazılır.",
    "Aynı cari + para birimi için devir zaten girilmişse satır hata verir — düzeltmek için önce Devri İptal Et.",
    "Portföydeki çekleri ayrıca içe aktaracaksanız: çek girişi cariyi ayrıca alacaklandırır; açılış bakiyesini çekler düşülmeden girin.",
  ],

  async findExisting() {
    // Varlık kontrolü kart çözümünden SONRA (kod ya da ad) `validateRow`da — anahtar metni kimlik değildir.
    return new Map();
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    if (v.amount === 0) row.result.errors.push({ column: "amount", message: "Tutar sıfır olamaz — sıfır bakiye için kayıt gerekmez." });
    const cari = await resolveCari(row, ctx);
    if (!cari || typeof v.currency !== "string") return;
    resolved.set(row, cari);
    const currency = v.currency as Currency;
    claimInFile(ctx, row, { key: `${cardKey(cari.card)}|${currency}`, column: "cariCode", message: "Aynı cari + para birimi dosyada iki kez var" });
    if (!cari.account) return;
    const dup = await prisma.cariTransaction.findFirst({
      where: { cariId: cari.account.id, currency, sourceType: CariTxnSource.ADJUSTMENT, reversedBy: { is: null } },
      select: { id: true },
    });
    if (dup) {
      row.result.errors.push({ column: "currency", message: `Bu cari için ${currency} devri zaten girilmiş — düzeltmek için önce mevcut devri iptal edin.` });
    }
    await checkPeriodOpen(row, cari, { currency, txnDate: (v.txnDate as Date | undefined) ?? new Date(), column: "txnDate" });
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    const cari = resolved.get(row);
    if (!cari) throw new Error("Cari çözümü önizlemede yapılmadı.");
    // Hesap yoksa kartın TEK fabrikası açar (çek girişinin lazy yolu); devir yazımı sonra servisten.
    const account = await prisma.$transaction((tx) => ensureCariAccountTx(tx, cari.party));
    logLegacyLegAdoption(account.adopted, ctx.userId);
    const amount = String(v.amount);
    const out = await cariService.setOpeningBalance(
      {
        cariId: account.id,
        currency: v.currency as Currency,
        balance: v.direction === "CREDIT" ? `-${amount}` : amount,
        description: (v.description as string | undefined) ?? null,
        txnDate: v.txnDate as Date | undefined,
      },
      ctx.userId,
    );
    return { id: out.data!.id };
  },

  async updateOne() {
    throw new Error("Açılış bakiyesi güncellenmez — devri iptal edip yeniden girin.");
  },

  async exportRows() {
    const rows = await prisma.cariTransaction.findMany({
      where: { sourceType: CariTxnSource.ADJUSTMENT, reversedBy: { is: null } },
      orderBy: CARI_STATEMENT_ORDER,
      select: {
        currency: true, debit: true, credit: true, txnDate: true, description: true,
        cari: { select: { customer: { select: { code: true } }, subcontractor: { select: { code: true } } } },
      },
    });
    return rows.map((r) => {
      const isDebit = r.debit.gt(0);
      return {
        cariType: r.cari.customer ? "Müşteri" : "Fason",
        cariCode: r.cari.customer?.code ?? r.cari.subcontractor?.code ?? "",
        currency: r.currency,
        amount: (isDebit ? r.debit : r.credit).toString(),
        direction: isDebit ? "Borçlu" : "Alacaklı",
        // Fabrika günü GG.AA.YYYY — `parseDateCell` aynı güne döner (UTC ISO metni günü kaydırarak gösterirdi).
        txnDate: factoryDateTr(r.txnDate),
        description: r.description ?? "",
      };
    });
  },

  async reverseBlockers(records) {
    const ids = records.map((r) => String(r.id));
    if (ids.length === 0) return new Map();
    const reversals = await prisma.cariTransaction.findMany({ where: { reversesTxnId: { in: ids } }, select: { reversesTxnId: true } });
    return new Map(reversals.map((r) => [String(r.reversesTxnId), "Devir zaten iptal edilmiş (ters kaydı var)"]));
  },

  async revertVersion(line, userId) {
    const txn = await prisma.cariTransaction.findUnique({ where: { id: line.recordId }, select: { cariId: true, currency: true } });
    if (!txn) return "Devir satırı bulunamadı";
    try {
      await cariService.cancelOpeningBalance({ cariId: txn.cariId, currency: txn.currency, reason: REVERT_REASON, expectedTxnId: line.recordId }, userId);
      return null;
    } catch (e) {
      const msg = revertBranchMessage(e);
      if (msg) return msg;
      throw e;
    }
  },
};
