// =============================================================================
// Tambur Service / shared
// =============================================================================
// Ortak yardımcılar, sabitler ve taşınan metotların `this` tipi.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import {
  copyStationCapabilitiesToRoll,
  type StationPropertyCap,
} from "../helpers/station-capability-transfer.helper";
import prisma from "../../lib/prisma";
import { consumeForTamburBirthTx } from "../helpers/consumable-birth.helper";
import { assertRollReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import {
  Prisma,
  Roll,
  RollStatus,
} from "@prisma/client";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import type { TamburService } from "../tambur.service";

/** Kapanışta kalan sapmasının kaynağını taşıyan kesimler: ebeveynin yaşayan çocukları, bu kapanışın kalan parçası hariç. */
export async function liveCutChildIdsTx(tx: Prisma.TransactionClient, parentId: string, remainingChildId: string | null): Promise<string[]> {
  const kids = await tx.roll.findMany({
    where: { parentRollId: parentId, status: { not: RollStatus.CANCELLED }, ...(remainingChildId ? { id: { not: remainingChildId } } : {}) },
    select: { id: true },
  });
  return kids.map((k) => k.id);
}

/**
 * Tambur istasyon yeteneği (T1): kesimle doğan çocuğa istasyonun AUTO özellikleri,
 * KALITIMDAN SONRA yazılır (kalıtılmış aynı bayrak no-op; değer seçimi bu yolda yok).
 * Tek boğaz `copyStationCapabilitiesToRoll`; yetenek yoksa sorgusuz döner.
 * `birth`: OUTPUT = tamburdan ÇIKAN top → top başına sarf (`consumeForTamburBirthTx`); INPUT = tambura
 * GİREN top (elle eklenen kartlı top) — sarf yok, çocukları kesimde ayrıca düşer (çift sayım olmasın).
 */
export async function applyTamburCapabilitiesTx(
  tx: Prisma.TransactionClient,
  args: { caps: StationPropertyCap[]; stationId: string | null | undefined; rollId: string; userId?: string | null; birth: "OUTPUT" | "INPUT" },
): Promise<void> {
  const { caps, stationId, rollId, userId } = args;
  if (caps.length === 0 || !stationId) return;
  const child = await tx.roll.findUniqueOrThrow({ where: { id: rollId }, select: { createdAt: true } });
  const before = await tx.rollProperty.findMany({ where: { rollId, ...ACTIVE_ROLL_PROPERTY }, select: { propertyId: true } });
  const { propertyIds } = await copyStationCapabilitiesToRoll(tx, { stationId, rollId, caps, userId: userId ?? null });
  // Geri kurulum donörü (tambur-undo birthPropertiesOf) `createdAt <= çocuk.createdAt` satırını
  // atadan kalıtılmış sayar; istasyon satırı aynı ms'ye düşerse ataya dirilirdi → +1 ms ayrıştır.
  const inherited = before.map((r) => r.propertyId);
  await tx.rollProperty.updateMany({
    where: { rollId, ...ACTIVE_ROLL_PROPERTY, createdAt: { lte: child.createdAt }, ...(inherited.length > 0 ? { propertyId: { notIn: inherited } } : {}) },
    data: { createdAt: new Date(child.createdAt.getTime() + 1) },
  });
  if (args.birth === "OUTPUT") await consumeForTamburBirthTx(tx, { rollId, propertyIds, userId });
}

/**
 * #8 — Tambur bir topu tüketmeden önce kalan AÇIK RollError'ları NO_CUT olarak
 * kapatır (top tüketildikten sonra hata bir daha kapanamaz → yetim hata sızar).
 * tx içinde çağrılır; kapatılan hata sayısını döner.
 */
export async function closeOrphanRollErrors(
  tx: Prisma.TransactionClient,
  rollId: string,
  stepId: string | null,
  userId?: string
): Promise<string[]> {
  const open = await tx.rollError.findMany({
    // Muayene (INSPECTION) satırı kapatılmaz: Tambur kararına girmez, CHECK `isProcessed=false` ister.
    where: { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId, isProcessed: false },
    select: { id: true },
  });
  if (open.length === 0) return [];
  await tx.rollError.updateMany({
    where: { ...ACTIONABLE_ROLL_ERROR_WHERE, id: { in: open.map((e) => e.id) } },
    data: {
      isProcessed: true,
      actionTaken: "NO_CUT",
      processedAtStepId: stepId,
      processedByUserId: userId ?? null,
      processedAt: new Date(),
    },
  });
  return open.map((e) => e.id);
}

export interface TamburRollErrorSummary {
  id: string;
  /// Hata noktası (tek metre). KK2/Kurşun veya tambur operatörü "60. metrede
  /// hata" olarak girer; aralık tutulmaz. Tambur kesim kararı operatörün.
  startMeter: number;
  errorType: string | null;
  /** KQ-D7 künyesi: hatanın açıldığı istasyon (adımsız eski kayıtta null). */
  detectedStationName?: string | null;
  detectedByName?: string | null;
  detectedAt?: Date;
  /** KQ-D7: açıldığı adım — tablet bu adımınkini "kendi", öncekileri gri gösterir. */
  detectedAtStepId?: string | null;
}

/**
 * Kesim replay'i (iki kesim yolu): aynı `clientToken`la doğmuş çocuk + güncel ebeveyn. Çocuk sonradan iptal/fire
 * edildiyse 409 `ENTRY_CANCELLED` (4. durum). ⚠️ AYNI TOKEN, FARKLI GÖVDE (BULGU-T4-003): operatör 40 m kesip zaman
 * aşımına düşer, yeniden ölçüp 25 m yazar, aynı token gider — düzeltme sessizce yutulmasın; yabancı bir
 * ebeveyn/çocuk çifti de dönmesin.
 */
export function cutReplay<R>(parentId: string, length: number, respond: (child: Roll, parent: Roll) => R) {
  return tokenReplay<Roll, R>({
    find: (db, clientToken) => db.roll.findUnique({ where: { clientToken } }),
    alive: assertRollReplayAlive,
    identity: (child) => [
      { ad: "parentRollId", mevcut: child.parentRollId, gelen: parentId },
      { ad: "cutLength", mevcut: child.initialQty, gelen: length },
    ],
    collision: "Bu istemci anahtarı FARKLI bir kesim için kullanılmış. Ekranı yenileyip kesimi tekrar girin — önceki kesim zaten kayıtlı olabilir.",
    collisionEk: (child) => ({ childBarcode: child.barcode }),
    respond: async (child) => respond(child, await prisma.roll.findUniqueOrThrow({ where: { id: parentId } })),
  });
}

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar (private üyeler
 * indeksli erişim tipiyle okunur).
 */
export type TamburServiceThis = {
  assertAtTamburWithReason: TamburService["assertAtTamburWithReason"];
  buildBranchInfoMap: TamburService["buildBranchInfoMap"];
  bypassService: TamburService["bypassService"];
  cutOpenFabricInner: TamburService["cutOpenFabricInner"];
  cutWarehouseRollInner: TamburService["cutWarehouseRollInner"];
  enrichTamburScanError: TamburService["enrichTamburScanError"];
  loadTamburRolls: TamburService["loadTamburRolls"];
};
