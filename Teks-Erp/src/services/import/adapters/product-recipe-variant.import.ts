// İş emri şablonu adaptörünün VARYANT genişlemesi (SY-H2): varyant kodu + terbiye tarifesi kodu +
// atkı ipliği değişim satırı. Sütunlar boş bırakılırsa bugünkü davranış (dokunma) — eski dosyalar
// aynı sonucu verir. Atkı değişimi ③b pivottur (`replaceRecipeWeftOverrides`, REPLACE); dokuma
// modülü ve `warpspec:write` ister (ürün yapısı ucunun kapısının aynası).
import prisma from "../../../lib/prisma";
import { matchesPermission } from "../../../middlewares/rbac.middleware";
import { readDokumaEnabled, readProductionEnabled } from "../../system-setting.service";
import { normalizeFinishingRateCode, resolveActiveFinishingRate } from "../../finishing-rate.service";
import { replaceRecipeWeftOverrides } from "../../item-construction.service";
import { AppError } from "../../../utils/app-error";
import type { ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { cellText, encodeWeftChanges, parseWeftChangesCell, resolveYarnCode, setCanonical } from "./weaving-import.shared";

const WEFT_CHANGE_PERMISSION = "warpspec:write";
const VARIANT_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;

export const RECIPE_VARIANT_COLUMNS: ImportColumn[] = [
  { key: "variantCode", label: "Varyant Kodu", type: "text", maxLen: 16, help: "Ürün içinde tekil (ör. V01). Boş = varyantsız şablon.", example: "" },
  { key: "finishingRateCode", label: "Terbiye Tarifesi Kodu", type: "text", maxLen: 32, help: "Yürürlükteki terbiye tarifesinin kodu. Boş = ürün yapısının tarifesi.", example: "" },
  {
    key: "weftChanges",
    label: "Atkı İpliği Değişimi",
    type: "text",
    maxLen: 500,
    help: "Atkı kartı harfi = iplik kodu, noktalı virgülle (ör. C=PES-150-SİM). Yazılırsa liste DEĞİŞTİRİLİR. Dokuma modülü gerekir.",
    example: "",
  },
];

/** Mevcut şablonun varyant alanları — diff anahtarlarıyla aynı biçimde. */
export function existingVariantFields(r: {
  variantCode: string | null;
  finishingRateCode: string | null;
  weftYarnOverrides: Array<{ weftSortOrder: number; yarnItem: { code: string } }>;
}): Record<string, unknown> {
  return {
    variantCode: r.variantCode,
    finishingRateCode: r.finishingRateCode,
    weftChanges: encodeWeftChanges(r.weftYarnOverrides.map((o) => ({ sortOrder: o.weftSortOrder, code: o.yarnItem.code }))),
  };
}

export const VARIANT_SELECT = {
  variantCode: true,
  finishingRateCode: true,
  weftYarnOverrides: { select: { weftSortOrder: true, yarnItem: { select: { code: true } } }, orderBy: { weftSortOrder: "asc" as const } },
} as const;

export async function validateVariantFields(row: PreparedRow, ctx: ImportContext): Promise<void> {
  const v = row.values;
  if (typeof v.variantCode === "string") {
    const code = v.variantCode.trim().toUpperCase();
    if (!VARIANT_CODE_RE.test(code)) row.result.errors.push({ column: "variantCode", message: "Varyant kodu: harf, rakam, nokta, tire, alt çizgi; en çok 16 (ör. V01)." });
    else setCanonical(row, "variantCode", code);
  }
  if (typeof v.finishingRateCode === "string") {
    try {
      const code = normalizeFinishingRateCode(v.finishingRateCode);
      if (!(await resolveActiveFinishingRate(code))) {
        row.result.errors.push({ column: "finishingRateCode", message: `'${code}' kodlu yürürlükte bir terbiye tarifesi yok.` });
      } else setCanonical(row, "finishingRateCode", code);
    } catch (e) {
      row.result.errors.push({ column: "finishingRateCode", message: e instanceof AppError ? e.message : "Tarife kodu okunamadı." });
    }
  }
  if (v.weftChanges !== undefined) await validateWeftChanges(row, ctx);
}

async function validateWeftChanges(row: PreparedRow, ctx: ImportContext): Promise<void> {
  const column = "weftChanges";
  if (!ctx.permissions || !matchesPermission(ctx.permissions, "warpspec:write")) {
    row.result.errors.push({ column, message: `Atkı ipliği değişimi için '${WEFT_CHANGE_PERMISSION}' yetkisi de gerekli.` });
    return;
  }
  if (!((await readProductionEnabled()) && (await readDokumaEnabled()))) {
    row.result.errors.push({ column, message: "Atkı ipliği değişimi dokuma modülü kapalıyken yazılamaz." });
    return;
  }
  const text = cellText(row.values.weftChanges);
  if (text === null) {
    row.values.weftChanges__rows = [];
    setCanonical(row, column, null);
    return;
  }
  const parsed = parseWeftChangesCell(text);
  if (parsed.error) {
    row.result.errors.push({ column, message: parsed.error });
    return;
  }
  const itemId = (row.values.itemCode__id as string | null | undefined) ?? (row.existing ? await recipeItemId(row) : null);
  const card = itemId ? await weftCardYarns(itemId) : null;
  const rows: Array<{ weftSortOrder: number; yarnItemId: string }> = [];
  for (const p of parsed.pairs!) {
    const letter = String.fromCharCode(65 + p.sortOrder);
    if (card === null) {
      row.result.errors.push({ column, message: "Ürünün atkı kartı bağlı değil — atkı ipliği değişimi yazılamaz." });
      return;
    }
    if (!card.has(p.sortOrder)) {
      row.result.errors.push({ column, message: `Atkı kartında ${letter} sırası yok.` });
      continue;
    }
    const id = await resolveYarnCode(row, { column, code: p.code }, ctx);
    if (!id) continue;
    if (card.get(p.sortOrder) === id) row.result.errors.push({ column, message: `${letter} sırasının ipliği zaten '${p.code}' — değişim gerekmez.` });
    rows.push({ weftSortOrder: p.sortOrder, yarnItemId: id });
  }
  row.values.weftChanges__rows = rows;
  setCanonical(row, column, encodeWeftChanges(parsed.pairs!.map((p) => ({ sortOrder: p.sortOrder, code: canonicalCode(row, p.code) }))));
}

/** Kod büyük/küçük harf farkı değişiklik sayılmasın: mevcut kümede aynı kod varsa onun yazımı. */
function canonicalCode(row: PreparedRow, code: string): string {
  const prev = String(row.existing?.weftChanges ?? "");
  const hit = prev.split(";").map((p) => p.slice(2)).find((c) => c.toUpperCase() === code.toUpperCase());
  return hit ?? code;
}

async function recipeItemId(row: PreparedRow): Promise<string | null> {
  const r = await prisma.productRecipe.findUnique({ where: { id: row.result.targetId as string }, select: { itemId: true } });
  return r?.itemId ?? null;
}

async function weftCardYarns(itemId: string): Promise<Map<number, string> | null> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { weftSpec: { select: { yarns: { select: { sortOrder: true, yarnItemId: true } } } } },
  });
  if (!item?.weftSpec) return null;
  return new Map(item.weftSpec.yarns.map((y) => [y.sortOrder, y.yarnItemId]));
}

/** Şablon yazıldıktan SONRA değişim kümesi (yalnız hücre doluysa) — ③b replace. */
export async function writeWeftChanges(row: PreparedRow, recipeId: string, userId?: string): Promise<void> {
  const rows = row.values.weftChanges__rows as Array<{ weftSortOrder: number; yarnItemId: string }> | undefined;
  if (rows === undefined) return;
  await replaceRecipeWeftOverrides(recipeId, rows, userId);
}

export function variantPayload(row: PreparedRow, out: Record<string, unknown>): void {
  for (const k of ["variantCode", "finishingRateCode"]) if (row.values[k] !== undefined) out[k] = row.values[k];
}
