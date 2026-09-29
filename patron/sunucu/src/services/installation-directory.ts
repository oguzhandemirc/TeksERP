// KURULUM DİZİNİ — imzalı isteğin açık anahtarı ve eşitleme hakkı (sınıf, modüller, patron bulutu
// bitişi, DEVREDİLDİ). İki kaynak (`KURULUM_KAYNAGI`):
//   · `kayit`  — satıcı CLI'siyle yazılmış kayıt (`scripts/tesis.ts kurulum-kaydet`); bulut satıcıya sormaz.
//   · `satici` — satıcı İÇ API'si (iç ağ, bearer); sonuç `installations` tablosunda önbelleklenir.
//     Önbellek TAZELİKTİR, geçerlilik değil: süre dolunca yeniden sorulur; satıcıya ulaşılamazsa BAYAT
//     kayıtla devam edilir; hiç dolmadıysa RED (fail-closed). Satıcının 404'ü kaydı pasife çeker.
import type { Installation, PrismaClient } from "@prisma/client";
import type { CloudConfig } from "../config";
import { installationKeyId } from "../lisans-protokol";
import { withLookup, withTesis } from "../lib/tenant";
import { VendorInstallationSchema, type VendorInstallation } from "../wire/satici-ic";

export interface InstallationRecord {
  readonly installationId: string;
  readonly tesisId: string;
  readonly publicKeyX: string | null;
  readonly keyId: string | null;
  readonly licenseClass: Installation["licenseClass"];
  readonly modules: readonly string[];
  readonly cloudUntil: Date | null;
  readonly handedOver: boolean;
  readonly active: boolean;
  /** `satici` kipinde satıcıya ulaşılamadı ve kayıt bayat önbellekten geldi. */
  readonly stale: boolean;
}

function toRecord(row: Installation, stale: boolean): InstallationRecord {
  return {
    installationId: row.installationId,
    tesisId: row.tesisId,
    publicKeyX: row.publicKeyX,
    keyId: row.keyId,
    licenseClass: row.licenseClass,
    modules: row.modules,
    cloudUntil: row.cloudUntil,
    handedOver: row.handedOver,
    active: row.active,
    stale,
  };
}

/** Açık anahtarın kurulum anahtar kimliği; biçimsizse null (doğrulama zaten reddeder). */
export function safeKeyId(x: string): string | null {
  try {
    return installationKeyId(x);
  } catch {
    return null;
  }
}

type VendorAnswer = { readonly kind: "ok"; readonly value: VendorInstallation } | { readonly kind: "yok" } | { readonly kind: "ulasilamadi"; readonly reason: string };

export class InstallationDirectory {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: Pick<CloudConfig, "KURULUM_KAYNAGI" | "SATICI_IC_API_URL" | "SATICI_IC_API_BELIRTECI" | "KURULUM_ONBELLEK_DK">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private readCached(installationId: string): Promise<Installation | null> {
    return withLookup(this.db, { kind: "kurulum", value: installationId }, (tx) => tx.installation.findUnique({ where: { installationId } }));
  }

  async resolve(installationId: string, nowMs: number): Promise<InstallationRecord | null> {
    const cached = await this.readCached(installationId);
    if (this.config.KURULUM_KAYNAGI === "kayit") return cached ? toRecord(cached, false) : null;
    const fresh = cached && cached.source === "SATICI" && cached.refreshedAt.getTime() + this.config.KURULUM_ONBELLEK_DK * 60_000 > nowMs;
    if (cached && fresh) return toRecord(cached, false);
    const answer = await this.askVendor(installationId);
    if (answer.kind === "ok") return toRecord(await this.persist(answer.value, nowMs), false);
    if (answer.kind === "yok") {
      if (cached) await withTesis(this.db, { tesisId: cached.tesisId }, (tx) => tx.installation.update({ where: { id: cached.id }, data: { active: false, refreshedAt: new Date(nowMs) } }));
      return null;
    }
    if (cached) {
      console.warn(`[patron] satıcı iç API'sine ulaşılamadı (${answer.reason}); kurulum bayat önbellekten`);
      return toRecord(cached, true);
    }
    console.warn(`[patron] satıcı iç API'sine ulaşılamadı (${answer.reason}); önbellek hiç dolmadı → RED`);
    return null;
  }

  private async askVendor(installationId: string): Promise<VendorAnswer> {
    const base = this.config.SATICI_IC_API_URL;
    const bearer = this.config.SATICI_IC_API_BELIRTECI;
    if (!base || !bearer) return { kind: "ulasilamadi", reason: "iç API yapılandırılmamış" };
    try {
      const res = await this.fetchImpl(new URL(`/ic/v1/kurulum/${encodeURIComponent(installationId)}`, base), {
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 404) return { kind: "yok" };
      if (!res.ok) return { kind: "ulasilamadi", reason: `HTTP ${res.status}` };
      const parsed = VendorInstallationSchema.safeParse(await res.json());
      if (!parsed.success || parsed.data.kurulumId !== installationId) return { kind: "ulasilamadi", reason: "yanıt sözleşmeye uymuyor" };
      return { kind: "ok", value: parsed.data };
    } catch (err) {
      return { kind: "ulasilamadi", reason: (err as Error).name };
    }
  }

  private persist(v: VendorInstallation, nowMs: number): Promise<Installation> {
    const now = new Date(nowMs);
    const fields = {
      publicKeyX: v.acikAnahtar,
      keyId: v.acikAnahtar ? safeKeyId(v.acikAnahtar) : null,
      licenseClass: v.sinif,
      modules: v.moduller,
      cloudUntil: v.patronBulutBitis ? new Date(v.patronBulutBitis) : null,
      handedOver: v.devredildi,
      active: v.aktif,
      source: "SATICI" as const,
      refreshedAt: now,
    };
    return withTesis(this.db, { tesisId: v.tesis.id }, async (tx) => {
      await tx.facility.upsert({
        where: { tesisId: v.tesis.id },
        create: { tesisId: v.tesis.id, name: v.tesis.ad, ...(v.saklamaAy === undefined ? {} : { retentionMonths: v.saklamaAy }) },
        update: { name: v.tesis.ad, ...(v.saklamaAy === undefined ? {} : { retentionMonths: v.saklamaAy }) },
      });
      return tx.installation.upsert({
        where: { installationId: v.kurulumId },
        create: { tesisId: v.tesis.id, installationId: v.kurulumId, ...fields },
        update: fields,
      });
    });
  }
}
