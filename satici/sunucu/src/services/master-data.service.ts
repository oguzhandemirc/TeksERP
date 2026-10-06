// ANA VERİ — Müşteri → Tesis → Kurulum: ekle · güncelle · pasife al / aktife al (SOFT DELETE).
// Sert silme YOK. Pasife alma bir durum geçişidir (atomik) ve MV-06'ya uyar: canlı çocuğu olan
// ebeveyn pasife alınamaz (aktif tesisi olan müşteri, aktif kurulumu olan tesis); kurulum yalnız
// hiç etkinleşmemişken ya da iptal edilmişken pasife alınır (lisanslı fabrika sessizce kaybolmasın).
// Ebeveyn–çocuk yarışı müşteri ağacı kilidiyle (9105) kapanır: çocuk doğarken ebeveyn pasife geçemez.
// `…Tx` biçimlerinin ilk ifadesi kilittir; kilidin anahtarı (müşteri/tesis) değişmeyen alandan okunur.
import { randomUUID } from "node:crypto";
import type { Kurulum, LisansSinifi, Musteri, Tesis } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import { badRequest, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { CLOUD_RETENTION_DEFAULT, CLOUD_RETENTION_MONTHS, SYNC_MINUTES_DEFAULT, SYNC_MINUTES_MAX, SYNC_MINUTES_MIN } from "./cloud-entitlement";
import { lockCustomer, lockDealers, lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { defaultGroupFor, requireChannel } from "./channel.service";
import { notifyDoorbell } from "./doorbell";
import { requireValidityEnd } from "./entitlement-policy";
import { requireReason } from "./sanction.service";

export function cleanName(name: string, what: string): string {
  const n = name.trim();
  if (!n || n.length > 200) throw badRequest(`${what} adı 1–200 karakter olmalı`);
  return n;
}

export function cleanTaxNo(taxNo: string | null | undefined): string | null {
  if (taxNo === undefined || taxNo === null) return null;
  const t = taxNo.trim();
  if (!t) return null;
  if (!/^[A-Za-z0-9-]{1,20}$/.test(t)) throw badRequest("Vergi numarası harf/rakam, en çok 20 karakter olmalı");
  return t;
}

function pollMinutes(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < 5 || v > 1440) throw badRequest("Yoklama aralığı 5–1440 dakika olmalı");
  return v;
}

function syncMinutes(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < SYNC_MINUTES_MIN || v > SYNC_MINUTES_MAX) throw badRequest("Eşitleme aralığı 1–60 dakika olmalı");
  return v;
}

function cloudRetention(v: number | null | undefined): number | null | undefined {
  if (v === undefined || v === null) return v;
  if (!(CLOUD_RETENTION_MONTHS as readonly number[]).includes(v)) throw badRequest("Bulut saklama süresi 3, 13, 25 ay ya da tüm geçmiş olmalı");
  return v;
}

async function assertActiveDealer(db: Db, dealerId: string | null | undefined): Promise<void> {
  if (!dealerId) return;
  const dealer = await db.bayi.findUnique({ where: { id: dealerId } });
  if (!dealer || !dealer.aktif) throw badRequest("Bayi bulunamadı ya da pasif");
}

export async function findSite(db: Db, siteId: string): Promise<Tesis> {
  const site = await db.tesis.findUnique({ where: { id: siteId } });
  if (!site) throw notFoundError("Tesis");
  return site;
}

export async function findInstallationWithSite(db: Db, installationDbId: string): Promise<Kurulum & { tesis: Tesis }> {
  const inst = await db.kurulum.findUnique({ where: { id: installationDbId }, include: { tesis: true } });
  if (!inst) throw notFoundError("Kurulum");
  return inst;
}

// ---------------------------------------------------------------- müşteri

/** Tek satır ekleme: kilit gerekmez (ebeveyni yok); portal onu işlem kimliği tx'inde çağırır. */
export async function createCustomerTx(tx: Db, g: { name: string; taxNo?: string | null; dealerId?: string | null }): Promise<Musteri> {
  const ad = cleanName(g.name, "Müşteri");
  await assertActiveDealer(tx, g.dealerId);
  return tx.musteri.create({ data: { ad, vergiNo: cleanTaxNo(g.taxNo), bayiId: g.dealerId ?? null } });
}

export async function findCustomer(db: Db, customerId: string): Promise<Musteri> {
  const row = await db.musteri.findUnique({ where: { id: customerId } });
  if (!row) throw notFoundError("Müşteri");
  return row;
}

/** Müşterinin bayi bağı DEĞİŞİYOR mu (atama, başka bayiye geçiş ya da bayiden alma)? Yetki kapısı rotada: yalnız yönetici. */
export function changesDealer(customer: Pick<Musteri, "bayiId">, dealerId: string | null | undefined): boolean {
  return dealerId !== undefined && dealerId !== customer.bayiId;
}

