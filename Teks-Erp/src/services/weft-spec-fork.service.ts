// =============================================================================
// ATKI KARTI — "BU DESENE ÖZEL KOPYA" (Seyitoğlu SY-P3; tasarım §2.8, §2.9 risk 1)
// =============================================================================
// Ortak atkı kartı birden çok kumaşta (desen no = kumaş kodu, K1) kullanılıyorsa kart kopyalanır ve
// YALNIZ istenen kumaşın bağı yeni karta çevrilir; diğer kumaşlar ve açık dokuma iş emirleri eski kartta
// kalır. Tek tx: kaynak kart satırı FOR UPDATE (kart yazıcılarıyla aynı kilit) → kopya → atomik claim
// (`items.weftSpecId = kaynak` beklenen durum; 0 satır → 409, tx geri).
// İDEMPOTENCY (migration'sız): kopyanın kodu doğal anahtardır (`weft_specs.code @unique`). Aynı kod zaten
// bu kumaşa bağlı kartsa istek önceki denemenin tekrarıdır → aynı kart döner (`replayed: true`); başka
// her durumda kod mükerrer 409.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isUniqueViolation, parseTextField } from "./helpers/cost-input.helper";
import { WEFT_SPEC_SELECT, type WeftSpecRow } from "./weft-spec.service";

export interface WeftSpecForkInput {
  itemId: string;
  code: unknown;
  name: unknown;
}

export interface WeftSpecForkResult {
  weftSpec: WeftSpecRow;
  itemId: string;
  previousWeftSpecId: string;
  replayed: boolean;
}

type ForkOutcome = { kind: "replay"; id: string } | { kind: "created"; id: string; yarnCount: number };

function requiredText(raw: unknown, label: string, max: number): string {
  const v = parseTextField(raw, label, max);
  if (!v) throw AppError.badRequest(`${label} zorunludur.`);
  return v;
}

async function forkInTx(tx: Prisma.TransactionClient, sourceId: string, itemId: string, code: string, name: string, userId: string | null): Promise<ForkOutcome> {
  // Kaynak kart satırı kilidi — kart güncellemesi ve varyant değişimi yazıcısı aynı satırı bekler;
  // eşzamanlı iki kopya isteği burada sıraya girer (ikincisi kullanım sayısını güncel okur).
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM weft_specs WHERE id = ${sourceId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw AppError.notFound("Atkı kartı bulunamadı.");

  const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, code: true, weftSpecId: true } });
  if (!item) throw AppError.notFound("Kumaş bulunamadı.");
  const existing = await tx.weftSpec.findUnique({ where: { code }, select: { id: true } });
  if (existing) {
    if (item.weftSpecId === existing.id) return { kind: "replay", id: existing.id };
    throw AppError.conflict("Bu kodla bir atkı kartı zaten var — kopyaya başka bir kod verin.", { code: "WEFT_SPEC_DUPLICATE" });
  }
  if (item.weftSpecId !== sourceId) {
    throw AppError.conflict(`${item.code} kumaşı artık bu atkı kartına bağlı değil — sayfayı yenileyin.`, { code: "WEFT_SPEC_BINDING_CHANGED" });
  }
  const users = await tx.item.count({ where: { weftSpecId: sourceId } });
  if (users < 2) {
    throw AppError.conflict("Bu atkı kartı yalnız bu kumaşta kullanılıyor — özel kopyaya gerek yok.", { code: "WEFT_SPEC_NOT_SHARED", users });
  }

  const source = await tx.weftSpec.findUniqueOrThrow({
    where: { id: sourceId },
    select: { picksPerCm: true, sequenceNote: true, sequenceCode: true, weftProgramNo: true, notes: true, yarns: { select: { yarnItemId: true, picksInRepeat: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } },
  });
  // Sıra (sortOrder) aynen korunur: varyant atkı değişimleri sıraya bağlıdır, yeni kartta da geçerli kalır.
  const created = await tx.weftSpec.create({
    data: {
      code,
      name,
      picksPerCm: source.picksPerCm,
      sequenceNote: source.sequenceNote,
      sequenceCode: source.sequenceCode,
      weftProgramNo: source.weftProgramNo,
      notes: source.notes,
      createdById: userId,
      updatedById: userId,
      yarns: { create: source.yarns.map((y) => ({ yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat, sortOrder: y.sortOrder })) },
    },
    select: { id: true },
  });
  const claim = await tx.item.updateMany({ where: { id: itemId, weftSpecId: sourceId }, data: { weftSpecId: created.id, updatedById: userId } });
  if (claim.count === 0) {
    throw AppError.conflict(`${item.code} kumaşı artık bu atkı kartına bağlı değil — sayfayı yenileyin.`, { code: "WEFT_SPEC_BINDING_CHANGED" });
  }
  return { kind: "created", id: created.id, yarnCount: source.yarns.length };
}

/** Atkı kartını kopyalar ve YALNIZ `itemId` kumaşının bağını kopyaya çevirir (SY-P3). */
export async function forkWeftSpecForItem(sourceId: string, input: WeftSpecForkInput, userId?: string): Promise<WeftSpecForkResult> {
  const code = requiredText(input.code, "Atkı kartı kodu", 32);
  const name = requiredText(input.name, "Atkı kartı adı", 100);
  let outcome: ForkOutcome;
  try {
    outcome = await prisma.$transaction((tx) => forkInTx(tx, sourceId, input.itemId, code, name, userId ?? null));
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir atkı kartı zaten var.", { code: "WEFT_SPEC_DUPLICATE" });
    throw e;
  }
  const weftSpec = await prisma.weftSpec.findUniqueOrThrow({ where: { id: outcome.id }, select: WEFT_SPEC_SELECT });
  if (outcome.kind === "created") {
    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WEFT_SPEC",
      recordId: weftSpec.id,
      newData: { code: weftSpec.code, name: weftSpec.name, copiedFromWeftSpecId: sourceId, forItemId: input.itemId, yarnCount: outcome.yarnCount },
    });
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM",
      recordId: input.itemId,
      oldData: { weftSpecId: sourceId },
      newData: { weftSpecId: weftSpec.id },
    });
  }
  return { weftSpec, itemId: input.itemId, previousWeftSpecId: sourceId, replayed: outcome.kind === "replay" };
}
