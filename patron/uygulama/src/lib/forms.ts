// Form → gelen kutusu gövdesi. Sayılar ondalık DİZİ ("12.5"); TR girişi ("1.250,5") çevrilir.
// Buradaki denetim kolaylıktır, karar sunucudadır (şema `patron/sunucu/src/wire/esitleme.ts`).
import type { CustomerMessageBody, OrderMessageBody } from "../api/wire";

export type Built<T> = { ok: true; body: T } | { ok: false; error: string };

/** "1.250,5" · "1250.5" · "12" → "1250.5" / "12"; geçersizse null. */
export function toDecimal(input: string): string | null {
  const t = input.trim().replace(/\s/g, "");
  if (t === "") return null;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^-?\d{1,14}(\.\d{1,6})?$/.test(norm)) return null;
  return norm.replace(/^(-?)0+(?=\d)/, "$1");
}

/** "29.09.2026" → "2026-09-29"; boş → undefined; geçersiz → null. */
export function trDateToIso(input: string): string | undefined | null {
  const t = input.trim();
  if (t === "") return undefined;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const opt = (s: string): string | undefined => (s.trim() === "" ? undefined : s.trim());

export interface OrderLineInput {
  readonly urunId: string | null;
  readonly renkId: string | null;
  readonly miktar: string;
  readonly birimFiyat: string;
}

export interface OrderInput {
  readonly cariKartId: string | null;
  readonly doviz: string;
  readonly termin: string;
  readonly aciklama: string;
  readonly kalemler: readonly OrderLineInput[];
}

export function buildOrder(i: OrderInput): Built<OrderMessageBody> {
  if (!i.cariKartId) return { ok: false, error: "Cari seçin" };
  const termin = trDateToIso(i.termin);
  if (termin === null) return { ok: false, error: "Termin GG.AA.YYYY biçiminde olmalı" };
  if (i.kalemler.length === 0) return { ok: false, error: "En az bir kalem ekleyin" };
  if (i.kalemler.length > 200) return { ok: false, error: "En çok 200 kalem" };
  const kalemler: OrderMessageBody["kalemler"][number][] = [];
  for (const [n, k] of i.kalemler.entries()) {
    if (!k.urunId) return { ok: false, error: `${n + 1}. kalem: ürün seçin` };
    const miktar = toDecimal(k.miktar);
    if (!miktar || Number(miktar) <= 0) return { ok: false, error: `${n + 1}. kalem: miktar geçersiz` };
    const fiyat = k.birimFiyat.trim() === "" ? undefined : toDecimal(k.birimFiyat);
    if (fiyat === null) return { ok: false, error: `${n + 1}. kalem: birim fiyat geçersiz` };
    kalemler.push({ urunId: k.urunId, ...(k.renkId ? { renkId: k.renkId } : {}), miktar, ...(fiyat ? { birimFiyat: fiyat } : {}) });
  }
  const aciklama = opt(i.aciklama);
  if (aciklama && aciklama.length > 500) return { ok: false, error: "Açıklama en çok 500 karakter" };
  return { ok: true, body: { cariKartId: i.cariKartId, doviz: i.doviz, ...(termin ? { termin } : {}), ...(aciklama ? { aciklama } : {}), kalemler } };
}

export interface CustomerInput {
  readonly ad: string;
  readonly musteri: boolean;
  readonly tedarikci: boolean;
  readonly il: string;
  readonly vergiNo: string;
  readonly telefon: string;
  readonly eposta: string;
}

export function buildCustomer(i: CustomerInput): Built<CustomerMessageBody> {
  const ad = i.ad.trim();
  if (ad === "") return { ok: false, error: "Ad zorunlu" };
  if (!i.musteri && !i.tedarikci) return { ok: false, error: "En az bir rol seçin" };
  const vergiNo = opt(i.vergiNo);
  if (vergiNo && !/^[0-9]{10,11}$/.test(vergiNo)) return { ok: false, error: "Vergi no 10–11 hane olmalı" };
  const telefon = opt(i.telefon);
  if (telefon && !/^[0-9 +()-]{7,25}$/.test(telefon)) return { ok: false, error: "Telefon geçersiz" };
  const eposta = opt(i.eposta);
  if (eposta && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return { ok: false, error: "E-posta geçersiz" };
  const il = opt(i.il);
  return {
    ok: true,
    body: { ad, roller: { musteri: i.musteri, tedarikci: i.tedarikci }, ...(il ? { il } : {}), ...(vergiNo ? { vergiNo } : {}), ...(telefon ? { telefon } : {}), ...(eposta ? { eposta } : {}) },
  };
}
