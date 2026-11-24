// =============================================================================
// ATKI TASLAĞI — ürün penceresinden girilen atkının kart olarak doğuşu (B19, tek pencere kararı A)
// =============================================================================
// Kullanıcı kod/ad girmez: kart kodu = ürün kodu (doluysa "-2", "-3"…), adı = ürün adı (doluysa " (2)"…).
// İki yol, ikisi de TEK tx: (1) yeni ürün — `ItemService.create` kartı ürün satırından önce aynı tx'te yazar;
// (2) var olan ürün — `attachNewWeftSpecToItem`: ürün satırı FOR UPDATE → kart → atomik claim (beklenen kart).
// Ortak kartın kopyası (ayırma) burada DEĞİL, yalnız `forkWeftSpecForItem`.
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isUniqueViolation } from "./helpers/cost-input.helper";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { findWeftOverrideOrphans, throwWeftOverrideOrphan } from "./helpers/effective-construction.helper";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { parseWeftSpecContent, WEFT_SPEC_SELECT, type WeftSpecContent, type WeftSpecRow } from "./weft-spec.service";

const CODE_MAX = 32;
const NAME_MAX = 100;
const CANDIDATES = 20;

function withSuffix(base: string, suffix: string, max: number): string {
  return `${base.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

/** Üründen türeyen aday kodlar (sıra belirlenimli: replay aynı adayları görür). */
export function weftCodeCandidates(itemCode: string): string[] {
  return Array.from({ length: CANDIDATES }, (_, i) => (i === 0 ? itemCode.slice(0, CODE_MAX) : withSuffix(itemCode, `-${i + 1}`, CODE_MAX)));
}

function nameCandidates(itemName: string): string[] {
  return Array.from({ length: CANDIDATES }, (_, i) => (i === 0 ? itemName.slice(0, NAME_MAX) : withSuffix(itemName, ` (${i + 1})`, NAME_MAX)));
}

/** `POST /api/items` gövdesindeki `weftSpecDraft` — yoksa null; yalnız KUMAŞ, seçili kartla birlikte gelemez. */
export async function readItemWeftDraft(itemType: unknown, data: Record<string, unknown>): Promise<WeftSpecContent | null> {
  if (!Object.prototype.hasOwnProperty.call(data, "weftSpecDraft")) return null;
  const raw = data.weftSpecDraft;
  if (raw === null || raw === undefined) return null;
  if (itemType !== ItemType.FABRIC) throw AppError.badRequest("Atkı yalnız KUMAŞ kartına girilir", { code: "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY" });
  if (typeof data.weftSpecId === "string" && data.weftSpecId !== "") {
    throw AppError.badRequest("Atkı ya var olan karttan seçilir ya da yeni girilir — ikisi birden olmaz.", { code: "WEFT_DRAFT_WITH_CARD" });
  }
  if (typeof raw !== "object" || Array.isArray(raw)) throw AppError.badRequest("Atkı taslağı geçersiz.");
  return parseWeftSpecContent(raw as Record<string, unknown>);
}

/** Taslaktan kart — çağıranın tx'inde; boş ilk aday kod/ad seçilir. */
export async function createWeftSpecFromDraftTx(
  tx: Prisma.TransactionClient,
  draft: WeftSpecContent,
  owner: { itemCode: string; itemName: string },
  userId: string | null,
): Promise<{ id: string; code: string; name: string }> {
  const codes = weftCodeCandidates(owner.itemCode);
  const names = nameCandidates(owner.itemName);
  const taken = await tx.weftSpec.findMany({
    where: { OR: [{ code: { in: codes } }, { nameFold: { in: names.map(foldNameForCompare) } }] },
    select: { code: true, nameFold: true },
  });
  const code = codes.find((c) => !taken.some((t) => t.code === c));
  const name = names.find((n) => !taken.some((t) => t.nameFold === foldNameForCompare(n)));
  if (!code || !name) throw AppError.conflict("Bu kumaş için atkı kartı kodu üretilemedi — Desen Kartları'ndan elle açın.", { code: "WEFT_SPEC_DUPLICATE" });
  return tx.weftSpec.create({
    data: {
      ...(draft.scalars as Prisma.WeftSpecUncheckedCreateInput),
      code,
      name,
      sequenceCode: draft.sequenceCode,
      createdById: userId,
      updatedById: userId,
      yarns: { create: draft.yarns.map((y, i) => ({ yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat, sortOrder: i })) },
    },
    select: { id: true, code: true, name: true },
  });
}

export function logDraftWeftCreate(card: { id: string; code: string; name: string }, draft: WeftSpecContent, itemId: string, userId?: string | null): void {
  void AuditService.log({
    userId: userId ?? undefined,
    action: "CREATE",
    tableName: "WEFT_SPEC",
    recordId: card.id,
    newData: { code: card.code, name: card.name, sequenceCode: draft.sequenceCode, yarns: draft.yarns, forItemId: itemId, source: "ITEM_FORM" },
  });
}

/** Kayıtlı kart taslakla aynı içerikte mi (replay ölçütü). */
function sameContent(row: WeftSpecRow, draft: WeftSpecContent): boolean {
  if ((row.sequenceCode ?? null) !== draft.sequenceCode || row.yarns.length !== draft.yarns.length) return false;
  return row.yarns.every((y, i) => y.yarnItemId === draft.yarns[i]!.yarnItemId && y.picksInRepeat === draft.yarns[i]!.picksInRepeat);
}

export interface AttachInput { itemId: string; expectedWeftSpecId: string | null; weft: Record<string, unknown> }
export interface AttachResult { weftSpec: WeftSpecRow; itemId: string; replayed: boolean }

/** Var olan kumaşa yeni atkı kartı — kart + bağ tek tx; tekrar deneme (aynı içerik, türemiş kod) aynı kartı döner. */
export async function attachNewWeftSpecToItem(input: AttachInput, userId?: string): Promise<AttachResult> {
  const draft = await parseWeftSpecContent(input.weft);
  await assertItemUsable(prisma, input.itemId, "DEFINITION");
  let created: { id: string; code: string; name: string } | null = null;
  let replayId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; code: string; name: string; itemType: string; weftSpecId: string | null }>>`
        SELECT id, code, name, "itemType"::text AS "itemType", "weftSpecId" FROM items WHERE id = ${input.itemId}::uuid FOR UPDATE`;
      const item = rows[0];
      if (!item) throw AppError.notFound("Kumaş bulunamadı.");
      if (item.itemType !== ItemType.FABRIC) throw AppError.badRequest("Atkı yalnız KUMAŞ kartına girilir", { code: "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY" });
      if (item.weftSpecId !== input.expectedWeftSpecId) {
        const linked = item.weftSpecId ? await tx.weftSpec.findUnique({ where: { id: item.weftSpecId }, select: WEFT_SPEC_SELECT }) : null;
        if (linked && weftCodeCandidates(item.code).includes(linked.code) && sameContent(linked, draft)) {
          replayId = linked.id;
          return;
        }
        throw AppError.conflict(`${item.code} kumaşının atkı kartı bu arada değişti — pencereyi kapatıp yeniden açın.`, { code: "WEFT_SPEC_BINDING_CHANGED" });
      }
      const orphans = await findWeftOverrideOrphans(tx, { itemId: item.id }, draft.yarns.length);
      if (orphans.length > 0) throwWeftOverrideOrphan(orphans);
      created = await createWeftSpecFromDraftTx(tx, draft, { itemCode: item.code, itemName: item.name }, userId ?? null);
      const claim = await tx.item.updateMany({
        where: { id: item.id, weftSpecId: input.expectedWeftSpecId },
        data: { weftSpecId: created.id, updatedById: userId ?? null },
      });
      if (claim.count === 0) throw AppError.conflict("Kumaşın atkı kartı bu arada değişti — yeniden deneyin.", { code: "WEFT_SPEC_BINDING_CHANGED" });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Bu kod ya da adla bir atkı kartı zaten var.", { code: "WEFT_SPEC_DUPLICATE" });
    throw e;
  }
  const id = (created as { id: string } | null)?.id ?? replayId!;
  const weftSpec = await prisma.weftSpec.findUniqueOrThrow({ where: { id }, select: WEFT_SPEC_SELECT });
  if (created) {
    logDraftWeftCreate(created, draft, input.itemId, userId);
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM",
      recordId: input.itemId,
      oldData: { weftSpecId: input.expectedWeftSpecId },
      newData: { weftSpecId: id },
    });
  }
  return { weftSpec, itemId: input.itemId, replayed: !created };
}
