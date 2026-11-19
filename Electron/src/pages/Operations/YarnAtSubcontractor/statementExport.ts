// =============================================================================
// FASONCU İPLİK EKSTRESİ — tek spec → Excel · PDF · Yazdır (`ReportExportBar`)
// =============================================================================
// Kaynak: Fasondaki İplik ucu (`filter[subcontractorId]`), ekranla AYNI yanıt — burada yeni sayı türetilmez, yalnız
// sunucu satırları dizilir; kg toplamı ve para birimi başına değer toplamı satırların toplamıdır (kur çevrilmez).
// Belge fasoncuya gidebilir → Sahibi ve Değer (iç bilgi) sütunları OPT-IN, varsayılan KAPALI.
// =============================================================================
import type { ReportColumn, ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { factoryDayKey, fmtDayKey, fmtFactoryDate } from "@/lib/factory-time";
import { formatAmount } from "@/lib/format";
import { CARRIED_LABEL, priceMissingText, subLabel, yarnLabel } from "./model";
import type { YarnAtSubRow } from "./service";

export interface StatementOptions {
  /** Sahip sütunu (müşteri adı) — başka müşterinin adı fasoncuya gitmesin diye opt-in. */
  includeOwner: boolean;
  /** Birim fiyat + değer — iç bilgi; yalnız fiyat alanı gelen kullanıcıda seçilebilir. */
  includeValue: boolean;
}

const num = (v: string | number | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function statementRows(rows: readonly YarnAtSubRow[]): YarnAtSubRow[] {
  return [...rows].sort((a, b) => yarnLabel(a).localeCompare(yarnLabel(b), "tr") || (a.lotNo ?? "").localeCompare(b.lotNo ?? "", "tr"));
}

export function buildSubcontractorStatement(rows: readonly YarnAtSubRow[], opts: StatementOptions, now: Date = new Date()): ReportExportSpec | null {
  const first = rows[0];
  if (!first) return null;
  const sorted = statementRows(rows);
  const columns: ReportColumn[] = [
    { header: "İplik", key: "yarn", width: 28 },
    { header: "Kod", key: "code", width: 16 },
    { header: "Lot", key: "lot", width: 16 },
    ...(opts.includeOwner ? [{ header: "Sahibi", key: "owner", width: 18 }] : []),
    { header: "Sipariş", key: "orders", width: 26 },
    { header: "İlk sevk", key: "since", width: 12 },
    { header: "Miktar (kg)", key: "kg", width: 13, numFmt: "#,##0.00", align: "right" as const },
    ...(opts.includeValue
      ? [
          { header: "Birim fiyat", key: "unitPrice", width: 12, numFmt: "#,##0.0000", align: "right" as const },
          { header: "Değer", key: "value", width: 14, numFmt: "#,##0.00", align: "right" as const },
          { header: "Para birimi", key: "currency", width: 10 },
        ]
      : []),
  ];
  // İç alanlar satıra yalnız seçiliyken girer (sütunu olmayan alan da dosyaya sızmasın).
  const data = sorted.map((r) => ({
    yarn: yarnLabel(r),
    code: r.yarnItemCode ?? "",
    lot: r.lotNo ?? "lotsuz",
    ...(opts.includeOwner ? { owner: r.ownerCustomerId ? r.ownerCustomerName ?? "Müşteri" : "Bizim" } : {}),
    orders: r.orders.map((o) => `${o.orderNo}${o.status === "COMPLETED" ? ` (${CARRIED_LABEL})` : ""}`).join(", "),
    since: fmtFactoryDate(r.oldestDispatchedAt),
    kg: num(r.kg),
    ...(opts.includeValue ? { unitPrice: r.unitPrice != null ? num(r.unitPrice) : null, value: r.value != null ? num(r.value) : null, currency: r.currency ?? "" } : {}),
  }));
  const totalKg = sorted.reduce((s, r) => s + num(r.kg), 0);
  const notes: string[] = [];
  if (opts.includeValue) {
    const byCur = new Map<string, number>();
    for (const r of sorted) if (r.value != null && r.currency) byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + num(r.value));
    for (const [cur, v] of [...byCur.entries()].sort(([a], [b]) => a.localeCompare(b))) notes.push(`Toplam değer (${cur}): ${formatAmount(v)}`);
    const missing = sorted.filter((r) => r.value == null);
    if (missing.length > 0) notes.push(`${missing.length} satırda fiyat yok (${[...new Set(missing.map((r) => priceMissingText(r)).filter(Boolean))].join("; ")}) — değer toplamına girmedi.`);
    notes.push("Değer = kg × mal kabuldeki lot birim fiyatı; para birimleri ayrı toplanır, kur çevrilmez.");
  }
  return {
    title: `Fasoncudaki iplik ekstresi — ${subLabel(first)}`,
    subtitle: fmtDayKey(factoryDayKey(now)),
    meta: [`Fasoncu: ${subLabel(first)}${first.subcontractorCode ? ` (${first.subcontractorCode})` : ""}`, "Bugün fasoncuda duran iplik: sevk − iade − sarılan; lot ve sipariş kırılımıyla."],
    orientation: opts.includeValue || opts.includeOwner ? "landscape" : "portrait",
    tables: [{ name: "İplik", columns, rows: data, totalRow: { yarn: "Toplam", kg: totalKg }, notes }],
  };
}
