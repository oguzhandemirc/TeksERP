// =============================================================================
// TeksERP — MAKİNE KARTI (toplayıcı) KİMLİĞİ · kayıt · sır yenileme · iptal · kapsam
// =============================================================================
// Kart paneldeki yöneticinin kaydıyla doğar (duyuru/onay akışı yok): ad, kart tipi, bağlı tezgahlar.
// Sır yalnız kayıtta ve yenilemede BİR KEZ döner; DB'de yalnız tohum durur (`collector-secret.helper`).
// Okuma yüzeyi OPT-IN izdüşümdür (`COLLECTOR_PUBLIC_SELECT`) — tohum hiçbir yanıta, log'a, audit'e girmez.
// İptal bir durum geçişidir (`revokedAt` damgası); kapsam satırları (③b pivot) iptalde ve PATCH'te
// değiştirilir, değişiklik audit'e yazılır. Bir tezgahın TEK kartı olur (`machineId` UNIQUE → 409).
// Kayıt `clientToken` replay'i dört durumludur (`collectorReplay`, tek boğaz) ama SIRRI YENİDEN DÖNMEZ:
// tohumdan türetmek mümkün olsa da sır yalnız ilk cevapta yaşar — replay "kayıtlı, sırrı yenileyin" der.
// =============================================================================
import { DeviceStatus, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import { requireKeyRing } from "./short-credential.service";
import { COLLECTOR_TYPE_RE } from "./machine-stop-code-map.service";
import { deriveCollectorSecret, newCollectorSeed } from "./helpers/collector-secret.helper";
import { assertCollectorReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
import type { ApiResponse } from "../types/api.types";

const TABLE = "MACHINE_COLLECTOR";

export const COLLECTOR_PUBLIC_SELECT = {
  id: true,
  name: true,
  collectorType: true,
  status: true,
  isActive: true,
  secretIssuedAt: true,
  lastSeenAt: true,
  silentSince: true,
  revokedAt: true,
  revokedById: true,
  createdAt: true,
  updatedAt: true,
  machines: { select: { machine: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.MachineCollectorSelect;

export type CollectorDto = Prisma.MachineCollectorGetPayload<{ select: typeof COLLECTOR_PUBLIC_SELECT }>;

/** Sır yanıtı — düz sır YALNIZ bu tipte ve yalnız kayıt/yenileme cevabında taşınır. */
export interface CollectorWithSecret {
  collector: CollectorDto;
  /** 64 hex (32 bayt) — kart imza anahtarı; bir daha gösterilmez. */
  secret: string;
}

/** Kayıt replay'i (aynı `clientToken`): kart zaten kayıtlı, sır GÖSTERİLEMEZ — panel sır yenilemeye yönlendirir. */
export interface CollectorSecretWithheld {
  collector: CollectorDto;
  secret: null;
  secretWithheld: true;
}

/** `idempotent: true` = bu çağrıda kart DOĞMADI (istemci metne değil bayrağa bakar). */
export type CollectorCreateResult = ApiResponse<CollectorWithSecret | CollectorSecretWithheld> & { idempotent?: true };

export const COLLECTOR_REPLAY_MESSAGE = "Kart zaten kayıtlı (yeniden gönderim) — sır yalnız ilk kayıtta gösterilir; kartı kurmak için sırrı yenileyin.";

const typeField = z.string().trim().regex(COLLECTOR_TYPE_RE, "Kart tipi büyük harf, rakam ve . _ - ile en çok 32 karakter olmalı (örn. TEKS-ESP32-V1).");
const machinesField = z.array(z.string().uuid("Tezgah kimliği geçersiz.")).max(64, "Bir karta en çok 64 tezgah bağlanır.");

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Kart adı zorunlu.").max(100, "Kart adı en çok 100 karakter olabilir."),
    collectorType: typeField,
    machineIds: machinesField.min(1, "Karta en az bir tezgah bağlanmalı."),
    clientToken: z.string().uuid("İstemci jetonu geçersiz.").nullish(),
  })
  .strict();
type CreateInput = z.infer<typeof createSchema>;

const updateSchema = z
  .object({
    name: z.string().trim().min(1, "Kart adı zorunlu.").max(100, "Kart adı en çok 100 karakter olabilir.").optional(),
    collectorType: typeField.optional(),
    machineIds: machinesField.min(1, "Karta en az bir tezgah bağlanmalı.").optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw AppError.badRequest(r.error.issues.map((i) => i.message).join(" · "), { code: "VALIDATION_ERROR", issues: r.error.issues });
  }
  return r.data;
}

function translateP2002(e: unknown): never {
  if (p2002Mentions(e, /machineId|machine_collector_machines/i)) {
    throw AppError.conflict("Seçilen tezgahlardan biri başka bir karta bağlı — bir tezgahın tek kartı olur.", { code: "MACHINE_ALREADY_LINKED" });
  }
  if (p2002Mentions(e, /nameFold|name/i)) {
    throw AppError.conflict("Bu adla kayıtlı bir kart zaten var.", { code: "COLLECTOR_NAME_TAKEN" });
  }
  throw e;
}

async function assertMachinesUsable(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))];
  const rows = await tx.machine.findMany({ where: { id: { in: unique } }, select: { id: true, isActive: true } });
  if (rows.length !== unique.length) throw AppError.badRequest("Seçilen tezgahlardan biri bulunamadı.", { code: "MACHINE_NOT_FOUND" });
  if (rows.some((r) => !r.isActive)) throw AppError.badRequest("Pasif tezgah karta bağlanamaz.", { code: "MACHINE_INACTIVE" });
  return unique;
}

