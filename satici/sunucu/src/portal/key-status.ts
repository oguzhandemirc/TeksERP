// ANAHTAR KÜNYESİ GÖRÜNÜMÜ (portal `/anahtarlar`): yalnız AÇIK yarı + kid + tür + geçerlilik + çapa bilgisi + sertifikayı
// veren kökün kid'i (sertifikanın kendisi gönderilmez); özel anahtar ve parolası hiçbir yanıtta yoktur.
import { parseJws } from "../lisans-protokol";
import type { Db } from "../lib/prisma";
import type { VendorContext } from "../services/context";

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
  return {
    capa: { kaynak: ctx.keys.anchorSource, kokler: ctx.keys.anchor.map((r) => ({ kid: r.kid, x: r.x, siniflar: r.classes })) },
    // Sertifikanın kendisi değil yalnız vereni (kök kid'i, JWS başlığı) — künye satırı "kim imzaladı"yı gösterir.
    anahtarlar: registry.map(({ sertifika, ...r }) => ({
      ...r,
      sertifikaVeren: certificateIssuer(sertifika),
      yuklu: loaded.has(r.kid),
      suresiDoldu: r.bitis !== null && r.bitis.getTime() < nowMs,
      capada: ctx.keys.wrapped.find((w) => w.kid === r.kid)?.inAnchor ?? null,
    })),
    kiraImzalayabilir: ctx.keys.subKeys.some((k) => k.kind === "ALT"),
    indirmeAnahtari: ctx.keys.downloadKey(nowMs)?.kid ?? null,
    uyarilar: ctx.keys.warnings,
  };
}
