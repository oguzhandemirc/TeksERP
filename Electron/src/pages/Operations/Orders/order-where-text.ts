// =============================================================================
// SİPARİŞLER "NEREDE?" + "SEVK DURUMU" — TEK SAF METİN KATMANI
// =============================================================================
// Backend yapısal veri döner (`nerede`: durum + yerler); cümleyi YALNIZ burası
// kurar. Liste hücresi, Excel/PDF (`meta.exportValue`) ve yan panel aynı
// fonksiyonlardan okur — ekran ile dosya ayrışmaz. Metinler kullanıcı onaylı
// tasarımdan birebir (SIPARIS-NEREDE-TASARIM.md + Ek kararlar).
// =============================================================================
import type { Tone } from "@/components/operations/StatusBadge";
import { isMeasuredUnit } from "@/lib/item-unit";
import { TERIM } from "@/lib/terim";
import { orderStatusLabels, type OrderStatus } from "@/types/enums";
import type { Order, OrderWherePlace, OrderWhereStep, OrderWhereWorkOrder } from "./types";
import { qtyFormatter } from "@/lib/format";

const NUM = qtyFormatter(2);
/** Türkçe gruplama (1.200) — top sayısı ve metre aynı biçimde. */
export const fmtNum = (n: number): string => NUM.format(n);

/** Fason gün ifadesi: 0 → aynı fabrika günü gönderildi. */
export const daysText = (d: number): string => (d <= 0 ? "bugün gönderildi" : `${fmtNum(d)} gündür`);

export const OVERDUE_TEXT = "Termini geçti";

/** Elle kapatılan sipariş (COMPLETED + manualClosedById) — "Nerede?" ve "Sevk durumu" aynı sözcük. */
export const ORDER_MANUAL_CLOSED_TEXT = "Sipariş elle kapatıldı";

/** Tek yerin cümlesi (satırdaki baş yer). */
export function placeText(p: OrderWherePlace): string {
  const n = `${fmtNum(p.topSayisi)} top`;
  if (p.tur === "HAZIR") return `Sevke hazır · ${n}`;
  if (p.tur === "FASON") {
    const head = p.ad ? `Fasonda – ${p.ad}` : "Fasonda";
    return p.gun != null ? `${head} · ${n} · ${daysText(p.gun)}` : `${head} · ${n}`;
  }
  return `${p.ad ?? "Üretim"} aşamasında · ${n}`;
}

const PLACE_TONE: Record<OrderWherePlace["tur"], Tone> = { ASAMA: "info", FASON: "warning", HAZIR: "success" };

export interface OrderWhereView {
  text: string;
  tone: Tone;
  /** Ek kırmızı rozet ("Termini geçti"). */
  overdue: boolean;
}

/**
 * "Nerede?" cümlesi + rengi. `nerede` yoksa (üretim kapalı / eski backend) null.
 * Elle kapatılan sipariş (COMPLETED + manualClosedById) "Hepsi gönderildi" demez.
 */
export function orderWhereView(order: Pick<Order, "nerede" | "manualClosedById">): OrderWhereView | null {
  const n = order.nerede;
  if (!n) return null;
  const v = (text: string, tone: Tone): OrderWhereView => ({ text, tone, overdue: n.terminGecti });
  switch (n.durum) {
    case "IPTAL":
      return v("Sipariş iptal edildi", "muted");
    case "TAMAM":
      return order.manualClosedById ? v(ORDER_MANUAL_CLOSED_TEXT, "muted") : v("Hepsi gönderildi", "success");
    case "IE_YOK":
      return v(`${TERIM.terbiyeIsEmri.tekil} açılmadı`, "muted");
    case "BASLANMADI":
      return v("İşe başlanmadı", "muted");
    case "GONDERILDI":
      return v("Üretilen toplar gönderildi", "success");
    case "YERLER": {
      const [head, ...rest] = n.yerler;
      if (!head) return v("İşe başlanmadı", "muted");
      const extra = rest.length > 0 ? ` · +${rest.length} yerde daha` : "";
      return v(placeText(head) + extra, PLACE_TONE[head.tur]);
    }
    default:
      // Bilinmeyen durum (yeni backend) — uydurma cümle basılmaz.
      return null;
  }
}

