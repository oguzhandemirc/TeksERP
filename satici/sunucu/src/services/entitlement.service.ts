// HAK (lisans hakkı) TASLAĞI + tek kullanımlık etkinleştirme kodu. HAK taslağı imzasız doğar (guncelSurum 0); imzalı
// sürümler `entitlement-version.service.ts` (KÖK · BAYİ · ARA imzacı, kök yoksa kök kuyruğu), imza politikası
// `entitlement-policy.ts`, düz biçim + toplu basım `entitlement-issue.service.ts` — hepsi buradan da yeniden ihraç edilir.
// Kod kuruluma bağlı doğar; düz metni yalnız bir kez döner (DB'de sunucu sırlı HMAC + son 4).
import type { Hak, KodTuru } from "@prisma/client";
import { DAY_MS, generateActivationCode } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockInstallation, lockLicenseNumber } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { checkModuleFormat, requireValidityEnd } from "./entitlement-policy";
import { recordValidityAtBirthTx } from "./sanction.service";

export { createCustomer, createInstallation, createSite } from "./master-data.service";
export * from "./entitlement-policy";
export * from "./entitlement-version.service";
export * from "./entitlement-issue.service";

function istanbulYear(nowMs: number): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date(nowMs)));
}

export interface CreateEntitlementInput {
  readonly installationDbId: string;
  readonly modules: readonly string[];
  readonly perpetual: boolean;
  readonly maintenanceUntil: Date;
  /** Geçerlilik bitişi (vadeli/demo); DEMO'da zorunlu. Verilirse GECERLILIK defter satırı aynı tx'te yazılır. */
  readonly validUntil?: Date | null;
  /** Numaranın yılı bu andan (İstanbul) — kilit ve numara aynı yılı görsün. */
  readonly nowMs: number;
  readonly actor: string;
}

/** Hak TASLAĞI doğar (imzasız); lisans numarası (TKS-YYYY-NNNN) doğuşta, yıl sayacı kilidi altında materyalize edilir. */
export async function createEntitlementTx(tx: Tx, g: CreateEntitlementInput): Promise<Hak> {
  await lockLicenseNumber(tx, istanbulYear(g.nowMs));
  const year = istanbulYear(g.nowMs);
  const modules = checkModuleFormat(g.modules);
  if (Number.isNaN(g.maintenanceUntil.getTime())) throw badRequest("Bakım bitişi geçersiz");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  if (!inst.aktif || inst.durum === "IPTAL") throw stateConflict("Pasif ya da iptal edilmiş kuruluma hak açılamaz");
  if (g.validUntil && Number.isNaN(g.validUntil.getTime())) throw badRequest("Geçerlilik bitişi geçersiz");
  requireValidityEnd(inst.sinif, g.validUntil);
  const existing = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true }, select: { lisansNo: true } });
  if (existing) throw stateConflict(`Kurulumun zaten aktif bir hakkı var (${existing.lisansNo}); değişiklik yeni sürümle yapılır`);
  const prefix = `TKS-${year}-`;
  const last = await tx.hak.findFirst({ where: { lisansNo: { startsWith: prefix } }, orderBy: { lisansNo: "desc" } });
  const next = last ? Number(last.lisansNo.slice(prefix.length)) + 1 : 1;
  if (next > 999_999) throw new VendorError(500, "SUNUCU_HATASI", "Lisans numarası uzayı doldu");
  const hak = await tx.hak.create({
    data: {
      kurulumId: inst.id,
      lisansNo: `${prefix}${String(next).padStart(4, "0")}`,
      moduller: modules,
      kalici: g.perpetual,
      bakimBitis: g.maintenanceUntil,
      gecerlilikBitis: g.validUntil ?? null,
    },
  });
  if (g.validUntil) await recordValidityAtBirthTx(tx, { installationDbId: inst.id, validUntil: g.validUntil, actor: g.actor });
  return hak;
}

