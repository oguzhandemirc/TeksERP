// =============================================================================
// EMANET VARSAYILAN DEPOSU — "sahipli top depo söylenmeden doğunca hangi depoya?" (genel fason F1b, 2026-11-08)
// =============================================================================
// Ayar `emanet.defaultWarehouseId` boşsa ya da emanet kapalıysa cevap bugünküdür: varsayılan depo
// (`resolveTargetWarehouseId`). Dolu ama depo pasif/yoksa SESSİZCE varsayılana DÜŞMEZ — 400 (fail-closed): mal
// "yanlış depoda" görünür ve kimse fark etmezdi. Yeni tablo/kolon yok; "Emanet Deposu" sıradan bir depodur.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readEmanetDefaultWarehouseId, readEmanetEnabled, SETTING_KEYS } from "../system-setting.service";
import { resolveTargetWarehouseId } from "./warehouse.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface EmanetWarehouseRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Depo emanet deposu olabilir mi — null = kullanılabilir; dolu = sebep (yazım 400'ü ve doğum 400'ü aynı metni basar). */
export async function emanetWarehouseProblem(db: Db, id: string): Promise<{ row: EmanetWarehouseRow | null; problem: string | null }> {
  const row = await db.warehouse.findUnique({ where: { id }, select: { id: true, code: true, name: true, isActive: true } });
  if (!row) return { row: null, problem: "Depo bulunamadı." };
  if (!row.isActive) return { row, problem: `"${row.name}" deposu pasif durumda.` };
  return { row, problem: null };
}

/**
 * Sahipli doğumun emanet deposu — null = ayar yok / emanet kapalı / sahip yok (çağıran bugünkü varsayılana düşer).
 * YAZMAZ: gelen belge ön kontrolü (claim'den önce) de bunu sorar ki her satır tek tek FAILED olmasın.
 */
export async function resolveEmanetBirthWarehouseIdTx(db: Db, ownerCustomerId: string | null | undefined): Promise<string | null> {
  if (!ownerCustomerId) return null;
  if (!(await readEmanetEnabled(db))) return null;
  const id = await readEmanetDefaultWarehouseId(db);
  if (!id) return null;
  const { problem } = await emanetWarehouseProblem(db, id);
  if (problem) {
    throw AppError.badRequest(
      // Panel yüzeyi P1'de gelir; o güne kadar yönetici ayar adını ve ucu duyar (P1 ekran yoluna çevirir).
      `Emanet varsayılan deposu kullanılamıyor: ${problem} Sistem yöneticisi "${SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID}" ayarını düzeltmeli ya da boşaltmalı (PUT /api/feature-flags/emanet-default-warehouse).`,
      { code: "EMANET_DEFAULT_WAREHOUSE_UNUSABLE", warehouseId: id },
    );
  }
  return id;
}

/**
 * Doğan topun deposu — `createInitialEntry`in TEK depo sorusu. Açık seçim (mal kabul) her zaman kazanır; yoksa sahipli
 * doğum emanet deposuna, o da yoksa bugünkü varsayılana.
 */
export async function resolveBirthWarehouseIdTx(db: Db, explicitId: string | null | undefined, ownerCustomerId: string | null | undefined): Promise<string> {
  if (explicitId) return resolveTargetWarehouseId(db, explicitId);
  return (await resolveEmanetBirthWarehouseIdTx(db, ownerCustomerId)) ?? resolveTargetWarehouseId(db);
}
