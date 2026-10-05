// BAKIMI BİTECEK MÜŞTERİLER (K9): yenileme satışı için aktif HAK'ların bakım bitişi, bitişe göre artan. Pencere: bitmiş
// (hepsi) + bitişine ≤ 90 gün kalan. Salt okuma; hatırlatma bildirimi (30 gün) `notifications/scanner.ts`te.
import type { Db } from "../lib/prisma";

const DAY_MS = 86_400_000;
export const MAINTENANCE_LIST_DAYS = 90;
/** Bildirim penceresiyle aynı eşik — scanner `MAINTENANCE_REMINDER_DAYS` (değişirse ikisi birlikte). */
const SOON_DAYS = 30;
const LIMIT = 500;

export type MaintenanceStage = "BITTI" | "YAKLASIYOR" | "SONRAKI";

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

export async function maintenanceDueView(db: Db, nowMs: number) {
  const horizon = new Date(nowMs + MAINTENANCE_LIST_DAYS * DAY_MS);
  const rows = await db.hak.findMany({
    where: {
      aktif: true,
      bakimBitis: { lte: horizon },
      kurulum: { aktif: true, durum: { in: ["ETKIN", "DEVREDILDI"] }, sinif: { notIn: ["DEMO", "TEST"] } },
    },
    select: {
      id: true,
      lisansNo: true,
      bakimBitis: true,
      kalici: true,
      kurulum: { select: { id: true, kurulumId: true, ad: true, sinif: true, durum: true, sonOrtam: true, tesis: { select: { ad: true, musteri: { select: { ad: true } } } } } },
    },
    orderBy: [{ bakimBitis: "asc" }, { id: "asc" }],
    take: LIMIT,
  });
  return rows.map((r) => {
    const left = Math.ceil((r.bakimBitis.getTime() - nowMs) / DAY_MS);
    const env = (r.kurulum.sonOrtam ?? null) as { uygulamaSurum?: unknown; derlemeTarihi?: unknown } | null;
    const build = isoOrNull(env?.derlemeTarihi);
    return {
      id: r.kurulum.id,
      kurulumId: r.kurulum.kurulumId,
      hakId: r.id,
      ad: r.kurulum.ad,
      musteri: r.kurulum.tesis.musteri.ad,
      tesis: r.kurulum.tesis.ad,
      sinif: r.kurulum.sinif,
      durum: r.kurulum.durum,
      lisansNo: r.lisansNo,
      kalici: r.kalici,
      bakimBitis: r.bakimBitis,
      kalanGun: left,
      asama: (left <= 0 ? "BITTI" : left <= SOON_DAYS ? "YAKLASIYOR" : "SONRAKI") as MaintenanceStage,
      kuruluSurum: typeof env?.uygulamaSurum === "string" ? env.uygulamaSurum : null,
      kuruluDerleme: build,
      /** Kurulu derleme bakım bitişinden SONRA çıktıysa fabrika onu ek süreye düşürür (K8); bilinmiyorsa null. */
      surumBakimDisi: build === null ? null : Date.parse(build) > r.bakimBitis.getTime(),
    };
  });
}
