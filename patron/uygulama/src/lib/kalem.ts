// Sipariş kalemleri (ERP): fabrika detayı → telefon kalem durumu, form → `PATCH /api/orders/:id` `lines[]` dizisi.
// Fabrika diziyi TAM değiştirir (id'li = güncelle, id'siz = yarat, EKSİK = SİL; mevcut kalemde gönderilmeyen
// `requiredPropertyIds` zorunlu özellikleri siler). Bu yüzden her mevcut kalem — iptal edilmiş olan dahil, panel gibi —
// kayıtlı alanlarıyla AYNEN geri yollanır; telefon yalnız miktar · birim fiyat · renk değiştirir ve kalem eklemeyi
// bilir. Kalem kaldırma telefonda yoktur: kaldırmak = kalem iptali (soft, ayrı uç).
import type { SiparisKaydi } from "../api/yazma";
import { toDecimal, type Built } from "./forms";

type Ham = Readonly<Record<string, unknown>>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const sayiMetni = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
};
const sayiYaDaNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export interface KalemKaydi {
  readonly id: string;
  readonly urunId: string;
  readonly urunAdi: string;
  readonly renkId: string | null;
  readonly renkAdi: string;
  /** Nokta ondalıklı ("1250.5"); fiyatsız kalemde birimFiyat "". */
  readonly miktar: string;
  readonly birim: string;
  readonly birimFiyat: string;
  readonly sevk: string;
  readonly iptal: boolean;
  /** Fabrikaya aynen geri yollanacak kayıtlı alanlar (`ORDER_LINE_WRITABLE` + zorunlu özellikler). */
  readonly geri: Readonly<Record<string, unknown>>;
}

/** Kalem yazımı neden kapalı: kısmi sevk · canlı iş emri bağı · kapanmış sipariş (fabrikanın kuralları, istemci gizler). */
export type KalemKilidi = "KAPALI" | "KISMI_SEVK" | "URETIMDE" | null;

export interface KalemDurumu {
  readonly siparis: SiparisKaydi;
  readonly kalemler: readonly KalemKaydi[];
  readonly kilit: KalemKilidi;
}

/** Fabrikanın ön denetimiyle aynı: CANCELLED dışı her iş emri bağı kalemleri kilitler. */
const canliBag = (l: Ham): boolean => Array.isArray(l.workOrderLinks) && (l.workOrderLinks as Ham[]).some((w) => s((w.workOrder as Ham | undefined)?.status) !== "CANCELLED");

export function kalemKaydi(l: Ham): KalemKaydi {
  const req = Array.isArray(l.requiredProperties) ? (l.requiredProperties as Ham[]).map((p) => s(p.propertyId)).filter(Boolean) : [];
  return {
    id: s(l.id),
    urunId: s(l.itemId),
    urunAdi: s((l.item as Ham | undefined)?.name),
    renkId: s(l.colorId) || null,
    renkAdi: s((l.color as Ham | undefined)?.name),
    miktar: sayiMetni(l.quantity),
    birim: s(l.unit),
    birimFiyat: sayiMetni(l.unitPrice),
    sevk: sayiMetni(l.shippedQty),
    iptal: l.cancelledAt != null,
    geri: {
      id: s(l.id), itemId: s(l.itemId), colorId: s(l.colorId) || null, quantity: Number(l.quantity), ...(s(l.unit) ? { unit: s(l.unit) } : {}),
      width: sayiYaDaNull(l.width), unitPrice: l.unitPrice == null ? null : String(l.unitPrice),
      customerItemName: l.customerItemName ?? null, customerColorName: l.customerColorName ?? null, cutNote: l.cutNote ?? null,
      tolerancePct: l.tolerancePct == null ? null : String(l.tolerancePct), recipeId: l.recipeId ?? null, pieceLengthM: sayiYaDaNull(l.pieceLengthM),
      requiredPropertyIds: req,
    },
  };
}

export function kalemDurumu(siparis: SiparisKaydi, h: Ham): KalemDurumu {
  const lines = Array.isArray(h.lines) ? (h.lines as Ham[]) : [];
  const kilit: KalemKilidi = siparis.durum === "COMPLETED" || siparis.durum === "CANCELLED" ? "KAPALI"
    : siparis.durum === "PARTIAL_SHIPPED" ? "KISMI_SEVK"
    : lines.some(canliBag) ? "URETIMDE" : null;
  return { siparis, kalemler: lines.map(kalemKaydi), kilit };
}

