// KURULUM DİZİNİ — imzalı isteğin açık anahtarı ve eşitleme hakkı (sınıf, modüller, patron bulutu
// bitişi, DEVREDİLDİ). İki kaynak (`KURULUM_KAYNAGI`):
//   · `kayit`  — satıcı CLI'siyle yazılmış kayıt (`scripts/tesis.ts kurulum-kaydet`); bulut satıcıya sormaz.
//   · `satici` — satıcı İÇ API'si (iç ağ, bearer); sonuç `installations` tablosunda önbelleklenir.
//     Önbellek TAZELİKTİR, geçerlilik değil: süre dolunca yeniden sorulur; satıcıya ulaşılamazsa BAYAT
//     kayıtla devam edilir; hiç dolmadıysa RED (fail-closed). Satıcının 404'ü kaydı pasife çeker.
// Satıcı cevabı `lookup`ta YAZILMAZ: kapı imzayı ve hakkı doğruladıktan SONRA `commit` eder (yönlendirme bağı +
// tesis DB isteği + önbellek) — yabancı imzalı istek ya da hakkı olmayan kurulum tesis DB'si istetemez (B5s).
// Önbellekte olmayan kimlik için satıcıya soru dakikalık bütçeyle sınırlı, "yok" cevabı önbellek süresince hatırlanır.
import type { Installation } from "@prisma/client";
import type { CloudConfig } from "../config";
import { installationKeyId } from "../lisans-protokol";
import { MinuteBudget } from "../lib/minute-budget";
import { withCentral, withLookup, withTesis } from "../lib/tenant";
import { VendorInstallationSchema, type VendorInstallation } from "../wire/satici-ic";
import type { TesisDbRouter } from "../lib/tesis-db";

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

/**
 * Kurulum → tesis yönlendirmesi (merkez `installation_routes`): ilk yazan bağlar, var olan bağ DEĞİŞMEZ.
 * Kurulum başka tesise bağlıysa false (çağıran REDDEDER) — kurulum kimliği tesis değiştirerek başka DB'ye taşınamaz.
 */
export async function bindInstallationRoute(router: TesisDbRouter, installationId: string, tesisId: string): Promise<boolean> {
  const bound = await withCentral(router, {}, async (tx) => {
    await tx.$executeRaw`INSERT INTO installation_routes (kurulum_id, tesis_id) VALUES (${installationId}::uuid, ${tesisId}::uuid) ON CONFLICT (kurulum_id) DO NOTHING`;
    return tx.installationRoute.findUnique({ where: { installationId }, select: { tesisId: true } });
  });
  return bound?.tesisId === tesisId.toLowerCase();
}

/** Kapının gördüğü aday: `pending` doluysa kayıt satıcıdan YENİ geldi ve henüz yazılmadı. */
export interface DirectoryLookup {
  readonly record: InstallationRecord | null;
  readonly pending: VendorInstallation | null;
  /** Kurulum zaten önbellekte (yönlendirme bağı ve tesis isteği önceden yazıldı). */
  readonly cached: boolean;
}

function vendorRecord(v: VendorInstallation): InstallationRecord {
  return {
    installationId: v.kurulumId,
    tesisId: v.tesis.id,
    publicKeyX: v.acikAnahtar,
    keyId: v.acikAnahtar ? safeKeyId(v.acikAnahtar) : null,
    licenseClass: v.sinif,
    modules: v.moduller,
    cloudUntil: v.patronBulutBitis ? new Date(v.patronBulutBitis) : null,
    handedOver: v.devredildi,
    active: v.aktif,
    stale: false,
  };
}

const NEGATIVE_MAX = 10_000;
const BRIDGE_CACHE_MAX = 10_000;

/** Push köprüsü araması: satıcı cevabı YAZILMAZ (yönlendirme bağı, tesis DB isteği, önbellek satırı yok). */
export type BridgeLookup =
  | { readonly kind: "ok"; readonly record: InstallationRecord; readonly durum: VendorInstallation["durum"] }
  | { readonly kind: "yok" }
  | { readonly kind: "ulasilamadi" };

