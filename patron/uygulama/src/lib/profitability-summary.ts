// Kârlılık özeti görünümü (`karlilik-ozet` anlığı, D4-G4): fabrikanın hesapladığı gelir, katkı, net ve sıralamayı
// yalnız ETİKETLER. Toplama, çıkarma, sıralama ve sayı karşılaştırması YOK (fabrika bekçisi `test_bulut_karlilik_ozeti`
// §2d ölçer); zarar tonu tel ondalığının işaretinden okunur, eksik kalem fabrikanın rozetiyle gösterilir.
import type { ProfitMoney, ProfitSummarySnapshot } from "../api/wire";
import { formatMoney } from "./format";
import { monthLabel } from "./expense-summary";

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)) : []);

/** Eksik girdili tutar: fabrika `null` gönderir → "hesaplanamadı" (0 yazılmaz). */
export function moneyOrMissing(v: unknown): string {
  return typeof v === "string" && v !== "" ? formatMoney(v) : "hesaplanamadı";
}

/** Zarar tonu yalnız işaretten: "-…" kritik, `null` uyarı, aksi yok. */
export function toneOf(v: unknown): "kritik" | "uyari" | undefined {
  if (typeof v !== "string") return "uyari";
  return v.startsWith("-") ? "kritik" : undefined;
}

export interface ProfitRowView {
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly tone: "kritik" | "uyari" | undefined;
  readonly lines: readonly string[];
}

export interface ProfitView {
  readonly monthTitle: string;
  readonly contribution: string;
  readonly contributionTone: "kritik" | "uyari" | undefined;
  readonly lines: readonly string[];
  readonly badge: string;
  readonly settings: string;
  readonly months: readonly ProfitRowView[];
  readonly services: readonly ProfitRowView[];
  readonly best: readonly ProfitRowView[];
  readonly worst: readonly ProfitRowView[];
  readonly unknownCustomers: string;
}

function rowView(prefix: string, r: Obj, i: number, title: string, extra: readonly string[] = []): ProfitRowView {
  const m = r as Partial<ProfitMoney>;
  return {
    key: `${prefix}-${i}-${title}`,
    title,
    value: moneyOrMissing(m.katki),
    tone: toneOf(m.katki),
    lines: [[`Gelir ${formatMoney(m.gelir)}`, `Net ${moneyOrMissing(m.net)}`, ...extra].join(" · "), str(m.rozet)].filter(Boolean),
  };
}

/** Telden görünüm; şekil bozuksa (eski/yabancı veri) `null` → ekran "henüz gelmedi" der. */
export function profitView(veri: unknown): ProfitView | null {
  const v = obj(veri) as Partial<ProfitSummarySnapshot>;
  const d = obj(v.donem) as Partial<ProfitSummarySnapshot["donem"]>;
  if (typeof v.buAy !== "string" || typeof d.gelir !== "string" || !Array.isArray(v.aylar)) return null;
  const unknown = typeof v.hesaplanamayanMusteri === "number" && v.hesaplanamayanMusteri !== 0
    ? `${v.hesaplanamayanMusteri} müşterinin kârı eksik girdi yüzünden hesaplanamadı`
    : "";
  return {
    monthTitle: `Son 12 ay (${monthLabel(v.buAy)} dahil)`,
    contribution: moneyOrMissing(d.katki),
    contributionTone: toneOf(d.katki),
    lines: [
      `Kesinleşen gelir ${formatMoney(d.gelir)}`,
      `İpe giden ${moneyOrMissing(d.sarf)} · Makineye giden ${moneyOrMissing(d.makine)} · Dışarıya ödenen ${moneyOrMissing(d.disFason)}`,
      `Net ${moneyOrMissing(d.net)}`,
    ],
    badge: str(d.rozet),
    settings: str(v.hesap),
    months: rows(v.aylar).map((r, i) => rowView("ay", r, i, monthLabel(str(r.ay)))),
    services: rows(v.buAyIslemler).map((r, i) => rowView("islem", r, i, str(r.etiket), [`${str(r.metre)} m`])),
    best: rows(v.enKarli).map((r, i) => rowView("karli", r, i, str(r.etiket))),
    worst: rows(v.enZararli).map((r, i) => rowView("zararli", r, i, str(r.etiket))),
    unknownCustomers: unknown,
  };
}
