// ETKİNLEŞTİRME — tek kullanımlık kod (atomik claim) + kurulum anahtarı kaydı + HAK + KİRA.
// Kod portalda KURULUMA bağlı doğar; kimliksiz istekte (D14) kurulumu KOD belirler, kimlik taşıyan istekte
// kod o kurulumun olmalı (başkasınınki "yok" sayılır). Yanıt lisans kimliğini (`kurulumId`) ve kod türünü taşır.
// Kod türü (D8): `ilk` hiç etkinleşmemiş kurulumu açar ya da aynı anahtarla yeniden etkinleştirir — başka
// anahtarla ETKİN kuruluma 409 TASIMA_KODU_GEREKLI (kod TÜKETİLMEZ); `tasima` kodu yalnız onaylanan talebin
// anahtarıyla kullanılır, anahtar o anda değişir (eski anahtar emekli: sonraki isteği 403) ve zincir yeniden başlar.
// Aynı kod + aynı anahtarla tekrar (ağ tekrarı) aynı kirayı alır; başka anahtarla ikinci kullanım 409.
import type { EtkinlestirmeKodu, KodTuru, Kurulum, TasimaTalebi } from "@prisma/client";
import type { ActivateRequest, LicenseResponse } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import { bodyKeyRole, installationCancelled, recordRequestNonce, verifySignedRequest, type KeyRole } from "./installation-auth";
import {
  activeEntitlement,
  computeSanctionState,
  currentEntitlementToken,
  downloadTokens,
  issueLease,
  licenseResponse,
} from "./lease.service";

const codeInvalid = (reason: string): VendorError => new VendorError(404, "ETKINLESTIRME_KODU_GECERSIZ", reason);
const codeUsed = (): VendorError => new VendorError(409, "ETKINLESTIRME_KODU_KULLANILMIS", "Bu etkinleştirme kodu daha önce kullanıldı");
const transferCodeRequired = (): VendorError =>
  new VendorError(409, "TASIMA_KODU_GEREKLI", "Bu kurulum başka bir makinede etkin: yeni makine yalnız onaylı taşıma koduyla etkinleşir (portaldan taşıma talebi)");

type CodeWithTransfer = EtkinlestirmeKodu & { tasimaTalebi: TasimaTalebi | null };

/**
 * Durum ön denetimi (kilitsiz, yan etkisiz; kilit altında AYNEN yinelenir): tüketilmemiş kod bu kuruluma bu
 * anahtarla kullanılabilir mi? Tüketilmiş kodun tekrar kararı ayrı (`replayOrConflict`).
 */
function assertUsable(g: { code: CodeWithTransfer; inst: Kurulum; kid: string; role: KeyRole; nowMs: number }): void {
  const { code, inst, kid, role, nowMs } = g;
  if (role === "RETIRED" || inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") {
    throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (taşındı, devredildi ya da iptal)");
  }
  if (code.gecerlilikBitis.getTime() < nowMs) throw codeInvalid("Etkinleştirme kodunun süresi dolmuş");
  if (code.tur === "ilk") {
    if (inst.durum === "ETKIN" && inst.anahtarKimligi !== kid) throw transferCodeRequired();
    return;
  }
  if (inst.durum !== "ETKIN") throw new VendorError(403, "KURULUM_IPTAL", "Taşıma kodu yalnız etkin kurulumda kullanılır");
  if (code.tasimaTalebi?.yeniAnahtarKimligi !== kid) throw codeInvalid("Bu taşıma kodu başka bir makinenin talebine ait");
}

/** Tüketilmiş kodu aynı anahtar yeniden sunduysa önceki sonucu döner; aksi hâlde 409. */
async function replayOrConflict(tx: Tx, ctx: VendorContext, code: EtkinlestirmeKodu, inst: Kurulum, kid: string, nowMs: number): Promise<LicenseResponse> {
  if (code.kullananAnahtarKimligi !== kid || inst.anahtarKimligi !== kid || !code.kiraId) throw codeUsed();
  const lease = await tx.kira.findUniqueOrThrow({ where: { id: code.kiraId } });
  const hak = await activeEntitlement(tx, inst.id);
  const sanction = await computeSanctionState(tx, inst.id);
  return licenseResponse({
    hak: await currentEntitlementToken(tx, hak),
    kira: lease.belge,
    tokens: downloadTokens(ctx, inst, hak, sanction, nowMs),
    nowMs,
    installationId: inst.kurulumId,
    codeKind: code.tur,
  });
}

