// KAYIT `sevkiyat-icerigi` türeticisi (patron sevkiyat dökümü, 2026-11-20): "bu sevkiyatta hangi çuvallar, çuvalda hangi
// toplar" — panelin sevkiyat ayrıntısının (`ShippingService.getShipmentById`) SALT OKUMA karşılığı, ikinci tanım yok:
// çuval listesi/sırası, BRÜT içerik (canlı top + iptal edilmemiş iade `prevSackId` ile çuvalında, yarış dedup'ı),
// çuvalsız toplar ve özet servisten AYNEN gelir. Hayalet top panel gibi süzülmez, `yok: true` işaretlenir.
// Finans/sipariş/müşteri kademesi tele ALINMAZ. Kökler SIRAYLA kurulur (servis tek tek; paralel yük yok).
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { shippingService } from "../services/shipping.service";
import { SACK_ABSENT_STATUSES } from "../services/helpers/sack-invariants.helper";

type RawRow = Record<string, unknown> & { id: string };

/** Servis yanıtının okunan kısmı (JSON'a çevrilmiş: Decimal → dizi/sayı). Fazla alan yok sayılır. */
const Num = z.union([z.string(), z.number()]);
const Named = z.object({ name: z.string() }).nullable();
const RollRow = z.object({
  id: z.string(),
  barcode: z.string().nullable(),
  status: z.string().optional(),
  width: Num.nullable(),
  currentQty: Num,
  item: Named,
  color: Named,
  sackId: z.string().nullable().optional(),
  returned: z.object({ returnedAt: z.string() }).optional(),
});
const ServiceView = z.object({
  rolls: z.array(RollRow),
  sacks: z.array(z.object({
    id: z.string(),
    sackNo: z.string(),
    seq: z.number().nullable(),
    seqLabel: z.string().nullable(),
    unitKind: z.string(),
    unitLabel: z.string().nullable(),
    weightKg: Num.nullable(),
    rolls: z.array(RollRow),
    rollCount: z.number(),
    returnedCount: z.number(),
    returnedQty: Num,
  })),
  summary: z.object({
    rollCount: z.number(), totalMeters: Num, sackCount: z.number(), totalKg: Num, returnedCount: z.number(), returnedMeters: Num,
  }),
});
type RollView = z.infer<typeof RollRow>;

const ABSENT: ReadonlySet<string> = new Set<string>(SACK_ABSENT_STATUSES);
const dec = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

function topWire(r: RollView) {
  return {
    id: r.id,
    topNo: r.barcode,
    urun: r.item?.name ?? null,
    renk: r.color?.name ?? null,
    en: r.width === null ? null : dec(r.width),
    metre: dec(r.currentQty),
    iade: r.returned !== undefined,
    iadeTarihi: r.returned?.returnedAt ?? null,
    yok: r.returned === undefined && r.status !== undefined && ABSENT.has(r.status),
  };
}

/** Tek sevkiyatın içeriği: `ozet` + `cuvallar` + `cuvalsizToplar`. */
export async function buildShipmentContent(shipmentId: string): Promise<Record<string, unknown>> {
  const res = await shippingService.getShipmentById(shipmentId);
  const v = ServiceView.parse(JSON.parse(JSON.stringify(res.data)));
  const cuvallar = v.sacks.map((s) => ({
    id: s.id,
    cuvalNo: s.sackNo,
    sira: s.seqLabel ?? (s.seq === null ? null : String(s.seq)),
    tur: s.unitKind,
    etiket: s.unitLabel,
    kg: s.weightKg === null ? null : dec(s.weightKg),
    top: s.rollCount,
    metre: s.rolls.reduce((m, r) => m.plus(dec(r.currentQty)), new Prisma.Decimal(0)),
    iadeTop: s.returnedCount,
    iadeMetre: dec(s.returnedQty),
    toplar: s.rolls.map(topWire),
  }));
  // Çuvalsız top: sevkiyata doğrudan bağlı — servisin üst `rolls` dizisinde `sackId` boş olanlar.
  const cuvalsizToplar = v.rolls.filter((r) => !r.sackId).map(topWire);
  const s = v.summary;
  return {
    ozet: {
      cuval: s.sackCount, top: s.rollCount, metre: dec(s.totalMeters), kg: dec(s.totalKg),
      tartiliCuval: v.sacks.filter((x) => x.weightKg !== null).length,
      iadeTop: s.returnedCount, iadeMetre: dec(s.returnedMeters),
    },
    cuvallar,
    cuvalsizToplar,
  };
}

/** `DERIVERS["sevkiyat-icerigi"]`: kökler SIRAYLA. */
export async function shipmentContentDerived(rows: readonly RawRow[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const r of rows) out.set(r.id, await buildShipmentContent(r.id));
  return out;
}
