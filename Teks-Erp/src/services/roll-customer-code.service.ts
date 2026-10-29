// =============================================================================
// MÜŞTERİ BARKODU — bağla / kaldır (D4-F1, DALGA4 §7.4–7.5; kararlar K11–K13)
// =============================================================================
// (A) Müşterinin önbasılı etiketi Tambur'da okutulup EMANET topa bağlanır. Eşleme DURUM kaydıdır
// (defter değil); yine de silinmez: değiştirme = `revoke` damgası + yeni bağlama. Tekillik DB'de
// (kısmi unique `revokedAt IS NULL`): müşteride aktif kod tekil · topta tek aktif kod. Okutmada
// kodu çözen TEK yer `helpers/roll-scan-resolve.helper.ts`dir; burada `code` ile okuma YAPILMAZ.
// =============================================================================

import { CustomerCodeSource, type RollCustomerCode } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import type { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { normalizeScanCode } from "../utils/code-format";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import { classifyScannedCode } from "./helpers/series-classifier.helper";
import { tokenReplay } from "./helpers/token-replay.helper";

const TABLE = "ROLL_CUSTOMER_CODE";

const bindSchema = z.strictObject({
  code: z.string({ error: "Müşteri barkodu zorunlu" }).trim().min(1, "Müşteri barkodu boş olamaz").max(64, "Müşteri barkodu en çok 64 karakter olabilir"),
  clientToken: z.uuid({ error: "clientToken geçerli bir UUID olmalı" }),
});
const revokeSchema = z.strictObject({
  reason: z.string({ error: "Kaldırma sebebi zorunlu" }).trim().min(3, "Kaldırma sebebi en az 3 karakter olmalı").max(300, "Kaldırma sebebi en çok 300 karakter olabilir"),
});

function assertRollId(rollId: string): void {
  if (!z.uuid().safeParse(rollId).success) throw AppError.notFound("Top bulunamadı", { rollId });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw AppError.badRequest(r.error.issues.map((i) => i.message).join(" · "), { code: "VALIDATION_ERROR", issues: r.error.issues });
  }
  return r.data;
}

/** Tek boğaz (R): ② aynı top + kod → kayıtlı satır · ③ başka yük → 409 · ④ kaldırılmış → 409. */
const bindReplay = (expect: { rollId: string; code: string }) =>
  tokenReplay<RollCustomerCode, ApiResponse<RollCustomerCode>>({
    find: (db, clientToken) => db.rollCustomerCode.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (prior.revokedAt) {
        throw AppError.conflict("Bu müşteri barkodu daha önce bağlanıp kaldırılmış — yeniden bağlamak için etiketi yeniden okutun.", {
          code: "CUSTOMER_CODE_REVOKED",
          customerCodeId: prior.id,
        });
      }
    },
    identity: (prior) => [
      { ad: "rollId", mevcut: prior.rollId, gelen: expect.rollId },
      { ad: "code", mevcut: prior.code, gelen: expect.code },
    ],
    collision: "Bu okutma kimliği başka bir top ya da kod için kullanılmış — etiketi yeniden okutun.",
    collisionEk: (prior) => ({ customerCodeId: prior.id }),
    respond: (prior) => ({ success: true, data: prior, message: "Müşteri barkodu zaten bağlı", idempotent: true }),
  });

