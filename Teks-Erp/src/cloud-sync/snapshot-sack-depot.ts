// ANLIK `cuval-deposu` (patron çuval deposu ekranı, 2026-11-20): "kimin kaç çuvalı hazır, çuvalda ne var" — panelin
// Çuvallar ekranının SALT OKUMA karşılığı. İkinci tanım yok:
//   • kapsam: panelin varsayılanı `resolveScopeOr()` = sevk edilmemiş birim (havuz + PLANNED sevkiyata atanmış);
//     sevk edilmiş çuval GELMEZ (brüt sevk rakamı `ozet.sevkiyat`/`sevkiyat`ta kalır);
//   • çuval başına top/metre `loadSackContentTotals` (liste/etiket ile aynı, hayaletsiz); toplar aynı `PRESENT_ROLL_WHERE`.
// Özet ve cari kovası fabrikada toplanır (bulut/uygulama toplamaz). Çuval dizisi tavanlı (yeni önce); özet tüm kümeden.
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { factoryYmd } from "../constants/time";
import { resolveScopeOr } from "../services/sack-search.service";
import { loadSackContentTotals, PRESENT_ROLL_WHERE } from "../services/helpers/sack-content-totals.helper";
import { loadFoldTypeCatalog } from "../services/helpers/fold-type";

export const SACK_DEPOT_SNAPSHOT = "cuval-deposu";
/** Gönderilen en çok birim (yeni önce) — paket hacmi sınırı; `kirpildi` söyler. */
export const SACK_DEPOT_CAP = 1500;
/** Müşterisiz birimlerin kovası (panel cari kapısıyla aynı ad). */
export const CUSTOMERLESS_LABEL = "Müşterisiz (genel stok)";

const Num = z.number();
const Str = z.string();
const Uuid = z.string().uuid();
const Sayilar = { cuval: Num, top: Num, metre: Num, kg: Num.nullable() };

const Top = z.strictObject({
  id: Uuid, topNo: Str.nullable(), urun: Str, renk: Str.nullable(), en: Num.nullable(), kat: Str.nullable(), kalite: Str.nullable(), metre: Num,
});
const Cuval = z.strictObject({
  id: Uuid, cuvalNo: Str, tur: z.enum(["SACK", "CART", "BULK"]), etiket: Str.nullable(), cariKartId: Uuid.nullable(), cari: Str.nullable(),
  sube: Str.nullable(), durum: z.enum(["DEPODA", "SEVKE_ATANDI"]), sevkiyatId: Uuid.nullable(), sevkiyatNo: Str.nullable(),
  kg: Num.nullable(), top: Num, metre: Num, olusturulma: Str, toplar: z.array(Top),
});

export const SACK_DEPOT_SNAPSHOT_SCHEMA = z.strictObject({
  ozet: z.strictObject({ ...Sayilar, tartiliCuval: Num, sevkeAtanan: Num }),
  cariler: z.array(z.strictObject({ cariKartId: Uuid.nullable(), ad: Str, ...Sayilar })),
  cuvallar: z.array(Cuval),
  kirpildi: z.boolean(),
});
export type SackDepotSnapshotData = z.input<typeof SACK_DEPOT_SNAPSHOT_SCHEMA>;
type TopWire = z.input<typeof Top>;

const dec = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

/** Çuval/top/metre/kg toplayıcısı — metre ve kg Decimal toplanır (kayan nokta birikmez). */
class Tally {
  cuval = 0;
  top = 0;
  weighed = 0;
  metre = new Prisma.Decimal(0);
  kg = new Prisma.Decimal(0);
  add(top: number, metre: Prisma.Decimal, kg: Prisma.Decimal | null): void {
    this.cuval += 1;
    this.top += top;
    this.metre = this.metre.add(metre);
    if (kg !== null) {
      this.weighed += 1;
      this.kg = this.kg.add(kg);
    }
  }
  counts() {
    return { cuval: this.cuval, top: this.top, metre: Number(this.metre), kg: this.weighed > 0 ? Number(this.kg) : null };
  }
}

