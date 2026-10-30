// =============================================================================
// CARİ KİLİDİ — koy / aç / listele (D4-I1a, ister 4.7; tasarım DALGA4 §10.5 md. 1–2)
// =============================================================================
// Satır DURUM + tarihçedir, defter değil: açmak `releasedAt` damgasıdır, yeniden kilit YENİ satırdır, hard delete
// yok. Hesap başına tek aktif kilit DB'de kısmi unique'tir (`cari_holds_active_cariId_key`); uygulamadaki ön
// okuma yalnız anlaşılır 409 içindir. Kapı yüklemi `helpers/cari-hold.helper.ts`te (bu dosya yazmaz/okutmaz).
// Bildirim (cari.kilitlendi / cari.kilit-acildi) D4-I5'in işi — burada yazılmaz.
// =============================================================================
import type { CariHold } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { activeHoldByCari, holdScopes, reasonLabel, type CariHoldReasonCode, type CariHoldScope } from "./helpers/cari-hold.helper";
import { readFinanceCariHoldReleaseBySamePerson } from "./system-setting.service";

const TABLE = "CARI_HOLD";

export interface PlaceCariHoldInput {
  blocksIntake: boolean;
  blocksShipment: boolean;
  blocksInvoice: boolean;
  reasonCode: CariHoldReasonCode;
  reasonText?: string | null;
  clientToken: string;
}

export interface CariHoldRow {
  id: string;
  cariId: string;
  scopes: CariHoldScope[];
  blocksIntake: boolean;
  blocksShipment: boolean;
  blocksInvoice: boolean;
  reasonCode: string;
  reasonLabel: string;
  reasonText: string | null;
  placedById: string;
  placedByName: string | null;
  createdAt: Date;
  releasedAt: Date | null;
  releasedById: string | null;
  releasedByName: string | null;
  releaseReason: string | null;
}

function toRow(h: CariHold, names: Map<string, string>): CariHoldRow {
  return {
    id: h.id,
    cariId: h.cariId,
    scopes: holdScopes(h),
    blocksIntake: h.blocksIntake,
    blocksShipment: h.blocksShipment,
    blocksInvoice: h.blocksInvoice,
    reasonCode: h.reasonCode,
    reasonLabel: reasonLabel(h.reasonCode),
    reasonText: h.reasonText,
    placedById: h.placedById,
    placedByName: names.get(h.placedById) ?? null,
    createdAt: h.createdAt,
    releasedAt: h.releasedAt,
    releasedById: h.releasedById,
    releasedByName: h.releasedById ? (names.get(h.releasedById) ?? null) : null,
    releaseReason: h.releaseReason,
  };
}

async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true, username: true } });
  return new Map(users.map((u) => [u.id, u.fullName || u.username]));
}

const placeReplay = (cariId: string, input: PlaceCariHoldInput) =>
  tokenReplay<CariHold, ApiResponse<CariHoldRow>>({
    find: (db, clientToken) => db.cariHold.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (!prior.releasedAt) return;
      throw AppError.conflict("Bu kilit konmuş ama sonra AÇILMIŞ — yeniden kilitlemek için formu kapatıp yeniden açın.", {
        code: "CARI_HOLD_RELEASED",
        holdId: prior.id,
      });
    },
    identity: (prior) => [
      { ad: "cariId", mevcut: prior.cariId, gelen: cariId },
      { ad: "kapsam", mevcut: holdScopes(prior).join(","), gelen: holdScopes(input).join(",") },
      { ad: "reasonCode", mevcut: prior.reasonCode, gelen: input.reasonCode },
    ],
    collision: "Bu istemci anahtarı FARKLI bir cari kilidi için kullanılmış. Formu kapatıp yeniden açın.",
    collisionEk: (prior) => ({ holdId: prior.id }),
    respond: async (prior) => ({
      success: true,
      data: toRow(prior, await userNames([prior.placedById, prior.releasedById])),
      message: "Cari kilidi zaten konmuş.",
    }),
  });

function holdExists(cariId: string): AppError {
  return AppError.conflict("Bu carinin zaten aktif bir kilidi var — kapsamı değiştirmek için önce mevcut kilidi açın.", {
    code: "CARI_HOLD_EXISTS",
    cariId,
  });
}

