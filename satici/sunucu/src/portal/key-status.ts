// ANAHTAR KÜNYESİ GÖRÜNÜMÜ (portal `/anahtarlar`): yalnız AÇIK yarı + kid + tür + geçerlilik + çapa bilgisi + sertifikayı
// veren kökün kid'i (sertifikanın kendisi gönderilmez); özel anahtar ve parolası hiçbir yanıtta yoktur.
// Açık sertifikalar (ISTEMCI · PAKET + bağlı OTA yaprakları) satıcının TUTMADIĞI anahtarlardır: künye DB'ye yazılmaz,
// anahtar biriminden canlı okunur; iptal durumu dağıtım iptali defterinin kiradaki belgesinden.
import { isPackageCertificateRevoked, parseJws } from "../lisans-protokol";
import type { Db } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { newestPackageRevocation } from "../services/package-revocation.service";

function certificateIssuer(token: string | null): string | null {
  if (!token) return null;
  const p = parseJws(token);
  return p.ok ? p.value.header.kid : null;
}

export async function keyStatus(ctx: VendorContext, db: Db, nowMs: number) {
  const registry = await db.anahtarKaydi.findMany({
    orderBy: [{ tur: "asc" }, { kid: "asc" }],
    select: { kid: true, tur: true, acikAnahtar: true, siniflar: true, sertifika: true, baslangic: true, bitis: true, durum: true, createdAt: true, updatedAt: true },
  });
  const loaded = new Set([...ctx.keys.wrapped.map((w) => w.kid), ...ctx.keys.subKeys.map((k) => k.kid), ...ctx.keys.intermediates.map((k) => k.kid)]);
  const revocation = await newestPackageRevocation(db, ctx.keys);
  // Kök bu sunucuda durmasa da (üretimde Mac'te) çapada olup olmadığı açık yarısından ölçülür.
  const inAnchor = (r: { kid: string; tur: string; acikAnahtar: string }): boolean | null =>
    ctx.keys.wrapped.find((w) => w.kid === r.kid)?.inAnchor ?? (r.tur === "KOK" ? ctx.keys.anchor.some((a) => a.kid === r.kid && a.x === r.acikAnahtar) : null);
  return {
    capa: { kaynak: ctx.keys.anchorSource, kokler: ctx.keys.anchor.map((r) => ({ kid: r.kid, x: r.x, siniflar: r.classes })) },
    // Sertifikanın kendisi değil yalnız vereni (kök kid'i, JWS başlığı) — künye satırı "kim imzaladı"yı gösterir.
    anahtarlar: registry.map(({ sertifika, ...r }) => ({
      ...r,
      sertifikaVeren: certificateIssuer(sertifika),
      yuklu: loaded.has(r.kid),
      suresiDoldu: r.bitis !== null && r.bitis.getTime() < nowMs,
      capada: inAnchor(r),
    })),
    acikSertifikalar: ctx.keys.openCertificates.map((c) => {
      const leaves = ctx.keys.otaLeaves.filter((l) => l.clientKid === c.kid);
      return {
        kid: c.kid,
        kullanim: c.usage,
        acikAnahtar: c.x,
        sertifikaId: c.document.sertifikaId,
        sertifikaVeren: certificateIssuer(c.certificate),
        baslangic: c.document.baslangic,
        bitis: c.document.bitis,
        suresiDoldu: Date.parse(c.document.bitis) < nowMs,
        iptalSira: revocation && isPackageCertificateRevoked(c.document, revocation.verified) ? revocation.sira : null,
        otaYapraklari: leaves.map((l) => ({ dosya: l.file, parmakIzi: l.fingerprint, baslangic: l.notBefore, bitis: l.notAfter })),
      };
    }),
    kiraImzalayabilir: ctx.keys.subKeys.some((k) => k.kind === "ALT"),
    indirmeAnahtari: ctx.keys.downloadKey(nowMs)?.kid ?? null,
    uyarilar: ctx.keys.warnings,
  };
}
