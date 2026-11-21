// =============================================================================
// FASON DEVERE — TABLET DÖNÜŞ KABULÜ BAĞLAMI (devere ek D1): açık siparişler + kalan levent/metre + kabul ayarları
// =============================================================================
// OPT-IN allowlist (`subcontractor-weaving-tablet.service` emsali): depocuya ücret/fiyat, iplik dağıtımı, satış siparişi,
// cari kodu İNMEZ — `map` yalnız adı geçen alanları çıkarır, `select` genişlese de sızmaz (`test_fason_devere_tablet_kabul`).
// "Gelen" = K3 kabul edilen sarım (`ACCEPTED_WARPING_BEAM_WHERE`); açık = kabul edilebilir durum (`RECEIVABLE`). Kabulün
// kendisi E1 belge ucundadır (`/api/warping-receive-docs`), burada ikinci kabul mantığı YOK. Modül kapısı serviste de.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { licenseModuleError } from "../../lib/license/module-ceiling";
import { SETTING_KEYS, readDevereEnabled } from "../system-setting.service";
import { readDevereBeamBodyMode } from "../system-setting/modules";
import type { DevereBeamBodyMode } from "../system-setting/defaults";
import { readDevereDuplicateDeliveryNote, readDevereReceiveWeighing, type DevereDuplicateDeliveryNote, type DevereReceiveWeighing } from "../system-setting/devere-receive";
import { ACCEPTED_WARPING_BEAM_WHERE } from "../helpers/warping-fee.helper";
import { RECEIVABLE, WARPING_RECEIVE_MAX_BEAMS } from "./receive-core";
import { WARPING_RECEIVE_DOC_MAX_ORDERS } from "./receive-doc";

/** Tablet listesinin üst sınırı — açık sipariş bundan fazlaysa devereci süzgeci gerekir (`truncated`). */
export const WARPING_TABLET_MAX_ORDERS = 200;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const m3 = (v: Prisma.Decimal) => v.toFixed(3);

export interface WarpingTabletOrder {
  id: string;
  orderNo: string;
  status: string;
  subcontractor: { id: string; name: string };
  warpSpec: { name: string; code: string };
  /** Plan satırları (adet × boy) — tablet metre alanını önerir; boş = levent adedi belli değil. */
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  /** NULL = levent adedi belli değil; kalan adet de NULL döner. */
  plannedBeamCount: number | null;
  targetLengthM: string;
  receivedBeamCount: number;
  receivedM: string;
  remainingBeamCount: number | null;
  /** Hedef − gelen, alt sınır 0 (fazla gelen eksiye düşmez; fark panel mutabakatında). */
  remainingM: string;
  expectedReturnAt: string | null;
}

export interface WarpingTabletContext {
  subcontractors: Array<{ id: string; name: string; openOrderCount: number }>;
  orders: WarpingTabletOrder[];
  truncated: boolean;
  settings: { beamBodyMode: DevereBeamBodyMode; receiveWeighing: DevereReceiveWeighing; duplicateDeliveryNote: DevereDuplicateDeliveryNote };
  limits: { maxOrders: number; maxBeamsPerOrder: number };
}

export async function getWarpingTabletContext(params: { subcontractorId: string | null }): Promise<WarpingTabletContext> {
  if (!(await readDevereEnabled())) {
    throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere / levent") ?? AppError.forbidden("Devere modülü bu kurulumda kapalı — devere dönüş kabulü yapılamaz.", { code: "MODULE_DISABLED", modul: "devere" });
  }
  const open = { status: { in: RECEIVABLE } } satisfies Prisma.WarpingOrderWhereInput;
  const where: Prisma.WarpingOrderWhereInput = params.subcontractorId ? { ...open, subcontractorId: params.subcontractorId } : open;
  // Sıralı (tek bağlantı havuzu dostu): sayım, sipariş satırları, ayarlar.
  const groups = await prisma.warpingOrder.groupBy({ by: ["subcontractorId"], where: open, _count: { _all: true } });
  const subs = groups.length === 0 ? [] : await prisma.subcontractor.findMany({ where: { id: { in: groups.map((g) => g.subcontractorId) } }, select: { id: true, name: true } });
  const rows = await prisma.warpingOrder.findMany({
    where,
    orderBy: [{ expectedReturnAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    take: WARPING_TABLET_MAX_ORDERS + 1,
    select: {
      id: true, orderNo: true, status: true, beamCount: true, targetLengthM: true, expectedReturnAt: true,
      subcontractor: { select: { id: true, name: true } },
      warpSpec: { select: { name: true, code: true } },
      beamLines: { select: { beamCount: true, beamLengthM: true }, orderBy: { sortOrder: "asc" } },
      warpBeams: {
        where: ACCEPTED_WARPING_BEAM_WHERE,
        select: { events: { where: { kind: "WOUND", reversal: { is: null } }, select: { lengthM: true } } },
      },
    },
  });
  const beamBodyMode = await readDevereBeamBodyMode();
  const receiveWeighing = await readDevereReceiveWeighing();
  const duplicateDeliveryNote = await readDevereDuplicateDeliveryNote();

  const count = new Map(groups.map((g) => [g.subcontractorId, g._count._all]));
  // ALLOWLIST `map`: yeni bir `select` alanı buradan geçmeden cihaza inmez.
  const orders: WarpingTabletOrder[] = rows.slice(0, WARPING_TABLET_MAX_ORDERS).map((o) => {
    const receivedM = o.warpBeams.reduce((s, b) => s.plus(b.events[0]?.lengthM ?? 0), D(0));
    const rest = D(o.targetLengthM).minus(receivedM);
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      subcontractor: { id: o.subcontractor.id, name: o.subcontractor.name },
      warpSpec: { name: o.warpSpec.name, code: o.warpSpec.code },
      beamLines: o.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: m3(l.beamLengthM) })),
      plannedBeamCount: o.beamCount,
      targetLengthM: m3(o.targetLengthM),
      receivedBeamCount: o.warpBeams.length,
      receivedM: m3(receivedM),
      remainingBeamCount: o.beamCount === null ? null : Math.max(0, o.beamCount - o.warpBeams.length),
      remainingM: m3(rest.isNegative() ? D(0) : rest),
      expectedReturnAt: o.expectedReturnAt?.toISOString() ?? null,
    };
  });
  return {
    subcontractors: subs
      .map((s) => ({ id: s.id, name: s.name, openOrderCount: count.get(s.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    orders,
    truncated: rows.length > WARPING_TABLET_MAX_ORDERS,
    settings: { beamBodyMode, receiveWeighing, duplicateDeliveryNote },
    limits: { maxOrders: WARPING_RECEIVE_DOC_MAX_ORDERS, maxBeamsPerOrder: WARPING_RECEIVE_MAX_BEAMS },
  };
}
