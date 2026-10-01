// HAK SÜRÜMÜ — CLI/fikstür düz biçimi, portal imza planı önizlemesi, eski derlemeye giden HAK seçimi ve ara imzacıyla
// TOPLU yeniden basım (G4 §2.6-3). Kararlar `entitlement-policy.ts`ten, yazım `entitlement-version.service.ts`ten.
import type { Hak, HakKokTalebi, HakSurumu, Kurulum } from "@prisma/client";
import { hasCapability } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, badRequest } from "../lib/errors";
import { lockInstallation, lockInstallations } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { installationCapabilities, planEntitlementSigner, type SignerPlanKind } from "./entitlement-policy";
import {
  entitlementVersionAudit,
  loadEntitlementTree,
  prepareEntitlementVersion,
  prepareRootRequest,
  queueRootRequestUnderLock,
  rootRequestAudit,
  writeEntitlementVersionUnderLock,
  type ChangeInput,
  type PreparedEntitlementVersion,
} from "./entitlement-version.service";
import { isIntermediateSignedToken } from "./revocation.service";

export type IssuedEntitlementChange = { readonly mode: "SIGNED"; readonly row: HakSurumu } | { readonly mode: "QUEUED"; readonly row: HakKokTalebi };

/** Düz biçim (CLI · bekçi fikstürü): plana göre imzala ya da kuyruğa al → kilit altında yaz → denetim. */
export async function issueEntitlementVersion(ctx: VendorContext, g: ChangeInput & { password: Buffer }): Promise<HakSurumu>;
export async function issueEntitlementVersion(ctx: VendorContext, g: ChangeInput & { password: Buffer; allowQueue: true }): Promise<IssuedEntitlementChange>;
export async function issueEntitlementVersion(ctx: VendorContext, g: ChangeInput & { password: Buffer; allowQueue?: true }): Promise<HakSurumu | IssuedEntitlementChange> {
  const hak = await loadEntitlementTree(prisma, g.entitlementId);
  const plan = planEntitlementSigner(ctx.keys, hak.kurulum.sinif, g.capabilities ?? installationCapabilities(hak.kurulum), g.nowMs ?? Date.now());
  if (plan.kind === "KUYRUK") {
    g.password.fill(0);
    if (!g.allowQueue) throw new VendorError(409, "DURUM_CAKISMASI", "Bu HAK değişikliği kök imzası bekler (kuyruk)", { imzaci: "KUYRUK" });
    const prepared = await prepareRootRequest(ctx, { ...g, expectedSigner: "KUYRUK" });
    const row = await prisma.$transaction(async (tx) => {
      await lockInstallation(tx, prepared.installationDbId);
      return queueRootRequestUnderLock(tx, prepared);
    });
    await recordAudit({ ...rootRequestAudit(row), actor: g.actor });
    return { mode: "QUEUED", row };
  }
  const prepared = await prepareEntitlementVersion(ctx, { ...g, expectedSigner: plan.kind });
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, prepared.installationDbId);
    return writeEntitlementVersionUnderLock(tx, prepared);
  });
  await recordAudit({ ...entitlementVersionAudit(row, prepared), actor: g.actor });
  return g.allowQueue ? { mode: "SIGNED", row } : row;
}

/** Portalın imza planı önizlemesi: arayüz hangi parolayı (ara/kök) soracağını ya da kuyruğa gireceğini buradan bilir. */
export async function previewEntitlementSigner(
  ctx: VendorContext,
  g: { entitlementId: string; capabilities?: readonly string[]; nowMs: number },
): Promise<{ imzaci: SignerPlanKind; kid: string | null; neden: string | null; bekleyenTalep: string | null }> {
  const hak = await loadEntitlementTree(prisma, g.entitlementId);
  const plan = planEntitlementSigner(ctx.keys, hak.kurulum.sinif, g.capabilities ?? installationCapabilities(hak.kurulum), g.nowMs);
  const pending = await prisma.hakKokTalebi.findFirst({ where: { hakId: hak.id, durum: "BEKLIYOR" }, select: { id: true } });
  return { imzaci: plan.kind, kid: plan.kind === "KUYRUK" ? null : plan.kid, neden: plan.kind === "KUYRUK" ? plan.reason : null, bekleyenTalep: pending?.id ?? null };
}

