// =============================================================================
// TON GRUBU (shade sorting, 2026-11-23) — tek helper: biçim · karışım yüklemi · önizleme · sevk kapısı
// =============================================================================
// Boyamadan dönen kumaş aynı renkte görünse de ton farkı taşır; fabrika topa ton harfi verir (`Roll.shadeCode`).
// KARIŞIM: aynı sevk kümesinde aynı (itemId, colorId) → ≥2 FARKLI ton. Tahsis (`SackAllocation`) sevk ANINDA
// doğduğu ve kumaş+renk tahsiste KESİN olduğu için aynı sipariş satırına düşebilecek küme budur; önizleme
// tahsisten önce koşar. Tonsuz (NULL) top karışım sayılmaz (bilinmeyen ≠ farklı).
// Sevk önizlemesi (`previewShadeMixes`) ve kapı (`assertShadeMixAllowedTx`) AYNI `findShadeMixes`i okur.
// Kural `shipping.shadeMixPolicy`: off (default, bugünkü) · warn (yalnız önizleme) · block (409 SHADE_MIX).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { sequentialTx } from "./tx-sequential-relations.helper";
import { readShippingShadeMixPolicy } from "../system-setting.service";
import type { ShippingShadeMixPolicy } from "../system-setting.service";

type Tx = Prisma.TransactionClient;

/** DB CHECK `rolls_shade_code_format_chk` ile birebir. */
export const SHADE_CODE_RE = /^[A-Z0-9]{1,4}$/;
export const SHADE_CODE_MAX = 4;
/** Liste filtresinde "tonsuz" seçeneği (top listesi `shadeCode=__none__`). */
export const SHADE_FILTER_NONE = "__none__";

/**
 * Ham girdiyi ton koduna çevirir: trim + ASCII büyük harf (Türkçe yerel büyütme YOK: "i" → "I").
 * `null`/`undefined`/boş → null (tonu kaldır). Geçersiz biçim → 400.
 */
export function normalizeShadeCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw AppError.badRequest("Ton kodu metin olmalı (ör. A, B, C)");
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const upper = trimmed.replace(/[a-z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 32));
  if (!SHADE_CODE_RE.test(upper)) {
    throw AppError.badRequest("Ton kodu 1–4 karakter, yalnız harf (A–Z) ya da rakam olmalı (ör. A, B, A2)", {
      code: "SHADE_CODE_INVALID",
    });
  }
  return upper;
}

export interface ShadeRollRow {
  id: string;
  barcode: string | null;
  itemId: string;
  colorId: string | null;
  shadeCode: string | null;
  itemName?: string | null;
  colorName?: string | null;
}

export interface ShadeMixGroup {
  itemId: string;
  colorId: string | null;
  itemName: string | null;
  colorName: string | null;
  /** Gruptaki farklı tonlar (alfabetik). */
  shades: string[];
  /** Ton → barkodlar (etkilenen HER top listelenir). */
  rollsByShade: Record<string, string[]>;
  /** Aynı gruptaki tonsuz toplar (bilgi; karışım sayılmaz). */
  unshadedBarcodes: string[];
}

