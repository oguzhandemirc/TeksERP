// =============================================================================
// TeksERP — Levent TABLET bağlamı (devere tablet dilimi, DEVERE-LEVENT-TARAMASI §11 D2)
// =============================================================================
// Salt okuma; yazıcı değil. Ayrı dosya: `warp-beam.service` 300 satır tavanını aşmasın.
// =============================================================================
import { CompanyType } from "@prisma/client";
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { resolveDenier } from "../constants/warp-beam";
import { listDevereMachines, listLoomMachines } from "./warp-beam.service";
import { yarnLotBalancesTx } from "./helpers/yarn-lot.helper";
import { readDevereAutoConsume, readDevereLotRequired, readDevereMountTracking, readDevereMountTrackingRequired, resolveBeamWeavingLinkRequired } from "./system-setting.service";
import { listOpenInHouseWeavingOrders, type MachineRunTabletContextDto } from "./helpers/machine-run-suggest.helper";
import { lastWindDefaults, type LastWindDefault } from "./helpers/warp-beam-wind-defaults.helper";

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
  /** Roller (İş Ortağı Rol Modeli D1): tablet alt etiketi bunlardan; `type` sıralama + eski tablet için kalır. */
  suppliers: Array<{ id: string; name: string; type: CompanyType; isCustomerRole: boolean; isSupplierRole: boolean; isSubcontractorRole: boolean }>;
  /** Faz 2 (lot): çözgü kartlarının iplik kalemlerine ait AKTİF lotlar, türetilen bakiyeyle (allowlist: id/lotNo/itemId/balanceKg). */
  yarnLots: Array<{ id: string; lotNo: string; itemId: string; balanceKg: number }>;
  /** `devere.lotRequired` — form kapıyı SUNUCUDAN okur, tahmin etmez (1e A3 ek şart ②). */
  lotRequired: boolean;
  /** Faz 3 (E3): levent BAĞLANABİLEN makineler (istasyonu levent tüketen), yuva sayısıyla — Tak formu (allowlist). */
  loomMachines: Array<{ id: string; code: string; name: string; stationName: string; warpBeamSlots: number }>;
  /** `devere.mountTracking` — "Tezgahta" sekmesi yalnız açıkken çizilir; alan yoksa/false = bugünkü ekran. */
  mountTracking: boolean;
  /** `devere.mountTrackingRequired` — Tak formunda yöntem zorunlu (sunucu da 400 verir). */
  mountTrackingRequired: boolean;
  /** Z1 (Y2): Plan/Sar formundaki "Dokuma işi" seçicisi — açık (PLANNED/IN_PROGRESS) ∧ IN_HOUSE işler; koşum bağlamıyla AYNI biçim. */
  weavingOrders: MachineRunTabletContextDto["weavingOrders"];
  /** `devere.beamWeavingLinkRequired` ETKİN değeri — form zorunluluğu SUNUCUDAN okur, tahmin etmez; sunucu da 400 verir. */
  beamWeavingLinkRequired: boolean;
  /** Z5/E8: `devere.autoConsume` — kapalıysa tablet KK1 sonrası "çözgü tüketimi yazılmadı (ayar kapalı)" bilgisini basar. */
  autoConsume: boolean;
  /** Z5/E6: çözgü kartı başına son IN_HOUSE sarımın makine + iplik satırları — SAR formu ön-dolumu, yalnız öneri. */
  lastWindDefaults: LastWindDefault[];
}

export async function getWarpBeamTabletContext(): Promise<ApiResponse<WarpBeamTabletContextDto>> {
  const [specs, machines, warehouses, subcontractors, suppliers] = await Promise.all([
    prisma.warpSpec.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, endsCount: true, yarnItemId: true, yarnItem: { select: { linearDensityDen: true } } } }),
    listDevereMachines().then((r) => r.data),
    prisma.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    prisma.subcontractor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true } }),
  ]);
  const supplierRank = (t: CompanyType): number => (t === CompanyType.CUSTOMER ? 1 : 0);
  // Lotlar SIRALI (Promise.all dışında): önce kart ipliklerinin kümesi, sonra lot + bakiye (tek sorgu).
  const yarnItemIds = [...new Set(specs.map((w) => w.yarnItemId))];
  const lotRows = yarnItemIds.length > 0 ? await prisma.yarnLot.findMany({ where: { isActive: true, itemId: { in: yarnItemIds } }, orderBy: { lotNo: "asc" }, select: { id: true, lotNo: true, itemId: true } }) : [];
  const balances = await yarnLotBalancesTx(prisma, lotRows.map((l) => l.id));
  const lotRequired = await readDevereLotRequired();
  const [loomMachines, mountTracking, mountTrackingRequired] = [await listLoomMachines().then((r) => r.data), await readDevereMountTracking(), await readDevereMountTrackingRequired()];
  const weavingOrders = await listOpenInHouseWeavingOrders(prisma);
  const beamWeavingLinkRequired = await resolveBeamWeavingLinkRequired();
  const autoConsume = await readDevereAutoConsume();
  const windDefaults = await lastWindDefaults(prisma, specs.map((w) => w.id));
  return {
    success: true,
    data: {
      warpSpecs: specs.map((w) => ({ id: w.id, code: w.code, name: w.name, endsCount: w.endsCount, denier: (() => { const d = resolveDenier(w.yarnItem); return d == null ? null : Number(d); })() })),
      machines,
      warehouses,
      subcontractors,
      suppliers: suppliers.map((c) => ({ id: c.id, name: c.name, type: c.type, isCustomerRole: c.isCustomerRole, isSupplierRole: c.isSupplierRole, isSubcontractorRole: c.isSubcontractorRole })).sort((a, b) => supplierRank(a.type) - supplierRank(b.type) || a.name.localeCompare(b.name, "tr")),
      yarnLots: lotRows.map((l) => ({ id: l.id, lotNo: l.lotNo, itemId: l.itemId, balanceKg: Number(balances.get(l.id) ?? 0) })),
      lotRequired,
      loomMachines,
      mountTracking,
      mountTrackingRequired,
      weavingOrders,
      beamWeavingLinkRequired,
      autoConsume,
      lastWindDefaults: windDefaults,
    },
  };
}
