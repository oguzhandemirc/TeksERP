// TAŞIMA (D8) — yeni makine YALNIZ TALEP açar: yanıt kod ya da lisans taşımaz (`lisans: null`). Talep
// kimlik ETKİN bir kurulumu gösteriyorsa ona bağlı, değilse (kimliksiz · kayıtsız · etkinleşmemiş · iptal) BAĞSIZ doğar
// ve yanıt AYNIDIR (durum sızmaz — B1k); `ortam.installationId` yalnız ipucudur, bağı onaylayan operatör kurar.
// İstenen lisans kimliği (`hedefKimlik`) başına TEK bekleyen talep (DB seddi); doğum tavanları `transfer-flood.ts`. Onay (BEKLIYOR → ONAYLANDI, atomik)
// tek kullanımlık `tasima` kodu üretir; kod müşteriye portaldan iletilir, yeni makine onu normal etkinleştirme
// yolundan kullanır ve anahtar ANCAK o anda değişir (eski anahtar emekli). Onaya kadar eski makine çalışır.
import type { TasimaTalebi } from "@prisma/client";
import { ENDPOINTS, TransferResponseSchema, parseVersion, type TransferRequestSchema } from "../lisans-protokol";
import type { z } from "zod";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError, stateConflict } from "../lib/errors";
import { lockCustomer, lockInstallation, lockTransferKey } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { VendorContext } from "./context";
import { issueActivationCodeUnderLock, type IssuedActivationCode } from "./entitlement.service";
import { installationCancelled, recordRequestNonce, requestScope, verifySignedRequest } from "./installation-auth";
import { requireReason } from "./sanction.service";
import { assertDealerOwnsCustomer } from "./dealer-ownership.service";
import { securityEvent } from "../lib/security-events";
import type { TransferFloodGuard } from "./transfer-flood";

type TransferRequest = z.infer<typeof TransferRequestSchema>;
type TransferResponse = z.infer<typeof TransferResponseSchema>;

/** Hedef başına tek bekleyen: gerçek yeni makine sahte talebe takılırsa yol portaldan iptaldir (talep künyesi cevapta). */
const pendingElsewhere = (other?: Pick<TasimaTalebi, "id" | "createdAt">): VendorError =>
  new VendorError(
    409,
    "TASIMA_ONAYI_BEKLIYOR",
    "Bu lisans için onay bekleyen başka bir taşıma talebi var — satıcıdan o talebi portalda iptal etmesini isteyin, sonra yeniden deneyin",
    other ? { bekleyenTalepId: other.id, bekleyenTalepZamani: other.createdAt.toISOString() } : undefined,
  );

const HOUR_MS = 3_600_000;

const response = (talep: Pick<TasimaTalebi, "id" | "durum">): TransferResponse =>
  TransferResponseSchema.parse({ v: 1, talepId: talep.id, durum: talep.durum, lisans: null });