export async function buildSackDepotSnapshotData(): Promise<SackDepotSnapshotData> {
  const sacks = await prisma.sack.findMany({
    where: { OR: resolveScopeOr() },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, sackNo: true, unitKind: true, unitLabel: true, customerId: true, weightKg: true, createdAt: true, shipmentId: true,
      customer: { select: { name: true } }, branch: { select: { name: true } }, shipment: { select: { shipmentNo: true } },
    },
  });
  const totals = await loadSackContentTotals(sacks.map((s) => s.id));
  const shown = sacks.slice(0, SACK_DEPOT_CAP);
  const shownIds = shown.map((s) => s.id);
  const rolls = shownIds.length === 0 ? [] : await prisma.roll.findMany({
    where: { sackId: { in: shownIds }, ...PRESENT_ROLL_WHERE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, sackId: true, barcode: true, currentQty: true, width: true, foldType: true, qualityGrade: true,
      item: { select: { name: true } }, color: { select: { name: true } }, qualityGradeRef: { select: { name: true } },
    },
  });
  const foldName = new Map((await loadFoldTypeCatalog()).values.map((v) => [v.code, v.name]));
  const rollsBySack = new Map<string, TopWire[]>();
  for (const r of rolls) {
    if (!r.sackId) continue;
    const list = rollsBySack.get(r.sackId) ?? [];
    list.push({
      id: r.id, topNo: r.barcode, urun: r.item.name, renk: r.color?.name ?? null, en: dec(r.width),
      kat: r.foldType === null ? null : (foldName.get(r.foldType) ?? r.foldType),
      kalite: r.qualityGradeRef?.name ?? r.qualityGrade ?? null, metre: Number(r.currentQty),
    });
    rollsBySack.set(r.sackId, list);
  }

  const all = new Tally();
  let assigned = 0;
  const byCustomer = new Map<string | null, { ad: string; t: Tally }>();
  for (const s of sacks) {
    const t = totals.get(s.id);
    const metre = t?.totalQty ?? new Prisma.Decimal(0);
    all.add(t?.rollCount ?? 0, metre, s.weightKg);
    if (s.shipmentId) assigned += 1;
    const bucket = byCustomer.get(s.customerId) ?? { ad: s.customer?.name ?? CUSTOMERLESS_LABEL, t: new Tally() };
    bucket.t.add(t?.rollCount ?? 0, metre, s.weightKg);
    byCustomer.set(s.customerId, bucket);
  }
  // Sıra panel cari kapısıyla aynı: müşterisiz kovası önce, sonra çok çuvallı önce, eşitlikte ad.
  const cariler = [...byCustomer.entries()]
    .map(([cariKartId, { ad, t }]) => ({ cariKartId, ad, ...t.counts() }))
    .sort((a, b) => (a.cariKartId === null ? -1 : b.cariKartId === null ? 1 : b.cuval - a.cuval || a.ad.localeCompare(b.ad, "tr")));
  return {
    ozet: { ...all.counts(), tartiliCuval: all.weighed, sevkeAtanan: assigned },
    cariler,
    cuvallar: shown.map((s) => {
      const t = totals.get(s.id);
      return {
        id: s.id, cuvalNo: s.sackNo, tur: s.unitKind, etiket: s.unitLabel, cariKartId: s.customerId, cari: s.customer?.name ?? null,
        sube: s.branch?.name ?? null, durum: s.shipmentId ? "SEVKE_ATANDI" as const : "DEPODA" as const,
        sevkiyatId: s.shipmentId, sevkiyatNo: s.shipment?.shipmentNo ?? null, kg: dec(s.weightKg),
        top: t?.rollCount ?? 0, metre: Number(t?.totalQty ?? 0), olusturulma: factoryYmd(s.createdAt), toplar: rollsBySack.get(s.id) ?? [],
      };
    }),
    kirpildi: sacks.length > SACK_DEPOT_CAP,
  };
}
