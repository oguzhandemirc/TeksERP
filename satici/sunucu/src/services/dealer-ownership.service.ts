// BAYİNİN KAYIT ÜZERİNDEKİ YAZMALARI (D10) — bayinin bir kayıtta işlem yapabilmesi müşterinin GÜNCEL
// bayi bağına bağlıdır; bağ yalnız müşteri kilidi (ve bayi kilitleri) altında değişir (master-data
// `updateCustomerTx`). Bu yüzden sahiplik eylemin tx'inde müşteri kilidi ALTINDA yeniden okunur; rotanın
// kilitsiz ön okuması yalnız "yok" cevabını hızlandırır. Tavan (dealer.service) kilit altında yeniden denetlenir.
import type { Hak, HakSurumu, Kurulum, LisansSinifi, Tesis } from "@prisma/client";
import { VendorError, notFoundError, stateConflict } from "../lib/errors";
import { lockCustomer, lockDealer, lockInstallation } from "../lib/locks";
import type { Db, Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import {
  assertWithinCeiling,
  ceilingViolations,
  currentCeiling,
  dealerUsage,
  findDealer,
  signedFieldsOf,
  type CeilingViolation,
} from "./dealer.service";
import {
  createEntitlementTx,
  issueActivationCodeUnderLock,
  writeEntitlementVersionUnderLock,
  type CreateEntitlementInput,
  type IssuedActivationCode,
  type PreparedEntitlementVersion,
} from "./entitlement.service";
import { createInstallationUnderLock, type CreateInstallationInput } from "./master-data.service";

/** Kilit ALTINDA: müşteri hâlâ bu bayinin mi? Değilse "bulunamadı" (varlık sızdırılmaz). */
export async function assertDealerOwnsCustomer(tx: Tx, dealerId: string, customerId: string, what = "Kayıt"): Promise<void> {
  const customer = await tx.musteri.findUnique({ where: { id: customerId }, select: { bayiId: true } });
  if (!customer || customer.bayiId !== dealerId) throw notFoundError(what);
}

/** Kurulumun müşterisi (tesis ve müşteri bağı değişmez; kilit anahtarı olarak kilitsiz okunur). */
export async function installationCustomerId(db: Db, installationDbId: string): Promise<string> {
  const inst = await db.kurulum.findUnique({ where: { id: installationDbId }, select: { tesis: { select: { musteriId: true } } } });
  if (!inst) throw notFoundError("Kurulum");
  return inst.tesis.musteriId;
}

/**
 * Müşteriyi bu bayiye geçirmek (yalnız yönetici; bayi + müşteri kilidi altında çağrılır): bayi aktif,
 * müşterinin CANLI kurulumları (aktif, iptal edilmemiş) bayinin GÜNCEL tavanına sığar — adet (bayinin
 * kullanımı + bu müşterinin kurulumları), her kurulumun sınıfı ve kanalı, aktif hakların modülleri.
 */
export async function assertDealerCanTakeCustomer(tx: Tx, dealerId: string, customerId: string): Promise<void> {
  const dealer = await findDealer(tx, dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const ceiling = await currentCeiling(tx, dealer);
  const installations = await tx.kurulum.findMany({
    where: { aktif: true, durum: { not: "IPTAL" }, tesis: { musteriId: customerId } },
    select: { sinif: true, kanalKodu: true, haklar: { where: { aktif: true }, select: { moduller: true } } },
  });
  const usage = (await dealerUsage(tx, dealer.id)) + installations.length;
  const violations: CeilingViolation[] = [...ceilingViolations(ceiling, { usage })];
  for (const inst of installations) {
    const modules = inst.haklar.flatMap((h) => h.moduller);
    violations.push(...ceilingViolations(ceiling, { licenseClass: inst.sinif, channelCode: inst.kanalKodu, modules }));
  }
  const unique = [...new Map(violations.map((v) => [JSON.stringify(v), v])).values()];
  assertWithinCeiling(unique);
}

// ---------------------------------------------------------------- bayinin kurulumu, hakkı, kodu

/** Bayi kurulum açar: sınıf ve kanal tavanda, kullanım + 1 ≤ adet (bayi + müşteri ağacı kilidi altında; sahiplik kilit altında). */
export async function createDealerInstallationTx(
  tx: Tx,
  g: CreateInstallationInput & { dealerId: string; site: Tesis },
): Promise<Kurulum> {
  await lockDealer(tx, g.dealerId);
  await lockCustomer(tx, g.site.musteriId);
  await assertDealerOwnsCustomer(tx, g.dealerId, g.site.musteriId, "Tesis");
  const dealer = await findDealer(tx, g.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const ceiling = await currentCeiling(tx, dealer);
  const usage = (await dealerUsage(tx, dealer.id)) + 1;
  assertWithinCeiling(ceilingViolations(ceiling, { licenseClass: g.licenseClass, usage, channelCode: g.channelCode }));
  return createInstallationUnderLock(tx, g);
}

/**
 * Bayi kilidi ALTINDA tavan YENİDEN denetlenir (imzadan bu yana değişmiş olabilir), müşteri kilidi altında
 * sahiplik yeniden okunur (müşteri bu arada başka bayiye geçmiş olabilir), sonra sürüm yazılır.
 */
export async function recordDealerEntitlementVersionTx(tx: Tx, p: PreparedEntitlementVersion & { customerId: string }): Promise<HakSurumu> {
  await lockDealer(tx, p.dealerId ?? "");
  await lockCustomer(tx, p.customerId);
  await lockInstallation(tx, p.installationDbId);
  if (!p.dealerId) throw new VendorError(500, "SUNUCU_HATASI", "Bayi imzası bayi kimliği taşımıyor");
  await assertDealerOwnsCustomer(tx, p.dealerId, p.customerId, "Hak");
  const dealer = await findDealer(tx, p.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const ceiling = await currentCeiling(tx, dealer);
  assertWithinCeiling(ceilingViolations(ceiling, { ...signedFieldsOf(p.fields, p.issuedAt.getTime()), usage: await dealerUsage(tx, dealer.id) }));
  return writeEntitlementVersionUnderLock(tx, p);
}

/**
 * Bayinin kod üretimi: YALNIZ hiç etkinleşmemiş kuruluma (D8 — etkin kurulumun anahtar değişimi satıcı
 * onaylı taşımadır, bayi onu kodla atlayamaz); son sürüm bayi imzalıysa GÜNCEL tavana hâlâ sığmalı (eski
 * imzalı hak daraltılmış tavanla yeni kuruluma gitmesin). Sahiplik müşteri kilidi altında.
 */
export async function createDealerActivationCodeTx(
  tx: Tx,
  ctx: VendorContext,
  g: { dealerId: string; customerId: string; installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<IssuedActivationCode> {
  await lockDealer(tx, g.dealerId);
  await lockCustomer(tx, g.customerId);
  await lockInstallation(tx, g.installationDbId);
  await assertDealerOwnsCustomer(tx, g.dealerId, g.customerId, "Kurulum");
  const dealer = await findDealer(tx, g.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  if (inst.durum !== "ETKINLESMEDI") {
    throw stateConflict("Bayi yalnız hiç etkinleşmemiş kuruluma kod üretir; etkin kurulumun makine değişimi satıcı onaylı taşımadır");
  }
  const hak = await tx.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true }, include: { kurulum: true } });
  if (hak && hak.guncelSurum >= 1) {
    const ceiling = await currentCeiling(tx, dealer);
    const fields = { modules: hak.moduller, licenseClass: hak.kurulum.sinif, perpetual: hak.kalici, maintenanceUntil: hak.bakimBitis };
    assertWithinCeiling(ceilingViolations(ceiling, { ...signedFieldsOf(fields, g.nowMs ?? Date.now()), usage: await dealerUsage(tx, dealer.id) }));
  }
  return issueActivationCodeUnderLock(tx, ctx, g);
}

/**
 * Bayinin hak taslağı: bayi + müşteri kilidi altında sahiplik ve taslağın GÜNCEL tavana sığması yeniden
 * denetlenir (imza anında da yeniden); numara sayacı kilidi `createEntitlementTx`in ilk ifadesi.
 */
export async function createDealerEntitlementTx(
  tx: Tx,
  g: CreateEntitlementInput & { dealerId: string; customerId: string; licenseClass: LisansSinifi },
): Promise<Hak> {
  await lockDealer(tx, g.dealerId);
  await lockCustomer(tx, g.customerId);
  await assertDealerOwnsCustomer(tx, g.dealerId, g.customerId, "Kurulum");
  const dealer = await findDealer(tx, g.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const draft = { modules: [...g.modules], licenseClass: g.licenseClass, perpetual: g.perpetual, maintenanceUntil: g.maintenanceUntil };
  assertWithinCeiling(ceilingViolations(await currentCeiling(tx, dealer), signedFieldsOf(draft, g.nowMs)));
  return createEntitlementTx(tx, g);
}