/** SAF karışım yüklemi — DB'siz birim testli; `findShadeMixes` bunu çağırır. */
export function groupShadeMixes(rows: readonly ShadeRollRow[]): ShadeMixGroup[] {
  const groups = new Map<string, ShadeMixGroup>();
  for (const r of rows) {
    const key = `${r.itemId}|${r.colorId ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { itemId: r.itemId, colorId: r.colorId, itemName: r.itemName ?? null, colorName: r.colorName ?? null, shades: [], rollsByShade: {}, unshadedBarcodes: [] };
      groups.set(key, g);
    }
    const label = r.barcode ?? "(barkodsuz)";
    if (r.shadeCode === null) {
      g.unshadedBarcodes.push(label);
      continue;
    }
    (g.rollsByShade[r.shadeCode] ??= []).push(label);
  }
  const out: ShadeMixGroup[] = [];
  for (const g of groups.values()) {
    g.shades = Object.keys(g.rollsByShade).sort();
    if (g.shades.length >= 2) out.push(g);
  }
  return out.sort((a, b) => (a.itemName ?? "").localeCompare(b.itemName ?? "", "tr") || (a.colorName ?? "").localeCompare(b.colorName ?? "", "tr"));
}

/** Kapsam: top id'leri ve/veya çuval id'leri (önizleme çuvaldan, kapı sevkiyatın toplarından). */
export async function findShadeMixes(
  db: Pick<Tx, "roll">,
  input: { rollIds?: string[]; sackIds?: string[] },
): Promise<ShadeMixGroup[]> {
  const scope: Prisma.RollWhereInput[] = [];
  if (input.rollIds && input.rollIds.length > 0) scope.push({ id: { in: input.rollIds } });
  if (input.sackIds && input.sackIds.length > 0) scope.push({ sackId: { in: input.sackIds } });
  if (scope.length === 0) return [];
  // Kapı tx içinde çağırır: iki ilişkili select tek bağlantıda sıralı koşsun (pg eşzamanlı sorgu hatası).
  const rows = await sequentialTx(db).roll.findMany({
    where: { OR: scope },
    select: { id: true, barcode: true, itemId: true, colorId: true, shadeCode: true, item: { select: { name: true } }, color: { select: { name: true } } },
    orderBy: [{ barcode: "asc" }, { id: "asc" }],
  });
  return groupShadeMixes(rows.map((r) => ({ id: r.id, barcode: r.barcode, itemId: r.itemId, colorId: r.colorId, shadeCode: r.shadeCode, itemName: r.item?.name ?? null, colorName: r.color?.name ?? null })));
}

/** Operatör cümlesi — kapı mesajı ve önizleme uyarısı aynı metni basar. */
export function shadeMixText(groups: readonly ShadeMixGroup[]): string {
  const parts = groups.map((g) => {
    const name = [g.itemName, g.colorName].filter(Boolean).join(" / ") || "ürün";
    const detail = g.shades.map((s) => `${s}: ${g.rollsByShade[s]!.join(", ")}`).join(" · ");
    return `${name} → ${g.shades.length} ton (${detail})`;
  });
  return `Aynı ürün+renkte farklı ton var — ${parts.join("; ")}`;
}

/**
 * Önizleme ikizi: kural `off` ise boş; `warn`/`block`ta `[SHADE_MIX] …` uyarısı + `shadeMixes[]`.
 * Eski istemci `warnings` metnini basar (ek alan bilinmeden atılır).
 */
export async function previewShadeMixes(
  db: Pick<Tx, "roll" | "systemSetting">,
  input: { sackIds?: string[]; rollIds?: string[] },
): Promise<{ shadeMixes: ShadeMixGroup[]; shadeMixPolicy: ShippingShadeMixPolicy; warnings: string[] }> {
  const shadeMixPolicy = await readShippingShadeMixPolicy(db);
  if (shadeMixPolicy === "off") return { shadeMixes: [], shadeMixPolicy, warnings: [] };
  const shadeMixes = await findShadeMixes(db, input);
  if (shadeMixes.length === 0) return { shadeMixes, shadeMixPolicy, warnings: [] };
  const tail = shadeMixPolicy === "block" ? " — Sevk Et reddedilir; tonları ayırın ya da düzeltin." : " — müşteride yan yana ton farkı görünebilir.";
  return { shadeMixes, shadeMixPolicy, warnings: [`[SHADE_MIX] ${shadeMixText(shadeMixes)}${tail}`] };
}

/** Sevk kapısı — yalnız `block`ta 409 `SHADE_MIX`, etkilenen her top barkoduyla. `off`/`warn` geçer. */
export async function assertShadeMixAllowedTx(
  tx: Pick<Tx, "roll" | "systemSetting">,
  input: { rollIds: string[]; belge: string },
): Promise<void> {
  if (input.rollIds.length === 0) return;
  const policy = await readShippingShadeMixPolicy(tx);
  if (policy !== "block") return;
  const mixes = await findShadeMixes(tx, { rollIds: input.rollIds });
  if (mixes.length === 0) return;
  throw AppError.conflict(`${shadeMixText(mixes)} — ${input.belge} bu hâliyle çıkamaz.`, { code: "SHADE_MIX", shadeMixes: mixes });
}
