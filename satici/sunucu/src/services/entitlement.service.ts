// PORTAL TARAFI (bu dilimde JSON API'si yok; portal 1f'de bu fonksiyonları çağırır):
// Müşteri → Tesis → Kurulum → Hak, HAK sürümünün KÖK imzası (parola alt sürece stdin'den),
// tek kullanımlık etkinleştirme kodu. Kod kuruluma bağlı doğar; düz metni yalnız bir kez döner.
import { randomInt } from "node:crypto";
import type { HakSurumu, LisansSinifi } from "@prisma/client";
import {
  ActivationCodeSchema,
  ChannelCodeSchema,
  EntitlementSchema,
  ModuleKeySchema,
  TYP,
  UuidSchema,
  decodeDocument,
  verifyEntitlement,
  type EntitlementDoc,
} from "../lisans-protokol";
import { signWithWrappedKey } from "../keys/signer";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { lockInstallation, lockLicenseNumber } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { hashActivationCode } from "./activation.service";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";

const bad = (message: string): VendorError => new VendorError(400, "GOVDE_GECERSIZ", message);

export async function createCustomer(g: { name: string; taxNo?: string; actor: string }) {
  if (!g.name.trim()) throw bad("Müşteri adı zorunlu");
  const row = await prisma.musteri.create({ data: { ad: g.name.trim(), vergiNo: g.taxNo ?? null } });
  await recordAudit({ event: "MUSTERI_EKLENDI", entity: "Musteri", entityId: row.id, actor: g.actor });
  return row;
}

export async function createSite(g: { customerId: string; name: string; actor: string }) {
  if (!g.name.trim()) throw bad("Tesis adı zorunlu");
  const row = await prisma.tesis.create({ data: { musteriId: g.customerId, ad: g.name.trim() } });
  await recordAudit({ event: "TESIS_EKLENDI", entity: "Tesis", entityId: row.id, actor: g.actor });
  return row;
}

/** Kurulum, fabrikanın installationId'siyle doğar — HAK o kimliğe imzalanır. */
export async function createInstallation(g: {
  siteId: string;
  installationId: string;
  licenseClass: LisansSinifi;
  channelCode: string;
  name?: string;
  pollMinutes?: number;
  actor: string;
}) {
  if (!UuidSchema.safeParse(g.installationId).success) throw bad("Kurulum kimliği (installationId) UUID olmalı");
  if (!ChannelCodeSchema.safeParse(g.channelCode).success) throw bad("Kanal kodu biçimsiz");
  const row = await prisma.kurulum.create({
    data: {
      tesisId: g.siteId,
      kurulumId: g.installationId,
      sinif: g.licenseClass,
      kanalKodu: g.channelCode,
      ad: g.name ?? null,
      yoklamaAraligiDk: g.pollMinutes ?? 60,
    },
  });
  await recordAudit({ event: "KURULUM_EKLENDI", entity: "Kurulum", entityId: row.id, actor: g.actor, summary: { sinif: g.licenseClass } });
  return row;
}

function istanbulYear(nowMs: number): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date(nowMs)));
}

/** Hak doğar; lisans numarası (TKS-YYYY-NNNN) doğuşta, yıl sayacı kilidi altında materyalize edilir. */
export async function createEntitlement(g: {
  installationDbId: string;
  modules: readonly string[];
  perpetual: boolean;
  maintenanceUntil: Date;
  validUntil?: Date | null;
  actor: string;
  nowMs?: number;
}) {
  const modules = [...new Set(g.modules)];
  for (const m of modules) if (!ModuleKeySchema.safeParse(m).success) throw bad(`Modül anahtarı biçimsiz: ${m}`);
  const year = istanbulYear(g.nowMs ?? Date.now());
  const row = await prisma.$transaction(async (tx) => {
    await lockLicenseNumber(tx, year);
    const prefix = `TKS-${year}-`;
    const last = await tx.hak.findFirst({ where: { lisansNo: { startsWith: prefix } }, orderBy: { lisansNo: "desc" } });
    const next = last ? Number(last.lisansNo.slice(prefix.length)) + 1 : 1;
    if (next > 999_999) throw new VendorError(500, "SUNUCU_HATASI", "Lisans numarası uzayı doldu");
    return tx.hak.create({
      data: {
        kurulumId: g.installationDbId,
        lisansNo: `${prefix}${String(next).padStart(4, "0")}`,
        moduller: modules,
        kalici: g.perpetual,
        bakimBitis: g.maintenanceUntil,
        gecerlilikBitis: g.validUntil ?? null,
      },
    });
  });
  await recordAudit({ event: "HAK_EKLENDI", entity: "Hak", entityId: row.id, actor: g.actor, summary: { lisansNo: row.lisansNo } });
  return row;
}

