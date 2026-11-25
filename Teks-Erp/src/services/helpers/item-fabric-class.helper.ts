// KUMAŞ SINIFLAMASI (K8, Seyitoğlu 2026-11-25): kumaş türü (ayarlanabilir liste) + yanmazlık.
// `BaseController` skalerleri olduğu için doğrulama AÇIKÇA burada; "yalnız KUMAŞ" kapısı çağıranda
// (`readFabricStructureFields`). Pasif tür yeni seçime giremez; kartta zaten olan tür yeniden yazılabilir.
import { FlameRetardancy } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

const FLAME_VALUES = Object.values(FlameRetardancy) as string[];

export function readFlameRetardancy(raw: unknown): FlameRetardancy | null {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !FLAME_VALUES.includes(raw)) {
    throw AppError.badRequest("Yanmazlık Yok / FR / Trevira CS / Diğer FR olmalı.", { code: "FLAME_RETARDANCY_INVALID" });
  }
  return raw as FlameRetardancy;
}

export async function readFabricTypeRef(raw: unknown, itemId?: string): Promise<string | null> {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") throw AppError.badRequest("Kumaş türü kimliği geçersiz.", { code: "FABRIC_TYPE_NOT_FOUND" });
  const t = await prisma.fabricType.findUnique({ where: { id: raw }, select: { isActive: true } }).catch(() => null);
  if (!t) throw AppError.badRequest("Kumaş türü bulunamadı.", { code: "FABRIC_TYPE_NOT_FOUND" });
  if (!t.isActive) {
    const kept = itemId ? await prisma.item.count({ where: { id: itemId, fabricTypeId: raw } }) : 0;
    if (kept === 0) throw AppError.badRequest("Kumaş türü pasif; Tanımlar › Kumaş Türleri'nden etkinleştirin.", { code: "FABRIC_TYPE_INACTIVE" });
  }
  return raw;
}
