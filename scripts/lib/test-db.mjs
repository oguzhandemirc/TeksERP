// =============================================================================
// Test DB aracı — SAF karar çekirdeği (zero-dep). CLI: scripts/test-db.mjs ·
// bekçi: scripts/test_test_db_araci.mjs. Karar burada, yan etki CLI'da: bekçi
// kararları DB'siz ölçebilsin ve CI'da da koşsun.
// =============================================================================

/** Aracın açıp silebileceği TEK ad biçimi. */
export const AD_DESENI = /^tekserp_[a-z0-9]+_test$/;

/** Desene uysa bile adla korunan aileler (fail-closed ikinci sed). */
const KORUNAN = [/^tekserp_fabrika/, /^postgres$/, /^template/];

/** DB yorumunun aracın kaydı olduğunu gösteren ön ek. */
export const YORUM_ONEKI = "test-db.mjs|";

/** Ad kapısı: hata metni ya da null. Hem hedef hem klon kaynağı için. */
export function adHatasi(ad) {
  if (typeof ad !== "string" || ad.length === 0) return "ad verilmedi";
  for (const k of KORUNAN) if (k.test(ad)) return `'${ad}' korunan bir ad (tekserp_fabrika_* · postgres · template*) — araç bu adı ASLA işlemez`;
  if (!AD_DESENI.test(ad)) return `'${ad}' biçim dışı — yalnız tekserp_[a-z0-9]+_test kabul edilir`;
  return null;
}

/** PG tanımlayıcısı; ad kapısından geçmiş ada bile uygulanır (iki kat sed). */
export function tanimlayici(ad) {
  return `"${String(ad).replace(/"/g, '""')}"`;
}

/** PG metin literali. */
export function literal(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Açılış kaydı → DB yorumu. `|` ve `=` alan içinde geçmesin diye ayıklanır. */
export function yorumYaz({ ac, kim, agac, dal, sablon }) {
  const temiz = (v) => String(v ?? "").replace(/[|=\n\r]/g, "_");
  const alanlar = [`ac=${temiz(ac)}`, `kim=${temiz(kim)}`, `agac=${temiz(agac)}`, `dal=${temiz(dal)}`];
  if (sablon) alanlar.push(`sablon=${temiz(sablon)}`);
  return YORUM_ONEKI + alanlar.join("|");
}

/** DB yorumu → kayıt nesnesi; aracın yorumu değilse null. */
export function yorumOku(yorum) {
  if (typeof yorum !== "string" || !yorum.startsWith(YORUM_ONEKI)) return null;
  const k = {};
  for (const parca of yorum.slice(YORUM_ONEKI.length).split("|")) {
    const i = parca.indexOf("=");
    if (i > 0) k[parca.slice(0, i)] = parca.slice(i + 1);
  }
  return k;
}

/**
 * Klon kaynağı kararı. `rolls`: sayı · "tablo-yok" (boş şema, fabrika verisi taşıyamaz) ·
 * null (ölçülemedi). Ölçülemeyen kaynak REDDEDİLİR — fabrika kopyası `_test` adı taşıyabilir.
 */
export function klonKaynagiKarari({ kaynak, varMi, rolls, bagliOturum }) {
  const sebepler = [];
  const ah = adHatasi(kaynak);
  if (ah) sebepler.push(`kaynak: ${ah}`);
  else if (!varMi) sebepler.push(`kaynak '${kaynak}' yok`);
  else {
    if (rolls === null || rolls === undefined) sebepler.push(`kaynak '${kaynak}' rolls sayısı ÖLÇÜLEMEDİ — fail-closed`);
    else if (rolls !== "tablo-yok" && !(Number.isInteger(rolls) && rolls === 0)) {
      sebepler.push(`kaynak '${kaynak}' ${rolls} top taşıyor — fabrika verisi kopyası olabilir, klonlanmaz (temiz şablon: rolls = 0)`);
    }
    if (bagliOturum > 0) sebepler.push(`kaynağa ${bagliOturum} bağlı oturum var (PG şablon klonu bağlantısız kaynak ister)`);
  }
  return { izin: sebepler.length === 0, sebepler };
}

/**
 * Silme kararı.
 * - `kayit`: yorumdan ya da jsonl'den okunan açılış kaydı (yoksa null) → `--kayitsiz` ister.
 * - `kayitAgaciBaska`: kayıttaki ağaç bu ağaç değil VE diskte duruyor → `--baska-agac` ister.
 * - `envReferanslari`: bu DB'yi DATABASE_URL'inde gösteren BAŞKA canlı ağaçlar → bayrakla AŞILMAZ.
 * - `bagliOturum`: > 0 ise silinmez (FORCE yok), raporlanır.
 */
export function silmeKarari({ ad, varMi, kayit, kayitAgaciBaska, envReferanslari, bagliOturum, bayraklar }) {
  const sebepler = [];
  const ah = adHatasi(ad);
  if (ah) return { izin: false, yok: false, sebepler: [ah] };
  if (!varMi) return { izin: false, yok: true, sebepler: [`'${ad}' zaten yok`] };
  if (!kayit && !bayraklar?.kayitsiz) sebepler.push(`'${ad}' bu araçla açılmamış (kayıt yok) — adından eminsen --kayitsiz ver`);
  if (kayit && kayitAgaciBaska && !bayraklar?.baskaAgac) {
    sebepler.push(`'${ad}' başka bir ağaçtan açılmış (${kayit.agac}) ve o ağaç duruyor — sahibi sensen --baska-agac ver`);
  }
  if (envReferanslari?.length) sebepler.push(`'${ad}' şu canlı ağaçların .env'inde hedef: ${envReferanslari.join(", ")} — o oturum bitmeden silinmez`);
  if (bagliOturum > 0) sebepler.push(`'${ad}' üzerinde ${bagliOturum} bağlı oturum var — silinmedi (FORCE kullanılmaz)`);
  return { izin: sebepler.length === 0, yok: false, sebepler };
}

/** `.env` metninden DATABASE_URL'in DB adı (yoksa null). */
export function envDbAdi(metin) {
  const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*['"]?([^'"\s#]+)/m.exec(String(metin ?? ""));
  if (!m) return null;
  try {
    return new URL(m[1]).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}