async function bindFresh(rollId: string, code: string, clientToken: string, userId?: string): Promise<ApiResponse<RollCustomerCode>> {
  const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { id: true, barcode: true, status: true, ownerCustomerId: true } });
  if (!roll) throw AppError.notFound("Top bulunamadı", { rollId });
  if (!roll.ownerCustomerId) {
    throw AppError.badRequest("Müşteri barkodu yalnız müşteri malı (emanet) topa bağlanır — bu topun sahibi yok.", { code: "ROLL_NOT_EMANET", rollId });
  }
  if (roll.status === "CANCELLED") {
    throw AppError.badRequest("İptal edilmiş topa müşteri barkodu bağlanamaz.", { code: "ROLL_CANCELLED", rollId });
  }
  // Bizim kodumuzla çakışan kod okutmayı bozar (iç barkod hep önce kazanır) — bağlanmaz.
  const ours = classifyScannedCode(code);
  const sameBarcode = ours ? null : await prisma.roll.findUnique({ where: { barcode: code }, select: { id: true } });
  if (ours || sameBarcode) {
    throw AppError.conflict(`"${code}" bizim barkod biçimimizle çakışıyor — müşteri barkodu olarak bağlanamaz.`, {
      code: "CUSTOMER_CODE_COLLIDES",
      scannedCode: code,
      ...(ours ? { series: ours.kind } : { rollId: sameBarcode!.id }),
    });
  }
  let row: RollCustomerCode;
  try {
    row = await prisma.rollCustomerCode.create({
      data: {
        rollId, customerId: roll.ownerCustomerId, code, source: CustomerCodeSource.BOUND_LABEL,
        clientToken, createdById: userId ?? null,
      },
    });
  } catch (e) {
    if (isClientTokenP2002(e)) throw e;
    if (p2002Mentions(e, /roll_customer_codes_customer_code_active_uq|customerId/i)) {
      throw AppError.conflict(`"${code}" bu müşteride başka bir topa bağlı — önce o topun kodunu kaldırın.`, { code: "CUSTOMER_CODE_TAKEN", scannedCode: code });
    }
    if (p2002Mentions(e, /roll_customer_codes_roll_active_uq|rollId/i)) {
      throw AppError.conflict("Bu topun zaten bir müşteri barkodu var — değiştirmek için önce kaldırın.", { code: "ROLL_CUSTOMER_CODE_EXISTS", rollId });
    }
    throw e;
  }
  await AuditService.log({
    userId, action: "CREATE", tableName: TABLE, recordId: row.id,
    newData: { rollId, rollBarcode: roll.barcode, customerId: row.customerId, code, source: row.source },
  }).catch(() => undefined);
  return { success: true, data: row, message: "Müşteri barkodu bağlandı" };
}

export class RollCustomerCodeService {
  /** POST /api/rolls/:id/customer-code — (A) önbasılı müşteri etiketini topa bağlar; `clientToken` zorunlu. */
  static async bind(rollId: string, body: unknown, userId?: string): Promise<ApiResponse<RollCustomerCode>> {
    assertRollId(rollId);
    const input = parse(bindSchema, body);
    const code = normalizeScanCode(input.code);
    return bindReplay({ rollId, code }).run(input.clientToken, () => bindFresh(rollId, code, input.clientToken, userId));
  }

  /** POST /api/rolls/:id/customer-code/revoke — aktif kodu damgalar (atomik claim; sebep zorunlu). Satır silinmez. */
  static async revoke(rollId: string, body: unknown, userId?: string): Promise<ApiResponse<{ id: string; code: string }>> {
    assertRollId(rollId);
    const input = parse(revokeSchema, body);
    const active = await prisma.rollCustomerCode.findFirst({ where: { rollId, revokedAt: null }, select: { id: true, code: true, customerId: true } });
    if (!active) throw AppError.conflict("Bu topun aktif müşteri barkodu yok.", { code: "CUSTOMER_CODE_NOT_ACTIVE", rollId });
    const claimed = await prisma.rollCustomerCode.updateMany({
      where: { id: active.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: input.reason },
    });
    if (claimed.count === 0) throw AppError.conflict("Müşteri barkodu az önce kaldırılmış — sayfayı yenileyin.", { code: "CUSTOMER_CODE_NOT_ACTIVE", rollId });
    await AuditService.log({
      userId, action: "UPDATE", tableName: TABLE, recordId: active.id,
      oldData: { revokedAt: null }, newData: { rollId, customerId: active.customerId, code: active.code, revoked: true, reason: input.reason },
    }).catch(() => undefined);
    return { success: true, data: { id: active.id, code: active.code }, message: "Müşteri barkodu kaldırıldı" };
  }
}
