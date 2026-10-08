// FİLO GÖRÜNÜMÜ (Dağıtım v2 — docs/design/GUNCELLEYICI.md): hangi kurulum hangi backend sürümünde, kanal nerede,
// politika ne, son güncelleme nasıl bitti. Salt okuma; sürümler yoklamanın ve yayın kökünün OKUNDUĞU değerlerdir.
import { backendPublished } from "../distribution/releases.view";
import { VersionTextSchema, compareVersions } from "../lisans-protokol";
import type { Db } from "../lib/prisma";
import type { Kurulum } from "@prisma/client";
import { notFoundError } from "../lib/errors";
import { installationCapabilities } from "../services/entitlement-policy";
import { UPDATE_POLICY_EVENT, UPDATE_RESULT_EVENTS, policyOf, policyTimeZone } from "../services/update-policy.service";

const RESULT_EVENTS: readonly string[] = Object.values(UPDATE_RESULT_EVENTS);

function versionText(v: unknown): string | null {
  return typeof v === "string" && VersionTextSchema.safeParse(v).success ? v : null;
}

/**
 * FİLO (Dağıtım v2): etkin kurulumlar × kurulu backend sürümü (son yoklamanın `ortam.uygulamaSurum`u) × kanalın
 * yayındaki sürümü (`son.json`; yayın kökü bağlı değilse kanal kaydındaki güncel sürüm) × politika × güncelleyici ×
 * son tamamlanan deneme (defterden). "Geride" yalnız iki sürüm de okunabildiğinde hesaplanır — okunamayan "bilinmiyor"dur.
 * `paketZinciri`: güncelleyicisi kök sertifikalı PAKET zincirini okuyabildiğini bildirmiş mi (yetenek `paket-zinciri`;
 * eski imzayla yayını bırakmanın ölçüsü — PAKET-ANAHTARI-KOK-ALTINDA §3.4); hiç etkinleşmemiş kurulumda bilinmiyor (null).
 */
export async function fleetView(db: Db, root: string | undefined) {
  const rows = await db.kurulum.findMany({
    where: { aktif: true, durum: { in: ["ETKIN", "DEVREDILDI", "ETKINLESMEDI"] } },
    include: { tesis: { select: { ad: true, musteri: { select: { ad: true } } } }, kanal: { select: { kod: true, guncelSurumler: true } } },
    orderBy: [{ kanalKodu: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 1000,
  });
  const channelVersion = new Map<string, { surum: string | null; kaynak: "YAYIN" | "KANAL_KAYDI" | "YOK" }>();
  for (const kod of new Set(rows.map((r) => r.kanalKodu))) {
    const published = root ? await backendPublished(root, kod) : null;
    const registered = versionText((rows.find((r) => r.kanalKodu === kod)?.kanal.guncelSurumler as { backend?: unknown } | null)?.backend);
    channelVersion.set(kod, published?.surum ? { surum: published.surum, kaynak: "YAYIN" } : registered ? { surum: registered, kaynak: "KANAL_KAYDI" } : { surum: null, kaynak: "YOK" });
  }
  const results = await db.kurulumKaydi.findMany({
    where: { kurulumId: { in: rows.map((r) => r.id) }, olay: { in: [...RESULT_EVENTS] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["kurulumId"],
    select: { kurulumId: true, olay: true, ayrinti: true, createdAt: true },
  });
  return rows.map((r) => {
    const installed = versionText((r.sonOrtam as { uygulamaSurum?: unknown } | null)?.uygulamaSurum);
    const channel = channelVersion.get(r.kanalKodu) ?? { surum: null, kaynak: "YOK" as const };
    const cmp = installed && channel.surum ? compareVersions(installed, channel.surum) : null;
    return {
      id: r.id,
      kurulumId: r.kurulumId,
      ad: r.ad,
      musteri: r.tesis.musteri.ad,
      tesis: r.tesis.ad,
      kanal: r.kanalKodu,
      sinif: r.sinif,
      durum: r.durum,
      sonYoklama: r.sonYoklamaZamani,
      kuruluSurum: installed,
      kanalSurumu: channel,
      geride: cmp === null ? null : cmp < 0,
      paketZinciri: r.durum === "ETKINLESMEDI" ? null : installationCapabilities(r).includes("paket-zinciri"),
      politika: policyOf(r),
      rapor: r.sonGuncellemeRaporu,
      raporZamani: r.sonGuncellemeRaporuZamani,
      sonSonuc: results.find((x) => x.kurulumId === r.id) ?? null,
    };
  });
}

/** Kurulumun güncelleme görünümü (`GET /kurulumlar/:id/guncelleme`): politika · pencerenin yorumlandığı dilim · son rapor · geçmiş. */
export async function installationUpdateView(db: Db, id: string) {
  const inst = await db.kurulum.findUnique({ where: { id } });
  if (!inst) throw notFoundError("Kurulum");
  return installationUpdateSection(db, inst);
}

async function installationUpdateSection(db: Db, inst: Kurulum) {
  return {
    politika: policyOf(inst),
    saatDilimi: policyTimeZone(inst),
    saatDilimiBildirildi: inst.saatDilimi !== null,
    rapor: inst.sonGuncellemeRaporu,
    raporZamani: inst.sonGuncellemeRaporuZamani,
    gecmis: await db.kurulumKaydi.findMany({
      where: { kurulumId: inst.id, olay: { in: [UPDATE_POLICY_EVENT, ...RESULT_EVENTS] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, olay: true, ayrinti: true, yapan: true, createdAt: true },
    }),
  };
}