type VendorAnswer = { readonly kind: "ok"; readonly value: VendorInstallation } | { readonly kind: "yok" } | { readonly kind: "ulasilamadi"; readonly reason: string };

export class InstallationDirectory {
  /** Satıcının "yok" dediği kimlik → hatırlama bitişi (ms). */
  private readonly unknown = new Map<string, number>();
  /** Eşitleme (`lookup`) ve köprü (`lookupForBridge`) AYRI bütçe: kimliksiz trafik birinden ötekini aç bırakamaz. */
  private readonly syncBudget: MinuteBudget;
  private readonly bridgeBudget: MinuteBudget;
  /** Push köprüsünün BELLEK önbelleği (tazelik `KURULUM_ONBELLEK_DK`, `fetchedAt` = satıcının son cevabı); DB'ye yazılmaz. */
  private readonly bridgeCache = new Map<string, { readonly value: Extract<BridgeLookup, { kind: "ok" }>; readonly until: number; readonly fetchedAt: number }>();

  constructor(
    private readonly db: TesisDbRouter,
    private readonly config: Pick<
      CloudConfig,
      "KURULUM_KAYNAGI" | "SATICI_IC_API_URL" | "SATICI_IC_API_BELIRTECI" | "KURULUM_ONBELLEK_DK" | "KURULUM_SORGU_BUTCE_DK" | "KOPRU_SORGU_BUTCE_DK" | "KOPRU_BAYAT_AZAMI_SAAT"
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.syncBudget = new MinuteBudget(
      () => this.config.KURULUM_SORGU_BUTCE_DK,
      (n) => console.warn(`[patron] kurulum sorgu bütçesi doldu (${n}/dk); bilinmeyen kimlikler bu dakika satıcıya sorulmuyor`),
    );
    this.bridgeBudget = new MinuteBudget(
      () => this.config.KOPRU_SORGU_BUTCE_DK,
      (n) => console.warn(`[patron] push köprüsü kurulum sorgu bütçesi doldu (${n}/dk); bilinmeyen kimliklere bu dakika 503`),
    );
  }

  private rememberUnknown(installationId: string, nowMs: number): void {
    this.unknown.delete(installationId);
    this.unknown.set(installationId, nowMs + this.config.KURULUM_ONBELLEK_DK * 60_000);
    while (this.unknown.size > NEGATIVE_MAX) this.unknown.delete(this.unknown.keys().next().value!);
  }

  private knownUnknown(installationId: string, nowMs: number): boolean {
    const until = this.unknown.get(installationId);
    if (until === undefined) return false;
    if (until > nowMs) return true;
    this.unknown.delete(installationId);
    return false;
  }

  private readCached(installationId: string): Promise<Installation | null> {
    return withLookup(this.db, { kind: "kurulum", value: installationId }, (tx) => tx.installation.findUnique({ where: { installationId } }));
  }

  /** Yan etkisi yalnız okuma (+ satıcının "yok"u önbellekteki kaydı pasife çeker); satıcı cevabı YAZILMAZ. */
  async lookup(installationId: string, nowMs: number): Promise<DirectoryLookup> {
    const none: DirectoryLookup = { record: null, pending: null, cached: false };
    const cached = await this.readCached(installationId);
    if (this.config.KURULUM_KAYNAGI === "kayit") return cached ? { record: toRecord(cached, false), pending: null, cached: true } : none;
    const fresh = cached && cached.source === "SATICI" && cached.refreshedAt.getTime() + this.config.KURULUM_ONBELLEK_DK * 60_000 > nowMs;
    if (cached && fresh) return { record: toRecord(cached, false), pending: null, cached: true };
    if (!cached && (this.knownUnknown(installationId, nowMs) || !this.syncBudget.take(nowMs))) return none;
    const answer = await this.askVendor(installationId);
    if (answer.kind === "ok") return { record: vendorRecord(answer.value), pending: answer.value, cached: cached !== null };
    if (answer.kind === "yok") {
      if (cached) await withTesis(this.db, { tesisId: cached.tesisId }, (tx) => tx.installation.update({ where: { id: cached.id }, data: { active: false, refreshedAt: new Date(nowMs) } }));
      else this.rememberUnknown(installationId, nowMs);
      return none;
    }
    if (cached) {
      console.warn(`[patron] satıcı iç API'sine ulaşılamadı (${answer.reason}); kurulum bayat önbellekten`);
      return { record: toRecord(cached, true), pending: null, cached: true };
    }
    console.warn(`[patron] satıcı iç API'sine ulaşılamadı (${answer.reason}); önbellek hiç dolmadı → RED`);
    return none;
  }

