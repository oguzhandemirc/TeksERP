// =============================================================================
// SEMANTİK KATMAN — KÜP KAYDI ve istemci kataloğu (R1-SEMCEK)
// =============================================================================
// İstemci yalnız GÖREBİLDİĞİ kimlikleri alır (izin + modül süzülmüş ağaç); ölçü adı/açıklaması
// `tanimlar.ts` sözlüğünden okunur — burada kopyalanmaz. Yeni küp R1-SEMKUP'ta buraya eklenir.
// =============================================================================
import { OLCU_TANIMLARI } from "./tanimlar";
import { canAccess, type AccessContext } from "./izin";
import { shipmentCube } from "./kupler/sevk.kup";
import { FILTER_OPERATORS, type SemanticCube } from "./tipler";

export const SEMANTIC_CUBES: readonly SemanticCube[] = [shipmentCube];

export function measureDictionaryEntry(id: string) {
  return OLCU_TANIMLARI.find((t) => t.kimlik === id) ?? null;
}

export interface CatalogCube {
  kimlik: string;
  ad: string;
  olculer: Array<{ kimlik: string; ad: string; aciklama: string; birim: string; iyiYon: string; boyutlar: string[] | null; paraBirimiAyri: boolean }>;
  boyutlar: Array<{ kimlik: string; ad: string; tur: "zaman" | "kategori"; islecler: string[]; kisiAdi?: true }>;
  notlar: string[];
}

export function buildCatalogTree(ctx: AccessContext, cubes: readonly SemanticCube[] = SEMANTIC_CUBES): CatalogCube[] {
  return cubes
    .filter((c) => canAccess(c, ctx))
    .map((c) => ({
      kimlik: c.id,
      ad: c.name,
      olculer: c.measures.flatMap((m) => {
        const t = measureDictionaryEntry(m.id);
        // Sözlükte olmayan ölçü yayımlanmaz (fail-closed); `test_semantik_derleyici` kaydı ölçer.
        if (!t || !canAccess(m, ctx)) return [];
        return [{
          kimlik: m.id, ad: t.ad, aciklama: t.aciklama, birim: t.birim, iyiYon: t.iyiYon,
          boyutlar: m.helper ? [...m.helper.dimensions] : null,
          paraBirimiAyri: m.helper?.perCurrency ?? false,
        }];
      }),
      boyutlar: c.dimensions
        .filter((d) => canAccess(d, ctx))
        .map((d) => ({
          kimlik: d.id,
          ad: d.name,
          tur: d.kind === "time" ? ("zaman" as const) : ("kategori" as const),
          islecler: d.kind === "time" ? [] : FILTER_OPERATORS.filter((o) => o !== "contains" || d.labelSql !== undefined),
          ...(d.personName ? { kisiAdi: true as const } : {}),
        })),
      notlar: [...(c.notes ?? [])],
    }));
}
