// KUMAŞ SINIFLAMASI (K8, Seyitoğlu 2026-11-25): kumaş türü (ayarlanabilir liste) + yanmazlık.
// `BaseController` skalerleri olduğu için doğrulama AÇIKÇA burada; "yalnız KUMAŞ" kapısı çağıranda
// (`readFabricStructureFields`). Pasif tür yeni seçime giremez; kartta zaten olan tür yeniden yazılabilir.
import { FlameRetardancy } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { FABRIC_TECHNIQUES, FABRIC_TECHNIQUES_AVAILABLE, type FabricTechniqueValue } from "../../constants/weave-classification";

/** Üretim tekniği (2026-11-25): yalnız bugün açık teknikler (Dokuma); Örme "yakında" → 400; null/"" temizler. */
export function readFabricTechnique(raw: unknown): FabricTechniqueValue | null {
  if (raw === null || raw === "") return null;
  if (!(FABRIC_TECHNIQUES as readonly unknown[]).includes(raw)) throw AppError.badRequest("Üretim tekniği Dokuma/Örme (WOVEN/KNITTED) olmalı.", { code: "FABRIC_TECHNIQUE_INVALID" });
  if (!FABRIC_TECHNIQUES_AVAILABLE.includes(raw as FabricTechniqueValue)) {
    throw AppError.badRequest("Örme üretim tekniği henüz kullanılamıyor; Dokuma seçin.", { code: "FABRIC_TECHNIQUE_NOT_AVAILABLE" });
  }
  return raw as FabricTechniqueValue;
}

/** Atkı kartı bağı: AKTİF kart olmalı; null/"" temizler. */
export async function readWeftSpecRef(w: unknown): Promise<string | null> {
  if (w === null || w === "") return null;
  if (typeof w !== "string") throw AppError.badRequest("Atkı kartı kimliği geçersiz.");
  const n = await prisma.weftSpec.count({ where: { id: w, isActive: true } });
  if (n === 0) throw AppError.badRequest("Atkı kartı bulunamadı ya da pasif", { code: "WEFT_SPEC_NOT_FOUND" });
  return w;
}

/** K7: PATCH'te `fibers` sessiz düşmesin — lif bileşimi kendi ucundan (replace) yazılır. */
export function assertNoFibersInPatch(data: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(data, "fibers")) {
    throw AppError.badRequest("Lif bileşimi PUT /api/items/:id/fibers ile değiştirilir.", { code: "ITEM_FIBER_USE_PUT" });
  }
}

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
