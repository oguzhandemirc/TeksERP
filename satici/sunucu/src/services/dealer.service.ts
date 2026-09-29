// BAYİ — hesap, TAVAN (modül ⊆ · sınıf ⊆ · kurulum adedi; sürümlü defter) ve bayi imzalı HAK.
// Protokol bayi sertifikasının kısıtını KRİPTOGRAFİK uygular (sertifikadaki modül/sınıf); portal
// bunun ÜSTÜNE bayinin GÜNCEL tavanını uygular — sertifika verildikten sonra daraltılan tavan
// sertifika süresince de bağlar. Denetim iki kez: imzadan ÖNCE (parola boşa sorulmasın) ve
// deftere yazarken bayi kilidi ALTINDA (tavan aynı anda değişemez).
import type { Bayi, BayiTavani, HakSurumu, Kurulum, LisansSinifi, Tesis } from "@prisma/client";
import { LICENSE_CLASSES, verifyCertificate, verifyEntitlement } from "../lisans-protokol";
import { KeyStore } from "../keys/key-store";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockCustomer, lockDealer, lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import {
  buildEntitlementPayload,
  issueActivationCodeUnderLock,
  loadEntitlementTree,
  signEntitlement,
  writeEntitlementVersionUnderLock,
  type EntitlementChanges,
  type IssuedActivationCode,
  type PreparedEntitlementVersion,
} from "./entitlement.service";
import { cleanName, cleanTaxNo, createInstallationUnderLock, type CreateInstallationInput } from "./master-data.service";
import { requireReason } from "./sanction.service";

export interface DealerCeilingInput {
  readonly modules: readonly string[];
  readonly classes: readonly LisansSinifi[];
  readonly installationCount: number;
}

export type CeilingViolation =
  | { readonly tur: "MODUL"; readonly moduller: string[] }
  | { readonly tur: "SINIF"; readonly sinif: string }
  | { readonly tur: "ADET"; readonly kullanim: number; readonly tavan: number }
  | { readonly tur: "TAVAN_YOK" };

/** SAF: hak (modüller + sınıf) ve kullanım güncel tavana sığıyor mu? */
export function ceilingViolations(
  ceiling: Pick<BayiTavani, "moduller" | "siniflar" | "kurulumAdedi"> | null,
  g: { readonly modules?: readonly string[]; readonly licenseClass?: LisansSinifi; readonly usage?: number },
): CeilingViolation[] {
  if (!ceiling) return [{ tur: "TAVAN_YOK" }];
  const out: CeilingViolation[] = [];
  const outside = (g.modules ?? []).filter((m) => !ceiling.moduller.includes(m));
  if (outside.length > 0) out.push({ tur: "MODUL", moduller: outside });
  if (g.licenseClass !== undefined && !ceiling.siniflar.includes(g.licenseClass)) out.push({ tur: "SINIF", sinif: g.licenseClass });
  if (g.usage !== undefined && g.usage > ceiling.kurulumAdedi) out.push({ tur: "ADET", kullanim: g.usage, tavan: ceiling.kurulumAdedi });
  return out;
}

function describe(v: CeilingViolation): string {
  switch (v.tur) {
    case "MODUL":
      return `tavan dışı modül: ${v.moduller.join(", ")}`;
    case "SINIF":
      return `tavan dışı sınıf: ${v.sinif}`;
    case "ADET":
      return `kurulum adedi aşılıyor (${v.kullanim} > ${v.tavan})`;
    case "TAVAN_YOK":
      return "bayinin tanımlı tavanı yok";
  }
}

export function assertWithinCeiling(violations: readonly CeilingViolation[]): void {
  if (violations.length === 0) return;
  throw new VendorError(409, "BAYI_TAVANI_ASILDI", `Bayi tavanı aşılıyor — ${violations.map(describe).join("; ")}`, { ihlaller: violations });
}

function cleanCeiling(c: DealerCeilingInput): DealerCeilingInput {
  const modules = [...new Set(c.modules)];
  const classes = [...new Set(c.classes)];
  for (const cls of classes) if (!(LICENSE_CLASSES as readonly string[]).includes(cls)) throw badRequest(`Bilinmeyen sınıf: ${cls}`);
  if (classes.length === 0) throw badRequest("Tavanda en az bir sınıf olmalı");
  if (!Number.isInteger(c.installationCount) || c.installationCount < 0 || c.installationCount > 100_000) {
    throw badRequest("Kurulum adedi 0–100000 olmalı");
  }
  return { modules, classes, installationCount: c.installationCount };
}

