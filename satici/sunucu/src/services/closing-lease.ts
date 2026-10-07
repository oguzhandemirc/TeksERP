// KAPANIŞ KİRASI (K6, lisans v2 §1.2): P modelinde imzasız 403 hiçbir süreyi kısaltmaz (araya giren biri fabrikayı
// durduramasın diye kısaltmamalı da). Eşleşmeyen tarafa bunun yerine İMZALI kira gider: K3, kısıtlama anı = o olayın
// İLK kapanış kirasının verilişi + ek süre (ilk kapanışta "şimdi + ek süre"; sonraki her kapanış AYNI tarihi taşır, tekrar
// yoklamak süreyi uzatmaz; olay geç fark edilse de fabrika aniden durmaz — ek süre her zaman tam verilir). Olayın başı
// kendi defterinden: kopya → reddi doğuran uyarının ilk görülmesi · taşıma → anahtarın emekli olduğu kurulum kaydı · iptal
// → son IPTAL kaydı. Yalnız `odenmis-tarih` yeteneğini bildiren istemciye gider; eski fabrika bugünkü 403'ü alır (sıfır
// fark). Kapanış kirası zincir ucunu İLERLETMEZ, modül anahtarı/bulut hakkı taşımaz; aynı olayda tekrar yoklama koşullar
// değişmediyse AYNI kirayı alır (defter şişmez). Alan tarafın kirayı bağlayabileceği HAK yoksa (genişlik kapısı) kapanış
// kirası basılmaz, eski 403 sürer; kuyruk açılmaz — alan taraf zincir sahibi değil (kira bağı kapısı, `lease-binding.ts`).
import type { Hak, Kira, KopyaUyarisi, Kurulum } from "@prisma/client";
import {
  DAY_MS,
  hasCapability,
  parseJws,
  type ClosingLeaseReason,
  type Fingerprint,
  type LicenseCapability,
  type LicenseResponse,
} from "../lisans-protokol";
import { retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { installationCancelled, type AuthenticatedRequest } from "./installation-auth";
import type { HeldEntitlement } from "./entitlement-issue.service";
import { leaseUnbindable } from "./lease-binding";
import { entitlementForDelivery, issueLease, leaseEntitlement, leaseRevocation, licenseResponse, type LeaseRevocation } from "./lease.service";
import type { PollTelemetry } from "./renewal.service";

/** Kapanış kirasını anlayan istemcinin yeteneği (P modeli: imzasız ret süre kısaltmaz). */
export const CLOSING_LEASE_CAPABILITY: LicenseCapability = "odenmis-tarih";

export function acceptsClosingLease(capabilities: readonly string[] | undefined): boolean {
  return hasCapability(capabilities, CLOSING_LEASE_CAPABILITY);
}

/** Kopya olayının başı: reddi doğuran uyarıların ilk görülmelerinin ERKENİ (yeni uyarı = yeni olay). */
export function copyEpisodeStart(alerts: readonly Pick<KopyaUyarisi, "ilkGorulme">[], nowMs: number): Date {
  const times = alerts.map((a) => a.ilkGorulme.getTime());
  return new Date(times.length > 0 ? Math.min(...times) : nowMs);
}

/** Taşıma/iptal olayının başı — olayın kurulum kaydı (yoksa null: kapanış basılmaz, eski 403 sürer). */
export async function ledgerEpisodeStart(tx: Tx, g: { installationDbId: string; reason: "TASIMA" | "IPTAL"; keyId: string }): Promise<Date | null> {
  const row = await tx.kurulumKaydi.findFirst({
    where: g.reason === "TASIMA" ? { kurulumId: g.installationDbId, eskiAnahtarKimligi: g.keyId } : { kurulumId: g.installationDbId, olay: "IPTAL" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

const leaseRevocationSequence = (belge: string): number | null => {
  const parsed = parseJws(belge);
  const v = parsed.ok ? (parsed.value.payload as { iptalSira?: unknown }).iptalSira : undefined;
  return typeof v === "number" ? v : null;
};

export interface ClosingLease {
  readonly id: string;
  readonly token: string;
  /** null: genişlik kapısı tuttu — HAK teslim edilmez. */
  readonly entitlementToken: string | null;
  readonly revocation: LeaseRevocation | null;
  readonly reused: boolean;
}

/**
 * Önceki kapanış kirası hâlâ aynı olayın, aynı (teslim edilecek) HAK sürümünün ve aynı kararların mı? (Çapadan sonra
 * basılmış, süresi dolmamış, o günden beri yaptırım defterine satır düşmemiş, iptal sırası aynı.)
 */
async function reusable(
  tx: Tx,
  last: Kira | null,
  g: { installationDbId: string; entitlementId: string; deliverableVersion: number; revocation: LeaseRevocation | null; nowMs: number },
): Promise<boolean> {
  if (!last || last.bitis.getTime() <= g.nowMs) return false;
  if (last.hakId !== g.entitlementId || last.hakSurum !== g.deliverableVersion) return false;
  if (leaseRevocationSequence(last.belge) !== (g.revocation?.sira ?? null)) return false;
  const changed = await tx.yaptirimEylemi.count({ where: { kurulumId: g.installationDbId, createdAt: { gt: last.createdAt } } });
  return changed === 0;
}

/**
 * Kapanış kirası basar ya da aynı olayın geçerli kapanış kirasını yeniden verir (kurulum kilidi altında çağrılır). Kira
 * alan tarafa bağlanamıyorsa null: çağıran eski 403'ü verir.
 */
export async function issueOrReuseClosingLease(
  tx: Tx,
  ctx: VendorContext,
  g: {
    readonly installation: Kurulum;
    readonly entitlement: Hak;
    readonly reason: ClosingLeaseReason;
    readonly keyId: string;
    /** Olayın başı: bu andan sonra bu anahtara verilen ilk kapanış kirası kısıtlama çapasıdır. */
    readonly episodeStart: Date;
    readonly presentedLeaseId: string | null;
    readonly measured: Fingerprint;
    /** Kapanış kirasını alan tarafın imzalı gövdede bildirdiği yetenekler (teslim edilecek HAK biçimi). */
    readonly capabilities: readonly string[];
    /** Alan tarafın elindeki HAK (genişlik kapısı); bilinmiyorsa null. */
    readonly held?: HeldEntitlement | null;
    readonly nowMs: number;
  },
): Promise<ClosingLease | null> {
  const revocation = await leaseRevocation(tx, ctx.keys);
  const deliverable = await entitlementForDelivery(tx, g.installation, g.entitlement, { capabilities: g.capabilities, held: g.held });
  if (leaseUnbindable(deliverable)) return null;
  const episode = { kurulumId: g.installation.id, anahtarKimligi: g.keyId, karar: "KAPANIS" as const, kapanisNedeni: g.reason, verilis: { gte: g.episodeStart } };
  const first = await tx.kira.findFirst({ where: episode, orderBy: [{ verilis: "asc" }, { id: "asc" }], select: { verilis: true } });
  const anchorMs = first ? first.verilis.getTime() : g.nowMs;
  const last = await tx.kira.findFirst({ where: episode, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (last && (await reusable(tx, last, { installationDbId: g.installation.id, entitlementId: g.entitlement.id, deliverableVersion: deliverable.surum, revocation, nowMs: g.nowMs }))) {
    return { id: last.id, token: last.belge, entitlementToken: deliverable.withheld ? null : (await leaseEntitlement(tx, last)).belge, revocation, reused: true };
  }
  // Önceki kira yalnız bu kurulumun defterindeyse zincire bağlanır (yabancı kimlik FK'yı kırmasın).
  const previous = g.presentedLeaseId ? await tx.kira.findFirst({ where: { id: g.presentedLeaseId, kurulumId: g.installation.id }, select: { id: true } }) : null;
  const lease = await issueLease(tx, ctx, {
    installation: g.installation,
    entitlement: g.entitlement,
    previousLeaseId: previous?.id ?? null,
    decision: "KAPANIS",
    clientFingerprint: g.measured,
    // Kira eşleşmeyen tarafın kendi ölçtüğü kümeyi taşır: fabrika kirayı kendisine ait sayar ve K3'ü uygular.
    acceptedFingerprint: g.measured,
    nowMs: g.nowMs,
    capabilities: g.capabilities,
    held: g.held ?? null,
    closing: { reason: g.reason, keyId: g.keyId, restrictAt: new Date(anchorMs + ctx.config.EK_SURE_GUN * DAY_MS) },
  });
  // Genişlik kapısında HAK teslim edilmez (kira alan tarafın elindeki güvenli sürüme ya da güncele bağlı).
  return { id: lease.id, token: lease.token, entitlementToken: lease.entitlement.withheld ? null : lease.entitlement.belge, revocation: lease.revocation, reused: false };
}

/**
 * Sonu gelmiş anahtarın yoklaması (taşınmış eski makine · iptal edilmiş kurulum): kilit altında durum TAZE okunur; kapanış
 * kirası + yoklama satırı aynı tx'te. Kapanış basılamıyorsa (HAK yok, olay kaydı yok, kira bağlanamaz) eski 403 sürer. Durum arada
 * değiştiyse (iptal geri alındı) 409 TEKRAR_DENEYIN: yeniden deneme olağan yoldan geçer.
 */
export async function closeEndedKey(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  g: {
    readonly presentedLeaseId: string | null;
    readonly measured: Fingerprint;
    readonly capabilities: readonly string[];
    readonly held?: HeldEntitlement | null;
    readonly telemetry: PollTelemetry;
    readonly nowMs: number;
  },
): Promise<LicenseResponse> {
  const response = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, auth.installation.id);
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: auth.installation.id } });
    const reason: "TASIMA" | "IPTAL" | null = inst.durum === "IPTAL" ? "IPTAL" : inst.anahtarKimligi !== auth.kid ? "TASIMA" : null;
    if (!reason) throw retryConflict();
    const hak = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true } });
    const episodeStart = await ledgerEpisodeStart(tx, { installationDbId: inst.id, reason, keyId: auth.kid });
    if (!hak || hak.guncelSurum < 1 || !episodeStart) return null;
    const closing = await issueOrReuseClosingLease(tx, ctx, {
      installation: inst,
      entitlement: hak,
      reason,
      keyId: auth.kid,
      episodeStart,
      presentedLeaseId: g.presentedLeaseId,
      measured: g.measured,
      capabilities: g.capabilities,
      held: g.held ?? null,
      nowMs: g.nowMs,
    });
    if (!closing) return null;
    await tx.yoklama.create({
      data: {
        kurulumId: inst.id,
        sonuc: `KAPANIS_${reason}`,
        kiraId: closing.id,
        durum: g.telemetry.durum,
        saat: g.telemetry.saat,
        ortam: g.telemetry.ortam,
        saglik: g.telemetry.saglik,
        gozlem: g.telemetry.gozlem,
        parmakIzi: g.measured,
      },
    });
    return await licenseResponse(tx, ctx.keys, { hak: closing.entitlementToken, kira: closing.token, tokens: [], nowMs: g.nowMs, revocation: closing.revocation });
  });
  if (!response) throw installationCancelled();
  return response;
}
