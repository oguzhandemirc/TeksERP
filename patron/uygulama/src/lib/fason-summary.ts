// Fason · emanet görünümleri (genel fason PB1): `ozet.stok.emanet`, `emanet-bakiye`, `fason-acik`, `hizmet-geliri`
// anlıkları. Rakamlar FABRİKANIN; burada toplama, çıkarma, sıralama YOK (fabrika bekçisi `test_bulut_fason_ozeti` §2d
// ölçer) — yalnız savunmalı okuma ve günlük dilde etiket. Eski fabrika alanı/anlığı göndermezse `null` döner, ekran
// boş durum çizer; çökmez.
import type { PeriodKey } from "./labels/uretim";
import { formatMoney, formatNumber } from "./format";

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Obj => x !== null) : []);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const isNum = (v: unknown): boolean => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));
/** Metre/kg: binin üstünde ondalıksız, altında en çok bir hane. */
const amount = (v: unknown): string => {
  if (!isNum(v)) return "—";
  return formatNumber(v, /^-?\d{4,}/.test(String(v)) ? 0 : 1);
};
/** Tel sayısı sıfırdan büyük mü (metin karşılaştırması; aritmetik değil). */
const positive = (v: unknown): boolean => isNum(v) && !/^-/.test(String(v)) && !/^0+(\.0+)?$/.test(String(v));

/** Pano stok satırının eki: "emanet 1.240 m" — fabrika emanet satırı göndermediyse `null`. */
export function stockConsignedText(ozetStok: unknown): string | null {
  const e = obj(obj(ozetStok)?.emanet);
  if (!e || !isNum(e.miktar)) return null;
  return `müşteri malı ${amount(e.miktar)} m`;
}

export interface ConsignedRowView {
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly lines: readonly string[];
}

/** Top · iplik · levent tek satırda; kapalı modülün alanı (`null`) hiç yazılmaz, sıfır olan da yazılmaz. */
function materialLine(b: Obj): string {
  const parts = [`${formatNumber(b.topAdet, 0)} top`];
  if (positive(b.iplikKg)) parts.push(`${amount(b.iplikKg)} kg iplik`);
  if (positive(b.leventAdet)) parts.push(`${formatNumber(b.leventAdet, 0)} levent`);
  return parts.join(" · ");
}

export interface ConsignedView {
  readonly totalValue: string;
  readonly totalLine: string;
  readonly rows: readonly ConsignedRowView[];
}

/** `emanet-bakiye` → müşteri satırları (sıra fabrikanın). Tanınmayan şekil `null`. */
export function consignedView(veri: unknown): ConsignedView | null {
  const d = obj(veri);
  const total = obj(d?.toplam);
  if (!d || !total) return null;
  return {
    totalValue: `${amount(total.topMiktar)} m`,
    totalLine: materialLine(total),
    rows: list(d.cariler).map((c, i) => ({
      key: text(c.cariKartId) ?? String(i),
      title: text(c.etiket) ?? "—",
      value: `${amount(c.topMiktar)} m`,
      lines: [materialLine(c)],
    })),
  };
}

/** Karnenin emanet satırı (`stok-karnesi.ozet.emanet`): ham · yarı mamul · bitmiş; yoksa `null`. */
export function scorecardConsignedLines(ozet: unknown): readonly { readonly label: string; readonly value: string }[] | null {
  const e = obj(obj(ozet)?.emanet);
  if (!e) return null;
  return [
    { label: "Ham", value: `${amount(e.hamMiktar)} m · ${formatNumber(e.hamAdet, 0)} top` },
    { label: "Yarı mamul", value: `${amount(e.yariMamulMiktar)} m · ${formatNumber(e.yariMamulAdet, 0)} top` },
    { label: "Bitmiş", value: `${amount(e.bitmisMiktar)} m · ${formatNumber(e.bitmisAdet, 0)} top` },
  ];
}

export interface SubcontractOpenView {
  readonly openText: string;
  readonly lateText: string;
  readonly late: boolean;
  readonly soonText: string | null;
  readonly remainingText: string;
  readonly clipped: boolean;
  readonly firms: readonly (ConsignedRowView & { readonly late: boolean })[];
}

/** `fason-acik` → "fasonda ne var, ne gecikti". Tanınmayan şekil `null`. */
export function subcontractOpenView(veri: unknown): SubcontractOpenView | null {
  const d = obj(veri);
  if (!d || !isNum(d.acikSevk)) return null;
  return {
    openText: `${formatNumber(d.acikSevk, 0)} açık sevk`,
    lateText: positive(d.geciken) ? `${formatNumber(d.geciken, 0)} sevkin dönüşü gecikti` : "Geciken dönüş yok",
    late: positive(d.geciken),
    soonText: positive(d.yaklasan) ? `${formatNumber(d.yaklasan, 0)} sevkin dönüşü yaklaşıyor` : null,
    remainingText: `Fasonda ${amount(d.kalanMiktar)} m kumaş`,
    clipped: d.kirpildi === true,
    firms: list(d.firmalar).map((f, i) => {
      const parts = [`${formatNumber(f.acikSevk, 0)} açık sevk`];
      if (positive(f.geciken)) parts.push(`${formatNumber(f.geciken, 0)} gecikmiş`);
      if (positive(f.iplikKg)) parts.push(`${amount(f.iplikKg)} kg iplik`);
      if (positive(f.leventAdet)) parts.push(`${formatNumber(f.leventAdet, 0)} levent`);
      return { key: text(f.fasonFirmaId) ?? String(i), title: text(f.etiket) ?? "—", value: `${amount(f.kalanMiktar)} m`, lines: [parts.join(" · ")], late: positive(f.geciken) };
    }),
  };
}

export interface ServiceRevenueView {
  readonly totalText: string;
  readonly rows: readonly ConsignedRowView[];
}

/** `hizmet-geliri` seçili dönem → toplam + hizmet satırları (sıra fabrikanın). Tanınmayan şekil `null`. */
export function serviceRevenueView(veri: unknown, period: PeriodKey): ServiceRevenueView | null {
  const p = obj(obj(veri)?.[period]);
  if (!p || !isNum(p.toplamTl)) return null;
  return {
    totalText: formatMoney(p.toplamTl),
    rows: list(p.kalemler).map((k, i) => ({
      key: text(k.hizmetId) ?? String(i),
      title: text(k.etiket) ?? "—",
      value: formatMoney(k.tutarTl),
      lines: [`${amount(k.miktar)} ${text(k.birim) ?? ""}`.trim()],
    })),
  };
}
