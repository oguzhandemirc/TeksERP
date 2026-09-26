// =============================================================================
// KARTELA HAREKETLERİ — olay defterinin okuma yüzeyi (docs/design/KARTELA-HAREKET-DEFTERI.md §5.3)
// =============================================================================
// Liste, sayfa imleci ve grup sayaçları TEK süzgeçten (`kartelaEventsWhere`) doğar; sayaç
// şeridi ayrı bir koşul taşımaz (`test_swatch_event_timeline` ölçer). Satır başlığı, durum
// geçişi, aktör, kanal ve tetik burada Türkçe kurulur; istemci ikinci sözlük tutmaz.
// Salt okur — defter yalnız `helpers/swatch-event.helper.ts`ten yazılır.
// =============================================================================

import { Prisma, SwatchEventType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { normalizeScanCode } from "../utils/code-format";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { WORK_ORDER_CHANNEL_LABEL } from "../constants/workorder-event-labels";
import {
  SWATCH_EVENT_GROUP,
  SWATCH_EVENT_GROUPS,
  SWATCH_EVENT_GROUP_LABEL,
  SWATCH_EVENT_TITLE,
  SWATCH_STATUS_LABEL,
  SWATCH_TRIGGER_LABEL,
  type SwatchEventGroup,
} from "../constants/swatch-event-labels";

export interface KartelaEventFilter {
  /** Kartela barkodu/kart no · çuval no · sevkiyat no · kabul no — TAM eşleşme (okutma). */
  search?: string;
  /** Gün-yalnız (`YYYY-MM-DD`, fabrika günü) ya da tam ISO damgası. */
  dateFrom?: string;
  dateTo?: string;
  swatchId?: string;
}

export interface KartelaTimelineItem {
  id: string;
  at: string;
  group: SwatchEventGroup;
  title: string;
  /** Durum geçişi + belge (çuval · sevkiyat · kabul · düşüm) — satırda DONUK numaralarla. */
  detail: string | null;
  reason: string | null;
  actor: string | null;
  channel: string | null;
  trigger: string | null;
  swatchId: string;
  card: string;
  product: string;
}

export interface KartelaTimelinePage {
  data: KartelaTimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Süzgeç çipleri — grup seçiminden BAĞIMSIZ, listeyle AYNI süzgeçten. */
  groups: Array<{ key: SwatchEventGroup; label: string; count: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** TEK süzgeç — liste, imleç ve sayaçlar bundan doğar. */
export function kartelaEventsWhere(f: KartelaEventFilter): Prisma.SwatchEventWhereInput {
  const and: Prisma.SwatchEventWhereInput[] = [];
  if (f.swatchId) {
    if (!UUID.test(f.swatchId)) throw AppError.badRequest("Geçersiz kartela kimliği");
    and.push({ swatchId: f.swatchId });
  }
  if (f.dateFrom) and.push({ createdAt: { gte: resolveRangeStart(f.dateFrom) } });
  if (f.dateTo) and.push({ createdAt: { lte: resolveRangeEnd(f.dateTo) } });
  const code = f.search ? normalizeScanCode(f.search) : "";
  if (code) {
    and.push({
      OR: [
        { swatch: { barcode: code } },
        { swatch: { cardNumber: code } },
        { sackNo: code },
        { shipmentNo: code },
        { swatch: { parentReceipt: { receiptNo: code } } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

const typesOfGroups = (groups: SwatchEventGroup[]): SwatchEventType[] =>
  (Object.keys(SWATCH_EVENT_GROUP) as SwatchEventType[]).filter((t) => groups.includes(SWATCH_EVENT_GROUP[t]));

type EventRow = Prisma.SwatchEventGetPayload<{
  include: { swatch: { select: { cardNumber: true; item: { select: { name: true } }; color: { select: { name: true } }; parentReceipt: { select: { receiptNo: true } } } } };
}>;

function describeEvent(e: EventRow): string {
  const transition = `${e.fromStatus ? SWATCH_STATUS_LABEL[e.fromStatus] : "—"} → ${SWATCH_STATUS_LABEL[e.toStatus]}`;
  const docs = [
    e.sackNo ? `Çuval ${e.sackNo}` : null,
    e.shipmentNo ? `Sevkiyat ${e.shipmentNo}` : null,
    e.receiptId && e.swatch.parentReceipt ? `Kabul ${e.swatch.parentReceipt.receiptNo}` : null,
    e.reductionId ? "Stok düşüm belgesi" : null,
  ].filter(Boolean);
  return [transition, ...docs].join(" · ");
}

export class KartelaTimelineService {
  async list(
    f: KartelaEventFilter,
    opts: { groups?: SwatchEventGroup[]; cursor?: string; limit: number },
  ): Promise<KartelaTimelinePage> {
    if (opts.cursor && !UUID.test(opts.cursor)) throw AppError.badRequest("Geçersiz page imleci");
    const where = kartelaEventsWhere(f);
    const counted = await prisma.swatchEvent.groupBy({ by: ["type"], where, _count: { _all: true } });
    const groupCounts = new Map<SwatchEventGroup, number>();
    for (const s of counted) groupCounts.set(SWATCH_EVENT_GROUP[s.type], (groupCounts.get(SWATCH_EVENT_GROUP[s.type]) ?? 0) + s._count._all);

    const rows = await prisma.swatchEvent.findMany({
      where: opts.groups?.length ? { AND: [where, { type: { in: typesOfGroups(opts.groups) } }] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Prisma imleci (createdAt, id) karşılaştırmasını DB'de kurar: bir eylemin satırları aynı
      // tx anını taşır ve ISO damgası mikrosaniyeyi kırpardı — kimlikli imleç kırpmaz.
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      take: opts.limit + 1,
      include: {
        swatch: { select: { cardNumber: true, item: { select: { name: true } }, color: { select: { name: true } }, parentReceipt: { select: { receiptNo: true } } } },
      },
    });
    const hasMore = rows.length > opts.limit;
    const page = rows.slice(0, opts.limit);
    const actorIds = [...new Set(page.map((r) => r.createdById).filter((x): x is string => !!x))];
    const users = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, username: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));
    return {
      data: page.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        group: SWATCH_EVENT_GROUP[e.type],
        title: SWATCH_EVENT_TITLE[e.type],
        detail: describeEvent(e),
        reason: e.reason,
        actor: e.createdById ? (nameById.get(e.createdById) ?? null) : null,
        channel: WORK_ORDER_CHANNEL_LABEL[e.channel] ?? e.channel,
        trigger: SWATCH_TRIGGER_LABEL[e.trigger] ?? e.trigger,
        swatchId: e.swatchId,
        card: e.swatch.cardNumber,
        product: [e.swatch.item.name, e.swatch.color?.name].filter(Boolean).join(" · "),
      })),
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      groups: SWATCH_EVENT_GROUPS.map((key) => ({ key, label: SWATCH_EVENT_GROUP_LABEL[key], count: groupCounts.get(key) ?? 0 })),
    };
  }
}

export const kartelaTimelineService = new KartelaTimelineService();