function secretHex(ringSecret: Buffer | null): string {
  if (!ringSecret) throw new AppError("Kart sırrı üretilemedi (anahtar halkası).", 503, true, { code: "SHORT_CREDENTIAL_KEY_UNAVAILABLE" });
  return ringSecret.toString("hex");
}

// Kimlik kapısı `===` kıyaslar (dizi değil): küme sıralı metne indirilir — sıra farkı aynı yüktür.
const sortedIds = (ids: readonly string[]) => [...new Set(ids.map((i) => i.toLowerCase()))].sort().join(",");

/** Tek boğaz (R): ② aynı yük → kart + `secretWithheld` (sır YOK) · ③ başka yük → 409 · ④ iptal edilmiş → 409. */
const collectorReplay = (input: CreateInput) =>
  tokenReplay<CollectorDto, CollectorCreateResult>({
    find: (db, clientToken) => db.machineCollector.findUnique({ where: { clientToken }, select: COLLECTOR_PUBLIC_SELECT }),
    alive: assertCollectorReplayAlive,
    identity: (p) => [
      { ad: "name", mevcut: p.name, gelen: input.name },
      { ad: "collectorType", mevcut: p.collectorType, gelen: input.collectorType },
      { ad: "machineIds", mevcut: sortedIds(p.machines.map((m) => m.machine.id)), gelen: sortedIds(input.machineIds) },
    ],
    collision: "Bu form daha önce başka bir kart için kaydedilmiş — yeni kart için formu yeniden açın.",
    collisionEk: (p) => ({ collectorId: p.id }),
    respond: (p) => ({ success: true, data: { collector: p, secret: null, secretWithheld: true }, message: COLLECTOR_REPLAY_MESSAGE, idempotent: true }),
  });

