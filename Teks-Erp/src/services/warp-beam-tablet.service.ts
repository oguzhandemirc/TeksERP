// =============================================================================
// TeksERP — Levent TABLET bağlamı (devere tablet dilimi, DEVERE-LEVENT-TARAMASI §11 D2)
// =============================================================================
// Salt okuma; yazıcı değil. Ayrı dosya: `warp-beam.service` 300 satır tavanını aşmasın.
// =============================================================================
import { CompanyType } from "@prisma/client";
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { resolveDenier } from "../constants/warp-beam";
import { listDevereMachines } from "./warp-beam.service";

/**
 * Tablet form bağlamı — TEK uç, TEK izin (`mobile:devere`), DEVERE-LEVENT-TARAMASI §11 D2.
 *
 * ⚠️ NEDEN AYRI UÇ: sarım/plan formu çözgü kartı, devere makinesi, depo, fasoncu ve
 * tedarikçi listesi ister; dördü ayrı uçlarda ayrı web izinleriyle (`warpspec:read` ·
 * `warehouse:read` · `customer:read`…) yaşıyor. Operatöre o izinleri dağıtmak yerine
 * tek uç, tek izin; panel bunu KULLANMAZ (kendi uçları kalır).
 *
 * ⚠️ CEVAP OPT-IN ALLOWLIST (1e ek şart ②): her satır yalnız `id` + `name` (+ kartta
 * form için gereken sayısal alanlar; denye TEK kaynaktan, `resolveDenier`). Cari/tedarikçi satırından vergi no, adres, bakiye
 * gibi başka alan SIZMAZ — `test_kimlik_sizintisi` sınıfı; yeni alan ancak buraya
 * adıyla eklenir, `select` genişletilerek değil.
 *
 * Tedarikçi adayları: `Customer` tipi bir ETİKET, duvar değil (CompanyType şerhi) —
 * bütün aktif cariler döner, tip yalnız sıralama için (SUPPLIER/BOTH önce).
 */
export interface WarpBeamTabletContextDto {
  warpSpecs: Array<{ id: string; code: string; name: string; endsCount: number; denier: number | null }>;
  machines: Array<{ id: string; code: string; name: string; stationName: string }>;
  warehouses: Array<{ id: string; name: string; isDefault: boolean }>;
  subcontractors: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string; type: CompanyType }>;
}

export async function getWarpBeamTabletContext(): Promise<ApiResponse<WarpBeamTabletContextDto>> {
  const [specs, machines, warehouses, subcontractors, suppliers] = await Promise.all([
    prisma.warpSpec.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, endsCount: true, yarnItem: { select: { linearDensityDen: true } } } }),
    listDevereMachines().then((r) => r.data),
    prisma.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    prisma.subcontractor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  const supplierRank = (t: CompanyType): number => (t === CompanyType.CUSTOMER ? 1 : 0);
  return {
    success: true,
    data: {
      warpSpecs: specs.map((w) => ({ id: w.id, code: w.code, name: w.name, endsCount: w.endsCount, denier: (() => { const d = resolveDenier(w.yarnItem); return d == null ? null : Number(d); })() })),
      machines,
      warehouses,
      subcontractors,
      suppliers: suppliers.map((c) => ({ id: c.id, name: c.name, type: c.type })).sort((a, b) => supplierRank(a.type) - supplierRank(b.type) || a.name.localeCompare(b.name, "tr")),
    },
  };
}