/** Excel/PDF "Nerede?" hücresi = ekrandaki rozet(ler) " · " ile. */
export function orderWhereExportText(order: Pick<Order, "nerede" | "manualClosedById">): string {
  const view = orderWhereView(order);
  if (!view) return "—";
  return view.overdue ? `${view.text} · ${OVERDUE_TEXT}` : view.text;
}

// ── Sevk durumu — TEK kaynak ─────────────────────────────────────────────────
// Liste hücresi, süzgeç, özet şeridi, detay başlığı, yan panel, Excel/PDF ve kalem
// bazında Excel AYNI cümleyi yazar. Durum enum'u ham ya da "Onaylandı" gibi iş akışı
// sözcüğüyle gösterilmez (Adnan Şahin isteği 2026-11-04; her kurulumda geçerli).

export interface OrderShipView {
  text: string;
  tone: Tone;
}

/**
 * Sevk durumu cümlesi + rengi — BRÜT sevk (`order.shippedQty`, metre defteri). Sayı çifti
 * yalnız bütün kalemler metreyle ölçülüyorsa yazılır (KG/ADET sevki deftere metre düşmez).
 * İstenen = aktif kalem miktarı + iptal kalemin sevk edilmiş kısmı. Onaysız ve iptal
 * sipariş miktardan önce durumunu söyler ("Henüz gönderilmedi" yanıltır).
 */
export function orderShipView(
  order: Pick<Order, "status" | "shippedQty" | "manualClosedById" | "lines">,
): OrderShipView {
  const lines = order.lines ?? [];
  const measured = lines.length > 0 && lines.every((l) => isMeasuredUnit(l.unit));
  const shipped = Number(order.shippedQty ?? 0);
  const requested = lines.reduce(
    (s, l) => s + (l.cancelledAt ? Number(l.shippedQty ?? 0) : Number(l.quantity ?? 0)),
    0,
  );
  const pair = measured ? `${fmtNum(shipped)} / ${fmtNum(requested)} m` : null;
  const L = orderStatusLabels;

  if (order.status === "PENDING") return { text: L.PENDING, tone: "warning" };
  if (order.status === "CANCELLED") {
    const text = pair && shipped > 0 ? `${L.CANCELLED} (${pair} gönderildi)` : L.CANCELLED;
    return { text, tone: "muted" };
  }
  if (order.status === "COMPLETED" && order.manualClosedById) {
    return { text: pair ? `${ORDER_MANUAL_CLOSED_TEXT} (${pair} gönderildi)` : ORDER_MANUAL_CLOSED_TEXT, tone: "muted" };
  }
  if (order.status === "COMPLETED" || (measured && requested > 0 && shipped >= requested)) {
    return { text: L.COMPLETED, tone: "success" };
  }
  if (shipped <= 0 && order.status !== "PARTIAL_SHIPPED") return { text: L.APPROVED, tone: "info" };
  return { text: pair ? `${L.PARTIAL_SHIPPED} (${pair})` : L.PARTIAL_SHIPPED, tone: "progress" };
}

/** "Sevk durumu" metni (ekran + Excel + PDF). */
export function orderShipText(order: Pick<Order, "status" | "shippedQty" | "manualClosedById" | "lines">): string {
  return orderShipView(order).text;
}

/**
 * "Sevk durumu" süzgeci — etiket listedekiyle aynı; yalnız "Hepsi gönderildi" kovası
 * elle kapatılanları da içerdiği için bunu söyler.
 */
export const ORDER_SHIP_FILTER_OPTIONS: ReadonlyArray<{ value: OrderStatus; label: string }> = (
  ["PENDING", "APPROVED", "PARTIAL_SHIPPED", "COMPLETED", "CANCELLED"] as const
).map((value) => ({
  value,
  label: value === "COMPLETED" ? `${orderStatusLabels.COMPLETED} ya da elle kapatıldı` : orderStatusLabels[value],
}));

