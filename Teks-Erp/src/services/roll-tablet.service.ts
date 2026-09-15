// =============================================================================
// TeksERP — Top (KK1) TABLET bağlamı (G3t: emanet sahip seçici)
// =============================================================================
// Salt okuma; yazıcı değil. Ayrı dosya: `inventory.service` tavanın çok üstünde (devralınan).
// =============================================================================
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { readEmanetEnabled } from "./system-setting.service";

/**
 * KK1 form bağlamı — TEK uç, TEK izin (`mobile:kk1`), `warp-beam-tablet.service` emsali.
 *
 * ⚠️ NEDEN AYRI UÇ: emanet sahibi seçicisi müşteri listesi ister; o liste `customer:read`
 * (ya da yedi başka mobil ekran izni) arkasında ve TAM cari kaydını (vergi no, adres…) döner.
 * KK1 operatörüne o izni dağıtmak yerine tek uç, tek izin; panel bunu KULLANMAZ.
 *
 * ⚠️ CEVAP OPT-IN ALLOWLIST: her satır yalnız `id` + `name`; yeni alan ancak buraya adıyla
 * eklenir, `select` genişletilerek değil (`test_emanet §6` her satırın anahtar kümesini ölçer).
 *
 * ⚠️ EMANET KAPALIYKEN `customers: []` — tablet zaten çağırmaz (bayrak kapalıyken seçici
 * çizilmez); sunucu da liste vermez ki kapalı kurulumda cari adları bu uçtan sızmasın.
 */
export interface RollTabletContextDto {
  customers: Array<{ id: string; name: string }>;
}

export async function getRollTabletContext(): Promise<ApiResponse<RollTabletContextDto>> {
  if (!(await readEmanetEnabled())) return { success: true, data: { customers: [] } };
  const customers = await prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return { success: true, data: { customers: customers.map((c) => ({ id: c.id, name: c.name })) } };
}