export async function currentCeiling(db: Db, dealer: Pick<Bayi, "id" | "guncelTavanSurum">): Promise<BayiTavani | null> {
  if (dealer.guncelTavanSurum < 1) return null;
  return db.bayiTavani.findUnique({ where: { bayiId_surum: { bayiId: dealer.id, surum: dealer.guncelTavanSurum } } });
}

/** Bayinin kullandığı kurulum adedi: müşterilerinde aktif ve iptal edilmemiş kurulumlar. */
export async function dealerUsage(db: Db, dealerId: string): Promise<number> {
  return db.kurulum.count({ where: { aktif: true, durum: { not: "IPTAL" }, tesis: { musteri: { bayiId: dealerId } } } });
}

export async function findDealer(db: Db, dealerId: string): Promise<Bayi> {
  const dealer = await db.bayi.findUnique({ where: { id: dealerId } });
  if (!dealer) throw notFoundError("Bayi");
  return dealer;
}

// ---------------------------------------------------------------- hesap + tavan

export async function createDealerTx(
  tx: Tx,
  g: { name: string; taxNo?: string | null; ceiling: DealerCeilingInput; reason: string; actor: string },
): Promise<Bayi & { tavan: BayiTavani }> {
  const reason = requireReason(g.reason, "Bayi hesabı");
  const ceiling = cleanCeiling(g.ceiling);
  const dealer = await tx.bayi.create({ data: { ad: cleanName(g.name, "Bayi"), vergiNo: cleanTaxNo(g.taxNo), guncelTavanSurum: 1 } });
  const tavan = await tx.bayiTavani.create({
    data: { bayiId: dealer.id, surum: 1, moduller: ceiling.modules as string[], siniflar: [...ceiling.classes], kurulumAdedi: ceiling.installationCount, sebep: reason, yapan: g.actor },
  });
  return { ...dealer, tavan };
}

/** Tavan değişimi = yeni sürüm satırı (defter). Mevcut kullanımın altına inmek serbesttir: var olan kurulumlar çalışır, yenisi açılamaz. */
export async function setDealerCeilingTx(tx: Tx, g: { dealerId: string; ceiling: DealerCeilingInput; reason: string; actor: string }): Promise<BayiTavani> {
  await lockDealer(tx, g.dealerId);
  const reason = requireReason(g.reason, "Bayi tavanı değişimi");
  const ceiling = cleanCeiling(g.ceiling);
  const dealer = await findDealer(tx, g.dealerId);
  const next = dealer.guncelTavanSurum + 1;
  const claim = await tx.bayi.updateMany({ where: { id: dealer.id, guncelTavanSurum: dealer.guncelTavanSurum }, data: { guncelTavanSurum: next } });
  if (claim.count === 0) throw stateConflict("Tavan bu arada değişti; yeniden deneyin");
  return tx.bayiTavani.create({
    data: { bayiId: dealer.id, surum: next, moduller: ceiling.modules as string[], siniflar: [...ceiling.classes], kurulumAdedi: ceiling.installationCount, sebep: reason, yapan: g.actor },
  });
}

export async function setDealerActiveTx(tx: Tx, g: { dealerId: string; active: boolean; reason: string }): Promise<Bayi> {
  await lockDealer(tx, g.dealerId);
  requireReason(g.reason, g.active ? "Bayiyi aktife almak" : "Bayiyi pasife almak");
  const claim = await tx.bayi.updateMany({ where: { id: g.dealerId, aktif: !g.active }, data: { aktif: g.active } });
  if (claim.count === 0) {
    await findDealer(tx, g.dealerId);
    throw stateConflict(g.active ? "Bayi zaten aktif" : "Bayi zaten pasif");
  }
  if (!g.active) {
    // Pasif bayinin hesapları giremez: oturumları kapanır (kullanıcılar ayrıca pasife alınmaz — geri dönüş tek adım).
    await tx.portalOturumu.updateMany({
      where: { kapanisZamani: null, kullanici: { bayiId: g.dealerId } },
      data: { kapanisZamani: new Date(), kapanisNedeni: "BAYI_PASIF" },
    });
  }
  return tx.bayi.findUniqueOrThrow({ where: { id: g.dealerId } });
}

