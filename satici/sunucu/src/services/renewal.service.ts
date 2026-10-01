// KİRA YENİLEME — yoklama, çevrimdışı yoklama, onaylı taşıma ve DR devri aynı yoldan geçer.
// Tek tx: kurulum kilidi (İLK ifade) → zincir kararı → kopya uyarısı → kira → uç ilerletme (atomik).
// Reddin kendisi de kayıttır: kopya uyarısı ve yoklama satırı COMMIT olur, sonra 403 döner — kapanış kirasını anlayan
// (P modeli) istemciye 403 yerine İMZALI kapanış kirası gider (K6, `closing-lease.ts`).
// Lisans v2 ekleri ayrı işlevlerde: yabancı HAK · yerel müdahale (`local-intervention.ts`) · yetenek ve durum kaydı sırası.
import type { KopyaUyariTuru, KopyaUyarisi, Prisma } from "@prisma/client";
import { compareFingerprints, jwsDigest, parseJws, type Fingerprint, type LicenseResponse, type PollRequest } from "../lisans-protokol";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import { acceptsClosingLease, copyClosingAnchor, issueOrReuseClosingLease } from "./closing-lease";
import type { VendorContext } from "./context";
import { decideChain, driftAccepted, forkSide, readFingerprint, type ChainDecision } from "./lease-chain";
import {
  activeEntitlement,
  computeSanctionState,
  downloadTokens,
  entitlementTokenFor,
  issueLease,
  leaseRevocation,
  licenseResponse,
} from "./lease.service";
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

async function upsertCopyAlert(
  tx: Tx,
  installationDbId: string,
  type: KopyaUyariTuru,
  sides: { owner: Fingerprint | null; other: Fingerprint },
  nowMs: number,
): Promise<KopyaUyarisi> {
  const open = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: installationDbId, tur: type, durum: "ACIK" } });
  if (open) {
    return tx.kopyaUyarisi.update({
      where: { id: open.id },
      data: { sonGorulme: new Date(nowMs), gorulmeSayisi: { increment: 1 }, digerParmakIzi: sides.other },
    });
  }
  const created = await tx.kopyaUyarisi.create({
    data: {
      kurulumId: installationDbId,
      tur: type,
      ilkGorulme: new Date(nowMs),
      sonGorulme: new Date(nowMs),
      ...(sides.owner ? { sahipParmakIzi: sides.owner } : {}),
      digerParmakIzi: sides.other,
    },
  });
  // Yeni uyarı bildirimi AYNI tx'te (sürmekte olan uyarının tekrar görülmesi bildirim DOĞURMAZ).
  await enqueueNotificationTx(tx, { event: "KOPYA_SUPHESI", keyParts: [created.id], installationDbId, relatedId: created.id, portalPath: "/kopya-uyarilari", referans: type });
  return created;
}

function inSecondWindow(ctx: VendorContext, alert: KopyaUyarisi, nowMs: number): boolean {
  return nowMs - alert.ilkGorulme.getTime() >= ctx.config.KOPYA_PENCERE_SN * 1000;
}

type RenewOutcome =
  | { readonly kind: "LEASE"; readonly response: LicenseResponse; readonly decision: ChainDecision }
  | { readonly kind: "DENIED" }
  | { readonly kind: "KEY_CHANGED" };