/**
 * Eski derleme yeni biçimi (ara imzalı HAK) TANIMAZ: yanıta giden HAK, kurulum `hak-ara` bildirmiyorsa en yeni ARA
 * İMZALI OLMAYAN sürümdür (kiranın `hakSurum`u bununla AYNI olmalı). Yetenekli kuruluma güncel sürüm gider.
 */
export async function deliverableEntitlement(
  db: Db,
  entitlement: Pick<Hak, "id" | "guncelSurum">,
  capabilities: readonly string[],
): Promise<{ surum: number; belge: string; imzalayanKid: string } | null> {
  const versions = await db.hakSurumu.findMany({
    where: { hakId: entitlement.id, surum: { lte: entitlement.guncelSurum } },
    orderBy: { surum: "desc" },
    select: { surum: true, belge: true, imzalayanKid: true },
    take: hasCapability(capabilities, "hak-ara") ? 1 : 64,
  });
  if (hasCapability(capabilities, "hak-ara")) return versions[0] ?? null;
  return versions.find((v) => !isIntermediateSignedToken(v.belge)) ?? null;
}

// ---------------------------------------------------------------- toplu yeniden basım (ara imzacı)

export interface ReissueResult {
  readonly hakId: string;
  readonly durum: "IMZALANACAK" | "ATLANDI";
  readonly neden: string | null;
}

/**
 * Yetenekli kurulumların HAK'larını değişiklik OLMADAN ara imzacıyla yeniden basar (G4 §2.6-3; acil iptal turunda
 * "yeniden basılmış HAK" bu yoldan doğar) — TEK parola, her imza parolanın KOPYASIYLA, kopya ve asıl iş bitince
 * sıfırlanır. Plan ARA olmayan, kök kuyruğu bekleyen ya da uzun ufku YENİ verecek (ikinci onay ister) HAK atlanır.
 */
export async function prepareIntermediateReissue(
  ctx: VendorContext,
  g: { entitlementIds: readonly string[]; password: Buffer; reason: string; actor: string; nowMs?: number; capabilitiesOf?: (installation: Kurulum) => readonly string[] },
): Promise<{ prepared: PreparedEntitlementVersion[]; results: ReissueResult[] }> {
  try {
    if (g.entitlementIds.length === 0 || g.entitlementIds.length > 100) throw badRequest("Toplu yeniden basım 1–100 HAK alır");
    const nowMs = g.nowMs ?? Date.now();
    const prepared: PreparedEntitlementVersion[] = [];
    const results: ReissueResult[] = [];
    for (const id of [...new Set(g.entitlementIds)]) {
      const hak = await loadEntitlementTree(prisma, id);
      const caps = (g.capabilitiesOf ?? installationCapabilities)(hak.kurulum);
      const plan = planEntitlementSigner(ctx.keys, hak.kurulum.sinif, caps, nowMs);
      const skip = (neden: string) => results.push({ hakId: id, durum: "ATLANDI", neden });
      if (plan.kind !== "ARA") {
        skip(plan.kind === "KUYRUK" ? `kök kuyruğu (${plan.reason})` : "kurulum hak-ara yeteneği bildirmiyor");
        continue;
      }
      if (hak.kurulum.durum === "IPTAL" || !hak.kurulum.aktif) {
        skip("iptal edilmiş ya da pasif kurulum");
        continue;
      }
      const copy = Buffer.from(g.password);
      try {
        const v = await prepareEntitlementVersion(ctx, { entitlementId: id, password: copy, reason: g.reason, actor: g.actor, nowMs, capabilities: caps, expectedSigner: "ARA" });
        prepared.push(v);
        results.push({ hakId: id, durum: "IMZALANACAK", neden: null });
      } catch (err) {
        if (err instanceof VendorError && err.code === "IMZA_PAROLASI_HATALI") throw err;
        skip(err instanceof VendorError ? `${err.code}: ${err.message}` : "imza hazırlanamadı");
      } finally {
        copy.fill(0);
      }
    }
    return { prepared, results };
  } finally {
    g.password.fill(0);
  }
}

/** Toplu basımın yazımı (tek tx): kurulum kilitleri kimlik sırasıyla, sonra her sürüm kendi atomik iddiasıyla. */
export async function recordIntermediateReissueTx(tx: Tx, prepared: readonly PreparedEntitlementVersion[]): Promise<HakSurumu[]> {
  await lockInstallations(
    tx,
    prepared.map((p) => p.installationDbId),
  );
  const rows: HakSurumu[] = [];
  for (const p of prepared) rows.push(await writeEntitlementVersionUnderLock(tx, p));
  return rows;
}