/** Talebi aç ya da var olanı döndür (kilit ALTINDA; ilk ifade anahtar kilidi). */
async function openOrReturn(
  tx: Tx,
  g: { installationDbId: string | null; hedef: string | null; kid: string; body: TransferRequest; ip: string | null; nowMs: number; flood?: TransferFloodGuard },
): Promise<{ talep: TasimaTalebi; created: boolean }> {
  await lockTransferKey(tx, g.kid);
  if (g.installationDbId) await lockInstallation(tx, g.installationDbId);
  const existing = g.installationDbId
    ? await tx.tasimaTalebi.findUnique({ where: { kurulumId_yeniAnahtarKimligi: { kurulumId: g.installationDbId, yeniAnahtarKimligi: g.kid } } })
    : // Kimliksiz: bu anahtarın en son talebi (onayda kuruluma bağlanmış olabilir) — fabrika aynı talebi yoklar.
      await tx.tasimaTalebi.findFirst({ where: { yeniAnahtarKimligi: g.kid }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (existing) return { talep: existing, created: false };
  if (g.hedef || g.installationDbId) {
    const other = await tx.tasimaTalebi.findFirst({
      where: { durum: "BEKLIYOR", OR: [...(g.hedef ? [{ hedefKimlik: g.hedef }] : []), ...(g.installationDbId ? [{ kurulumId: g.installationDbId }] : [])] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (other) throw pendingElsewhere(other);
  }
  await g.flood?.admit(tx, { hedef: g.hedef, bound: g.installationDbId !== null, ip: g.ip, nowMs: g.nowMs });
  try {
    const created = await tx.tasimaTalebi.create({
      data: {
        kurulumId: g.installationDbId,
        hedefKimlik: g.hedef,
        yeniAcikAnahtar: g.body.acikAnahtar,
        yeniAnahtarKimligi: g.kid,
        yeniParmakIzi: g.body.parmakIzi,
        ortam: g.body.ortam,
        gerekce: g.body.gerekce,
      },
    });
    // Bildirim AYNI tx'te; gerekçe ve ortam GİTMEZ. Tekillik talep değil hedef × saat (sel tek satırda birleşir).
    await enqueueNotificationTx(tx, {
      event: "TASIMA_TALEBI",
      keyParts: [g.installationDbId ?? g.hedef ?? "kimliksiz", Math.floor(g.nowMs / HOUR_MS)],
      installationDbId: g.installationDbId,
      relatedId: created.id,
      portalPath: "/tasima-talepleri",
      referans: g.installationDbId ? null : "Bağsız talep — hedef kurulumu onaylarken seçin",
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
/**
 * Bekleyen taşıma talebini etkin SAYMAYAN ilk fabrika sürümü: eski paket imzasız `BEKLIYOR` dosyasıyla etkinleştirme
 * kilidini kaldırırdı, o yüzden talebi hiç açılmaz. Yalnız çekirdek (x.y.z) karşılaştırılır; biçimsiz sürüm eski sayılır.
 */
export const TASIMA_ASGARI_FABRIKA_SURUMU = "2.15.6";

export function transferClientTooOld(uygulamaSurum: string): boolean {
  const v = parseVersion(uygulamaSurum.split("+")[0]);
  const min = parseVersion(TASIMA_ASGARI_FABRIKA_SURUMU)!;
  if (!v) return true;
  for (let i = 0; i < 3; i++) if (v.core[i] !== min.core[i]) return v.core[i] < min.core[i];
  return false;
}

export async function handleTransferRequest(
  _ctx: VendorContext,
  g: {
    header: unknown;
    rawBody: Buffer;
    body: TransferRequest;
    nowMs: number;
    limit?: (scope: string) => void;
    path?: string;
    ip?: string | null;
    flood?: TransferFloodGuard;
  },
): Promise<TransferResponse> {
  const verified = await verifySignedRequest({
    header: g.header,
    rawBody: g.rawBody,
    purposes: ["tasima"],
    nowMs: g.nowMs,
    keyFromBody: g.body.acikAnahtar,
    path: g.path ?? ENDPOINTS.TRANSFER,
    unknownInstallationAsNull: true,
  });
  if ((g.body.kurulumId ?? null) !== (verified.request.kurulumId ?? null)) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const hedef = verified.request.kurulumId ?? null;
  // Anahtarın KENDİSİNE ait roller (güncel · emekli) sızıntı değildir: yalnız o anahtarın sahibi görür.
  if (verified.installation && verified.role === "RETIRED") throw installationCancelled();
  if (verified.installation && verified.role === "CURRENT") throw new VendorError(400, "GOVDE_GECERSIZ", "Bu kurulum anahtarı zaten lisanslı; taşıma gerekmiyor");
  // Yabancı anahtara kurulumun durumu söylenmez: yalnız ETKİN kurulum talebi bağlar, gerisi bağsız ve aynı yanıt.
  const inst = verified.installation?.durum === "ETKIN" ? verified.installation : null;
  if (!inst && (await prisma.kurulumKaydi.count({ where: { eskiAnahtarKimligi: verified.kid } })) > 0) {
    // Bağsız talepte de emekli anahtar yeni talep açamaz (taşınmış makine kendini yeniden taşıyamasın).
    throw installationCancelled();
  }
  const scope = { installationDbId: inst?.id ?? null, kid: verified.kid };
  g.limit?.(requestScope(scope));
  if (transferClientTooOld(g.body.ortam.uygulamaSurum)) {
    throw new VendorError(409, "TASIMA_SURUM_ESKI", "Taşıma için bu makineye güncel sürümü kurun");
  }
  await recordRequestNonce({ ...scope, request: verified.request, nowMs: g.nowMs });
  const r = await prisma.$transaction((tx) =>
    openOrReturn(tx, { installationDbId: inst?.id ?? null, hedef, kid: verified.kid, body: g.body, ip: g.ip ?? null, nowMs: g.nowMs, flood: g.flood }),
  );
  if (r.created) {
    if (inst === null) securityEvent("KIMLIKSIZ_TASIMA");
    await recordAudit({
      event: "TASIMA_TALEBI",
      entity: "TasimaTalebi",
      entityId: r.talep.id,
      actor: "kurulum",
      summary: { kurulumId: inst?.id ?? null, hedefKimlik: hedef, yeniAnahtarKimligi: verified.kid, kimliksiz: inst === null },
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

/** Talebin hedeflediği kurulum: bağlıysa bağı, değilse istenen lisans kimliği; ikisi de yoksa (kimliksiz) null. */
export async function transferTargetInstallation(
  db: Db,
  talep: Pick<TasimaTalebi, "kurulumId" | "hedefKimlik">,
): Promise<{ id: string; musteriId: string; bayiId: string | null } | null> {
  const where = talep.kurulumId ? { id: talep.kurulumId } : talep.hedefKimlik ? { kurulumId: talep.hedefKimlik } : null;
  if (!where) return null;
  const inst = await db.kurulum.findUnique({ where, select: { id: true, tesis: { select: { musteriId: true, musteri: { select: { bayiId: true } } } } } });
  return inst ? { id: inst.id, musteriId: inst.tesis.musteriId, bayiId: inst.tesis.musteri.bayiId } : null;
}

/**
 * Bayi reddi (B1k çıkışı): yalnız kendi müşterisinin kurulumunu hedefleyen talep. Sahiplik müşteri kilidi ALTINDA yeniden
 * ölçülür (D10); kilit sırası CUSTOMER → TRANSFER_KEY → INSTALLATION. Bayi onaylayamaz — kod üretimi satıcıda kalır.
 */
export async function rejectTransferAsDealerTx(
  tx: Tx,
  ctx: VendorContext,
  g: { dealerId: string; customerId: string; talep: TasimaTalebi; actor: string; reason: string },
): Promise<TransferDecision> {
  await lockCustomer(tx, g.customerId);
  await assertDealerOwnsCustomer(tx, g.dealerId, g.customerId, "Taşıma talebi");
  const target = await transferTargetInstallation(tx, g.talep);
  if (!target || target.musteriId !== g.customerId) throw notFoundError("Taşıma talebi");
  return decideTransferTx(tx, ctx, { talep: g.talep, decision: "REDDEDILDI", actor: g.actor, reason: g.reason });
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