/**
 * Bayi anahtarını bağlar: anahtar dizininde `bayi-…` kid'li parolalı dosya olmalı, kök imzalı BAYI
 * sertifikası çapaya karşı ŞİMDİ geçerli olmalı ve bu bayinin id'sini taşımalı.
 */
export async function linkDealerKeyTx(tx: Tx, ctx: VendorContext, g: { dealerId: string; kid: string; nowMs?: number }): Promise<Bayi> {
  await lockDealer(tx, g.dealerId);
  const dealer = await findDealer(tx, g.dealerId);
  const info = ctx.keys.wrapped.find((w) => w.kind === "BAYI" && w.kid === g.kid);
  if (!info || !info.certificate) throw badRequest(`Bayi anahtarı anahtar dizininde yok: ${g.kid}`);
  const cert = verifyCertificate(info.certificate, { roots: ctx.keys.anchor, usage: "BAYI", atMs: g.nowMs ?? Date.now() });
  if (!cert.ok) throw badRequest(`Bayi sertifikası geçersiz (${cert.code})`);
  if (cert.value.document.bayi?.bayiId !== dealer.id) throw badRequest("Sertifika başka bir bayiye ait");
  const taken = await tx.bayi.findFirst({ where: { anahtarKid: g.kid, id: { not: dealer.id } }, select: { id: true } });
  if (taken) throw stateConflict("Bu anahtar başka bir bayiye bağlı");
  return tx.bayi.update({ where: { id: dealer.id }, data: { anahtarKid: g.kid } });
}

/** Portal anahtar dizinini tazeler (yeni bayi dosyası bakım işini beklemeden görünsün). */
export function reloadKeys(ctx: VendorContext): void {
  ctx.keys = KeyStore.load(ctx.config);
}

// ---------------------------------------------------------------- bayinin kurulumu

