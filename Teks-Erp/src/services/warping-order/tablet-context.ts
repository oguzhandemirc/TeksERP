// =============================================================================
// FASON DEVERE — TABLET DÖNÜŞ KABULÜ BAĞLAMI (devere ek D1): açık siparişler + kalan levent/metre + kabul ayarları
// =============================================================================
// OPT-IN allowlist (`subcontractor-weaving-tablet.service` emsali): depocuya ücret/fiyat, iplik dağıtımı, satış siparişi,
// cari kodu İNMEZ — `map` yalnız adı geçen alanları çıkarır, `select` genişlese de sızmaz (`test_fason_devere_tablet_kabul`).
// "Gelen" = K3 kabul edilen sarım (`ACCEPTED_WARPING_BEAM_WHERE`); açık = kabul edilebilir durum (`RECEIVABLE`). Kabulün
// kendisi E1 belge ucundadır (`/api/warping-receive-docs`), burada ikinci kabul mantığı YOK. Modül kapısı serviste de.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { LIVE_REWORK_WHERE } from "../helpers/warping-beam-rejection.helper";
import { readDevereRejectPhotoRequired } from "../system-setting";
import { readDevereBeamCardAutoPrint, type DevereBeamCardAutoPrint } from "../system-setting/devere-beam-card";
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
import { WARP_SPEC_YARN_DENIER_SELECT, warpSpecDenierLines } from "../helpers/warp-spec-yarn.helper";
import { tabletWarpLayout, type TabletWarpLayout } from "../helpers/warp-sequence.helper";

/** Tablet listesinin üst sınırı — açık sipariş bundan fazlaysa devereci süzgeci gerekir (`truncated`). */
export const WARPING_TABLET_MAX_ORDERS = 200;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const m3 = (v: Prisma.Decimal) => v.toFixed(3);

export interface WarpingTabletOrder {
  id: string;
  orderNo: string;
  status: string;
  subcontractor: { id: string; name: string };
  /** Kart görseli G (EKLEME; eski tablet okumaz): `yarns` (harf = kart sırası), `sequenceNote`, `endsSequence` — levent satırındaki tel düzeni bandı. */
  warpSpec: { name: string; code: string } & TabletWarpLayout;
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
  /** Devere ek-2 r: kabulde yeniden sarım adayı — REJECTED ∧ aktif ret kipi "yeniden sarılsın" ∧ canlı yeniden sarımı yok. */
  reworkCandidates: Array<{ beamId: string; beamNo: string; lengthM: string | null; bodyNo: string | null; rejectionDocNo: string }>;
}

export interface WarpingTabletContext {
  subcontractors: Array<{ id: string; name: string; openOrderCount: number }>;
  orders: WarpingTabletOrder[];
  truncated: boolean;
  /** `rejectPhotoRequired` (ek-2 r): tablet ret sayfası fotosuz göndermeyi kapatır; sunucu da 400 verir. */
  /** `beamCardAutoPrint` (S5t): tablet kabul sonrası A6 levent kartı — OFF bugün · ASK sor · ALWAYS doğrudan pencere. */
  settings: { beamBodyMode: DevereBeamBodyMode; receiveWeighing: DevereReceiveWeighing; duplicateDeliveryNote: DevereDuplicateDeliveryNote; rejectPhotoRequired: boolean; beamCardAutoPrint: DevereBeamCardAutoPrint };
  limits: { maxOrders: number; maxBeamsPerOrder: number };
}

/** Yeniden sarım adayları — `planReceiveReworks` kapısının okuma ikizi (son karar kabulde, 400/409). */
async function reworkCandidatesByOrder(orderIds: string[]): Promise<Map<string, WarpingTabletOrder["reworkCandidates"]>> {
  const out = new Map<string, WarpingTabletOrder["reworkCandidates"]>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.warpBeam.findMany({
    where: {
      warpingOrderId: { in: orderIds }, status: WarpBeamStatus.REJECTED,
      rejectionItems: { some: { rejection: { cancelledAt: null, expectRework: true } } },
      reworks: { none: LIVE_REWORK_WHERE },
    },
    orderBy: [{ beamNo: "asc" }],
    select: {
      id: true, beamNo: true, warpingOrderId: true, beamBody: { select: { bodyNo: true } },
      events: { where: { kind: "WOUND" }, select: { lengthM: true }, take: 1 },
      rejectionItems: { where: { rejection: { cancelledAt: null } }, select: { rejection: { select: { docNo: true } } }, take: 1 },
    },
  });
  for (const r of rows) {
    if (!r.warpingOrderId) continue;
    const len = r.events[0]?.lengthM;
    const list = out.get(r.warpingOrderId) ?? [];
    list.push({ beamId: r.id, beamNo: r.beamNo, lengthM: len == null ? null : m3(len), bodyNo: r.beamBody?.bodyNo ?? null, rejectionDocNo: r.rejectionItems[0]?.rejection.docNo ?? "" });
    out.set(r.warpingOrderId, list);
  }
  return out;
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
      warpSpec: { select: { name: true, code: true, sequenceNote: true, ...WARP_SPEC_YARN_DENIER_SELECT } },
      beamLines: { select: { beamCount: true, beamLengthM: true }, orderBy: { sortOrder: "asc" } },
      warpBeams: {
        where: ACCEPTED_WARPING_BEAM_WHERE,
        select: { events: { where: { kind: "WOUND", reversal: { is: null } }, select: { lengthM: true } } },
      },
    },
  });
  const reworks = await reworkCandidatesByOrder(rows.slice(0, WARPING_TABLET_MAX_ORDERS).map((o) => o.id));
  const rejectPhotoRequired = await readDevereRejectPhotoRequired();
  const beamBodyMode = await readDevereBeamBodyMode();
  const receiveWeighing = await readDevereReceiveWeighing();
  const duplicateDeliveryNote = await readDevereDuplicateDeliveryNote();
  const beamCardAutoPrint = await readDevereBeamCardAutoPrint();

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
      warpSpec: { name: o.warpSpec.name, code: o.warpSpec.code, ...tabletWarpLayout(warpSpecDenierLines(o.warpSpec), o.warpSpec.sequenceNote) },
      beamLines: o.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: m3(l.beamLengthM) })),
      plannedBeamCount: o.beamCount,
      targetLengthM: m3(o.targetLengthM),
      receivedBeamCount: o.warpBeams.length,
      receivedM: m3(receivedM),
      remainingBeamCount: o.beamCount === null ? null : Math.max(0, o.beamCount - o.warpBeams.length),
      remainingM: m3(rest.isNegative() ? D(0) : rest),
      expectedReturnAt: o.expectedReturnAt?.toISOString() ?? null,
      reworkCandidates: reworks.get(o.id) ?? [],
    };
  });
  return {
    subcontractors: subs
      .map((s) => ({ id: s.id, name: s.name, openOrderCount: count.get(s.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    orders,
    truncated: rows.length > WARPING_TABLET_MAX_ORDERS,
    settings: { beamBodyMode, receiveWeighing, duplicateDeliveryNote, rejectPhotoRequired, beamCardAutoPrint },
    limits: { maxOrders: WARPING_RECEIVE_DOC_MAX_ORDERS, maxBeamsPerOrder: WARPING_RECEIVE_MAX_BEAMS },
  };
}