/** Kayıt — kart ONAYLI doğar (yönetici kaydıdır); sır yalnız bu cevapta. */
async function createCollectorFresh(input: CreateInput, userId?: string): Promise<ApiResponse<CollectorWithSecret>> {
  const ring = requireKeyRing();
  const id = randomUUID();
  const seed = newCollectorSeed(ring.active);
  let collector: CollectorDto;
  try {
    collector = await prisma.$transaction(async (tx) => {
      const machineIds = await assertMachinesUsable(tx, input.machineIds);
      await tx.machineCollector.create({
        data: {
          id, collectorKey: randomUUID(), name: input.name, collectorType: input.collectorType,
          status: DeviceStatus.APPROVED, secretSeed: seed, secretIssuedAt: new Date(),
          clientToken: input.clientToken ?? null, createdById: userId ?? null, updatedById: userId ?? null,
        },
      });
      await tx.machineCollectorLink.createMany({ data: machineIds.map((machineId) => ({ collectorId: id, machineId })) });
      return tx.machineCollector.findUniqueOrThrow({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
    });
  } catch (e) {
    translateP2002(e);
  }
  await AuditService.log({
    userId, action: "CREATE", tableName: TABLE, recordId: id,
    newData: { name: collector.name, collectorType: collector.collectorType, machineIds: collector.machines.map((m) => m.machine.id), secretIssued: true },
  }).catch(() => undefined);
  return { success: true, data: { collector, secret: secretHex(deriveCollectorSecret(ring, id, seed)) }, message: "Kart kaydedildi — sır yalnız şimdi gösterilir" };
}

export class MachineCollectorService {
  static async list(): Promise<ApiResponse<CollectorDto[]>> {
    const data = await prisma.machineCollector.findMany({ select: COLLECTOR_PUBLIC_SELECT, orderBy: { createdAt: "asc" } });
    return { success: true, data };
  }

  static async get(id: string): Promise<ApiResponse<CollectorDto>> {
    const data = await prisma.machineCollector.findUnique({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
    if (!data) throw AppError.notFound("Kart bulunamadı", { collectorId: id });
    return { success: true, data };
  }

  /** Kayıt; `clientToken`lı tekrar boğazdan döner (sırsız). Token'sız eski istemci bugünkü yoldan geçer. */
  static async create(body: unknown, userId?: string): Promise<CollectorCreateResult> {
    const input = parse(createSchema, body);
    return collectorReplay(input).run(input.clientToken, () => createCollectorFresh(input, userId));
  }

  /** Ad · kart tipi · bağlı tezgahlar. Tezgah listesi verilirse kapsam YERİNE KONUR (③b). */
  static async update(id: string, body: unknown, userId?: string): Promise<ApiResponse<CollectorDto>> {
    const input = parse(updateSchema, body);
    let before: CollectorDto;
    let after: CollectorDto;
    try {
      ({ before, after } = await prisma.$transaction(async (tx) => {
        const cur = await tx.machineCollector.findUnique({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
        if (!cur) throw AppError.notFound("Kart bulunamadı", { collectorId: id });
        const claim = await tx.machineCollector.updateMany({
          where: { id, revokedAt: null },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.collectorType !== undefined ? { collectorType: input.collectorType } : {}),
            updatedById: userId ?? null,
          },
        });
        if (claim.count === 0) throw AppError.conflict("İptal edilmiş kart değiştirilemez.", { code: "COLLECTOR_REVOKED" });
        if (input.machineIds) {
          const machineIds = await assertMachinesUsable(tx, input.machineIds);
          await tx.machineCollectorLink.deleteMany({ where: { collectorId: id } });
          await tx.machineCollectorLink.createMany({ data: machineIds.map((machineId) => ({ collectorId: id, machineId })) });
        }
        return { before: cur, after: await tx.machineCollector.findUniqueOrThrow({ where: { id }, select: COLLECTOR_PUBLIC_SELECT }) };
      }));
    } catch (e) {
      translateP2002(e);
    }
    const ids = (d: CollectorDto) => d.machines.map((m) => m.machine.id);
    await AuditService.log({
      userId, action: "UPDATE", tableName: TABLE, recordId: id,
      changes: [
        { field: "name", old: before.name, new: after.name },
        { field: "collectorType", old: before.collectorType, new: after.collectorType },
        { field: "machineIds", old: ids(before), new: ids(after) },
      ].filter((c) => JSON.stringify(c.old) !== JSON.stringify(c.new)),
    }).catch(() => undefined);
    return { success: true, data: after, message: "Kart güncellendi" };
  }

  /** Sır yenileme — eski sır o an geçersizleşir; yeni sır yalnız bu cevapta. */
  static async rotateSecret(id: string, userId?: string): Promise<ApiResponse<CollectorWithSecret>> {
    const ring = requireKeyRing();
    const seed = newCollectorSeed(ring.active);
    const claim = await prisma.machineCollector.updateMany({
      where: { id, revokedAt: null },
      data: { secretSeed: seed, secretIssuedAt: new Date(), updatedById: userId ?? null },
    });
    if (claim.count === 0) {
      const exists = await prisma.machineCollector.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw AppError.notFound("Kart bulunamadı", { collectorId: id });
      throw AppError.conflict("İptal edilmiş kartın sırrı yenilenemez — yeni kart kaydedin.", { code: "COLLECTOR_REVOKED" });
    }
    const collector = await prisma.machineCollector.findUniqueOrThrow({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
    await AuditService.log({
      userId, action: "UPDATE", tableName: TABLE, recordId: id,
      changes: [{ field: "secretIssuedAt", old: null, new: collector.secretIssuedAt }],
    }).catch(() => undefined);
    return { success: true, data: { collector, secret: secretHex(deriveCollectorSecret(ring, id, seed)) }, message: "Kart sırrı yenilendi — yeni sır yalnız şimdi gösterilir" };
  }

  /** İptal — durum geçişi; kart artık imza atamaz, tezgahları başka karta bağlanabilir. */
  static async revoke(id: string, userId?: string): Promise<ApiResponse<CollectorDto>> {
    const { before, after } = await prisma.$transaction(async (tx) => {
      const cur = await tx.machineCollector.findUnique({ where: { id }, select: COLLECTOR_PUBLIC_SELECT });
      if (!cur) throw AppError.notFound("Kart bulunamadı", { collectorId: id });
      const claim = await tx.machineCollector.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: userId ?? null, isActive: false, updatedById: userId ?? null },
      });
      if (claim.count === 0) throw AppError.conflict("Kart zaten iptal edilmiş.", { code: "COLLECTOR_REVOKED" });
      await tx.machineCollectorLink.deleteMany({ where: { collectorId: id } });
      return { before: cur, after: await tx.machineCollector.findUniqueOrThrow({ where: { id }, select: COLLECTOR_PUBLIC_SELECT }) };
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: TABLE, recordId: id,
      changes: [
        { field: "revokedAt", old: null, new: after.revokedAt },
        { field: "machineIds", old: before.machines.map((m) => m.machine.id), new: [] },
      ],
    }).catch(() => undefined);
    return { success: true, data: after, message: "Kart iptal edildi" };
  }
}
