// TAŞIMA (D8) — yeni makine YALNIZ TALEP açar: yanıt kod ya da lisans taşımaz (`lisans: null`). Talep
// kimlik taşıyorsa o kuruluma bağlı, kimliksizse (yeni makine lisans kimliğini bilmiyor, D14) BAĞSIZ doğar —
// `ortam.installationId` yalnız ipucudur, bağı onaylayan operatör kurar. Onay (BEKLIYOR → ONAYLANDI, atomik)
// tek kullanımlık `tasima` kodu üretir; kod müşteriye portaldan iletilir, yeni makine onu normal etkinleştirme
// yolundan kullanır ve anahtar ANCAK o anda değişir (eski anahtar emekli). Onaya kadar eski makine çalışır.
import type { TasimaTalebi } from "@prisma/client";
import { ENDPOINTS, TransferResponseSchema, type TransferRequestSchema } from "../lisans-protokol";
import type { z } from "zod";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError, stateConflict } from "../lib/errors";
import { lockInstallation, lockTransferKey } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { VendorContext } from "./context";
import { issueActivationCodeUnderLock, type IssuedActivationCode } from "./entitlement.service";
import { installationCancelled, recordRequestNonce, requestScope, verifySignedRequest } from "./installation-auth";
import { requireReason } from "./sanction.service";

type TransferRequest = z.infer<typeof TransferRequestSchema>;
type TransferResponse = z.infer<typeof TransferResponseSchema>;

const pendingElsewhere = (): VendorError =>
  new VendorError(409, "TASIMA_ONAYI_BEKLIYOR", "Bu kurulum için başka bir taşıma talebi onay bekliyor");

const response = (talep: Pick<TasimaTalebi, "id" | "durum">): TransferResponse =>
  TransferResponseSchema.parse({ v: 1, talepId: talep.id, durum: talep.durum, lisans: null });

