// BAYİ — hesap, TAVAN (modül ⊆ · sınıf ⊆ · kurulum adedi · kanal ⊆ · kalıcı izni · bakım ay tavanı;
// sürümlü defter) ve bayi imzalı HAK. Bayinin kayıt üzerindeki yazmaları (sahiplik kilit altında):
// dealer-ownership.service.ts.
// Protokol bayi sertifikasının kısıtını KRİPTOGRAFİK uygular (sertifikadaki modül/sınıf); portal
// bunun ÜSTÜNE bayinin GÜNCEL tavanını uygular — sertifika verildikten sonra daraltılan tavan
// sertifika süresince de bağlar. Denetim iki kez: imzadan ÖNCE (parola boşa sorulmasın) ve
// deftere yazarken bayi kilidi ALTINDA (tavan aynı anda değişemez).
import type { Bayi, BayiTavani, LisansSinifi } from "@prisma/client";
import { LICENSE_CLASSES, verifyCertificate, verifyEntitlement } from "../lisans-protokol";
import { KeyStore } from "../keys/key-store";
import { VendorError, badRequest, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockDealer } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { buildEntitlementPayload, loadEntitlementTree, signEntitlement, type EntitlementChanges, type PreparedEntitlementVersion } from "./entitlement.service";
import { cleanChannelList } from "./channel.service";
import { cleanName, cleanTaxNo } from "./master-data.service";
import { requireReason } from "./sanction.service";

/** Bayi tavanının bakım ay tavanı varsayılanı (yıllık bakım kalıbı) ve üst sınırı. */
export const DEFAULT_MAINTENANCE_MONTHS = 12;
export const MAX_MAINTENANCE_MONTHS = 120;

export interface DealerCeilingInput {
  readonly modules: readonly string[];
  readonly classes: readonly LisansSinifi[];
  readonly installationCount: number;
  /** Bayinin kurulum açabileceği kanallar (boş = kurulum açamaz). */
  readonly channels?: readonly string[];
  /** Bayi KALICI hak imzalayabilir mi — varsayılan HAYIR (yönetici kararı g). */
  readonly perpetualAllowed?: boolean;
  /** Bakım bitişi imza anından en çok kaç ay sonra olabilir. */
  readonly maintenanceMonths?: number;
}

export type CeilingViolation =
  | { readonly tur: "MODUL"; readonly moduller: string[] }
  | { readonly tur: "SINIF"; readonly sinif: string }
  | { readonly tur: "ADET"; readonly kullanim: number; readonly tavan: number }
  | { readonly tur: "KANAL"; readonly kanal: string }
  | { readonly tur: "KALICI" }
  | { readonly tur: "BAKIM"; readonly bakimBitis: string; readonly enGec: string; readonly tavanAy: number }
  | { readonly tur: "TAVAN_YOK" };

/** `atMs` + `months` takvim ayı (UTC; ayın son günü taşarsa ay sonuna oturur). */
export function addMonthsUtc(atMs: number, months: number): number {
  const d = new Date(atMs);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

/** SAF: hak (modüller · sınıf · kalıcı · bakım bitişi), kanal ve kullanım güncel tavana sığıyor mu? */
export function ceilingViolations(
  ceiling: Pick<BayiTavani, "moduller" | "siniflar" | "kurulumAdedi" | "kanallar" | "kaliciIzni" | "bakimAyTavani"> | null,
  g: {
    readonly modules?: readonly string[];
    readonly licenseClass?: LisansSinifi;
    readonly usage?: number;
    readonly channelCode?: string;
    readonly perpetual?: boolean;
    /** Bakım bitişi `atMs` (imza/doğuş anı) + tavan ayını aşamaz. */
    readonly maintenance?: { readonly until: Date; readonly atMs: number };
  },
): CeilingViolation[] {
  if (!ceiling) return [{ tur: "TAVAN_YOK" }];
  const out: CeilingViolation[] = [];
  const outside = (g.modules ?? []).filter((m) => !ceiling.moduller.includes(m));
  if (outside.length > 0) out.push({ tur: "MODUL", moduller: outside });
  if (g.licenseClass !== undefined && !ceiling.siniflar.includes(g.licenseClass)) out.push({ tur: "SINIF", sinif: g.licenseClass });
  if (g.usage !== undefined && g.usage > ceiling.kurulumAdedi) out.push({ tur: "ADET", kullanim: g.usage, tavan: ceiling.kurulumAdedi });
  if (g.channelCode !== undefined && !ceiling.kanallar.includes(g.channelCode)) out.push({ tur: "KANAL", kanal: g.channelCode });
  if (g.perpetual === true && !ceiling.kaliciIzni) out.push({ tur: "KALICI" });
  if (g.maintenance) {
    const latest = addMonthsUtc(g.maintenance.atMs, ceiling.bakimAyTavani);
    if (g.maintenance.until.getTime() > latest) {
      out.push({ tur: "BAKIM", bakimBitis: g.maintenance.until.toISOString(), enGec: new Date(latest).toISOString(), tavanAy: ceiling.bakimAyTavani });
    }
  }
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
    case "KANAL":
      return `bayiye atanmamış kanal: ${v.kanal}`;
    case "KALICI":
      return "bayinin kalıcı hak imzalama izni yok";
    case "BAKIM":
      return `bakım bitişi tavanı aşıyor (en geç ${v.enGec.slice(0, 10)}, ${v.tavanAy} ay)`;
    case "TAVAN_YOK":
      return "bayinin tanımlı tavanı yok";
  }
}