/** Bayi kurulum açar: sınıf tavanda, kullanım + 1 ≤ adet (bayi + müşteri ağacı kilidi altında). */
export async function createDealerInstallationTx(
  tx: Tx,
  g: CreateInstallationInput & { dealerId: string; site: Tesis },
): Promise<Kurulum> {
  await lockDealer(tx, g.dealerId);
  await lockCustomer(tx, g.site.musteriId);
  const dealer = await findDealer(tx, g.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const ceiling = await currentCeiling(tx, dealer);
  assertWithinCeiling(ceilingViolations(ceiling, { licenseClass: g.licenseClass, usage: (await dealerUsage(tx, dealer.id)) + 1 }));
  return createInstallationUnderLock(tx, g);
}

// ---------------------------------------------------------------- bayi imzalı HAK

function dealerKeyFor(ctx: VendorContext, dealer: Bayi, nowMs: number): { path: string; kid: string; certificate: string } {
  if (!dealer.anahtarKid) throw stateConflict("Bayinin bağlı imza anahtarı yok (satıcıya başvurun)");
  const info = ctx.keys.wrapped.find((w) => w.kind === "BAYI" && w.kid === dealer.anahtarKid);
  if (!info || !info.certificate) throw new VendorError(500, "SUNUCU_HATASI", "Bayi anahtar dosyası sunucuda bulunamadı");
  const cert = verifyCertificate(info.certificate, { roots: ctx.keys.anchor, usage: "BAYI", atMs: nowMs });
  if (!cert.ok || cert.value.document.bayi?.bayiId !== dealer.id) throw stateConflict("Bayi sertifikası geçersiz ya da süresi dolmuş (satıcıya başvurun)");
  return { path: info.path, kid: info.kid, certificate: info.certificate };
}

/**
 * BAYİ imzalı yeni sürümü HAZIRLAR (tx dışı): sahiplik → anahtar/sertifika → GÜNCEL tavan (ön
 * denetim) → imza (bayi parolası alt sürecin stdin'ine) → protokol doğrulaması (sertifika kısıtı).
 */
export async function prepareDealerEntitlementVersion(
  ctx: VendorContext,
  g: { dealerId: string; entitlementId: string; changes?: EntitlementChanges; password: Buffer; reason: string; actor: string; nowMs?: number },
): Promise<PreparedEntitlementVersion> {
  try {
    const reason = requireReason(g.reason, "HAK sürümü");
    const nowMs = g.nowMs ?? Date.now();
    const hak = await loadEntitlementTree(prisma, g.entitlementId);
    if (hak.kurulum.tesis.musteri.bayiId !== g.dealerId) throw notFoundError("Hak");
    if (hak.kurulum.durum === "IPTAL" || !hak.kurulum.aktif) throw stateConflict("İptal edilmiş ya da pasif kurulumun hakkı imzalanamaz");
    const dealer = await findDealer(prisma, g.dealerId);
    if (!dealer.aktif) throw stateConflict("Bayi pasif");
    const key = dealerKeyFor(ctx, dealer, nowMs);
    const { payload, fields } = buildEntitlementPayload(hak, g.changes ?? {}, nowMs, { dealerId: dealer.id, certificate: key.certificate });
    const ceiling = await currentCeiling(prisma, dealer);
    assertWithinCeiling(ceilingViolations(ceiling, { modules: fields.modules, licenseClass: fields.licenseClass, usage: await dealerUsage(prisma, dealer.id) }));
    const token = await signEntitlement(key.path, payload, g.password);
    // Protokolün kriptografik kısıtı: sertifikadaki modül/sınıf dışına çıkan HAK burada düşer.
    const verified = verifyEntitlement(token, ctx.keys.anchor);
    if (!verified.ok) {
      throw new VendorError(409, "BAYI_TAVANI_ASILDI", `Bayi sertifikası bu hakkı kapsamıyor (${verified.code}): ${verified.message}`, { protokolKodu: verified.code });
    }
    if (verified.value.signer.kind !== "BAYI" || verified.value.document.surum !== payload.surum) {
      throw new VendorError(500, "SUNUCU_HATASI", "Bayi imzalı HAK beklenen imzacıyla doğrulanamadı");
    }
    return {
      entitlementId: hak.id,
      installationDbId: hak.kurulumId,
      baseVersion: hak.guncelSurum,
      version: payload.surum,
      token,
      signerKid: key.kid,
      signerKind: "BAYI",
      dealerId: dealer.id,
      fields,
      clearValidity: g.changes?.perpetual === true && !hak.kalici && hak.gecerlilikBitis !== null,
      issuedAt: new Date(nowMs),
      reason,
      actor: g.actor,
    };
  } finally {
    g.password.fill(0);
  }
}

/** Bayi kilidi ALTINDA tavan YENİDEN denetlenir (imzadan bu yana değişmiş olabilir), sonra sürüm yazılır. */
export async function recordDealerEntitlementVersionTx(tx: Tx, p: PreparedEntitlementVersion): Promise<HakSurumu> {
  await lockDealer(tx, p.dealerId ?? "");
  await lockInstallation(tx, p.installationDbId);
  if (!p.dealerId) throw new VendorError(500, "SUNUCU_HATASI", "Bayi imzası bayi kimliği taşımıyor");
  const dealer = await findDealer(tx, p.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const ceiling = await currentCeiling(tx, dealer);
  assertWithinCeiling(ceilingViolations(ceiling, { modules: p.fields.modules, licenseClass: p.fields.licenseClass, usage: await dealerUsage(tx, dealer.id) }));
  return writeEntitlementVersionUnderLock(tx, p);
}

/** Bayinin kod üretimi: son sürüm bayi imzalıysa GÜNCEL tavana hâlâ sığmalı (eski imzalı hak daraltılmış tavanla yeni kuruluma gitmesin). */
export async function createDealerActivationCodeTx(
  tx: Tx,
  ctx: VendorContext,
  g: { dealerId: string; installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<IssuedActivationCode> {
  await lockDealer(tx, g.dealerId);
  await lockInstallation(tx, g.installationDbId);
  const dealer = await findDealer(tx, g.dealerId);
  if (!dealer.aktif) throw stateConflict("Bayi pasif");
  const hak = await tx.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true }, include: { kurulum: true } });
  if (hak && hak.guncelSurum >= 1) {
    const ceiling = await currentCeiling(tx, dealer);
    assertWithinCeiling(ceilingViolations(ceiling, { modules: hak.moduller, licenseClass: hak.kurulum.sinif, usage: await dealerUsage(tx, dealer.id) }));
  }
  return issueActivationCodeUnderLock(tx, ctx, g);
}