/**
 * Ad · vergi no · bayi bağı. Bayi değişimi (D10): eski + yeni bayi kilidi (kimlik sırasıyla) → müşteri kilidi;
 * kilitsiz okunan bağ kilit altında değişmişse "tekrar deneyin"; yeni bayinin GÜNCEL tavanı müşterinin canlı
 * kurulumlarını (adet · sınıf · kanal · hak modülleri) kaldırmalı (`assertDealerCanTake`, dealer.service).
 */
export async function updateCustomerTx(
  tx: Tx,
  g: {
    customer: Musteri;
    name?: string;
    taxNo?: string | null;
    dealerId?: string | null;
    assertDealerCanTake?: (tx: Tx, dealerId: string, customerId: string) => Promise<void>;
  },
): Promise<Musteri> {
  const dealerChange = changesDealer(g.customer, g.dealerId);
  if (dealerChange) await lockDealers(tx, [g.customer.bayiId, g.dealerId].filter((d): d is string => typeof d === "string"));
  await lockCustomer(tx, g.customer.id);
  const current = await findCustomer(tx, g.customer.id);
  if (dealerChange) {
    if (current.bayiId !== g.customer.bayiId) throw retryConflict("Müşterinin bayisi bu arada değişti; yeniden deneyin");
    if (g.dealerId) {
      await assertActiveDealer(tx, g.dealerId);
      if (!g.assertDealerCanTake) throw new Error("Bayi değişimi tavan denetimi olmadan yapılamaz");
      await g.assertDealerCanTake(tx, g.dealerId, current.id);
    }
  }
  return tx.musteri.update({
    where: { id: current.id },
    data: {
      ...(g.name === undefined ? {} : { ad: cleanName(g.name, "Müşteri") }),
      ...(g.taxNo === undefined ? {} : { vergiNo: cleanTaxNo(g.taxNo) }),
      ...(dealerChange ? { bayiId: g.dealerId ?? null } : {}),
    },
  });
}

export async function setCustomerActiveTx(tx: Tx, g: { customerId: string; active: boolean; reason: string }): Promise<Musteri> {
  await lockCustomer(tx, g.customerId);
  requireReason(g.reason, g.active ? "Müşteriyi aktife almak" : "Müşteriyi pasife almak");
  const current = await tx.musteri.findUnique({ where: { id: g.customerId } });
  if (!current) throw notFoundError("Müşteri");
  if (!g.active) {
    const liveSites = await tx.tesis.count({ where: { musteriId: current.id, aktif: true } });
    if (liveSites > 0) throw stateConflict(`Müşterinin ${liveSites} aktif tesisi var; önce tesisleri pasife alın`);
  }
  const claim = await tx.musteri.updateMany({ where: { id: current.id, aktif: !g.active }, data: { aktif: g.active } });
  if (claim.count === 0) throw stateConflict(g.active ? "Müşteri zaten aktif" : "Müşteri zaten pasif");
  return tx.musteri.findUniqueOrThrow({ where: { id: current.id } });
}

// ---------------------------------------------------------------- tesis

/** `dealerId` verilirse (bayi portalı) sahiplik müşteri kilidi ALTINDA denetlenir: başka bayinin müşterisi "yok"tur. */
export async function createSiteTx(tx: Tx, g: { customerId: string; name: string; dealerId?: string }): Promise<Tesis> {
  await lockCustomer(tx, g.customerId);
  const ad = cleanName(g.name, "Tesis");
  const customer = await tx.musteri.findUnique({ where: { id: g.customerId } });
  if (!customer || (g.dealerId !== undefined && customer.bayiId !== g.dealerId)) throw notFoundError("Müşteri");
  if (!customer.aktif) throw stateConflict("Pasif müşteriye tesis eklenemez");
  return tx.tesis.create({ data: { musteriId: customer.id, ad } });
}

export async function updateSiteTx(tx: Tx, g: { site: Tesis; name: string }): Promise<Tesis> {
  await lockCustomer(tx, g.site.musteriId);
  return tx.tesis.update({ where: { id: g.site.id }, data: { ad: cleanName(g.name, "Tesis") } });
}