export const KILIT_ILETISI: Readonly<Record<Exclude<KalemKilidi, null>, string>> = {
  KAPALI: "Tamamlanmış ya da iptal edilmiş siparişin kalemleri değişmez",
  KISMI_SEVK: "Kısmen sevk edilmiş siparişin kalemleri değişmez; kalanı iptal edebilirsiniz",
  URETIMDE: "Siparişin üretimi başladı; kalemler değişmez. Kalemi iptal edebilirsiniz",
};

/** Formdaki bir satır: mevcut kalem (`id`) ya da yeni kalem (`id` yok, ürün seçilir). */
export interface KalemSatiri {
  readonly id?: string;
  readonly urunId: string | null;
  readonly urunAdi: string;
  readonly renkId: string | null;
  readonly renkAdi: string;
  readonly miktar: string;
  readonly birimFiyat: string;
}

export const kalemSatirlari = (d: KalemDurumu): KalemSatiri[] =>
  d.kalemler.filter((k) => !k.iptal).map((k) => ({ id: k.id, urunId: k.urunId, urunAdi: k.urunAdi, renkId: k.renkId, renkAdi: k.renkAdi, miktar: k.miktar, birimFiyat: k.birimFiyat }));

/**
 * Form → `lines[]`. Mevcut kalem: kayıtlı alanlar + değişen üçü. Yeni kalem: ürün · renk · miktar · fiyat (birim kalem
 * kartından). İptal edilmiş kalem aynen gider (fabrika ona dokunmaz). Değişiklik yoksa boş dizi değil `degisti:false`.
 */
export function kalemDizisi(d: KalemDurumu, form: readonly KalemSatiri[]): Built<{ lines: Record<string, unknown>[]; degisti: boolean }> {
  const byId = new Map(d.kalemler.map((k) => [k.id, k]));
  const lines: Record<string, unknown>[] = [];
  let degisti = false;
  for (const [n, f] of form.entries()) {
    if (!f.urunId) return { ok: false, error: `${n + 1}. kalem: ürün seçin` };
    const miktar = toDecimal(f.miktar);
    if (!miktar || Number(miktar) <= 0) return { ok: false, error: `${n + 1}. kalem: miktar geçersiz` };
    const fiyat = f.birimFiyat.trim() === "" ? null : toDecimal(f.birimFiyat);
    if (fiyat === null && f.birimFiyat.trim() !== "") return { ok: false, error: `${n + 1}. kalem: birim fiyat geçersiz` };
    const eski = f.id ? byId.get(f.id) : undefined;
    if (eski) {
      if (Number(miktar) !== Number(eski.miktar) || (fiyat ?? "") !== eski.birimFiyat || f.renkId !== eski.renkId) degisti = true;
      lines.push({ ...eski.geri, colorId: f.renkId, quantity: Number(miktar), unitPrice: fiyat });
    } else {
      degisti = true;
      lines.push({ itemId: f.urunId, ...(f.renkId ? { colorId: f.renkId } : {}), quantity: Number(miktar), ...(fiyat ? { unitPrice: fiyat } : {}) });
    }
  }
  if (form.length === 0) return { ok: false, error: "En az bir kalem kalmalı" };
  for (const k of d.kalemler) {
    if (k.iptal) lines.push({ ...k.geri });
    else if (!form.some((f) => f.id === k.id)) return { ok: false, error: "Kalem formdan çıkarılamaz; kalemi iptal edin" };
  }
  return { ok: true, body: { lines, degisti } };
}

const imza = (urunId: string | null, renkId: string | null, miktar: string, fiyat: string) => `${urunId}|${renkId ?? ""}|${Number(miktar)}|${fiyat === "" ? "" : Number(fiyat)}`;

/** Belirsiz denemeden sonra STALE: taze kayıtta aktif kalemler formdakilerle (çoklu küme) aynıysa ilk deneme yazılmıştır. */
export function kalemFarkVar(taze: KalemDurumu, form: readonly KalemSatiri[]): boolean {
  const a = taze.kalemler.filter((k) => !k.iptal).map((k) => imza(k.urunId, k.renkId, k.miktar, k.birimFiyat)).sort();
  const b = form.map((f) => imza(f.urunId, f.renkId, toDecimal(f.miktar) ?? f.miktar, f.birimFiyat.trim() === "" ? "" : (toDecimal(f.birimFiyat) ?? f.birimFiyat))).sort();
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}
