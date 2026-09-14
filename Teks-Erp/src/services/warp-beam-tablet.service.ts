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
import { yarnLotBalancesTx } from "./helpers/yarn-lot.helper";
import { readDevereLotRequired } from "./system-setting.service";

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
  /** Faz 2 (lot): çözgü kartlarının iplik kalemlerine ait AKTİF lotlar, türetilen bakiyeyle (allowlist: id/lotNo/itemId/balanceKg). */
  yarnLots: Array<{ id: string; lotNo: string; itemId: string; balanceKg: number }>;
  /** `devere.lotRequired` — form kapıyı SUNUCUDAN okur, tahmin etmez (1e A3 ek şart ②). */
  lotRequired: boolean;
}

export async function getWarpBeamTabletContext(): Promise<ApiResponse<WarpBeamTabletContextDto>> {
  const [specs, machines, warehouses, subcontractors, suppliers] = await Promise.all([
    prisma.warpSpec.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, endsCount: true, yarnItemId: true, yarnItem: { select: { linearDensityDen: true } } } }),
    listDevereMachines().then((r) => r.data),
    prisma.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    prisma.subcontractor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  const supplierRank = (t: CompanyType): number => (t === CompanyType.CUSTOMER ? 1 : 0);
  // Lotlar SIRALI (Promise.all dışında): önce kart ipliklerinin kümesi, sonra lot + bakiye (tek sorgu).
  const yarnItemIds = [...new Set(specs.map((w) => w.yarnItemId))];
  const lotRows = yarnItemIds.length > 0 ? await prisma.yarnLot.findMany({ where: { isActive: true, itemId: { in: yarnItemIds } }, orderBy: { lotNo: "asc" }, select: { id: true, lotNo: true, itemId: true } }) : [];
  const balances = await yarnLotBalancesTx(prisma, lotRows.map((l) => l.id));
  const lotRequired = await readDevereLotRequired();
  return {
    success: true,
    data: {
      warpSpecs: specs.map((w) => ({ id: w.id, code: w.code, name: w.name, endsCount: w.endsCount, denier: (() => { const d = resolveDenier(w.yarnItem); return d == null ? null : Number(d); })() })),
      machines,
      warehouses,
      subcontractors,
      suppliers: suppliers.map((c) => ({ id: c.id, name: c.name, type: c.type })).sort((a, b) => supplierRank(a.type) - supplierRank(b.type) || a.name.localeCompare(b.name, "tr")),
      yarnLots: lotRows.map((l) => ({ id: l.id, lotNo: l.lotNo, itemId: l.itemId, balanceKg: Number(balances.get(l.id) ?? 0) })),
      lotRequired,
    },
  };
}
