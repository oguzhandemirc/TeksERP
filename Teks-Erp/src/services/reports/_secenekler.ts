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
/**
 * KOD TABANLI eksen seçeneği (sebep · belge tipi · KDV oranı). `code` SORGU
 * PARAMETRESİNİN BİREBİR BİÇİMİDİR — panel seçtiğini olduğu gibi geri gönderir;
 * `ad` yalnız gösterimdir. Ad `Sebep…` olarak doğdu, kapsamı sonra genişledi
 * (6e ile mutabık); yeniden adlandırma ayrı bir iştir.
 */
export interface SebepSecenek { code: string; ad: string }
export interface Secenekler {
  /** FİNANS: pencerede geçen cari hesaplar (`CariAccount`, müşteri + fasoncu). */
  cariId?: Secenek[];
  /** FİNANS: kasa/banka hesapları (kaynak İKİ tablo, tek listede birleşir). */
  accountId?: Secenek[];
  /**
   * FİNANS: pencerede geçen KDV oranları — ÜÇÜNCÜ ŞEKİL AÇILMADI (6e itirazı,
   * kabul). `code` sorgu parametresinin birebir biçimidir (`"18.00"`, şema
   * `/^\d{1,3}\.\d{2}$/`): panel seçtiğini OLDUĞU GİBİ geri gönderir. Sayıya
   * çevirip geri biçimlendirmek, aynı değeri iki yerde biçimlendirmek olurdu.
   * `ad` yalnız gösterim (`"%18"`) — çeviri değil SAYI BİÇİMİ, o yüzden
   * backend'de üretilmesi etiket tek-kaynağını çiğnemez.
   */
  oran?: SebepSecenek[];
  /**
   * FİNANS: ekstrede geçen belge tipleri. `Secenek` DEĞİL `SebepSecenek`:
   * anahtar bir kimlik değil ENUM değeridir ve `reasonCode` ile aynı şekli taşır
   * (kod + görünen ad) — panel ikisini tek bileşenle çizebilsin.
   */
  belgeTipi?: SebepSecenek[];
  customerId?: Secenek[];
  itemId?: Secenek[];
  colorId?: Secenek[];
  subcontractorId?: Secenek[];
  reasonCode?: SebepSecenek[];
}
/** Rapor nesnesi seçici kaynağını taşır; rota `meta.secenekler`e kaldırır. `dusenSatir` (R5b-c4) yalnız süzgeçliyken:
 * süzgeçsiz satır − süzgeçli satır (toplayıcı zaten ×2 koştuğu için bedava) — ekranda "veri yok" ile "süzgeç kesti" ayrılsın. */
export interface WithSecenekler { secenekler: Secenekler; dusenSatir?: number }

/** Süzgeçli koşumda düşen satır sayısı; süzgeçsizde `undefined` (anahtar YOK). */
export function droppedRows(unfilteredCount: number | null, filteredCount: number): number | undefined {
  return unfilteredCount == null ? undefined : Math.max(0, unfilteredCount - filteredCount);
}

/**
 * ⚠️ İKİNCİ KOŞUM HER RAPORDA GEREKMEZ ve ölçüt SÜZGECİN NEREYE İNDİĞİdir
 * (d9 ölçtü 2026-09-15, R5b-d-b):
 *   • Süzgeç WHERE'e iniyorsa (satış eksenleri · `aging` · `fx-diff`) kaynak
 *     sorgusu da süzülür ⇒ toplayıcı bir kez DAHA, o süzgeç olmadan koşar.
 *   • Süzgeç yalnız satır DÖKÜMÜNE uygulanıyorsa (`cash-book` · `statement` —
 *     orada özet bir BAKİYEdir ve süzgeçten etkilenmemelidir) kaynak sorgusu
 *     ZATEN süzgeçsizdir ⇒ ikinci koşum gereksiz bir maliyettir.
 * İkisini tek kurala bağlamak ya boşuna sorgu ekler ya kilitli seçici üretir.
 */
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

/**
 * ORAN ekseni: `code` sorgu biçiminde (sabit 2 hane), `ad` gösterim (`"%18"`).
 *
 * ⚠️ SIRALAMA SAYISAL, metin DEĞİL: `"10.00" < "3.00"` metin sıralamasında
 * DOĞRUdur ve listeyi ters gösterirdi. `tr` karşılaştırıcısı da burada yanlış
 * araçtır — sıralanan şey bir ad değil bir BÜYÜKLÜK.
 */
export function rateOptions(values: Iterable<number | string | null | undefined>): SebepSecenek[] {
  const seen = new Map<string, { code: string; ad: string; n: number }>();
  for (const v of values) {
    const n = typeof v === "string" ? Number(v) : v;
    if (n === null || n === undefined || !Number.isFinite(n)) continue;
    const code = n.toFixed(2);
    if (seen.has(code)) continue;
    seen.set(code, { code, ad: `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`, n });
  }
  return [...seen.values()].sort((a, b) => a.n - b.n).slice(0, SECENEK_MAX).map(({ code, ad }) => ({ code, ad }));
}

/** Süzgeç verilmiş mi (seçenek için toplayıcı yeniden koşacak mı)? */
export function hasFilters(f: object): boolean {
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));
}
