// İş emri görünümü (patron İE ekranı, `is-emri` v3) — SAF okuyucular. Aşama, top/metre, firma payı ve sipariş bağları
// FABRİKANIN türettiği alanlardır; burada yalnız etikete çevrilir, toplanmaz. Eski fabrika alanı göndermezse "—".
// Termin/gecikme yok: fasonda yalnız "N gündür" (gönderimden bu yana, fabrika günü; renk taşımaz).
import type { AsamaDegeri, ListMemberFilterKey } from "../api/wire";
import { factoryDayDiff } from "./factory-time";
import { formatDate, formatNumber } from "./format";
import { WORK_ORDER_STATUS, WORK_ORDER_TYPE } from "./labels/uretim";

export type Kayit = Readonly<Record<string, unknown>>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
const isNum = (v: unknown): boolean => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));
const rows = (v: unknown): Kayit[] => (Array.isArray(v) ? v.filter((x): x is Kayit => typeof x === "object" && x !== null) : []);
const n0 = (v: unknown): string => (isNum(v) ? formatNumber(v, 0) : "—");

/** Aşama → etiket (liste çipi, konum başlığı ve kırılım satırı aynı dil). `diger` süzülmez, yalnız kırılımda. */
export const STAGE_LABEL: Readonly<Record<string, string>> = {
  fason: "Fasonda",
  kursun: "Kurşun",
  tambur: "Tambur",
  depo: "Depoda",
  sevkEdildi: "Sevk edildi",
  diger: "Diğer (giriş, bekleyen)",
};
/** Süzgeç çipleri (tel `ASAMA_DEGERLERI` sırası). */
export const STAGE_CHIPS: readonly AsamaDegeri[] = ["kursun", "tambur", "fason", "depo", "sevkEdildi"];
export const isStage = (v: unknown): v is AsamaDegeri => typeof v === "string" && (STAGE_CHIPS as readonly string[]).includes(v);

export const NO_ORDER_TEXT = "Siparişsiz (stok)";

/** Firma konumu üyelik anahtarı — ekranlar literal yazmaz (fason alan adları yalnız beyanlı görünümlerde, `test_bulut_fason_ozeti` §2d). */
export const FIRM_FILTER = "fasonFirmaId" satisfies ListMemberFilterKey;
/** Liste üyelik sorgusu: firma konumunda aşama gönderilmez (top o firmada). */
export function memberQuery(q: { asama?: string | null; firma?: string; cari?: string; siparis?: string }): Partial<Record<ListMemberFilterKey, string>> {
  return { asama: q.firma ? undefined : (q.asama ?? undefined), [FIRM_FILTER]: q.firma, cariKartId: q.cari, siparisId: q.siparis };
}

export const workOrderNo = (k: Kayit): string => text(k.isEmriNo) ?? "—";
export const isOpen = (k: Kayit): boolean => k.acik !== false;
/** Bağlı sipariş yok (alan geldi ve boş); alan hiç gelmediyse (eski fabrika) `false`. */
export const noOrder = (k: Kayit): boolean => Array.isArray(k.siparisIdleri) && texts(k.siparisIdleri).length === 0;

export function customerText(k: Kayit): string {
  return text(k.musteriAdi) ?? (noOrder(k) ? "Stok için üretim" : "—");
}

export function fabricText(k: Kayit): string {
  return [text(k.urunAdi), text(k.renkAdi)].filter(Boolean).join(" · ") || "—";
}

/** Liste hücresi: ilk sipariş no (+N); bağsızsa "Siparişsiz (stok)". */
export function orderCell(k: Kayit): string {
  if (noOrder(k)) return NO_ORDER_TEXT;
  const nos = texts(k.siparisNolari);
  if (nos.length === 0) return "—";
  return nos.length === 1 ? nos[0]! : `${nos[0]!} +${nos.length - 1}`;
}

/** Siparişler (no + kimlik, aynı sırada; fabrika iki diziyi eş gönderir). */
export function orders(k: Kayit): { id: string | null; no: string }[] {
  const ids = texts(k.siparisIdleri);
  return texts(k.siparisNolari).map((no, i) => ({ id: ids[i] ?? null, no }));
}

/** Müşteriler (kimlik + ad); kimlik yoksa yalnız ad. */
export function customers(k: Kayit): { id: string | null; ad: string }[] {
  const ids = texts(k.cariKartIdleri);
  const names = texts(k.musteriAdlari);
  if (ids.length === 0) return [{ id: null, ad: customerText(k) }];
  return ids.map((id, i) => ({ id, ad: names[i] ?? (i === 0 ? text(k.musteriAdi) : null) ?? "—" }));
}

/** "18 top · 2.160 m"; gelmeyen parça yazılmaz. */
export function rollsText(top: unknown, metre: unknown): string {
  return [isNum(top) ? `${n0(top)} top` : null, isNum(metre) ? `${n0(metre)} m` : null].filter(Boolean).join(" · ") || "—";
}