async function placeFresh(cariId: string, input: PlaceCariHoldInput, userId: string): Promise<ApiResponse<CariHoldRow>> {
  const cari = await prisma.cariAccount.findUnique({
    where: { id: cariId },
    select: {
      id: true,
      isActive: true,
      customerId: true,
      customer: { select: { name: true, isActive: true } },
      subcontractor: { select: { customerId: true, isActive: true } },
    },
  });
  if (!cari) throw AppError.notFound("Cari hesap bulunamadı.", { code: "CARI_ACCOUNT_NOT_FOUND" });
  // Kapı müşteri kartından çözülür (gelen belge, sipariş, sevk, satış faturası): kartı olmayan fason hesabına kilit anlamsız.
  if (!cari.customerId && !cari.subcontractor?.customerId) {
    throw AppError.badRequest("Cari kilidi yalnız müşteri kartına bağlı hesaba konur.", { code: "CARI_HOLD_NOT_CUSTOMER", cariId });
  }
  if (!cari.isActive || cari.customer?.isActive === false || cari.subcontractor?.isActive === false) {
    throw AppError.conflict("Pasif cariye kilit konmaz — önce cariyi/müşteriyi aktif edin.", { code: "CARI_INACTIVE", cariId });
  }
  if (await activeHoldByCari(prisma, cariId)) throw holdExists(cariId);

  let row: CariHold;
  try {
    row = await prisma.cariHold.create({
      data: {
        cariId,
        blocksIntake: input.blocksIntake,
        blocksShipment: input.blocksShipment,
        blocksInvoice: input.blocksInvoice,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText?.trim() || null,
        placedById: userId,
        clientToken: input.clientToken,
      },
    });
  } catch (e) {
    if (isClientTokenP2002(e)) throw e;
    // Ön okuma ile insert arasındaki yarışın kaybedeni: kısmi unique son hattır.
    if (p2002Mentions(e, /cari_holds_active_cariId_key|cariId/i)) throw holdExists(cariId);
    throw e;
  }
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: TABLE,
    recordId: row.id,
    newData: { cariId, kapsam: holdScopes(row), reasonCode: row.reasonCode, reasonText: row.reasonText },
  }).catch(() => undefined);
  return { success: true, data: toRow(row, await userNames([userId])), message: "Cari kilitlendi." };
}

export const cariHoldService = {
  /** POST /api/finance/cari/:id/holds — kilit koy; aynı `clientToken` → aynı satır (replay, tek boğaz). */
  async place(cariId: string, input: PlaceCariHoldInput, userId: string): Promise<ApiResponse<CariHoldRow>> {
    if (!input.blocksIntake && !input.blocksShipment && !input.blocksInvoice) {
      throw AppError.badRequest("Kilidin en az bir kapsamı seçilmeli (yeni iş kabulü, sevk ya da fatura onayı).", { code: "CARI_HOLD_SCOPE_EMPTY" });
    }
    return placeReplay(cariId, input).run(input.clientToken, () => placeFresh(cariId, input, userId));
  },

  /** POST /api/finance/cari/holds/:holdId/release — atomik claim (`releasedAt: null`); ikinci açma 409. */
  async release(holdId: string, reason: string, userId: string): Promise<ApiResponse<CariHoldRow>> {
    const hold = await prisma.cariHold.findUnique({ where: { id: holdId }, select: { id: true, cariId: true, placedById: true, releasedAt: true } });
    if (!hold) throw AppError.notFound("Cari kilidi bulunamadı.", { code: "CARI_HOLD_NOT_FOUND" });
    const notActive = () => AppError.conflict("Bu kilit zaten açılmış.", { code: "CARI_HOLD_NOT_ACTIVE", holdId });
    if (hold.releasedAt) throw notActive();
    if (hold.placedById === userId && (await readFinanceCariHoldReleaseBySamePerson()) === "DENY") {
      throw AppError.conflict(
        "Bu kilidi siz koydunuz; fabrika ayarı gereği kilidi açma yetkisi olan BAŞKA bir kişi açmalı.",
        { code: "CARI_HOLD_SAME_PERSON", holdId },
      );
    }
    const claimed = await prisma.cariHold.updateMany({
      where: { id: holdId, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: userId, releaseReason: reason.trim() },
    });
    if (claimed.count === 0) throw notActive();
    const row = await prisma.cariHold.findUniqueOrThrow({ where: { id: holdId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: holdId,
      oldData: { releasedAt: null },
      newData: { cariId: row.cariId, released: true, releaseReason: row.releaseReason },
    }).catch(() => undefined);
    return { success: true, data: toRow(row, await userNames([row.placedById, row.releasedById])), message: "Cari kilidi açıldı." };
  },

  /** GET /api/finance/cari/:id/holds — aktif kilit + tarihçe (yeniden eskiye). */
  async listByCari(cariId: string): Promise<ApiResponse<{ active: CariHoldRow | null; history: CariHoldRow[] }>> {
    const exists = await prisma.cariAccount.findUnique({ where: { id: cariId }, select: { id: true } });
    if (!exists) throw AppError.notFound("Cari hesap bulunamadı.", { code: "CARI_ACCOUNT_NOT_FOUND" });
    const rows = await prisma.cariHold.findMany({ where: { cariId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
    const names = await userNames(rows.flatMap((r) => [r.placedById, r.releasedById]));
    const active = await activeHoldByCari(prisma, cariId);
    const mapped = rows.map((r) => toRow(r, names));
    return { success: true, data: { active: active ? (mapped.find((r) => r.id === active.id) ?? null) : null, history: mapped } };
  },
};