/** Talebi aç ya da var olanı döndür (kilit ALTINDA; ilk ifade anahtar kilidi). */
async function openOrReturn(
  tx: Tx,
  g: { installationDbId: string | null; kid: string; body: TransferRequest },
): Promise<{ talep: TasimaTalebi; created: boolean }> {
  await lockTransferKey(tx, g.kid);
  if (g.installationDbId) await lockInstallation(tx, g.installationDbId);
  const existing = g.installationDbId
    ? await tx.tasimaTalebi.findUnique({ where: { kurulumId_yeniAnahtarKimligi: { kurulumId: g.installationDbId, yeniAnahtarKimligi: g.kid } } })
    : // Kimliksiz: bu anahtarın en son talebi (onayda kuruluma bağlanmış olabilir) — fabrika aynı talebi yoklar.
      await tx.tasimaTalebi.findFirst({ where: { yeniAnahtarKimligi: g.kid }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (existing) return { talep: existing, created: false };
  if (g.installationDbId) {
    const other = await tx.tasimaTalebi.findFirst({ where: { kurulumId: g.installationDbId, durum: "BEKLIYOR" } });
    if (other) throw pendingElsewhere();
  }
  try {
    const created = await tx.tasimaTalebi.create({
      data: {
        kurulumId: g.installationDbId,
        yeniAcikAnahtar: g.body.acikAnahtar,
        yeniAnahtarKimligi: g.kid,
        yeniParmakIzi: g.body.parmakIzi,
        ortam: g.body.ortam,
        gerekce: g.body.gerekce,
      },
    });
    // Bildirim AYNI tx'te; gerekçe ve ortam GİTMEZ. Kimliksiz talepte kurulum bilinmez (etiketler boş).
    await enqueueNotificationTx(tx, {
      event: "TASIMA_TALEBI",
      keyParts: [created.id],
      installationDbId: g.installationDbId,
      relatedId: created.id,
      portalPath: "/tasima-talepleri",
      referans: g.installationDbId ? null : "Kimliksiz talep — hedef kurulumu onaylarken seçin",
    });
    return { talep: created, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) throw pendingElsewhere();
    throw err;
  }
}

/**
 * Uç (gövde KATI şemadan geçmiş): imza (gövdedeki anahtar) → ucuz ön denetimler → hız sınırı → nonce
 * (kurulumsuz talepte kapsam anahtar kimliği) → kilitli tx.
 */
export async function handleTransferRequest(
  _ctx: VendorContext,
  g: { header: unknown; rawBody: Buffer; body: TransferRequest; nowMs: number; limit?: (scope: string) => void; path?: string },
): Promise<TransferResponse> {
  const verified = await verifySignedRequest({
    header: g.header,
    rawBody: g.rawBody,
    purposes: ["tasima"],
    nowMs: g.nowMs,
    keyFromBody: g.body.acikAnahtar,
    path: g.path ?? ENDPOINTS.TRANSFER,
  });
  if ((g.body.kurulumId ?? null) !== (verified.request.kurulumId ?? null)) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const inst = verified.installation;
  if (inst) {
    if (verified.role === "RETIRED" || inst.durum === "IPTAL") throw installationCancelled();
    if (verified.role === "CURRENT") throw new VendorError(400, "GOVDE_GECERSIZ", "Bu kurulum anahtarı zaten lisanslı; taşıma gerekmiyor");
    if (inst.durum === "ETKINLESMEDI") {
      throw new VendorError(400, "GOVDE_GECERSIZ", "Kurulum henüz etkinleşmedi; taşıma yerine etkinleştirme kodu kullanın");
    }
    if (inst.durum !== "ETKIN") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum taşınamaz (devredildi ya da iptal)");
  } else if ((await prisma.kurulumKaydi.count({ where: { eskiAnahtarKimligi: verified.kid } })) > 0) {
    // Kimliksiz talepte de emekli anahtar yeni talep açamaz (taşınmış makine kendini yeniden taşıyamasın).
    throw installationCancelled();
  }
  const scope = { installationDbId: inst?.id ?? null, kid: verified.kid };
  g.limit?.(requestScope(scope));
  await recordRequestNonce({ ...scope, request: verified.request, nowMs: g.nowMs });
  const r = await prisma.$transaction((tx) => openOrReturn(tx, { installationDbId: inst?.id ?? null, kid: verified.kid, body: g.body }));
  if (r.created) {
    await recordAudit({
      event: "TASIMA_TALEBI",
      entity: "TasimaTalebi",
      entityId: r.talep.id,
      actor: "kurulum",
      summary: { kurulumId: inst?.id ?? null, yeniAnahtarKimligi: verified.kid, kimliksiz: inst === null },
    });
  }
  return response(r.talep);
}

export async function findTransferRequest(talepId: string): Promise<TasimaTalebi> {
  const talep = await prisma.tasimaTalebi.findUnique({ where: { id: talepId } });
  if (!talep) throw notFoundError("Taşıma talebi");
  return talep;
}

export interface TransferDecision {
  readonly talep: TasimaTalebi;
  /** Yalnız onayda: tek kullanımlık `tasima` kodu (düz metin YALNIZ bu dönüşte). */
  readonly code: IssuedActivationCode | null;
}

/**
 * Karar (BEKLIYOR → ONAYLANDI | REDDEDILDI, atomik). `talep` kilitsiz okunur (anahtarı değişmez). Onay:
 * bağsız talepte hedef kurulumu operatör verir (`installationDbId`); bağlı talepte verilirse aynı olmalı.
 * Hedef ETKİN olmalı; kurulumun anahtarı DEĞİŞMEZ — değişim tasima koduyla etkinleştirmede.
 */
export async function decideTransferTx(
  tx: Tx,
  ctx: VendorContext,
  g: { talep: TasimaTalebi; decision: "ONAYLANDI" | "REDDEDILDI"; actor: string; reason: string; installationDbId?: string; nowMs?: number },
): Promise<TransferDecision> {
  await lockTransferKey(tx, g.talep.yeniAnahtarKimligi);
  const reason = requireReason(g.reason, "Taşıma kararı");
  const talep = g.talep;
  if (g.installationDbId && talep.kurulumId && g.installationDbId !== talep.kurulumId) {
    throw stateConflict("Talep başka bir kuruluma bağlı; hedef kurulum değiştirilemez");
  }
  const target = g.decision === "ONAYLANDI" ? (talep.kurulumId ?? g.installationDbId ?? null) : talep.kurulumId;
  if (g.decision === "ONAYLANDI" && !target) throw new VendorError(400, "GOVDE_GECERSIZ", "Kimliksiz taşıma talebi: onaylarken hedef kurulumu seçin");
  if (target) await lockInstallation(tx, target);
  const claim = await tx.tasimaTalebi.updateMany({
    where: { id: talep.id, durum: "BEKLIYOR", kurulumId: talep.kurulumId },
    data: { durum: g.decision, kararZamani: new Date(), kararVeren: g.actor, kararSebebi: reason, ...(g.decision === "ONAYLANDI" ? { kurulumId: target } : {}) },
  });
  if (claim.count === 0) throw stateConflict("Taşıma talebi zaten karara bağlanmış");
  let code: IssuedActivationCode | null = null;
  if (g.decision === "ONAYLANDI" && target) {
    const inst = await tx.kurulum.findUnique({ where: { id: target } });
    if (!inst) throw notFoundError("Kurulum");
    if (!inst.aktif || inst.durum !== "ETKIN") throw stateConflict("Kurulum ETKİN değil; taşıma onaylanamaz (etkinleşmemiş kuruluma ilk etkinleştirme kodu üretilir)");
    if (inst.anahtarKimligi === talep.yeniAnahtarKimligi) throw stateConflict("Talebin anahtarı zaten bu kurulumun anahtarı");
    const retired = await tx.kurulumKaydi.count({ where: { kurulumId: inst.id, eskiAnahtarKimligi: talep.yeniAnahtarKimligi } });
    if (retired > 0) throw stateConflict("Talebin anahtarı bu kurulumdan emekli edilmiş; yeni anahtarla talep açılmalı");
    code = await issueActivationCodeUnderLock(tx, ctx, {
      installationDbId: inst.id,
      kind: "tasima",
      transferRequestId: talep.id,
      actor: g.actor,
      nowMs: g.nowMs,
    });
    await tx.kurulumKaydi.create({
      data: {
        kurulumId: inst.id,
        olay: "TASIMA_ONAYLANDI",
        anahtarKimligi: talep.yeniAnahtarKimligi,
        acikAnahtar: talep.yeniAcikAnahtar,
        ayrinti: { talepId: talep.id, kodId: code.id, sebep: reason, kimliksiz: talep.kurulumId === null },
        yapan: g.actor,
      },
    });
  }
  return { talep: await tx.tasimaTalebi.findUniqueOrThrow({ where: { id: talep.id } }), code };
}

async function decide(ctx: VendorContext, g: { talepId: string; decision: "ONAYLANDI" | "REDDEDILDI"; actor: string; reason: string; installationDbId?: string }): Promise<TransferDecision> {
  const talep = await findTransferRequest(g.talepId);
  return prisma.$transaction((tx) => decideTransferTx(tx, ctx, { ...g, talep }));
}

/** Düz biçim (CLI · bekçi): onay → tek kullanımlık taşıma kodu (düz metin YALNIZ dönüşte). */
export async function approveTransfer(ctx: VendorContext, g: { talepId: string; actor: string; reason: string; installationDbId?: string }): Promise<TransferDecision> {
  const r = await decide(ctx, { ...g, decision: "ONAYLANDI" });
  await recordAudit({ event: "TASIMA_ONAYLANDI", entity: "TasimaTalebi", entityId: r.talep.id, actor: g.actor, summary: { sebep: g.reason, kurulumId: r.talep.kurulumId, kodId: r.code?.id ?? null } });
  return r;
}

export async function rejectTransfer(ctx: VendorContext, g: { talepId: string; actor: string; reason: string }): Promise<TasimaTalebi> {
  const r = await decide(ctx, { ...g, decision: "REDDEDILDI" });
  await recordAudit({ event: "TASIMA_REDDEDILDI", entity: "TasimaTalebi", entityId: r.talep.id, actor: g.actor, summary: { sebep: g.reason } });
  return r.talep;
}
