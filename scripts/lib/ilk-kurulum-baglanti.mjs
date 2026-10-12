// =============================================================================
// İLK KURULUM DEPOSU ↔ BACKEND YAYINI — girdi sözleşmesi (tek kaynak)
// =============================================================================
// Windows backend yayını (`deploy/backend-yayinla.mjs`) bittiğinde grubun ilk kurulum arşivi aynı paketle yenilenir
// (`deploy/kurulum/ilk-kurulum-yayinla.mjs --uygula`). Arşivin backend'den başka girdileri (sunucu kurulumu, PG zip'i,
// PG künyesi, isteğe bağlı tkpub) yayına argümanla verilir; hiçbiri verilmezse yayın sürer ama depo güncellenmez ve bu
// yüksek sesle söylenir; KISMİ girdi yüklemeden ÖNCE durur. Bekçi: scripts/test_ilk_kurulum_yayinla.mjs.
// =============================================================================

export const ILK_KURULUM_BETIK = 'deploy/kurulum/ilk-kurulum-yayinla.mjs';
/** backend-yayinla argüman adı → ilk-kurulum-yayinla argümanı. `pgKunye` verilmezse yayının `--pg-kunye`si kullanılır. */
export const ILK_KURULUM_ARGLARI = Object.freeze({
  setup: Object.freeze({ yayin: 'ilk-kurulum-setup', hedef: '--setup', zorunlu: true }),
  pg: Object.freeze({ yayin: 'ilk-kurulum-pg', hedef: '--pg', zorunlu: true }),
  pgKunye: Object.freeze({ yayin: 'ilk-kurulum-pg-kunye', hedef: '--pg-kunye', zorunlu: true }),
  tkpub: Object.freeze({ yayin: 'ilk-kurulum-tkpub', hedef: '--tkpub', zorunlu: false }),
});

/**
 * Yayının ilk kurulum girdileri. `arg(ad)` → değer | undefined. Üç sonuç:
 *   { durum: 'yok' } · { durum: 'eksik', eksik: [argüman] } · { durum: 'tam', girdi: { setup, pg, pgKunye, tkpub? } }
 */
export function ilkKurulumGirdisi(arg, { pgKunyeYedek = null } = {}) {
  const girdi = {};
  for (const [ad, t] of Object.entries(ILK_KURULUM_ARGLARI)) {
    const v = arg(t.yayin);
    if (v !== undefined && v !== '') girdi[ad] = v;
  }
  const kendi = Object.keys(girdi).length > 0;
  if (!kendi) return { durum: 'yok' };
  if (girdi.pgKunye === undefined && pgKunyeYedek) girdi.pgKunye = pgKunyeYedek;
  const eksik = Object.entries(ILK_KURULUM_ARGLARI).filter(([ad, t]) => t.zorunlu && girdi[ad] === undefined).map(([, t]) => `--${t.yayin}`);
  return eksik.length ? { durum: 'eksik', eksik } : { durum: 'tam', girdi };
}

/** ilk-kurulum-yayinla argümanları (betik yolu dahil, KOK'a göreli). */
export function ilkKurulumArgv({ grup, paket, girdi, uygula = false }) {
  const a = [ILK_KURULUM_BETIK, '--grup', grup, '--backend', paket];
  for (const [ad, t] of Object.entries(ILK_KURULUM_ARGLARI)) if (girdi?.[ad] !== undefined) a.push(t.hedef, girdi[ad]);
  if (uygula) a.push('--uygula');
  return a;
}

/** Ekrana basılacak, kopyalanabilir komut (tek tırnaklı kabuk biçimi). */
export function kabukKomutu(argv) {
  const q = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);
  return ['node', ...argv].map(q).join(' ');
}
