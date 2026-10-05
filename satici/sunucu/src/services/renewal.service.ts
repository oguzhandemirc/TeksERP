// KİRA YENİLEME — yoklama, çevrimdışı yoklama, onaylı taşıma ve DR devri aynı yoldan geçer.
// Tek tx: kurulum kilidi (İLK ifade) → zincir kararı → kopya uyarısı → kira → uç ilerletme (atomik).
// Reddin kendisi de kayıttır: kopya uyarısı ve yoklama satırı COMMIT olur, sonra 403 döner — kapanış kirasını anlayan
// (P modeli) istemciye 403 yerine İMZALI kapanış kirası gider (K6, `closing-lease.ts`).
// Lisans v2 ekleri ayrı işlevlerde: yabancı HAK · yerel müdahale (`local-intervention.ts`) · yetenek ve durum kaydı sırası.
import type { KopyaUyarisi, Prisma } from "@prisma/client";
import { hasCapability, jwsDigest, parseJws, type Fingerprint, type LicenseResponse, type PollRequest } from "../lisans-protokol";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import { acceptsClosingLease, copyEpisodeStart, issueOrReuseClosingLease } from "./closing-lease";
import type { VendorContext } from "./context";
import { inSecondWindow, upsertCopyAlert } from "./copy-alert";
import { FINGERPRINT_V2_CAPABILITY, canLearnFingerprint, fingerprintMismatch } from "./fingerprint-policy";
import { listLegacyWeakInstallationTx } from "./hardware.service";
import { decideChain, driftAccepted, forkSide, readFingerprint, type ChainDecision } from "./lease-chain";
import {
  activeEntitlement,
  computeSanctionState,
  downloadTokens,
  entitlementForDelivery,
  issueLease,
  leaseEntitlement,
  leaseRevocation,
  licenseResponse,
  type DeliveredEntitlement,
} from "./lease.service";
import { capabilityDowngradeRefusal, holdForRootSignatureTx, leaseUnbindable } from "./lease-binding";
import { isForeignEntitlement, type PollV2Report } from "./local-intervention";
import { applyOwnerReportTx } from "./poll-report";

export interface PollTelemetry {
  readonly durum: PollRequest["durum"];
  readonly saat: PollRequest["saat"];
  readonly ortam: PollRequest["ortam"];
  readonly saglik: PollRequest["saglik"];
  readonly gozlem: PollRequest["gozlem"];
}

export interface RenewInput {
  readonly installationDbId: string;
  /** İsteği imzalayan anahtar — kilit altında hâlâ güncel olmalı. */
  readonly kid: string;
  readonly presentedLeaseId: string | null;
  /** DR devri gibi parmak izi taşımayan isteklerde uçta sayılır (kabul edilen küme). */
  readonly assumeAtTip?: boolean;
  readonly measured: Fingerprint | null;
  /** `ozet`: fabrikanın elindeki HAK'ın bayt özeti (yeni fabrika) — yabancı HAK'ı kesin ayırır. */
  readonly clientEntitlement: { readonly hakId: string; readonly surum: number; readonly ozet?: string } | null;
  readonly telemetry: PollTelemetry | null;
  /** Lisans v2 yoklama ekleri (yetenek · durum kaydı · belirsizlik); DR devri ve eski fabrika taşımaz. */
  readonly report?: PollV2Report;
  /** Kurulumun bildirdiği X25519 açık anahtarı (Faz 2d); temiz zincirde kaydedilir. */
  readonly encryptionKey?: string;
  readonly nowMs: number;
}

const RESULT_OF: Record<ChainDecision, string> = {
  NORMAL: "NORMAL",
  ROOT: "TASIMA",
  REPEAT: "TEKRAR",
  CATCH_UP: "YAKALA",
  FORK: "CATAL",
};

/** Deftere yazılmış kendi kiramızın zorlama alanı (imza burada yeniden doğrulanmaz: belge bizim DB'mizden). */
function leaseEnforcement(token: string): boolean | null {
  const parsed = parseJws(token);
  const value = parsed.ok ? (parsed.value.payload as { zorlama?: unknown }).zorlama : undefined;
  return typeof value === "boolean" ? value : null;
}

