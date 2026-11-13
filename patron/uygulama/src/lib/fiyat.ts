// Fiyat formu (V5c, ERP): anahtar = yön + döviz + (cari | kart varsayılanı). Fabrika upsert eder; bayat koruma sürümü
// anahtarın yürürlükteki satırının `updatedAt`idir (satır yoksa gönderilmez). Para binlik ayırıcılı basılır.
import type { FiyatGovdesi, FiyatKaydi, FiyatYonu } from "../api/yazma";
import { formatMoney } from "./format";
import { toDecimal, type Built } from "./forms";

export const FIYAT_YONLERI: readonly { readonly key: FiyatYonu; readonly label: string }[] = [
  { key: "SALE", label: "Satış" },
  { key: "PURCHASE", label: "Alış" },
];

export const FIYAT_DOVIZLERI = ["TRY", "USD", "EUR", "GBP", "RUB"] as const;

export interface FiyatFormu {
  readonly yon: FiyatYonu;
  readonly doviz: string;
  readonly cariId: string | null;
  readonly cariAdi: string;
  readonly fiyat: string;
}

export const BOS_FIYAT: FiyatFormu = { yon: "SALE", doviz: "TRY", cariId: null, cariAdi: "", fiyat: "" };

export const fiyatFormu = (k: FiyatKaydi): FiyatFormu => ({ yon: k.yon, doviz: k.doviz, cariId: k.cariId, cariAdi: k.cariAdi, fiyat: k.fiyat.replace(".", ",") });

export const ayniAnahtar = (k: Pick<FiyatKaydi, "yon" | "doviz" | "cariId">, f: Pick<FiyatFormu, "yon" | "doviz" | "cariId">): boolean =>
  k.yon === f.yon && k.doviz === f.doviz && (k.cariId ?? null) === (f.cariId ?? null);

/** Listede formun anahtarındaki yürürlükteki satır (yoksa null). */
export const anahtarSatiri = (list: readonly FiyatKaydi[], f: Pick<FiyatFormu, "yon" | "doviz" | "cariId">): FiyatKaydi | null =>
  list.find((k) => ayniAnahtar(k, f)) ?? null;

/** Para girişi: "1.300" binlik gruplu yazımdır (1300), 1,3 değil; diğerleri `toDecimal` kuralıyla. */
const BINLIK = /^\d{1,3}(\.\d{3})+$/;

export function fiyatGovdesi(urunId: string, f: FiyatFormu): Built<FiyatGovdesi> {
  const ham = f.fiyat.trim().replace(/\s/g, "");
  const fiyat = toDecimal(BINLIK.test(ham) ? ham.replace(/\./g, "") : ham);
  if (fiyat === null) return { ok: false, error: "Fiyat girin" };
  if (Number(fiyat) < 0) return { ok: false, error: "Fiyat negatif olamaz" };
  return { ok: true, body: { urunId, cariId: f.cariId, yon: f.yon, doviz: f.doviz, fiyat } };
}

export const ayniFiyat = (a: string, b: string): boolean => Number(a) === Number(b);

export const yonEtiketi = (y: FiyatYonu): string => (y === "SALE" ? "Satış" : "Alış");

/** Satır başlığı: "Satış · Kart fiyatı" ya da "Satış · <cari>". */
export const fiyatBasligi = (k: Pick<FiyatKaydi, "yon" | "cariId" | "cariAdi">): string =>
  `${yonEtiketi(k.yon)} · ${k.cariId ? k.cariAdi || "Cari" : "Kart fiyatı"}`;

export const fiyatDegeri = (k: Pick<FiyatKaydi, "fiyat" | "doviz">): string => formatMoney(k.fiyat, k.doviz);
