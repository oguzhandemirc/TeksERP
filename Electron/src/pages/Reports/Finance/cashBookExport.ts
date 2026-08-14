// =============================================================================
// KASA / BANKA DEFTERİ — dışa aktarım spec'i (TEK spec → Excel + PDF + Yazdır)
// =============================================================================
// ⚠️ İKİ TABLO, İKİ SORU: "Hesap Özeti" hangi hesapta ne kadar hareket olduğunu,
// "Defter" ise TEK hesabın satır satır dökümünü ve yürüyen bakiyesini söyler.
// İkincisi yalnız bir hesap seçiliyse üretilir — iki hesabın hareketi tek
// sütunda toplanırsa çıkan sayı hiçbir hesabın bakiyesi olmaz (backend de bu
// yüzden `rows`'u yalnız tek hesapta döner).
//
// ⚠️ GENEL TOPLAM yalnız `totals` doluysa (tek para birimi) basılır. Farklı
// para birimli kasaları toplamak "kasada 1,2 milyon var" gibi bir yalan üretir.
//
// ⚠️ "Fark" (kapanış − kayıtlı bakiye) `storedComparable` false iken YAZILMAZ:
// kayıtlı bakiye her zaman "şu an"dır, geçmiş bir kesitle karşılaştırmak tanım
// gereği fark üretir ve o fark UYDURMADIR.
// =============================================================================

import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import { toNum } from "./service";
import {
  ACCOUNT_KIND_LABEL,
  CASH_KIND_LABEL,
  CASH_SOURCE_LABEL,
  type CashBookAccountSummary,
  type CashBookReport,
} from "./cashBookService";

const MONEY = "#,##0.00";

export function buildCashBookExport(opts: {
  summary: CashBookReport;
  /** Tek hesap seçiliyse o hesabın defteri — yoksa `null`. */
  ledger: { account: CashBookAccountSummary; report: CashBookReport } | null;
  periodLabel: string;
}): ReportExportSpec {
  const { summary, ledger, periodLabel } = opts;

  const meta = [`Dönem: ${periodLabel}`, ...summary.notes];
  // Defter sorgusunun kendi notları (satır kırpma gibi) özet notlarında YOKTUR;
  // atlanırsa "5000 satırda kesildi" uyarısı tam da eksik satırların olduğu
  // dosyada görünmez olurdu.
  if (ledger) {
    for (const n of ledger.report.notes) if (!meta.includes(n)) meta.push(n);
  }

  const tables: ReportTableSpec[] = [accountsTable(summary)];
  if (ledger) tables.push(ledgerTable(ledger.account, ledger.report));

  return { title: "Kasa & Banka Defteri", subtitle: periodLabel, meta, tables };
}

function accountsTable(rep: CashBookReport): ReportTableSpec {
  const showDiff = rep.storedComparable;
  return {
    name: "Hesap Özeti",
    columns: [
      { header: "Tür", key: "kind", width: 8 },
      { header: "Kod", key: "code", width: 12 },
      { header: "Hesap", key: "name", width: 28 },
      { header: "Para", key: "currency", width: 7 },
      { header: "Devir", key: "opening", width: 15, numFmt: MONEY, align: "right" },
      { header: "Giriş", key: "totalIn", width: 15, numFmt: MONEY, align: "right" },
      { header: "Çıkış", key: "totalOut", width: 15, numFmt: MONEY, align: "right" },
      { header: "Kapanış", key: "closing", width: 15, numFmt: MONEY, align: "right" },
      { header: "Kayıtlı bakiye", key: "storedBalance", width: 15, numFmt: MONEY, align: "right" },
      { header: "Fark", key: "storedDiff", width: 12, numFmt: MONEY, align: "right" },
      { header: "Hareket", key: "movementCount", width: 9, numFmt: "#,##0", align: "right" },
    ],
    rows: rep.accounts.map((a) => ({
      kind: ACCOUNT_KIND_LABEL[a.accountKind],
      code: a.code,
      name: a.isActive ? a.name : `${a.name} (pasif)`,
      currency: a.currency,
      opening: toNum(a.opening),
      totalIn: toNum(a.totalIn),
      totalOut: toNum(a.totalOut),
      closing: toNum(a.closing),
      storedBalance: toNum(a.storedBalance),
      storedDiff: showDiff && a.storedDiff !== null ? toNum(a.storedDiff) : "",
      movementCount: a.movementCount,
    })),
    totalRow: rep.totals
      ? {
          kind: "",
          code: "",
          name: "TOPLAM",
          currency: rep.accounts[0]?.currency ?? "",
          opening: toNum(rep.totals.opening),
          totalIn: toNum(rep.totals.totalIn),
          totalOut: toNum(rep.totals.totalOut),
          closing: toNum(rep.totals.closing),
          storedBalance: "",
          storedDiff: "",
          movementCount: rep.accounts.reduce((s, a) => s + a.movementCount, 0),
        }
      : undefined,
  };
}

function ledgerTable(account: CashBookAccountSummary, rep: CashBookReport): ReportTableSpec {
  const rows = rep.rows ?? [];
  return {
    // Excel sayfa adı 31 karakterle kırpılır — kod başta olduğu için hangi hesap
    // olduğu kırpılsa da okunur.
    name: `${account.code} Defter`,
    columns: [
      { header: "Tarih", key: "date", width: 11 },
      { header: "Belge No", key: "docNo", width: 16 },
      { header: "Kaynak", key: "source", width: 18 },
      { header: "Tür", key: "kind", width: 15 },
      { header: "Karşı taraf", key: "counterparty", width: 26 },
      { header: "Açıklama", key: "description", width: 30 },
      { header: "Giriş", key: "in", width: 14, numFmt: MONEY, align: "right" },
      { header: "Çıkış", key: "out", width: 14, numFmt: MONEY, align: "right" },
      { header: "Bakiye", key: "running", width: 15, numFmt: MONEY, align: "right" },
      { header: "Durum", key: "state", width: 10 },
    ],
    rows: rows.map((r) => ({
      date: new Date(r.date).toLocaleDateString("tr-TR"),
      docNo: r.docNo,
      source: CASH_SOURCE_LABEL[r.source],
      kind: r.kind ? CASH_KIND_LABEL[r.kind] ?? r.kind : "",
      counterparty: r.counterparty ?? "",
      description: r.description ?? "",
      // Boş hücre "0" yerine BOŞ bırakılır: her satırda iki kolondan biri zaten
      // sıfırdır ve sıfırlarla dolu bir defter okunmaz.
      in: r.direction === "IN" ? toNum(r.amount) : "",
      out: r.direction === "OUT" ? toNum(r.amount) : "",
      running: toNum(r.running),
      state: r.cancelled ? "İPTAL" : "",
    })),
    totalRow: {
      date: "",
      docNo: "",
      source: "",
      kind: "",
      counterparty: "",
      description: "DÖNEM TOPLAMI",
      in: toNum(account.totalIn),
      out: toNum(account.totalOut),
      running: toNum(account.closing),
      state: "",
    },
    notes: [
      `Dönem başı devir: ${account.opening} ${account.currency} — dönemden ÖNCEKİ hareketlerin toplamıdır.`,
      "İptal edilen belgeler İKİ satırla görünür: belge tarihinde asıl hareket, iptal anında ters hareket.",
    ],
  };
}