type RenewOutcome =
  | { readonly kind: "LEASE"; readonly response: LicenseResponse; readonly decision: ChainDecision }
  | { readonly kind: "DENIED" }
  | { readonly kind: "WITHHELD" }
  | { readonly kind: "KEY_CHANGED" };

async function renewInTx(tx: Tx, ctx: VendorContext, g: RenewInput): Promise<RenewOutcome> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  if (inst.durum === "IPTAL" || inst.anahtarKimligi !== g.kid) return { kind: "KEY_CHANGED" };
  if (inst.durum === "ETKINLESMEDI") throw new VendorError(401, "KURULUM_BILINMIYOR", "Kurulum henüz etkinleşmedi");
  const hak = await activeEntitlement(tx, inst.id);
  // Teslim edilecek HAK'ın biçimi yanıtı ALACAK tarafın bu istekte bildirdiği yeteneklerden (DR devri gibi raporsuz
  // istekte kurulum kaydından): eski sürüme dönen fabrika ara imzalı HAK'ı bu yanıtta almaz.
  const receiverCapabilities = g.report ? [...g.report.capabilities] : undefined;
  const delivered = await entitlementForDelivery(tx, inst, hak, { capabilities: receiverCapabilities, held: g.clientEntitlement });
  const tipRow = inst.sonKiraId ? await tx.kira.findUnique({ where: { id: inst.sonKiraId } }) : null;
  const tip = tipRow
    ? {
        id: tipRow.id,
        previousId: tipRow.oncekiKiraId,
        createdAtMs: tipRow.createdAt.getTime(),
        clientFingerprint: readFingerprint(tipRow.istemciParmakIzi),
        fromFile: tipRow.karar === "DOSYA",
      }
    : null;
  const accepted = readFingerprint(inst.kabulEdilenParmakIzi);
  const measured = g.measured ?? accepted;
  const decision: ChainDecision =
    g.assumeAtTip && tip
      ? "NORMAL"
      : decideChain({
          presentedLeaseId: g.presentedLeaseId,
          tip,
          measured,
          nowMs: g.nowMs,
          repeatWindowMs: ctx.config.TEKRAR_PENCERE_SN * 1000,
        });
  // Meşru donanım değişikliği (K8) öğrenmedir; uyuşmazlık uyarısı kiranın kuralıyla, ret v1 eşiğiyle (`fingerprintMismatch`).
  const learnable = g.measured !== null && canLearnFingerprint(accepted, measured, inst.sinif);
  const mismatch = fingerprintMismatch(accepted, measured, inst, receiverCapabilities);

  let deny = false;
  const alerts: KopyaUyarisi[] = [];
  if (decision === "FORK" && tip) {
    const side = forkSide(accepted, measured, tip.clientFingerprint);
    const alert = await upsertCopyAlert(
      tx,
      inst.id,
      "ZINCIR_CATALI",
      side === "REQUESTER_IS_OWNER"
        ? { owner: measured, other: tip.clientFingerprint }
        : { owner: side === "REQUESTER_IS_OTHER" ? tip.clientFingerprint : null, other: measured },
      g.nowMs,
    );
    alerts.push(alert);
    if (side === "REQUESTER_IS_OTHER" && inSecondWindow(ctx, alert, g.nowMs)) deny = true;
  }
  if (mismatch.alert) {
    const alert = await upsertCopyAlert(tx, inst.id, "PARMAK_IZI_UYUSMAZ", { owner: accepted, other: measured }, g.nowMs);
    if (mismatch.deniable) alerts.push(alert);
    if (mismatch.deniable && inSecondWindow(ctx, alert, g.nowMs)) deny = true;
  }
  // D2s — kira zincirinin iki kurcalama izi (yalnız UYARI; kira yine verilir, asla anında durdurma):
  // sunulan kira bu kurulumun defterinde yoksa (başka kurulumdan taşınmış ya da uydurulmuş) YABANCI_KIRA;
  // raporlanan kip, fabrikanın elindeki kiranın zorlamasıyla uyuşmuyorsa (kira/durum silinip varsayılana
  // dönülmüş) KIP_UYUSMAZ. Beklenen kip SUNULAN kiradan okunur — portalda zorlama yeni değiştiyse fabrika
  // eski kirayla gelir ve bu uyarı sayılmaz; kirası hiç yoksa kurulumun güncel zorlaması beklenir.
  const presented = g.presentedLeaseId ? await tx.kira.findFirst({ where: { id: g.presentedLeaseId, kurulumId: inst.id } }) : null;
  if (g.presentedLeaseId && !presented) {
    await upsertCopyAlert(tx, inst.id, "YABANCI_KIRA", { owner: accepted, other: measured }, g.nowMs);
  }
  if (await isForeignEntitlement(tx, { installation: inst, delivered, client: g.clientEntitlement })) {
    await upsertCopyAlert(tx, inst.id, "YABANCI_HAK", { owner: accepted, other: measured }, g.nowMs);
  }
  if (g.telemetry) {
    const expected = presented ? leaseEnforcement(presented.belge) : inst.zorlama;
    if (expected !== null && (g.telemetry.durum.kip === "zorla") !== expected) {
      await upsertCopyAlert(tx, inst.id, "KIP_UYUSMAZ", { owner: accepted, other: measured }, g.nowMs);
    }
  }
  if (decision === "CATCH_UP") {
    const since = new Date(g.nowMs - ctx.config.KOPYA_PENCERE_SN * 1000);
    const recent = await tx.kira.count({ where: { kurulumId: inst.id, karar: "YAKALA", createdAt: { gte: since } } });
    // Bu yakalama da sayılır: eşik, pencere içindeki toplam "yakala" sayısıdır. Yalnız uyarı.
    if (recent + 1 >= ctx.config.YAKALA_UYARI_ESIGI) {
      await upsertCopyAlert(tx, inst.id, "AYNI_PARMAK_IZI_TEKRAR", { owner: accepted, other: measured }, g.nowMs);
    }
  }

  const recordPoll = async (result: string, leaseId: string | null): Promise<void> => {
    if (!g.telemetry) return;
    await tx.yoklama.create({
      data: {
        kurulumId: inst.id,
        sonuc: result,
        kiraId: leaseId,
        durum: g.telemetry.durum,
        saat: g.telemetry.saat,
        ortam: g.telemetry.ortam,
        saglik: g.telemetry.saglik,
        gozlem: g.telemetry.gozlem,
        parmakIzi: measured,
      },
    });
  };

  if (deny) {
    const denying: KopyaUyarisi[] = [];
    for (const alert of alerts) {
      if (!inSecondWindow(ctx, alert, g.nowMs)) continue;
      if (!alert.redZamani) {
        denying.push(await tx.kopyaUyarisi.update({ where: { id: alert.id }, data: { redZamani: new Date(g.nowMs) } }));
        await enqueueNotificationTx(tx, { event: "KOPYA_KIRA_REDDI", keyParts: [alert.id], installationDbId: inst.id, relatedId: alert.id, portalPath: "/kopya-uyarilari", referans: alert.tur });
      } else denying.push(alert);
    }
    // Kapanış kirası bağlanamıyorsa (genişlik kapısı) basılmaz: eski 403 (kira bağı kapısı, `lease-binding.ts`).
    const closing = acceptsClosingLease(g.report?.capabilities)
      ? await issueOrReuseClosingLease(tx, ctx, {
          installation: inst,
          entitlement: hak,
          reason: "KOPYA",
          keyId: g.kid,
          episodeStart: copyEpisodeStart(denying, g.nowMs),
          presentedLeaseId: g.presentedLeaseId,
          measured,
          capabilities: g.report?.capabilities ?? [],
          held: g.clientEntitlement,
          nowMs: g.nowMs,
        })
      : null;
    if (closing) {
      await recordPoll("KAPANIS_KOPYA", closing.id);
      return {
        kind: "LEASE",
        decision,
        response: licenseResponse({ hak: closing.entitlementToken, kira: closing.token, tokens: [], nowMs: g.nowMs, revocation: closing.revocation }),
      };
    }
    await recordPoll("RED_KIRA_VERILMEDI", null);
    return { kind: "DENIED" };
  }

  // Faz 2d: X25519 yalnız TEMİZ zincirde kaydedilir — çatal/açık kopya uyarısında bir kopya kendi anahtarını
  // yazıp sahibin modül anahtarlarını kendine sardıramasın. Değişim kurulum kaydına (defter) satır olur.
  let installation = inst;
  const openForkNow = decision === "FORK" ? null : await tx.kopyaUyarisi.findFirst({ where: { kurulumId: inst.id, tur: "ZINCIR_CATALI", durum: "ACIK" } });
  if (g.encryptionKey && g.encryptionKey !== inst.sifrelemeAnahtari && decision !== "FORK" && !openForkNow) {
    const set = await tx.kurulum.updateMany({
      where: { id: inst.id, sifrelemeAnahtari: inst.sifrelemeAnahtari, anahtarKimligi: g.kid },
      data: { sifrelemeAnahtari: g.encryptionKey },
    });
    if (set.count === 0) throw retryConflict();
    await tx.kurulumKaydi.create({
      data: {
        kurulumId: inst.id,
        olay: "SIFRELEME_ANAHTARI",
        anahtarKimligi: g.kid,
        ayrinti: { sifrelemeAnahtari: g.encryptionKey, eski: inst.sifrelemeAnahtari },
        yapan: "kurulum",
      },
    });
    installation = { ...inst, sifrelemeAnahtari: g.encryptionKey };
  }

  if (decision === "REPEAT" && tipRow) {
    await recordPoll("TEKRAR", tipRow.id);
    const sanction = await computeSanctionState(tx, inst.id);
    return {
      kind: "LEASE",
      decision,
      response: licenseResponse({
        // Tekrar AYNI kirayı verir: HAK da o kiranın bağlı olduğu sürümdür (`hakOzeti` tutsun); genişlik kapısında HAK yok.
        hak: delivered.withheld ? null : entitlementToDeliver(g.clientEntitlement, await leaseEntitlement(tx, tipRow)),
        kira: tipRow.belge,
        tokens: downloadTokens(ctx, inst, hak, sanction, g.nowMs),
        nowMs: g.nowMs,
        revocation: await leaseRevocation(tx, ctx.keys),
      }),
    };
  }

  // Genişlik kapısı (yetenek düşüşü): zincir sahibinde güncel şartların kök imzası kuyruğa girer; fabrika kirayı
  // bağlayamayacaksa (elinde güncelden geniş olmayan HAK yok) talep ACİL olur. Kira bağı kuralı TEK yerde (`lease-binding.ts`).
  if (decision !== "FORK") await holdForRootSignatureTx(tx, { entitlementId: hak.id, delivered, nowMs: g.nowMs });

  // Yetenek, durum kaydı sırası ve yerel müdahale yalnız zincir sahibinden okunur (çatalda iki tarafın sırası karışır).
  const ownerReport =
    decision !== "FORK" && g.telemetry
      ? await applyOwnerReportTx(tx, {
          installation: inst,
          kid: g.kid,
          report: g.report,
          status: g.telemetry.durum,
          clock: g.telemetry.saat,
          sides: { owner: accepted, other: measured },
          capabilityDowngrade: delivered.withheld !== undefined,
          nowMs: g.nowMs,
        })
      : {};

  // v1'den gelen zayıf kurulum durmaz (zayıf kuralla sürer) ve onay listesine düşer (K8).
  if (decision !== "FORK" && hasCapability(g.report?.capabilities, FINGERPRINT_V2_CAPABILITY)) await listLegacyWeakInstallationTx(tx, { inst, kid: g.kid, nowMs: g.nowMs });

  // Fabrika bu kirayı bağlayamaz (elindeki HAK güncelden geniş ya da yok; güncel ara imzalıyı tanımaz): kira VERİLMEZ —
  // kayıtlar (uyarı · acil kök talebi · yetenek · yoklama) commit olur, sonra 403. Fabrika elindeki kirayla sürer. DR devri
  // gibi raporsuz istek de istisna değildir (bağlanamayan kira hiçbir yoldan çıkmaz).
  if (leaseUnbindable(delivered)) {
    const seen: Prisma.KurulumUncheckedUpdateManyInput = { ...ownerReport };
    if (g.telemetry) Object.assign(seen, { sonYoklamaZamani: new Date(g.nowMs), sonSaglik: g.telemetry.saglik, sonOrtam: g.telemetry.ortam, platform: g.telemetry.ortam.platform });
    if (Object.keys(seen).length > 0) {
      const claim = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: inst.sonKiraId }, data: seen });
      if (claim.count === 0) throw retryConflict();
    }
    await recordPoll("RED_KOK_IMZASI_BEKLIYOR", null);
    return { kind: "WITHHELD" };
  }

  // Kabul edilen küme yalnız öğrenilebilir değişimde kayar (K8: güçlülerden ≥ 2 tutuyor; ölçülemeyen etken eski değerini
  // korur), çatalda ve çatal uyarısı açıkken ASLA (kopya kendini "sahip" yapamasın).
  const openFork = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: inst.id, tur: "ZINCIR_CATALI", durum: "ACIK" } });
  const canDrift = decision !== "FORK" && learnable && !openFork;
  const nextAccepted = canDrift ? driftAccepted(accepted, measured) : accepted;

  const lease = await issueLease(tx, ctx, {
    installation,
    entitlement: hak,
    previousLeaseId: tip?.id ?? null,
    decision: decision === "ROOT" ? "TASIMA" : decision === "CATCH_UP" ? "YAKALA" : decision === "FORK" ? "CATAL" : "NORMAL",
    clientFingerprint: measured,
    acceptedFingerprint: nextAccepted,
    nowMs: g.nowMs,
    held: g.clientEntitlement,
    ...(receiverCapabilities ? { capabilities: receiverCapabilities } : {}),
  });
  const stateUpdate: Prisma.KurulumUncheckedUpdateManyInput = {
    sonKiraId: lease.id,
    kabulEdilenParmakIzi: nextAccepted,
  };
  if (g.telemetry) {
    stateUpdate.sonYoklamaZamani = new Date(g.nowMs);
    stateUpdate.sonSaglik = g.telemetry.saglik;
    stateUpdate.sonOrtam = g.telemetry.ortam;
    stateUpdate.platform = g.telemetry.ortam.platform;
  }
  Object.assign(stateUpdate, ownerReport);
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: inst.sonKiraId }, data: stateUpdate });
  if (claim.count === 0) throw retryConflict();
  await recordPoll(RESULT_OF[decision], lease.id);
  return {
    kind: "LEASE",
    decision,
    response: licenseResponse({
      hak: entitlementToDeliver(g.clientEntitlement, lease.entitlement),
      kira: lease.token,
      tokens: downloadTokens(ctx, inst, hak, lease.sanction, g.nowMs),
      nowMs: g.nowMs,
      revocation: lease.revocation,
    }),
  };
}

