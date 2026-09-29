// SATICI İÇ API'Sİ (patron bulutu → satıcı; sözleşme PATRON-BULUTU-ESITLEME §17). Yanıt ALLOWLIST'tir:
// yalnız eşitleme kapısının ihtiyacı (açık anahtar + kid, durum, sınıf, patron-bulut hakkı ve bitişi, tesis
// kimliği/adı). Müşteri, vergi no, lisans no, bayi, parmak izi, ortam/sağlık ve öteki modüller ÇIKMAZ; çıktı
// KATI şemadan geçer, fazla alan 500'dür (sızıntı sessiz olmaz). Kimlik = LİSANS kimliği (D14).
import type { Hak } from "@prisma/client";
import { z } from "zod";
import { IsoTimeSchema, LICENSE_CLASSES, PublicKeyXSchema, UuidSchema, InstallationKidSchema } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import type { Db } from "../lib/prisma";
import { notifyDoorbell, type DoorbellTopic } from "./doorbell";
import { computeSanctionState } from "./lease.service";

export const CLOUD_MODULE_KEY = "patron-bulut";
/** İç API'den çalınabilen zil konuları — lisans/güncelleme/destek zili yalnız satıcının kendi eylemlerinden. */
export const INTERNAL_DOORBELL_TOPICS = ["gelen-kutusu", "rapor", "ozet"] as const satisfies readonly DoorbellTopic[];

export const InternalInstallationSchema = z.strictObject({
  v: z.literal(1),
  kurulumId: UuidSchema,
  tesis: z.strictObject({ id: UuidSchema, ad: z.string().min(1).max(200) }),
  acikAnahtar: PublicKeyXSchema.nullable(),
  anahtarKimligi: InstallationKidSchema.nullable(),
  durum: z.enum(["ETKINLESMEDI", "ETKIN", "DEVREDILDI", "IPTAL"]),
  sinif: z.enum(LICENSE_CLASSES),
  moduller: z.array(z.literal(CLOUD_MODULE_KEY)).max(1),
  patronBulutBitis: IsoTimeSchema.nullable(),
  devredildi: z.boolean(),
  aktif: z.boolean(),
});
export type InternalInstallation = z.infer<typeof InternalInstallationSchema>;

export const InternalDoorbellSchema = z.strictObject({
  v: z.literal(1),
  tesisId: UuidSchema,
  konu: z.enum(INTERNAL_DOORBELL_TOPICS),
});

type CloudHak = Pick<Hak, "aktif" | "guncelSurum" | "moduller" | "bakimBitis" | "gecerlilikBitis">;

/**
 * Patron bulutu hakkının bitişi — TEK kaynak. Hak imzalı ve `patron-bulut` modülünü taşıyor, modül yaptırımla
 * donmamış olmalı; bitiş bakım ve (varsa) geçerlilik bitişinin ERKENİ (ticari model kararı gelene dek).
 */
export function cloudEntitlementUntil(hak: CloudHak | null, frozenModules: readonly string[]): Date | null {
  if (!hak || !hak.aktif || hak.guncelSurum < 1 || !hak.moduller.includes(CLOUD_MODULE_KEY)) return null;
  if (frozenModules.includes(CLOUD_MODULE_KEY)) return null;
  const ends = [hak.bakimBitis.getTime(), ...(hak.gecerlilikBitis ? [hak.gecerlilikBitis.getTime()] : [])];
  return new Date(Math.min(...ends));
}

/** Lisans kimliğiyle kurulum görünümü; kurulum yoksa null (404). DB kimliği ya da fabrika installationId'si eşleşmez. */
export async function readInstallationForCloud(db: Db, licenseId: string): Promise<InternalInstallation | null> {
  const inst = await db.kurulum.findUnique({
    where: { kurulumId: licenseId },
    include: { tesis: { select: { id: true, ad: true, aktif: true } }, haklar: { where: { aktif: true }, take: 1 } },
  });
  if (!inst) return null;
  const sanction = await computeSanctionState(db, inst.id);
  const until = cloudEntitlementUntil(inst.haklar[0] ?? null, sanction.donmusModuller);
  return InternalInstallationSchema.parse({
    v: 1,
    kurulumId: inst.kurulumId,
    tesis: { id: inst.tesis.id, ad: inst.tesis.ad },
    acikAnahtar: inst.acikAnahtar,
    anahtarKimligi: inst.anahtarKimligi,
    durum: inst.durum,
    sinif: inst.sinif,
    moduller: until ? [CLOUD_MODULE_KEY] : [],
    patronBulutBitis: until ? until.toISOString() : null,
    devredildi: inst.durum === "DEVREDILDI",
    aktif: inst.aktif && inst.tesis.aktif && inst.durum !== "IPTAL",
  });
}

/** Zilin hedefleri: tesisin ETKİN, aktif ÜRETİM kurulumları (satıcı DB kimlikleri). Tesis yoksa null. */
export async function doorbellTargets(db: Db, tesisId: string): Promise<string[] | null> {
  const tesis = await db.tesis.findUnique({ where: { id: tesisId }, select: { id: true } });
  if (!tesis) return null;
  const rows = await db.kurulum.findMany({ where: { tesisId, sinif: "URETIM", durum: "ETKIN", aktif: true }, select: { id: true }, orderBy: { id: "asc" } });
  return rows.map((r) => r.id);
}

/** Zili çalar (PG NOTIFY → dinleyici süreç SSE'ye iletir); içerik taşımaz. */
export async function ringInstallations(db: Db, installationDbIds: readonly string[], topic: (typeof INTERNAL_DOORBELL_TOPICS)[number]): Promise<void> {
  for (const id of installationDbIds) await notifyDoorbell(db, id, topic);
}

// ---------------------------------------------------------------- çağrı sayacı (ayak izi)

/** İç API çağrıları uç × durum başına SAYILIR; denetime her istek değil, pencere başına tek satır yazılır. */
export class InternalApiCounters {
  private counts = new Map<string, number>();
  private windowStart = Date.now();

  bump(endpoint: string, status: number): void {
    const key = `${endpoint} ${status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counts].sort(([a], [b]) => a.localeCompare(b)));
  }

  /** Pencereyi kapatır: sayı varsa tek denetim satırı (best-effort), sonra sıfır. */
  async flush(nowMs: number = Date.now()): Promise<boolean> {
    const counts = this.snapshot();
    const start = this.windowStart;
    this.counts = new Map();
    this.windowStart = nowMs;
    if (Object.keys(counts).length === 0) return false;
    await recordAudit({
      event: "IC_API_SAYAC",
      entity: "ic_api",
      actor: "sistem",
      summary: { pencereBaslangic: new Date(start).toISOString(), pencereBitis: new Date(nowMs).toISOString(), sayilar: counts },
    });
    return true;
  }
}