  /**
   * Push köprüsü (amaç `bildir`): `satici` kipinde YALNIZ satıcıya sorar ve bellekte tutar (tesis DB'sine dokunmaz);
   * satıcıya ulaşılamazsa en çok `KOPRU_BAYAT_AZAMI_SAAT` yaşlı bellek kaydı, yoksa `ulasilamadi` (503). Köprü bütçesi
   * doluysa da `ulasilamadi`: "yok" (401) yalnız satıcının cevabıdır. `kayit` kipinde yalnız buluta kayıtlı kurulum
   * (var olan önbellek satırı, salt okuma) görünür. Hiçbir yolda `commit` YOK.
   */
  async lookupForBridge(installationId: string, nowMs: number): Promise<BridgeLookup> {
    if (this.config.KURULUM_KAYNAGI === "kayit") {
      const cached = await this.readCached(installationId);
      return cached ? { kind: "ok", record: toRecord(cached, false), durum: undefined } : { kind: "yok" };
    }
    const hit = this.bridgeCache.get(installationId);
    if (hit && hit.until > nowMs) return hit.value;
    if (!hit && this.knownUnknown(installationId, nowMs)) return { kind: "yok" };
    if (!hit && !this.bridgeBudget.take(nowMs)) return { kind: "ulasilamadi" };
    const answer = await this.askVendor(installationId);
    if (answer.kind === "ok") {
      const value = { kind: "ok", record: vendorRecord(answer.value), durum: answer.value.durum } as const;
      this.bridgeCache.delete(installationId);
      this.bridgeCache.set(installationId, { value, until: nowMs + this.config.KURULUM_ONBELLEK_DK * 60_000, fetchedAt: nowMs });
      while (this.bridgeCache.size > BRIDGE_CACHE_MAX) this.bridgeCache.delete(this.bridgeCache.keys().next().value!);
      return value;
    }
    if (answer.kind === "yok") {
      this.bridgeCache.delete(installationId);
      this.rememberUnknown(installationId, nowMs);
      return { kind: "yok" };
    }
    if (hit && nowMs - hit.fetchedAt <= this.config.KOPRU_BAYAT_AZAMI_SAAT * 3_600_000) {
      console.warn(`[patron] satıcı iç API'sine ulaşılamadı (${answer.reason}); push köprüsü kurulumu bayat bellekten`);
      return { ...hit.value, record: { ...hit.value.record, stale: true } };
    }
    return { kind: "ulasilamadi" };
  }

  /** İmza + hak doğrulandıktan SONRA: satıcı cevabını yazar (bağ → tesis DB isteği → önbellek). */
  async commit(v: VendorInstallation, nowMs: number): Promise<InstallationRecord | null> {
    const row = await this.persist(v, nowMs);
    return row ? toRecord(row, false) : null;
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

  /** Yönlendirme bağı → tesis DB isteği (yoksa ISTENDI; hazır değilse `withTesis` 503) → tesis DB'sine önbellek. */
  private async persist(v: VendorInstallation, nowMs: number): Promise<Installation | null> {
    if (!(await bindInstallationRoute(this.db, v.kurulumId, v.tesis.id))) {
      console.warn(`[patron] kurulum ${v.kurulumId} başka tesise bağlı; satıcının yeni tesis cevabı RED`);
      return null;
    }
    await this.db.requestFacility(v.tesis.id);
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
