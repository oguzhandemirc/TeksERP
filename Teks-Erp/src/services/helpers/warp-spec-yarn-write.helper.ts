// =============================================================================
// ÇÖZGÜ KARTI İPLİK SATIRI YAZIMI (fason devere D3) — gövde doğrulama + replace
// =============================================================================
// Satır kümesi saf yapılandırma pivotudur (③b): REPLACE edilir, eski/yeni küme audit'e çağıran yazar.
// Kolonlar (`yarnItemId`, `endsCount`) satırların özetidir ve yalnız `warpSpecSummaryFromLines`ten türetilir.
// =============================================================================
import { ItemType, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertItemUsable } from "./item-usage.helper";
import { isKgYarnUnit } from "../../constants/yarn-unit";
import type { WarpSpecYarnLine } from "./warp-spec-yarn.helper";

/** Kartta en çok iplik satırı (talimatta A…T harfleri; hesap ucunun sınırıyla aynı). */
export const WARP_SPEC_MAX_YARNS = 20;
const MAX_ENDS = 1_000_000;
const SEQUENCE_NOTE_MAX = 160;

/** Kart ipliği olarak seçilebilir mi: İPLİK · kullanılabilir · denyesi dolu (devere formülünün çarpanı). */
export async function assertWarpYarnItem(yarnItemId: string): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: yarnItemId },
    select: { id: true, name: true, itemType: true, linearDensityDen: true, yarnPurchaseUnit: true },
  });
  if (!item) throw AppError.badRequest("Çözgü ipliği bulunamadı.");
  if (item.itemType !== ItemType.YARN) {
    throw AppError.badRequest(`"${item.name}" bir İPLİK kalemi değil — kumaş ya da sarf kalemi çözgü ipliği olamaz.`);
  }
  // Çözgü kartı karta yeni TANIM ekler (B) — "Tükenene kadar"/Pasif iplik seçilemez.
  await assertItemUsable(prisma, item.id, "DEFINITION");
  // SY-a: çözgü kg ile sarılır/düşülür — adet/metre ile alınan fantezi iplik çözgüye giremez.
  if (!isKgYarnUnit(item.yarnPurchaseUnit)) {
    throw AppError.badRequest(`"${item.name}" adet/metre ile alınan fantezi iplik — çözgü ipliği kg birimli olmalı.`, { code: "WARP_YARN_NON_KG_UNIT" });
  }
  if (item.linearDensityDen === null) {
    throw AppError.badRequest(
      `"${item.name}" kaleminin denye değeri boş. Devere hesabı (tel × denye × metre ÷ 9.000.000) ` +
        "denye olmadan yapılamaz — kalem kartından denyeyi girin.",
    );
  }
}

function parseEnds(v: unknown, row: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest(`${row}. iplik satırı: tel adedi sıfırdan büyük tam sayı olmalı.`);
  if (n > MAX_ENDS) throw AppError.badRequest(`${row}. iplik satırı: tel adedi çok büyük.`);
  return n;
}

/** Gövdedeki `yarns` dizisini doğrular; sıra = dizideki sıra (A, B, C…). İplik kartları SIRAYLA denetlenir. */
export async function parseWarpYarnRows(raw: unknown): Promise<WarpSpecYarnLine[]> {
  if (!Array.isArray(raw)) throw AppError.badRequest("İplik satırları liste olmalı.");
  if (raw.length === 0) throw AppError.badRequest("Çözgü kartında en az bir iplik satırı olmalı.");
  if (raw.length > WARP_SPEC_MAX_YARNS) throw AppError.badRequest(`Çözgü kartında en çok ${WARP_SPEC_MAX_YARNS} iplik satırı olabilir.`);
  const lines: WarpSpecYarnLine[] = raw.map((r: unknown, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw AppError.badRequest(`${i + 1}. iplik satırı geçersiz.`);
    const o = r as Record<string, unknown>;
    if (typeof o.yarnItemId !== "string" || o.yarnItemId.length === 0) throw AppError.badRequest(`${i + 1}. iplik satırı: iplik seçilmeli.`);
    return { yarnItemId: o.yarnItemId, endsCount: parseEnds(o.endsCount, i + 1), sortOrder: i };
  });
  if (new Set(lines.map((l) => l.yarnItemId)).size !== lines.length) {
    throw AppError.badRequest("Aynı iplik kartta iki satır olamaz — telleri tek satırda toplayın.");
  }
  for (const l of lines) await assertWarpYarnItem(l.yarnItemId);
  return lines;
}

/** `sequenceNote`: gönderilmemiş → dokunma; boş → null; ≤ 160 karakter metin. */
export function normalizeSequenceNote(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw AppError.badRequest("Dizilim notu metin olmalı.");
  const t = v.trim();
  if (t.length > SEQUENCE_NOTE_MAX) throw AppError.badRequest(`Dizilim notu en çok ${SEQUENCE_NOTE_MAX} karakter olabilir.`);
  return t === "" ? null : t;
}

/** Satır kümesini değiştirir (aynı tx); kolonlar bu kümenin özetiyle zaten yazılmış olmalı. */
export async function replaceWarpYarnRowsTx(tx: Prisma.TransactionClient, warpSpecId: string, lines: ReadonlyArray<WarpSpecYarnLine>): Promise<void> {
  await tx.warpSpecYarn.deleteMany({ where: { warpSpecId } });
  await tx.warpSpecYarn.createMany({
    data: lines.map((l, i) => ({ warpSpecId, yarnItemId: l.yarnItemId, endsCount: l.endsCount, sortOrder: i })),
  });
}

export async function readWarpYarnRows(warpSpecId: string): Promise<WarpSpecYarnLine[]> {
  return prisma.warpSpecYarn.findMany({
    where: { warpSpecId },
    select: { yarnItemId: true, endsCount: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
}

export function sameWarpYarnRows(a: ReadonlyArray<WarpSpecYarnLine>, b: ReadonlyArray<WarpSpecYarnLine>): boolean {
  return a.length === b.length && a.every((x, i) => x.yarnItemId === b[i]!.yarnItemId && x.endsCount === b[i]!.endsCount);
}
