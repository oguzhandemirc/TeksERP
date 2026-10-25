// =============================================================================
// Kayıtlı rapor koşu sonucu → genel yaprağın blok tipleri (`AnaSayi` · `GrafikBlok` · `TabloBlok`)
// =============================================================================
// Yalnız BİÇİM dönüşümüdür: sayı hesaplanmaz, kıyas yüzdesi istemcide üretilmez (K-KIYAS) — önceki dönem
// değeri sunucunun döndürdüğü toplamdır ve ayrı satırda yazılır.
// =============================================================================
import type { AnaSayi, Birim, GrafikBlok, GrafikTuru, TabloBlok, TabloHucresi } from "../sunum";
import { GRAFIK_TURLERI } from "../sunum";
import type { SemanticResultLite } from "./custom-api";

const UNITS: readonly Birim[] = ["m", "kg", "top", "adet", "siparis", "levent", "parti", "yuzde", "puan", "gun", "dakika", "saat", "TRY", "USD", "EUR"];

export function unitOf(raw: string): Birim {
  return (UNITS as readonly string[]).includes(raw) ? (raw as Birim) : "adet";
}

/** Ana sayı + (varsa) kıyas döneminin ham toplamı. */
export function headlineOf(r: SemanticResultLite): { figure: AnaSayi; previous: number | null } | null {
  const m = r.olculer[0];
  if (!m) return null;
  const value = r.toplam.degerler[m.kimlik] ?? null;
  return {
    figure: { olcu: m.kimlik, ad: m.ad, deger: value, birim: unitOf(m.birim), ...(value === null ? { olculemedi: "Bu dönemde veri yok." } : {}) },
    previous: r.kiyas ? (r.kiyas.toplam.degerler[m.kimlik] ?? null) : null,
  };
}

const rowLabel = (r: SemanticResultLite, row: SemanticResultLite["satirlar"][number]) =>
  r.boyutlar.map((d) => row.anahtarlar[d.kimlik]?.etiket ?? row.anahtarlar[d.kimlik]?.deger ?? "—").join(" · ");

export function tableOf(r: SemanticResultLite): TabloBlok {
  const columns = [
    ...r.boyutlar.map((d) => ({ anahtar: `b:${d.kimlik}`, baslik: d.ad, hiza: "sol" as const })),
    ...r.olculer.map((m) => ({ anahtar: `o:${m.kimlik}`, baslik: m.ad, birim: unitOf(m.birim), hiza: "sag" as const })),
  ];
  const rows = r.satirlar.map((row) => {
    const out: Record<string, TabloHucresi> = {};
    for (const d of r.boyutlar) out[`b:${d.kimlik}`] = row.anahtarlar[d.kimlik]?.etiket ?? row.anahtarlar[d.kimlik]?.deger ?? null;
    for (const m of r.olculer) out[`o:${m.kimlik}`] = row.degerler[m.kimlik] ?? null;
    return out;
  });
  const total: Record<string, TabloHucresi> = {};
  if (r.boyutlar[0]) total[`b:${r.boyutlar[0].kimlik}`] = "Toplam";
  for (const m of r.olculer) total[`o:${m.kimlik}`] = r.toplam.degerler[m.kimlik] ?? null;
  return { kolonlar: columns, satirlar: rows, toplam: total };
}

export function chartOf(r: SemanticResultLite, kind: string): GrafikBlok | null {
  const m = r.olculer[0];
  if (!m || r.boyutlar.length === 0) return null;
  const tur: GrafikTuru = (GRAFIK_TURLERI as readonly string[]).includes(kind) ? (kind as GrafikTuru) : "cubuk";
  return {
    tur,
    eksen: { x: { ad: r.boyutlar.map((d) => d.ad).join(" · "), tur: "kategori" }, y: { ad: m.ad, birim: unitOf(m.birim) } },
    kategoriler: r.satirlar.map((row) => rowLabel(r, row)),
    seriler: [{ ad: m.ad, veri: r.satirlar.map((row) => row.degerler[m.kimlik] ?? null) }],
  };
}
