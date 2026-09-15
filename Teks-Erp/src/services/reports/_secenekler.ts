// =============================================================================
// TeksERP — Raporlarda SEÇİCİ KAYNAKLARI (raporlar fazı R5b-c3): `meta.secenekler`
// =============================================================================
// Panel çoklu seçicisi liste uçlarından (müşteri/kalem/renk/fasoncu) beslenemez: o uçlar kendi izinlerini ister
// (`customer:read` vb.) ve rapor kitlesinde 403 riski var — "çıkışsız kapı" sınıfı (makine listesi tuzağının aynısı,
// `meta.leventler` emsali). Bu yüzden seçenekler RAPORUN KENDİ toplayıcısından türer: pencerede geçen değerler,
// süzgeçten BAĞIMSIZ (süzgeçli yanıtta da tam liste — seçenek daralmasın), ≤200/eksen, ada göre `tr` sıralı,
// yalnız o raporun eksenleri. Süzgeçsiz istekte ek sorgu YOK; süzgeçli istekte toplayıcı bir kez daha süzgeçsiz koşar.
// Ad sızıntısı ölçüldü: müşteri adı aynı izin kitlesinin kardeş raporlarında zaten basılı; kalem kod+ad ve renk adı
// ürün kataloğu; fasoncu adı ve sebep etiketi rapor satırında basılı.
// =============================================================================

export interface Secenek { id: string; ad: string; kod?: string }
export interface SebepSecenek { code: string; ad: string }
export interface Secenekler {
  customerId?: Secenek[];
  itemId?: Secenek[];
  colorId?: Secenek[];
  subcontractorId?: Secenek[];
  reasonCode?: SebepSecenek[];
}
/** Rapor nesnesi seçici kaynağını taşır; rota `meta.secenekler`e kaldırır. */
export interface WithSecenekler { secenekler: Secenekler }

export const SECENEK_MAX = 200;
const tr = (a: string, b: string) => a.localeCompare(b, "tr");

/** Kimlik başına tek satır (ilk görülen ad/kod), ada göre sıralı, ≤200. `id` boş/null olan hücre atlanır. */
export function optionList(cells: Iterable<{ id: string | null | undefined; ad: string | null | undefined; kod?: string | null }>): Secenek[] {
  const seen = new Map<string, Secenek>();
  for (const c of cells) {
    if (!c.id || seen.has(c.id)) continue;
    seen.set(c.id, { id: c.id, ad: c.ad ?? "", ...(c.kod ? { kod: c.kod } : {}) });
  }
  return [...seen.values()].sort((a, b) => tr(a.ad, b.ad) || tr(a.id, b.id)).slice(0, SECENEK_MAX);
}

/** Sebep kodu listesi: kod başına tek satır, etiket katalogdan (yoksa kodun kendisi), etikete göre sıralı. */
export function reasonOptions(codes: Iterable<string | null | undefined>, labelOf: (code: string) => string | undefined): SebepSecenek[] {
  const seen = new Map<string, SebepSecenek>();
  for (const c of codes) {
    if (!c || seen.has(c)) continue;
    seen.set(c, { code: c, ad: labelOf(c) ?? c });
  }
  return [...seen.values()].sort((a, b) => tr(a.ad, b.ad) || tr(a.code, b.code)).slice(0, SECENEK_MAX);
}

/** Süzgeç verilmiş mi (seçenek için toplayıcı yeniden koşacak mı)? */
export function hasFilters(f: object): boolean {
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));
}