interface Activated {
  readonly response: LicenseResponse;
  readonly installationDbId: string;
  readonly codeId: string;
  readonly kind: KodTuru;
  readonly event: "ETKINLESTI" | "YENIDEN_ETKINLESTI" | "TASINDI";
}

async function activateInTx(
  tx: Tx,
  ctx: VendorContext,
  g: { codeId: string; installationDbId: string; kid: string; body: ActivateRequest; nowMs: number },
): Promise<{ kind: "replay"; response: LicenseResponse } | { kind: "activated"; activated: Activated }> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  const code = await tx.etkinlestirmeKodu.findUniqueOrThrow({ where: { id: g.codeId }, include: { tasimaTalebi: true } });
  if (code.durum === "IPTAL") throw codeInvalid("Etkinleştirme kodu geçersiz");
  if (code.durum === "KULLANILDI") {
    if (inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (devredildi ya da iptal)");
    return { kind: "replay", response: await replayOrConflict(tx, ctx, code, inst, g.kid, g.nowMs) };
  }
  assertUsable({ code, inst, kid: g.kid, role: await bodyKeyRoleTx(tx, inst, g.kid), nowMs: g.nowMs });
  const claim = await tx.etkinlestirmeKodu.updateMany({
    where: { id: code.id, durum: "AKTIF" },
    data: { durum: "KULLANILDI", kullanimZamani: new Date(g.nowMs), kullananAnahtarKimligi: g.kid },
  });
  if (claim.count === 0) {
    const fresh = await tx.etkinlestirmeKodu.findUniqueOrThrow({ where: { id: code.id } });
    return { kind: "replay", response: await replayOrConflict(tx, ctx, fresh, inst, g.kid, g.nowMs) };
  }
  const hak = await activeEntitlement(tx, inst.id);
  const keyChanged = inst.durum === "ETKIN" && inst.anahtarKimligi !== g.kid;
  const event: Activated["event"] = code.tur === "tasima" ? "TASINDI" : inst.durum === "ETKIN" ? "YENIDEN_ETKINLESTI" : "ETKINLESTI";
  await tx.kurulumKaydi.create({
    data: {
      kurulumId: inst.id,
      olay: event,
      anahtarKimligi: g.kid,
      acikAnahtar: g.body.acikAnahtar,
      eskiAnahtarKimligi: keyChanged ? inst.anahtarKimligi : null,
      eskiAcikAnahtar: keyChanged ? inst.acikAnahtar : null,
      ayrinti: {
        kodId: code.id,
        kodTuru: code.tur,
        ...(code.tasimaTalebiId ? { talepId: code.tasimaTalebiId } : {}),
        platform: g.body.ortam.platform,
        uygulamaSurum: g.body.ortam.uygulamaSurum,
      },
      yapan: "kurulum",
    },
  });
  const updated = await tx.kurulum.updateMany({
    where: { id: inst.id, durum: inst.durum, sonKiraId: inst.sonKiraId, anahtarKimligi: inst.anahtarKimligi },
    data: {
      durum: "ETKIN",
      acikAnahtar: g.body.acikAnahtar,
      anahtarKimligi: g.kid,
      kabulEdilenParmakIzi: g.body.parmakIzi,
      platform: g.body.ortam.platform,
      sonOrtam: g.body.ortam,
      etkinlesmeZamani: new Date(g.nowMs),
      sonKiraId: null,
    },
  });
  if (updated.count === 0) throw retryConflict();
  const fresh = await tx.kurulum.findUniqueOrThrow({ where: { id: inst.id } });
  const lease = await issueLease(tx, ctx, {
    installation: fresh,
    entitlement: hak,
    previousLeaseId: null,
    decision: code.tur === "tasima" ? "TASIMA" : "ETKINLESTIRME",
    clientFingerprint: g.body.parmakIzi,
    acceptedFingerprint: g.body.parmakIzi,
    nowMs: g.nowMs,
  });
  const tip = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: null }, data: { sonKiraId: lease.id } });
  if (tip.count === 0) throw retryConflict();
  await tx.etkinlestirmeKodu.update({ where: { id: code.id }, data: { kiraId: lease.id } });
  // Eski anahtarın zil aboneliği "şimdi yokla" duyar → sonraki yoklaması 403 KURULUM_IPTAL.
  if (keyChanged) await notifyDoorbell(tx, inst.id, "lisans");
  return {
    kind: "activated",
    activated: {
      response: licenseResponse({
        hak: await currentEntitlementToken(tx, hak),
        kira: lease.token,
        tokens: downloadTokens(ctx, fresh, hak, lease.sanction, g.nowMs),
        nowMs: g.nowMs,
        installationId: fresh.kurulumId,
        codeKind: code.tur,
      }),
      installationDbId: inst.id,
      codeId: code.id,
      kind: code.tur,
      event,
    },
  };
}