/** "Fasonda · Kurşun" — İE'nin topu olan aşamalar (fabrikanın sırası); kapalıda durum. */
export function whereText(k: Kayit): string {
  if (!isOpen(k)) return text(k.durum) ? (WORK_ORDER_STATUS[k.durum as string]?.label ?? (k.durum as string)) : "Kapandı";
  const st = texts(k.asamalar).filter((a) => a !== "sevkEdildi").map((a) => STAGE_LABEL[a] ?? a);
  return st.length > 0 ? st.join(" · ") : "Topu yok";
}

/** Bu aşamadaki top · metre (`asamaTop` satırı); aşama verilmediyse İE toplamı. */
export function stageAmount(k: Kayit, stage: string | null): { top: unknown; metre: unknown } {
  if (stage) {
    const r = rows(k.asamaTop).find((x) => x.anahtar === stage);
    return r ? { top: r.top, metre: r.metre } : { top: 0, metre: null };
  }
  return { top: k.topSayisi, metre: k.metre };
}

/** Gönderimden bu yana tam fabrika günü metni; tarih yoksa `null`. */
export function daysText(iso: unknown, now: Date = new Date()): string | null {
  const t = text(iso);
  if (!t || !Number.isFinite(Date.parse(t))) return null;
  const d = factoryDayDiff(now, t);
  return d <= 0 ? "bugün gitti" : `${formatNumber(d, 0)} gündür`;
}

export interface StageRow { key: string; label: string; value: string }
/** "Toplar nerede?" kırılımı: sıfır satır çizilmez; bilinmeyen anahtar kendi adıyla. */
export function stageRows(k: Kayit): StageRow[] {
  return rows(k.asamaTop).flatMap((r) => {
    const key = text(r.anahtar);
    if (!key || !isNum(r.top) || /^0+(\.0+)?$/.test(String(r.top))) return [];
    return [{ key, label: STAGE_LABEL[key] ?? key, value: rollsText(r.top, r.metre) }];
  });
}

export interface FirmRow { key: string; firmId: string | null; label: string; value: string; line: string | null }
/** Fasondaki firma payları (fabrikanın sırası); kalemsiz fason topu "Firma bilinmiyor". */
export function firmRows(k: Kayit, now: Date = new Date()): FirmRow[] {
  return rows(k.fasonFirmalari).map((f, i) => ({
    key: text(f.fasonFirmaId) ?? `bilinmiyor-${i}`,
    firmId: text(f.fasonFirmaId),
    label: text(f.ad) ?? "Firma bilinmiyor",
    value: `${n0(f.top)} top`,
    line: [isNum(f.metre) ? `${n0(f.metre)} m` : null, daysText(f.enEskiGonderim, now)].filter(Boolean).join(" · ") || null,
  }));
}

/** Liste satırı metinleri — liste, konum ve test aynı kaynaktan. */
export function listRowText(k: Kayit, stage: string | null) {
  const m = stageAmount(k, stage);
  return {
    title: customerText(k),
    value: isNum(m.top) ? `${n0(m.top)} top` : undefined,
    lines: [fabricText(k), `${workOrderNo(k)} · ${orderCell(k)}`, stage ? (isNum(m.metre) ? `${n0(m.metre)} m` : "—") : whereText(k)],
  };
}

/** "Üretim ayrıntıları": yalnız fabrikanın gönderdiği alanlar. */
export function detailRows(k: Kayit): { key: string; label: string; value: string }[] {
  const tur = text(k.tur);
  const m = (v: unknown) => (isNum(v) ? `${n0(v)} m` : null);
  return [
    tur ? { key: "tur", label: "Tür", value: WORK_ORDER_TYPE[tur] ?? tur } : null,
    text(k.durum) ? { key: "durum", label: "Durum", value: WORK_ORDER_STATUS[k.durum as string]?.label ?? (k.durum as string) } : null,
    text(k.planBitis) ? { key: "plan", label: "Plan bitiş", value: formatDate(k.planBitis) } : null,
    m(k.hedefMiktar) ? { key: "hedef", label: "Hedef", value: m(k.hedefMiktar)! } : null,
    m(k.siparisMetre) ? { key: "siparisMetre", label: "Sipariş metresi", value: m(k.siparisMetre)! } : null,
    m(k.girenMetre) ? { key: "giren", label: "Giren", value: m(k.girenMetre)! } : null,
    m(k.uretilenMetre) ? { key: "uretilen", label: "Üretilen", value: m(k.uretilenMetre)! } : null,
    { key: "toplam", label: "Canlı toplar", value: rollsText(k.topSayisi, k.metre) },
  ].filter((x): x is { key: string; label: string; value: string } => x !== null);
}