export async function setSiteActiveTx(tx: Tx, g: { site: Tesis; active: boolean; reason: string }): Promise<Tesis> {
  await lockCustomer(tx, g.site.musteriId);
  requireReason(g.reason, g.active ? "Tesisi aktife almak" : "Tesisi pasife almak");
  const customer = await tx.musteri.findUniqueOrThrow({ where: { id: g.site.musteriId } });
  if (g.active && !customer.aktif) throw stateConflict("Pasif müşterinin tesisi aktife alınamaz; önce müşteriyi aktife alın");
  if (!g.active) {
    const live = await tx.kurulum.count({ where: { tesisId: g.site.id, aktif: true } });
    if (live > 0) throw stateConflict(`Tesisin ${live} aktif kurulumu var; önce kurulumları pasife alın`);
  }
  const claim = await tx.tesis.updateMany({ where: { id: g.site.id, aktif: !g.active }, data: { aktif: g.active } });
  if (claim.count === 0) throw stateConflict(g.active ? "Tesis zaten aktif" : "Tesis zaten pasif");
  return tx.tesis.findUniqueOrThrow({ where: { id: g.site.id } });
}

// ---------------------------------------------------------------- kurulum

export interface CreateInstallationInput {
  readonly siteId: string;
  readonly licenseClass: LisansSinifi;
  /** Güncelleme grubu; verilmezse sınıftan (K-3: TEST → test, diğerleri → genel). */
  readonly channelCode?: string;
  readonly name?: string | null;
  readonly pollMinutes?: number;
  readonly syncMinutes?: number;
  readonly cloudRetentionMonths?: number | null;
}

/**
 * Kilit ALTINDA (müşteri ağacı) çağrılır: tesis/müşteri tazeden okunur ve aktif olmalı. Lisans kimliği
 * (`kurulumId`) burada DOĞAR (D14): dışarıdan verilmez; fabrikaya etkinleştirme yanıtıyla gider.
 */
export async function createInstallationUnderLock(tx: Tx, g: CreateInstallationInput): Promise<Kurulum> {
  const group = installationGroup(g);
  await requireChannel(tx, group);
  const name = g.name === undefined || g.name === null ? null : cleanName(g.name, "Kurulum");
  const site = await tx.tesis.findUnique({ where: { id: g.siteId }, include: { musteri: true } });
  if (!site) throw notFoundError("Tesis");
  if (!site.aktif || !site.musteri.aktif) throw stateConflict("Pasif tesis ya da müşteriye kurulum eklenemez");
  return tx.kurulum.create({
    data: {
      tesisId: site.id,
      kurulumId: randomUUID(),
      sinif: g.licenseClass,
      kanalKodu: group,
      ad: name,
      yoklamaAraligiDk: pollMinutes(g.pollMinutes) ?? 60,
      esitlemeAraligiDk: syncMinutes(g.syncMinutes) ?? SYNC_MINUTES_DEFAULT,
      bulutSaklamaAy: g.cloudRetentionMonths === undefined ? CLOUD_RETENTION_DEFAULT : cloudRetention(g.cloudRetentionMonths),
    },
  });
}

/** Kurulumun doğacağı grup: açık seçim ya da sınıfın varsayılanı (K-3). */
export function installationGroup(g: Pick<CreateInstallationInput, "licenseClass" | "channelCode">): string {
  return g.channelCode ?? defaultGroupFor(g.licenseClass);
}

/** Kurulum lisans kimliğiyle doğar — HAK o kimliğe imzalanır. `site` kilitsiz okunur (müşterisi değişmez). */
export async function createInstallationTx(tx: Tx, g: CreateInstallationInput & { site: Tesis }): Promise<Kurulum> {
  await lockCustomer(tx, g.site.musteriId);
  return createInstallationUnderLock(tx, g);
}

export interface UpdateInstallationInput {
  readonly installationDbId: string;
  readonly name?: string | null;
  readonly channelCode?: string;
  readonly pollMinutes?: number;
  readonly syncMinutes?: number;
  readonly cloudRetentionMonths?: number | null;
  readonly licenseClass?: LisansSinifi;
  readonly actor: string;
}

/**
 * Ad · güncelleme grubu · yoklama/eşitleme aralığı · bulut saklama · (imzalı HAK yokken) sınıf. Kiraya giden alan değişirse
 * zil çalar. Grup yalnız aktif bir gruba taşınır (K-4: yalnız satıcı tarafı — bayinin kurulum düzenleme yolu yok); grup
 * değişimi geri sürüm DEMEK DEĞİLDİR: yeni gruptaki sürüm kuruludan eskiyse kurulum o grup yetişene dek bekler (§3.1).
 */
