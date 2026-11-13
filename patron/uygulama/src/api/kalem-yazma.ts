// Kalem iptali ve üretimdeki sipariş iptalinin İE eylemleri (ERP). Fabrika uçları panelinkiyle aynı:
// `GET/POST /orders/:id/lines/:lineId/cancel(-preview)` ve `POST /orders/:id/cancel` `workOrderActions`.
// Önizleme etkilenen HER kaydı listeler; uygulama kullanıcının GÖRDÜĞÜ önizlemenin belirteciyle gider (tutmazsa 409
// CANCEL_PREVIEW_STALE, fabrika hiçbir şey uygulamaz). Belirteci vermeyen eski fabrikaya karşı yazıcı uygulamadan hemen
// önce önizlemeyi yeniden okur ve etkilenen İE kümesi değiştiyse durur.
import { ApiError, type ApiClient } from "./client";

type Ham = Readonly<Record<string, unknown>>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const seg = (v: string) => encodeURIComponent(v);

export const CANCEL_PREVIEW_STALE = "CANCEL_PREVIEW_STALE";
const bayat = (ne: string) => new ApiError(409, CANCEL_PREVIEW_STALE, `${ne} siz bakarken değişti. Önizlemeyi yenileyin.`);

export interface KalemIptalOnizleme {
  readonly siparisNo: string;
  readonly urunAdi: string;
  readonly renkAdi: string;
  readonly istenen: number;
  readonly sevk: number;
  readonly kalan: number;
  readonly isEmirleri: readonly { readonly id: string; readonly no: string; readonly durum: string; readonly stogaDoner: boolean }[];
  /** Son aktif kalemse siparişin düşeceği durum (COMPLETED · CANCELLED), değilse null. */
  readonly siparisSonDurum: string | null;
  readonly engeller: readonly string[];
  readonly iptalEdilebilir: boolean;
  readonly belirtec: string | null;
}

export function kalemIptalOnizleme(h: Ham | null | undefined): KalemIptalOnizleme {
  if (!h || !Array.isArray(h.affectedWorkOrders) || !Array.isArray(h.blockers)) throw new ApiError(502, "SUNUCU_HATASI", "Sunucudan beklenmeyen yanıt");
  return {
    siparisNo: s(h.orderNumber), urunAdi: s(h.itemName), renkAdi: s(h.colorName),
    istenen: n(h.requestedQty), sevk: n(h.shippedQty), kalan: n(h.remainingQty),
    isEmirleri: (h.affectedWorkOrders as Ham[]).map((w) => ({ id: s(w.id), no: s(w.workOrderNumber), durum: s(w.status), stogaDoner: w.willBecomeStock === true })),
    siparisSonDurum: s(h.resultingOrderStatus) || null,
    engeller: (h.blockers as unknown[]).filter((x): x is string => typeof x === "string"),
    iptalEdilebilir: h.canCancel === true,
    belirtec: typeof h.previewToken === "string" && h.previewToken !== "" ? h.previewToken : null,
  };
}

const ieKumesi = (o: { isEmirleri: readonly { id: string }[] }) => o.isEmirleri.map((w) => w.id).sort().join(",");

export async function kalemIptalOnizlemeOku(c: ApiClient, siparisId: string, kalemId: string): Promise<KalemIptalOnizleme> {
  return kalemIptalOnizleme(await c.get<Ham>(`/orders/${seg(siparisId)}/lines/${seg(kalemId)}/cancel-preview`));
}

/** Kalemi iptal et (soft). `gorulen`: kullanıcının onayladığı önizleme. */
export async function kalemIptalEt(c: ApiClient, siparisId: string, kalemId: string, gorulen: KalemIptalOnizleme): Promise<void> {
  const taze = await kalemIptalOnizlemeOku(c, siparisId, kalemId);
  if (!taze.iptalEdilebilir || ieKumesi(taze) !== ieKumesi(gorulen)) throw bayat("Kalem");
  await c.post<unknown>(`/orders/${seg(siparisId)}/lines/${seg(kalemId)}/cancel`, gorulen.belirtec ? { expectedPreviewToken: gorulen.belirtec } : {});
}

/** Fabrikanın İE iptal eylemleri (`computeAllowedActions`). */
export type IsEmriEylemi = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";
export const EYLEMLER: readonly IsEmriEylemi[] = ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"];
export const eylemMi = (v: unknown): v is IsEmriEylemi => typeof v === "string" && (EYLEMLER as readonly string[]).includes(v);

export interface EylemSecimi {
  readonly isEmriId: string;
  readonly eylem: IsEmriEylemi;
}

/**
 * Seçimler, taze önizlemedeki HER iş emrini o iş emrinin izinli eylemiyle karşılıyor mu. Karşılamıyorsa fabrika eksik
 * olana varsayılan eylemi uygulardı (kullanıcının görmediği karar) → dur.
 */
export function eylemlerTam(
  isEmirleri: readonly { readonly id: string; readonly izinli: readonly IsEmriEylemi[] }[],
  secim: readonly EylemSecimi[],
): boolean {
  return isEmirleri.every((w) => secim.some((x) => x.isEmriId === w.id && w.izinli.includes(x.eylem)));
}

/** Panelle aynı eylem dili (`OrderCancelDialog`); İE adı terim kaynağından okuma anında çözülür. */
export function eylemEtiketi(e: IsEmriEylemi, belirtme: string): string {
  return e === "UNLINK_ONLY" ? "Sadece bağı kopar" : e === "CONVERT_TO_STOCK" ? `${belirtme} stoğa çevir` : `${belirtme} de iptal et`;
}