/** Kilit altındaki taze rol (emekli anahtar tx içinde okunur). */
async function bodyKeyRoleTx(tx: Tx, inst: Kurulum, kid: string): Promise<KeyRole> {
  if (inst.anahtarKimligi === kid) return "CURRENT";
  const retired = await tx.kurulumKaydi.count({ where: { kurulumId: inst.id, eskiAnahtarKimligi: kid } });
  return retired > 0 ? "RETIRED" : "BODY";
}

/**
 * Uç (gövde KATI şemadan geçmiş): imza (gövdedeki anahtar) → kod → ucuz ön denetimler → kurulum hız sınırı →
 * nonce → kilitli tx. Ön denetimler nonce'tan ve kilitten ÖNCE: reddedilecek istek kilit/defter tüketmez.
 */
export async function handleActivation(
  ctx: VendorContext,
  g: { header: unknown; rawBody: Buffer; body: ActivateRequest; nowMs: number; limit?: (scope: string) => void },
): Promise<LicenseResponse> {
  const body = g.body;
  const verified = await verifySignedRequest({ header: g.header, rawBody: g.rawBody, purposes: ["etkinlestir"], nowMs: g.nowMs, keyFromBody: body.acikAnahtar });
  if ((body.kurulumId ?? null) !== (verified.request.kurulumId ?? null)) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const code = await prisma.etkinlestirmeKodu.findUnique({
    where: { kodOzeti: ctx.codeHasher.digest(body.kod) },
    include: { kurulum: true, tasimaTalebi: true },
  });
  // Kimlik taşıyan istekte başka kurulumun kodu "yok"tur (varlığı sızdırılmaz).
  if (!code || !code.kurulum.aktif || code.durum === "IPTAL" || (verified.installation && verified.installation.id !== code.kurulumId)) {
    throw codeInvalid("Etkinleştirme kodu geçersiz");
  }
  const inst = code.kurulum;
  const role = verified.installation ? verified.role : await bodyKeyRole(inst, verified.kid);
  if (role === "RETIRED") throw installationCancelled();
  if (code.durum === "AKTIF") assertUsable({ code, inst, kid: verified.kid, role, nowMs: g.nowMs });
  else if (inst.durum === "IPTAL" || inst.durum === "DEVREDILDI") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (devredildi ya da iptal)");
  else if (code.kullananAnahtarKimligi !== verified.kid) throw codeUsed();
  g.limit?.(inst.id);
  await recordRequestNonce({ installationDbId: inst.id, kid: verified.kid, request: verified.request, nowMs: g.nowMs });
  const result = await prisma.$transaction((tx) =>
    activateInTx(tx, ctx, { codeId: code.id, installationDbId: inst.id, kid: verified.kid, body, nowMs: g.nowMs }),
  );
  if (result.kind === "replay") return result.response;
  const a = result.activated;
  await recordAudit({
    event: a.event === "TASINDI" ? "KURULUM_TASINDI" : a.event === "YENIDEN_ETKINLESTI" ? "KURULUM_YENIDEN_ETKINLESTI" : "KURULUM_ETKINLESTI",
    entity: "Kurulum",
    entityId: a.installationDbId,
    actor: "kurulum",
    summary: { kodId: a.codeId, kodTuru: a.kind, anahtarKimligi: verified.kid },
  });
  return a.response;
}
