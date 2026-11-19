// Ortak veri tablosu modeli (D7): sütun tanımı, görünüm tercihi (sıralama + gizli sütunlar) ve saf yardımcılar.
// Sıralama SUNUCUDA (`?sirala=&yon=`); istemci yalnız sunucunun beyan ettiği alanı (`liste.siralama`) seçtirir, kendisi
// sıralamaz. Tercih bilinmeyen alan/sütun taşırsa sessizce düşer (eski tercih yeni sürümü kırmaz).
import type { ListSortDir } from "../../api/wire";

export type SutunTuru = "metin" | "sayi" | "tarih";

export interface TabloSutunu<R> {
  /** Kayıttaki tel alanı (sıralama anahtarıyla aynı ad). */
  readonly anahtar: string;
  readonly etiket: string;
  readonly tur: SutunTuru;
  /** Hücre metni (biçimleme ekranın; aritmetik yok). */
  readonly deger: (r: R) => string;
  /** Geniş ekranda göreli genişlik (flex); varsayılan 1. */
  readonly genislik?: number;
  /** Gizlenemez (satırın kimliği: no). */
  readonly sabit?: boolean;
}

export interface TabloTercihi {
  readonly sirala: string | null;
  readonly yon: ListSortDir;
  readonly gizli: readonly string[];
}

export const VARSAYILAN_TERCIH: TabloTercihi = { sirala: null, yon: "artan", gizli: [] };

/** Saklı/uzak değer → geçerli tercih: sıralanamayan alan, bilinmeyen ya da sabit sütun düşer. */
export function normalizeTercih(raw: unknown, sutunlar: readonly TabloSutunu<never>[], siralanabilir: readonly string[]): TabloTercihi {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return VARSAYILAN_TERCIH;
  const o = raw as Record<string, unknown>;
  const sirala = typeof o.sirala === "string" && siralanabilir.includes(o.sirala) ? o.sirala : null;
  const yon: ListSortDir = o.yon === "azalan" ? "azalan" : "artan";
  const gizlenebilir = new Set(sutunlar.filter((c) => !c.sabit).map((c) => c.anahtar));
  const gizli = Array.isArray(o.gizli) ? [...new Set(o.gizli.filter((k): k is string => typeof k === "string" && gizlenebilir.has(k)))] : [];
  return { sirala, yon: sirala ? yon : "artan", gizli };
}

/** Başlığa dokunuş döngüsü: başka alan → artan · artan → azalan · azalan → varsayılan sıra. */
export function basligaDokun(t: TabloTercihi, alan: string): TabloTercihi {
  if (t.sirala !== alan) return { ...t, sirala: alan, yon: "artan" };
  if (t.yon === "artan") return { ...t, yon: "azalan" };
  return { ...t, sirala: null, yon: "artan" };
}

const YON_METNI: Readonly<Record<SutunTuru, Readonly<Record<ListSortDir, string>>>> = {
  metin: { artan: "A → Z", azalan: "Z → A" },
  sayi: { artan: "küçükten büyüğe", azalan: "büyükten küçüğe" },
  tarih: { artan: "eskiden yeniye", azalan: "yeniden eskiye" },
};

export const VARSAYILAN_SIRA_METNI = "En yeni önce";

/** Sıralama seçenekleri (alt sayfa): varsayılan + her sıralanabilir sütunun iki yönü. Anahtar `alan:yon`. */
export function siralamaSecenekleri<R>(sutunlar: readonly TabloSutunu<R>[], siralanabilir: readonly string[]): { key: string; label: string }[] {
  const out = [{ key: "", label: VARSAYILAN_SIRA_METNI }];
  for (const c of sutunlar) {
    if (!siralanabilir.includes(c.anahtar)) continue;
    for (const y of ["artan", "azalan"] as const) out.push({ key: `${c.anahtar}:${y}`, label: `${c.etiket} (${YON_METNI[c.tur][y]})` });
  }
  return out;
}

export const secenekAnahtari = (t: TabloTercihi): string => (t.sirala ? `${t.sirala}:${t.yon}` : "");

export function secenektenTercih(t: TabloTercihi, key: string): TabloTercihi {
  if (!key) return { ...t, sirala: null, yon: "artan" };
  const [alan, yon] = key.split(":");
  return { ...t, sirala: alan ?? null, yon: yon === "azalan" ? "azalan" : "artan" };
}

/** Çip metni: seçili sıranın kısa adı. */
export function siralamaEtiketi<R>(t: TabloTercihi, sutunlar: readonly TabloSutunu<R>[]): string {
  const c = t.sirala ? sutunlar.find((x) => x.anahtar === t.sirala) : undefined;
  return c ? `${c.etiket} (${YON_METNI[c.tur][t.yon]})` : VARSAYILAN_SIRA_METNI;
}

/** Geniş ekranda çizilecek sütunlar (gizliler hariç; sabit sütun hep görünür). */
export const gorunenSutunlar = <R,>(sutunlar: readonly TabloSutunu<R>[], t: TabloTercihi): TabloSutunu<R>[] =>
  sutunlar.filter((c) => c.sabit || !t.gizli.includes(c.anahtar));