/**
 * HAK'ın yeni sürümünü KÖK ile imzalar. Parola Buffer'ı imza alt sürecinin stdin'ine gider ve
 * sıfırlanır. İmzalanan belge çapaya karşı doğrulanmadan deftere yazılmaz (fabrika reddederdi).
 */
export async function issueEntitlementVersion(
  ctx: VendorContext,
  g: { entitlementId: string; password: Buffer; reason: string; actor: string; nowMs?: number },
): Promise<HakSurumu> {
  const reason = g.reason.trim();
  if (!reason) {
    g.password.fill(0);
    throw bad("HAK sürümü için sebep zorunlu");
  }
  const hak = await prisma.hak.findUnique({
    where: { id: g.entitlementId },
    include: { kurulum: { include: { tesis: { include: { musteri: true } } } } },
  });
  if (!hak || !hak.aktif) {
    g.password.fill(0);
    throw new VendorError(404, "GOVDE_GECERSIZ", "Hak bulunamadı");
  }
  const inst = hak.kurulum;
  const root = ctx.keys.rootFileFor(inst.sinif);
  if (!root) {
    g.password.fill(0);
    throw new VendorError(500, "SUNUCU_HATASI", `${inst.sinif} sınıfını imzalayacak (çapadaki) kök anahtar yok`);
  }
  const nowMs = g.nowMs ?? Date.now();
  const version = hak.guncelSurum + 1;
  const payload: EntitlementDoc = {
    v: 1,
    hakId: hak.id,
    surum: version,
    lisansNo: hak.lisansNo,
    musteri: { id: inst.tesis.musteri.id, ad: inst.tesis.musteri.ad },
    tesis: { id: inst.tesis.id, ad: inst.tesis.ad },
    kurulumId: inst.kurulumId,
    sinif: inst.sinif,
    moduller: hak.moduller,
    kalici: hak.kalici,
    bakimBitis: hak.bakimBitis.toISOString(),
    verilis: new Date(nowMs).toISOString(),
  };
  const checked = decodeDocument(EntitlementSchema, payload);
  if (!checked.ok) {
    g.password.fill(0);
    throw bad(`HAK şemaya uymuyor: ${checked.message}`);
  }
  const token = await signWithWrappedKey({ keyFile: root.path, typ: TYP.HAK, payload: checked.value, password: g.password });
  const verified = verifyEntitlement(token, ctx.keys.anchor);
  if (!verified.ok || verified.value.document.hakId !== hak.id || verified.value.document.surum !== version) {
    throw new VendorError(500, "SUNUCU_HATASI", "İmzalanan HAK güven çapasına karşı doğrulanamadı");
  }
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, inst.id);
    const claim = await tx.hak.updateMany({ where: { id: hak.id, guncelSurum: hak.guncelSurum }, data: { guncelSurum: version } });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "HAK bu arada başka bir sürümle imzalandı; yeniden deneyin");
    const created = await tx.hakSurumu.create({
      data: {
        hakId: hak.id,
        surum: version,
        belge: token,
        imzalayanKid: root.kid,
        verilis: new Date(nowMs),
        sebep: reason,
        yapan: g.actor,
      },
    });
    await notifyDoorbell(tx, inst.id, "lisans");
    return created;
  });
  await recordAudit({ event: "HAK_IMZALANDI", entity: "Hak", entityId: hak.id, actor: g.actor, summary: { surum: version, imzalayanKid: root.kid } });
  return row;
}

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateActivationCode(): string {
  let body = "";
  for (let i = 0; i < 12; i++) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const code = `TKS-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  return ActivationCodeSchema.parse(code);
}

/**
 * Kuruluma bağlı tek kullanımlık kod üretir; önceki AKTİF kodlar iptal olur (tek açık kod).
 * Düz metin YALNIZ dönüşte vardır — DB'de sha256 + son 4 karakter.
 */
export async function createActivationCode(
  ctx: VendorContext,
  g: { installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<{ code: string; id: string; expiresAt: Date }> {
  const nowMs = g.nowMs ?? Date.now();
  const days = g.validDays ?? ctx.config.ETKINLESTIRME_KODU_GUN;
  const code = generateActivationCode();
  const created = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
    if (inst.durum !== "ETKINLESMEDI" && inst.durum !== "ETKIN") throw bad("Bu kurulum için etkinleştirme kodu üretilemez");
    const hak = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true } });
    if (!hak || hak.guncelSurum < 1) throw bad("Önce kurulumun HAK'ı kök anahtarla imzalanmalı");
    await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
    return tx.etkinlestirmeKodu.create({
      data: {
        kurulumId: inst.id,
        kodOzeti: hashActivationCode(code),
        kodSonu: code.slice(-4),
        gecerlilikBitis: new Date(nowMs + days * 86_400_000),
        yapan: g.actor,
      },
    });
  });
  await recordAudit({ event: "ETKINLESTIRME_KODU", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { kodSonu: created.kodSonu } });
  return { code, id: created.id, expiresAt: created.gecerlilikBitis };
}