export async function updateInstallationTx(tx: Tx, g: UpdateInstallationInput): Promise<Kurulum> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  const groupChanges = g.channelCode !== undefined && g.channelCode !== inst.kanalKodu;
  if (groupChanges) await requireChannel(tx, g.channelCode as string);
  if (g.licenseClass !== undefined && g.licenseClass !== inst.sinif) {
    const signed = await tx.hak.count({ where: { kurulumId: inst.id, guncelSurum: { gte: 1 } } });
    if (signed > 0) throw stateConflict("Sınıf imzalı HAK'ın parçası: imzalı hakkı olan kurulumun sınıfı değişmez (yeni kurulum açın)");
    const draft = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true }, select: { gecerlilikBitis: true } });
    if (draft) requireValidityEnd(g.licenseClass, draft.gecerlilikBitis);
  }
  const data = {
    ...(g.name === undefined ? {} : { ad: g.name === null ? null : cleanName(g.name, "Kurulum") }),
    ...(groupChanges ? { kanalKodu: g.channelCode } : {}),
    ...(g.pollMinutes === undefined ? {} : { yoklamaAraligiDk: pollMinutes(g.pollMinutes) }),
    ...(g.syncMinutes === undefined ? {} : { esitlemeAraligiDk: syncMinutes(g.syncMinutes) }),
    ...(g.cloudRetentionMonths === undefined ? {} : { bulutSaklamaAy: cloudRetention(g.cloudRetentionMonths) }),
    ...(g.licenseClass === undefined ? {} : { sinif: g.licenseClass }),
  };
  const current = inst as unknown as Record<string, unknown>;
  const changed = Object.entries(data)
    .filter(([k, v]) => current[k] !== v)
    .map(([k]) => k);
  if (changed.length === 0) return inst;
  const updated = await tx.kurulum.update({ where: { id: inst.id }, data });
  const ayrinti = changed.includes("kanalKodu") ? { alanlar: changed, grup: { onceki: inst.kanalKodu, yeni: updated.kanalKodu } } : { alanlar: changed };
  await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay: "GUNCELLENDI", ayrinti, yapan: g.actor } });
  if (["kanalKodu", "yoklamaAraligiDk", "esitlemeAraligiDk"].some((k) => changed.includes(k))) await notifyDoorbell(tx, inst.id, "lisans");
  return updated;
}

/** Pasife alma yalnız ETKINLESMEDI ya da IPTAL kurulumda; açık kodlar düşer. `installation` kilitsiz okunur (tesisi değişmez). */
export async function setInstallationActiveTx(
  tx: Tx,
  g: { installation: Kurulum & { tesis: Tesis }; active: boolean; reason: string; actor: string },
): Promise<Kurulum> {
  await lockCustomer(tx, g.installation.tesis.musteriId);
  await lockInstallation(tx, g.installation.id);
  const reason = requireReason(g.reason, g.active ? "Kurulumu aktife almak" : "Kurulumu pasife almak");
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installation.id }, include: { tesis: true } });
  if (!g.active && inst.durum !== "ETKINLESMEDI" && inst.durum !== "IPTAL") {
    throw stateConflict("Yalnız etkinleşmemiş ya da iptal edilmiş kurulum pasife alınır (önce kurulumu iptal edin)");
  }
  if (g.active && !inst.tesis.aktif) throw stateConflict("Pasif tesisin kurulumu aktife alınamaz; önce tesisi aktife alın");
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, aktif: !g.active }, data: { aktif: g.active } });
  if (claim.count === 0) throw stateConflict(g.active ? "Kurulum zaten aktif" : "Kurulum zaten pasif");
  if (!g.active) await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  await tx.kurulumKaydi.create({
    data: { kurulumId: inst.id, olay: g.active ? "AKTIFE_ALINDI" : "PASIFE_ALINDI", ayrinti: { sebep: reason }, yapan: g.actor },
  });
  return tx.kurulum.findUniqueOrThrow({ where: { id: inst.id } });
}

// ---------------------------------------------------------------- düz biçimler (CLI · bekçi fikstürü)

export async function createCustomer(g: { name: string; taxNo?: string; dealerId?: string | null; actor: string }): Promise<Musteri> {
  const row = await createCustomerTx(prisma, g);
  await recordAudit({ event: "MUSTERI_EKLENDI", entity: "Musteri", entityId: row.id, actor: g.actor });
  return row;
}

export async function createSite(g: { customerId: string; name: string; actor: string }): Promise<Tesis> {
  const row = await prisma.$transaction((tx) => createSiteTx(tx, g));
  await recordAudit({ event: "TESIS_EKLENDI", entity: "Tesis", entityId: row.id, actor: g.actor });
  return row;
}

export async function createInstallation(g: CreateInstallationInput & { actor: string }): Promise<Kurulum> {
  const site = await findSite(prisma, g.siteId);
  const row = await prisma.$transaction((tx) => createInstallationTx(tx, { ...g, site }));
  await recordAudit({ event: "KURULUM_EKLENDI", entity: "Kurulum", entityId: row.id, actor: g.actor, summary: { sinif: g.licenseClass } });
  return row;
}
