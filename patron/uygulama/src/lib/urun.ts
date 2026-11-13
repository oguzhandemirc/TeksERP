// Ürün kartı (V5c, ERP) yardımcıları: tür etiketi ve türden türeyen birim (panel `Electron/src/types/enums.ts` aynası).
import type { UrunGovdesi, UrunKaydi } from "../api/yazma";
import type { Built } from "./forms";
export type UrunTuru = "FABRIC" | "YARN" | "CONSUMABLE";

export const URUN_TURLERI: readonly { readonly key: UrunTuru; readonly label: string; readonly birim: string }[] = [
  { key: "FABRIC", label: "Kumaş", birim: "MT" },
  { key: "YARN", label: "İplik", birim: "KG" },
  { key: "CONSUMABLE", label: "Sarf", birim: "ADET" },
];

export const urunTuruEtiketi = (tur: string | null | undefined): string => URUN_TURLERI.find((x) => x.key === tur)?.label ?? "";

// ── Form (V5c) ────────────────────────────────────────────────────────────────

export interface UrunFormu {
  readonly ad: string;
  readonly tur: UrunTuru;
}

/** Yeni ürün: ad 1–100 (fabrika büyük harfe çevirir), birim türden. */
export function urunGovdesi(f: UrunFormu): Built<UrunGovdesi> {
  const ad = f.ad.trim().replace(/\s+/g, " ");
  if (!ad) return { ok: false, error: "Ürün adı girin" };
  if (ad.length > 100) return { ok: false, error: "Ürün adı en çok 100 karakter" };
  const tur = URUN_TURLERI.find((x) => x.key === f.tur);
  if (!tur) return { ok: false, error: "Tür seçin" };
  return { ok: true, body: { ad, tur: tur.key, birim: tur.birim } };
}

/** Düzenleme yalnız adı değiştirir (kod ve tür fabrikada değişmez). */
export function urunPatch(k: UrunKaydi, ad: string): Built<Readonly<Record<string, unknown>>> {
  const b = urunGovdesi({ ad, tur: "FABRIC" });
  if (!b.ok) return b;
  return { ok: true, body: b.body.ad !== k.ad ? { name: b.body.ad } : {} };
}
