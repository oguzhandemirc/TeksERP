// SİSTEM SAĞLIĞI ÖZETİ — portal ana sayfasındaki "Sistem sağlığı" kartı (GET /portal/api/saglik, `portal:oku`). YALNIZ
// sayı ve durum taşır: anahtar çapasının kaynağı, geçerli alt sertifika sayısı, zil, denetim yazma hatası, ERİŞİM JWKS'inin
// yaşı. Özel anahtar, parola, jeton, JWKS içeriği GİRMEZ (bekçi: test_erisim_kapisi §6o).
import { auditFailureCount } from "../lib/audit";
import type { AccessVerifier } from "../http/access-jwt";
import type { VendorContext } from "./context";

/** ERİŞİM kipinin özeti: JWKS dosyasının yaşı ve tavana göre durumu (UYARI: yarısı geçti · ASILDI: RED). */
function accessStatus(access: AccessVerifier | null) {
  if (!access) return { kip: "kapali" as const };
  const j = access.jwks.state();
  return {
    kip: "acik" as const,
    jwks: { dolu: j.filled, anahtarSayisi: j.keyCount, dosyaYasiSn: j.sourceAgeSec, azamiYasSn: j.maxSourceAgeSec, yasDurumu: j.ageLevel, okumaYasiSn: j.ageSec, sonHata: j.lastError },
  };
}

export function systemHealth(ctx: VendorContext, nowMs: number) {
  const hub = ctx.runtime?.hub ?? null;
  return {
    zil: { dinliyor: hub?.listening() ?? false, abone: hub?.subscriberCount() ?? 0, teslim: hub?.delivered() ?? 0 },
    anahtarlar: {
      capa: ctx.keys.anchorSource,
      altGecerli: ctx.keys.subKeys.filter((k) => k.kind === "ALT").length,
      indirmeVar: ctx.keys.downloadKey(nowMs) !== null,
      uyariSayisi: ctx.keys.warnings.length,
    },
    denetimYazmaHatasi: auditFailureCount(),
    erisim: accessStatus(ctx.runtime?.access ?? null),
  };
}