/**
 * Yanıta HAK konur mu: genişlik kapısı tuttuysa ASLA (HAK değişikliği teslim edilmez); fabrikada HAK yok, başka
 * kimlik/sürüm, ya da bildirdiği bayt özeti teslim edilenle tutmuyor (yabancı ya da eski biçimli HAK — kira `hakOzeti` ile
 * teslim edilene bağlıdır, fabrika onu almadan kirayı bağlayamaz).
 */
function entitlementToDeliver(client: RenewInput["clientEntitlement"], delivered: DeliveredEntitlement): string | null {
  if (delivered.withheld) return null;
  if (client === null || client.hakId !== delivered.hakId || client.surum !== delivered.surum) return delivered.belge;
  return client.ozet !== undefined && client.ozet !== jwsDigest(delivered.belge) ? delivered.belge : null;
}

/** Kira yeniler; kopya şüphesinin ikinci penceresinde 403 KIRA_VERILMEDI (kayıtlar yine de yazılır). */
export async function renewLease(ctx: VendorContext, g: RenewInput): Promise<{ response: LicenseResponse; decision: ChainDecision }> {
  const outcome = await prisma.$transaction((tx) => renewInTx(tx, ctx, g));
  if (outcome.kind === "KEY_CHANGED") {
    throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulumun lisansı taşındı ya da iptal edildi; kira verilmez");
  }
  if (outcome.kind === "DENIED") {
    throw new VendorError(403, "KIRA_VERILMEDI", "Kopya şüphesi sürüyor: bu makineye kira verilmedi (lisans sahibiyle görüşün)");
  }
  if (outcome.kind === "WITHHELD") throw capabilityDowngradeRefusal();
  return { response: outcome.response, decision: outcome.decision };
}