async function renewInTx(tx: Tx, ctx: VendorContext, g: RenewInput): Promise<RenewOutcome> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  if (inst.durum === "IPTAL" || inst.anahtarKimligi !== g.kid) return { kind: "KEY_CHANGED" };
  if (inst.durum === "ETKINLESMEDI") throw new VendorError(401, "KURULUM_BILINMIYOR", "Kurulum henüz etkinleşmedi");
  const hak = await activeEntitlement(tx, inst.id);
  const delivered = await entitlementTokenFor(tx, inst, hak);
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
  const vsAccepted = compareFingerprints(accepted, measured, { excludeF5: inst.sinif === "DR" });

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
  if (vsAccepted.result === "ESLESMEDI") {
    const alert = await upsertCopyAlert(tx, inst.id, "PARMAK_IZI_UYUSMAZ", { owner: accepted, other: measured }, g.nowMs);
    alerts.push(alert);
    if (inSecondWindow(ctx, alert, g.nowMs)) deny = true;
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
  if (await isForeignEntitlement(tx, { installation: inst, delivered: { entitlement: hak, token: delivered }, client: g.clientEntitlement })) {
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
    if (acceptsClosingLease(g.report?.capabilities)) {
      const closing = await issueOrReuseClosingLease(tx, ctx, {
        installation: inst,
        entitlement: hak,
        reason: "KOPYA",
        keyId: g.kid,
        anchor: copyClosingAnchor(denying, g.nowMs),
        presentedLeaseId: g.presentedLeaseId,
        measured,
        nowMs: g.nowMs,
      });
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

  const hakToken = entitlementToDeliver(g.clientEntitlement, hak, delivered);

  if (decision === "REPEAT" && tipRow) {
    await recordPoll("TEKRAR", tipRow.id);
    const sanction = await computeSanctionState(tx, inst.id);
    return {
      kind: "LEASE",
      decision,
      response: licenseResponse({
        hak: hakToken,
        kira: tipRow.belge,
        tokens: downloadTokens(ctx, inst, hak, sanction, g.nowMs),
        nowMs: g.nowMs,
        revocation: await leaseRevocation(tx),
      }),
    };
  }

  // Yetenek, durum kaydı sırası ve yerel müdahale yalnız zincir sahibinden okunur (çatalda iki tarafın sırası karışır).
  const ownerReport =
    decision !== "FORK" && g.telemetry
      ? await applyOwnerReportTx(tx, { installation: inst, kid: g.kid, report: g.report, status: g.telemetry.durum, clock: g.telemetry.saat, sides: { owner: accepted, other: measured }, nowMs: g.nowMs })
      : {};

  // Kabul edilen küme yalnız sakin yenilemede kayar: tek etkenlik değişim (parça değişimi), çatal
  // uyarısı açıkken ASLA (kopya kendini "sahip" yapamasın).
  const openFork = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: inst.id, tur: "ZINCIR_CATALI", durum: "ACIK" } });
  const canDrift =
    decision !== "FORK" && vsAccepted.result === "ESLESTI" && vsAccepted.mismatched.length <= 1 && !openFork && g.measured !== null;
  const nextAccepted = canDrift ? driftAccepted(accepted, measured) : accepted;

  const lease = await issueLease(tx, ctx, {
    installation,
    entitlement: hak,
    previousLeaseId: tip?.id ?? null,
    decision: decision === "ROOT" ? "TASIMA" : decision === "CATCH_UP" ? "YAKALA" : decision === "FORK" ? "CATAL" : "NORMAL",
    clientFingerprint: measured,
    acceptedFingerprint: nextAccepted,
    nowMs: g.nowMs,
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
      hak: hakToken,
      kira: lease.token,
      tokens: downloadTokens(ctx, inst, hak, lease.sanction, g.nowMs),
      nowMs: g.nowMs,
      revocation: lease.revocation,
    }),
  };
}

/**
 * Yanıta HAK konur mu: fabrikada HAK yok, başka kimlik/sürüm, ya da bildirdiği bayt özeti teslim edilenle tutmuyor
 * (yabancı ya da eski biçimli HAK — kira `hakOzeti` ile teslim edilene bağlıdır, fabrika onu almadan kirayı bağlayamaz).
 */
function entitlementToDeliver(client: RenewInput["clientEntitlement"], hak: { id: string; guncelSurum: number }, delivered: string): string | null {
  if (client === null || client.hakId !== hak.id || client.surum !== hak.guncelSurum) return delivered;
  return client.ozet !== undefined && client.ozet !== jwsDigest(delivered) ? delivered : null;
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
  return { response: outcome.response, decision: outcome.decision };
}