export function assertWithinCeiling(violations: readonly CeilingViolation[]): void {
  if (violations.length === 0) return;
  throw new VendorError(409, "BAYI_TAVANI_ASILDI", `Bayi tavanı aşılıyor — ${violations.map(describe).join("; ")}`, { ihlaller: violations });
}

interface CleanCeiling {
  readonly modules: string[];
  readonly classes: LisansSinifi[];
  readonly installationCount: number;
  readonly channels: string[];
  readonly perpetualAllowed: boolean;
  readonly maintenanceMonths: number;
}

async function cleanCeiling(db: Db, c: DealerCeilingInput): Promise<CleanCeiling> {
  const modules = [...new Set(c.modules)];
  const classes = [...new Set(c.classes)];
  for (const cls of classes) if (!(LICENSE_CLASSES as readonly string[]).includes(cls)) throw badRequest(`Bilinmeyen sınıf: ${cls}`);
  if (classes.length === 0) throw badRequest("Tavanda en az bir sınıf olmalı");
  if (!Number.isInteger(c.installationCount) || c.installationCount < 0 || c.installationCount > 100_000) {
    throw badRequest("Kurulum adedi 0–100000 olmalı");
  }
  const months = c.maintenanceMonths ?? DEFAULT_MAINTENANCE_MONTHS;
  if (!Number.isInteger(months) || months < 1 || months > MAX_MAINTENANCE_MONTHS) throw badRequest(`Bakım ay tavanı 1–${MAX_MAINTENANCE_MONTHS} olmalı`);
  return {
    modules,
    classes,
    installationCount: c.installationCount,
    channels: await cleanChannelList(db, c.channels ?? []),
    perpetualAllowed: c.perpetualAllowed ?? false,
    maintenanceMonths: months,
  };
}

const ceilingRow = (c: CleanCeiling) => ({
  moduller: c.modules,
  siniflar: c.classes,
  kurulumAdedi: c.installationCount,
  kanallar: c.channels,
  kaliciIzni: c.perpetualAllowed,
  bakimAyTavani: c.maintenanceMonths,
});

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
  const ceiling = await cleanCeiling(tx, g.ceiling);
  const dealer = await tx.bayi.create({ data: { ad: cleanName(g.name, "Bayi"), vergiNo: cleanTaxNo(g.taxNo), guncelTavanSurum: 1 } });
  const tavan = await tx.bayiTavani.create({ data: { bayiId: dealer.id, surum: 1, ...ceilingRow(ceiling), sebep: reason, yapan: g.actor } });
  return { ...dealer, tavan };
}

/** Tavan değişimi = yeni sürüm satırı (defter). Mevcut kullanımın altına inmek serbesttir: var olan kurulumlar çalışır, yenisi açılamaz. */
export async function setDealerCeilingTx(tx: Tx, g: { dealerId: string; ceiling: DealerCeilingInput; reason: string; actor: string }): Promise<BayiTavani> {
  await lockDealer(tx, g.dealerId);
  const reason = requireReason(g.reason, "Bayi tavanı değişimi");
  const ceiling = await cleanCeiling(tx, g.ceiling);
  const dealer = await findDealer(tx, g.dealerId);
  const next = dealer.guncelTavanSurum + 1;
  const claim = await tx.bayi.updateMany({ where: { id: dealer.id, guncelTavanSurum: dealer.guncelTavanSurum }, data: { guncelTavanSurum: next } });
  if (claim.count === 0) throw retryConflict("Tavan bu arada değişti; yeniden deneyin");
  return tx.bayiTavani.create({ data: { bayiId: dealer.id, surum: next, ...ceilingRow(ceiling), sebep: reason, yapan: g.actor } });
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

// ---------------------------------------------------------------- bayi imzalı HAK

/** HAK'ın tavana giden alanları (modül · sınıf · kalıcı · bakım bitişi `atMs`e göre). */
export function signedFieldsOf(
  f: { readonly modules: readonly string[]; readonly licenseClass: LisansSinifi; readonly perpetual: boolean; readonly maintenanceUntil: Date },
  atMs: number,
): Parameters<typeof ceilingViolations>[1] {
  return { modules: f.modules, licenseClass: f.licenseClass, perpetual: f.perpetual, maintenance: { until: f.maintenanceUntil, atMs } };
}

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
    assertWithinCeiling(ceilingViolations(ceiling, { ...signedFieldsOf(fields, nowMs), usage: await dealerUsage(prisma, dealer.id) }));
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

