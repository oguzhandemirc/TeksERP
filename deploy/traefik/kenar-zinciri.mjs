// Traefik kenar zinciri denetimi — satıcı ve patron compose-denetle'nin ORTAK kuralı (paket yok, saf fonksiyon).
// Zincir yönlendirici başına TAM İKİ halkadır ve sıra önemlidir: önce Cloudflare ipallowlist (TCP karşı ucu,
// başlık okunmaz), sonra hız sınırı (anahtar Cf-Connecting-Ip — yalnız allowlist'ten geçmiş, yani Cloudflare'in
// yazdığı başlık). Ters sırada başlık kökene doğrudan gelen istekte sahte olurdu.

/** Hız sınırının uygulamanınkinin ALTINA inmemesi için tabanlar (istek/sn ve patlama). */
export const HIZ_TABANI = Object.freeze({ saniyeBasi: 4, patlama: 300 });

/**
 * @param {Record<string, unknown>} etiket  servisin çözülmüş etiketleri (`docker compose config` ya da düz eşleme)
 * @param {string} yonlendirici            yönlendirici adı
 * @param {readonly string[] | null} cf    Cloudflare aralıkları (tek kaynak uygulama kodu); null → ölçülemedi
 * @param {{ saniyeBasi: number }} [taban] çağıranın uygulama sınırından türeyen ek taban
 * @returns {string[]} sorunlar (boş = temiz)
 */
export function kenarZinciriSorunlari(etiket, yonlendirici, cf, taban = HIZ_TABANI) {
  const e = (k) => (etiket[k] === undefined ? undefined : String(etiket[k]));
  const sorun = [];
  const halkalar = (e(`traefik.http.routers.${yonlendirici}.middlewares`) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (halkalar.length !== 2) return [`${yonlendirici}: ara katman zinciri iki halka değil (${halkalar.join(",") || "YOK"})`];
  const [izin, hiz] = halkalar;
  const m = (ad, alt) => `traefik.http.middlewares.${ad}.${alt}`;

  const kaynaklar = (e(m(izin, "ipallowlist.sourcerange")) ?? "").split(",").map((x) => x.trim()).filter(Boolean).sort();
  if (cf === null) sorun.push("Cloudflare aralıkları OKUNAMADI");
  else if (JSON.stringify(kaynaklar) !== JSON.stringify([...cf].sort())) sorun.push(`${izin}: ipallowlist ${kaynaklar.length} kaynak ↔ ${cf.length} Cloudflare aralığı (birebir değil)`);
  if (Object.keys(etiket).some((k) => k.startsWith(m(izin, "ipallowlist.ipstrategy")))) sorun.push(`${izin}: ipallowlist ipstrategy taşıyor (başlık okunur — sahtelenebilir)`);

  const hk = Object.keys(etiket).filter((k) => k.startsWith(m(hiz, "ratelimit.")));
  if (hk.length === 0) sorun.push(`${hiz}: ratelimit değil`);
  const kriter = Object.keys(etiket).filter((k) => k.startsWith(m(hiz, "ratelimit.sourcecriterion.")));
  const baslik = e(m(hiz, "ratelimit.sourcecriterion.requestheadername")) ?? "";
  if (kriter.length !== 1 || baslik.toLowerCase() !== "cf-connecting-ip") sorun.push(`${hiz}: kaynak ölçütü yalnız Cf-Connecting-Ip başlığı olmalı (${kriter.map((k) => k.split(".").pop()).join(",") || "YOK"}=${baslik || "-"})`);
  const ortalama = Number(e(m(hiz, "ratelimit.average")) ?? NaN);
  const patlama = Number(e(m(hiz, "ratelimit.burst")) ?? NaN);
  const donem = e(m(hiz, "ratelimit.period")) ?? "1s";
  if (donem !== "1s") sorun.push(`${hiz}: period 1s değil (${donem})`);
  const tabanSn = Math.max(HIZ_TABANI.saniyeBasi, taban.saniyeBasi ?? 0);
  if (!(ortalama >= tabanSn)) sorun.push(`${hiz}: average ${ortalama} < taban ${tabanSn}/sn`);
  if (!(patlama >= HIZ_TABANI.patlama)) sorun.push(`${hiz}: burst ${patlama} < taban ${HIZ_TABANI.patlama}`);
  return sorun;
}
