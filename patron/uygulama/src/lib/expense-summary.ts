// Masraf özeti görünümü (`ozet-masraf` anlığı, D4-H2): fabrikanın hesapladığı toplam, fark ve payı yalnız ETİKETLER.
// Toplama, çıkarma, sıralama ve sayı karşılaştırması YOK (fabrika bekçisi `test_bulut_masraf_ozeti` §2d ölçer);
// farkın yönü tel ondalığının işaretinden okunur.
import type { ExpenseCategoryRow, ExpenseSummarySnapshot } from "../api/wire";
import { formatMoney } from "./format";

const MONTH_NAMES: Readonly<Record<string, string>> = {
  "01": "Ocak", "02": "Şubat", "03": "Mart", "04": "Nisan", "05": "Mayıs", "06": "Haziran",
  "07": "Temmuz", "08": "Ağustos", "09": "Eylül", "10": "Ekim", "11": "Kasım", "12": "Aralık",
};

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** `2026-10` → `Ekim 2026`; tanınmayan biçim olduğu gibi. */
export function monthLabel(key: string): string {
  const name = MONTH_NAMES[key.slice(5, 7)];
  return name && /^\d{4}-\d{2}$/.test(key) ? `${name} ${key.slice(0, 4)}` : key;
}

/** Fark metni: "+1.250,00 ₺ arttı" · "−300,00 ₺ azaldı" · "değişmedi" (yön yalnız işaretten). */
export function changeText(fark: string): { text: string; tone: "artis" | "azalis" | "yok" } {
  if (!/^-?\d+(\.\d+)?$/.test(fark) || /^-?0+(\.0+)?$/.test(fark)) return { text: "değişmedi", tone: "yok" };
  if (fark.startsWith("-")) return { text: `${formatMoney(fark.slice(1))} azaldı`, tone: "azalis" };
  return { text: `${formatMoney(fark)} arttı`, tone: "artis" };
}

export interface ExpenseRowView {
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly lines: readonly string[];
}

export interface ExpenseView {
  readonly monthTitle: string;
  readonly total: string;
  readonly change: ReturnType<typeof changeText>;
  readonly lastMonthText: string;
  readonly yearText: string;
  readonly rows: readonly ExpenseRowView[];
}

function rowView(r: ExpenseCategoryRow, i: number): ExpenseRowView {
  const title = r.digerMi ? `Diğer (${r.kategoriSayisi} kategori)` : r.etiket;
  const pay = typeof r.buAyPay === "number" ? `Bu ayın %${String(r.buAyPay).replace(".", ",")}'i` : "";
  return {
    key: `${i}-${r.etiket}`,
    title,
    value: formatMoney(r.buAy),
    lines: [`Geçen aya göre ${changeText(str(r.fark)).text}`, [pay, `12 ayda ${formatMoney(r.toplam)}`].filter(Boolean).join(" · ")],
  };
}

/** Telden görünüm; şekil bozuksa (eski/yabancı veri) `null` → ekran "henüz gelmedi" der. */
export function expenseView(veri: unknown): ExpenseView | null {
  const v = obj(veri) as Partial<ExpenseSummarySnapshot>;
  if (typeof v.buAy !== "string" || typeof v.buAyToplam !== "string" || !Array.isArray(v.kategoriler)) return null;
  return {
    monthTitle: monthLabel(v.buAy),
    total: formatMoney(v.buAyToplam),
    change: changeText(str(v.fark)),
    lastMonthText: `${monthLabel(str(v.gecenAy))}: ${formatMoney(v.gecenAyToplam)}`,
    yearText: `Son 12 ay: ${formatMoney(v.toplam)}`,
    rows: v.kategoriler.map((r, i) => rowView(r, i)),
  };
}