export async function createEntitlement(g: Omit<CreateEntitlementInput, "nowMs"> & { nowMs?: number }): Promise<Hak> {
  const input: CreateEntitlementInput = { ...g, nowMs: g.nowMs ?? Date.now() };
  const row = await prisma.$transaction((tx) => createEntitlementTx(tx, input));
  await recordAudit({ event: "HAK_EKLENDI", entity: "Hak", entityId: row.id, actor: g.actor, summary: { lisansNo: row.lisansNo } });
  return row;
}

// ---------------------------------------------------------------- etkinleştirme kodu
// Biçim ve üretim protokolde tek kaynak (`generateActivationCode`, 16 karakter). Türü (`ilk` · `tasima`)
// kodun metninde değil burada: `tasima` kodu yalnız onaylanan talepten doğar (transfer.service).

export interface IssuedActivationCode {
  readonly code: string;
  readonly id: string;
  readonly expiresAt: Date;
  readonly codeTail: string;
  readonly kind: KodTuru;
}

export interface IssueActivationCodeInput {
  readonly installationDbId: string;
  readonly validDays?: number;
  readonly actor: string;
  readonly nowMs?: number;
  /** Varsayılan `ilk`; `tasima` yalnız onaylanan taşıma talebiyle (`transferRequestId`). */
  readonly kind?: KodTuru;
  readonly transferRequestId?: string;
}

/**
 * Kilit ALTINDA: kuruluma bağlı tek kullanımlık kod; önceki AKTİF kodlar iptal (tek açık kod).
 * Düz metin YALNIZ dönüşte vardır — DB'de sunucu sırlı HMAC + son 4 karakter (son 4 YALNIZ burada).
 * `ilk` kod: etkinleşmemiş ya da ETKİN kurulum (ETKİN'de yalnız aynı anahtarla yeniden etkinleştirir);
 * `tasima` kodu: yalnız ETKİN kurulum.
 */
export async function issueActivationCodeUnderLock(tx: Tx, ctx: VendorContext, g: IssueActivationCodeInput): Promise<IssuedActivationCode> {
  const nowMs = g.nowMs ?? Date.now();
  const kind: KodTuru = g.kind ?? "ilk";
  if ((kind === "tasima") !== (g.transferRequestId !== undefined)) throw new VendorError(500, "SUNUCU_HATASI", "Taşıma kodu yalnız taşıma talebiyle üretilir");
  const days = g.validDays ?? ctx.config.ETKINLESTIRME_KODU_GUN;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw badRequest("Kod geçerlilik günü 1–365 olmalı");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  const allowed = kind === "tasima" ? inst.durum === "ETKIN" : inst.durum === "ETKINLESMEDI" || inst.durum === "ETKIN";
  if (!inst.aktif || !allowed) throw stateConflict("Bu kurulum için etkinleştirme kodu üretilemez");
  const hak = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true } });
  if (!hak || hak.guncelSurum < 1) throw stateConflict("Önce kurulumun HAK'ı imzalanmalı");
  const code = generateActivationCode();
  await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  const created = await tx.etkinlestirmeKodu.create({
    data: {
      kurulumId: inst.id,
      kodOzeti: ctx.codeHasher.digest(code),
      kodSonu: code.slice(-4),
      tur: kind,
      tasimaTalebiId: g.transferRequestId ?? null,
      gecerlilikBitis: new Date(nowMs + days * DAY_MS),
      yapan: g.actor,
    },
  });
  return { code, id: created.id, expiresAt: created.gecerlilikBitis, codeTail: created.kodSonu, kind };
}

export async function createActivationCodeTx(
  tx: Tx,
  ctx: VendorContext,
  g: { installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<IssuedActivationCode> {
  await lockInstallation(tx, g.installationDbId);
  return issueActivationCodeUnderLock(tx, ctx, g);
}

export async function createActivationCode(
  ctx: VendorContext,
  g: { installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<{ code: string; id: string; expiresAt: Date }> {
  const created = await prisma.$transaction((tx) => createActivationCodeTx(tx, ctx, g));
  await recordAudit({ event: "ETKINLESTIRME_KODU", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { kodId: created.id, tur: created.kind } });
  return { code: created.code, id: created.id, expiresAt: created.expiresAt };
}