// ── Yan panel (iş emri kartı) ────────────────────────────────────────────────

export const STEP_GLYPH: Record<OrderWhereStep["asama"], string> = { GECTI: "✓", BURADA: "●", SIRADA: "○" };

const qtyText = (q: { topSayisi: number; metre: number }) => `${fmtNum(q.topSayisi)} top · ${fmtNum(q.metre)} m`;

/**
 * İlerleme çizgisinin tek adımı: `✓ Ham kontrol` · `● Fason (Akın Boya, 8 top, 3 gündür)` ·
 * `○ Tambur`. Topların durduğu adımda parantezde ayrıntı: fasondaysa firma(lar), değilse top sayısı.
 */
export function stepTrailText(step: OrderWhereStep, wo: Pick<OrderWhereWorkOrder, "fason">): string {
  const base = `${STEP_GLYPH[step.asama]} ${step.ad}`;
  if (step.asama !== "BURADA") return base;
  if (step.fasonTop > 0 && wo.fason.length > 0) {
    const firms = wo.fason.map((f) => `${f.firmaAd}, ${fmtNum(f.topSayisi)} top, ${daysText(f.gun)}`).join("; ");
    return `${base} (${firms})`;
  }
  return `${base} (${fmtNum(step.topSayisi)} top)`;
}

/** Aşama başına top + metre satırları (kartın altı). */
export function woDetailLines(wo: OrderWhereWorkOrder): string[] {
  const out: string[] = [];
  for (const s of wo.adimlar) if (s.asama === "BURADA" && s.topSayisi > 0) out.push(`${s.ad}: ${qtyText(s)}`);
  for (const f of wo.fason) out.push(`Fasonda – ${f.firmaAd}: ${qtyText(f)} · ${daysText(f.gun)}`);
  if (wo.hazir.topSayisi > 0) out.push(`Sevke hazır: ${qtyText(wo.hazir)}`);
  if (wo.gitti.topSayisi > 0) out.push(`Gönderildi: ${qtyText(wo.gitti)}`);
  return out;
}

// ── Hızlı sekmeler + süzgeç anahtarları (süzme SUNUCUDA) ─────────────────────
export const WHERE_FILTER_KEY = "filter[nerede]";
export const FASON_FIRMA_KEY = "filter[fasonFirmaId]";
export const FASON_GUN_KEY = "filter[fasondaGunden]";

export type WhereTabValue = "BEKLEYEN" | "FASONDA" | "SEVKE_HAZIR" | "KISMEN" | "GECIKEN";

export interface WhereTab {
  value: WhereTabValue | null;
  label: string;
  /** Üretim modülü kapalıyken düşer (sunucu da 403 verir). */
  production?: boolean;
}

export const WHERE_TABS: readonly WhereTab[] = [
  { value: null, label: "Tümü" },
  { value: "BEKLEYEN", label: "Bekleyenler" },
  { value: "FASONDA", label: "Fasonda", production: true },
  { value: "SEVKE_HAZIR", label: "Sevke hazır", production: true },
  { value: "KISMEN", label: "Kısmen gidenler" },
  { value: "GECIKEN", label: "Gecikenler" },
];

export function whereTabs(productionEnabled: boolean): WhereTab[] {
  return WHERE_TABS.filter((t) => productionEnabled || !t.production);
}

/** URL değerinden etkin sekme; tanınmayan değer "Tümü" görünür (sunucu 400 verir). */
export function activeWhereTab(raw: string | null): WhereTabValue | null {
  return WHERE_TABS.find((t) => t.value !== null && t.value === raw)?.value ?? null;
}

/** "Fasonda X günden uzun" girdisi → URL değeri; boş/geçersiz/aralık dışı (0–3650) → null (süzgeç kalkar). */
export function normalizeFasonGun(input: string): string | null {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 3650 ? null : String(n);
}
