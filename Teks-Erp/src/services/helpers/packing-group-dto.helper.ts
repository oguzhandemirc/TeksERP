// =============================================================================
// SEVK PARTİSİ DTO YÜKLEYİCİSİ — toplamlar DB'de, bellekte değil (2026-09-22)
// =============================================================================
// `packing-group.helper.ts`ten ayrıldı (boyut tavanı): kural orada kalır, TOPLAM
// HESABI burada. Anlam `toDto` ile BİREBİR olmak ZORUNDA — ikisi boğaz-ikizdir ve
// `test_sevk_partisi §4c` aynı fikstürle iki yolu karşılaştırır.
// =============================================================================
import { Prisma, type PackingGroupStatus } from "@prisma/client";


export interface PackingGroupDto {
  id: string;
  /** Kalıcı tekil kod `PRT-YYMM-NNNN` — ad değişse de değişmez; belge/arama kimliği. */
  code: string;
  name: string;
  seq: number | null;
  note: string | null;
  sackCount: number;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  weightKg: number | null;
  createdAt: Date;
  /** Sevk partisi alanları — grup modunda `OPEN` / null / 0 döner (ek alan, davranış aynı). */
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  /** Sevkiyata bağlanmış (partide numarasıyla kalan) çuval sayısı. */
  shippedSackCount: number;
  nextPackageNo: number;
}


export const GROUP_WITH_SACKS_SELECT = {
  id: true,
  // Replay gövde kapısının (F117) kimlik alanı — token'lı grup BAŞKA bir cariye
  // aitse cached kaydı dönmek yanlış cevap olurdu.
  customerId: true,
  code: true,
  name: true,
  seq: true,
  note: true,
  createdAt: true,
  status: true,
  closedAt: true,
  nextPackageNo: true,
  // Toplam üye (sevk edilmiş dahil) — parti modunda "kaç çuval gitti" bundan türer.
  _count: { select: { sacks: true } },
  sacks: {
    where: { shipmentId: null },
    select: {
      id: true,
      weightKg: true,
      rolls: { select: { currentQty: true } },
      swatches: { select: { id: true } },
    },
  },
} satisfies Prisma.PackingGroupSelect;

type GroupRow = Prisma.PackingGroupGetPayload<{ select: typeof GROUP_WITH_SACKS_SELECT }>;

export function toDto(g: GroupRow): PackingGroupDto {
  let rollCount = 0;
  let swatchCount = 0;
  let totalQty = new Prisma.Decimal(0);
  let weight = new Prisma.Decimal(0);
  let anyWeight = false;
  for (const sk of g.sacks) {
    rollCount += sk.rolls.length;
    swatchCount += sk.swatches.length;
    for (const r of sk.rolls) totalQty = totalQty.plus(r.currentQty);
    if (sk.weightKg != null) {
      weight = weight.plus(sk.weightKg);
      anyWeight = true;
    }
  }
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    seq: g.seq,
    note: g.note,
    sackCount: g.sacks.length,
    rollCount,
    swatchCount,
    totalQty: Number(totalQty),
    weightKg: anyWeight ? Number(weight) : null,
    createdAt: g.createdAt,
    status: g.status,
    closedAt: g.closedAt,
    shippedSackCount: g._count.sacks - g.sacks.length,
    nextPackageNo: g.nextPackageNo,
  };
}


/**
 * Ad tekilliği CANLI gruplar arasında. DB'de partial unique KURULAMAZ: "canlı"
 * tanımı ÇOCUK satıra bakıyor (havuzda çuvalı var mı) ve bir unique index başka
 * tabloyu okuyamaz. Yarışı kapatan şey `nextPackingGroupSeqTx`in advisory
 * kilididir — bu kontrol onun ARKASINDA, aynı tx içinde koşar.


/**
 * PARTİ TOPLAMLARI — TEK SQL, DB'de GROUP BY (büyük hacim planı 2026-09-22): `toDto`
 * her partinin çuval + top satırlarını belleğe çekiyordu (30 parti × 100 çuval × 20 top =
 * 60.000 satır). Burada çuval/top/kartela sayıları, metraj ve kg cari başına lateral
 * toplamla gelir; satır sayısı parti sayısı kadardır. Anlam `toDto` ile BİREBİR:
 * sackCount = havuzdaki (shipmentId NULL) çuval · rollCount/totalQty o çuvallardaki
 * bütün toplar (statü süzgeci yok) · weightKg tartılı yoksa null · shippedSackCount =
 * toplam üye − havuz. Bekçi: `test_sevk_partisi §4c` iki yolu aynı fikstürle karşılaştırır.
 */
export async function loadPackingGroupDtos(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  where: Prisma.Sql,
  orderBy: Prisma.Sql = Prisma.sql`g.seq ASC NULLS LAST, g."createdAt" ASC`,
): Promise<PackingGroupDto[]> {
  type Row = {
    id: string; code: string; name: string; seq: number | null; note: string | null; createdAt: Date;
    status: PackingGroupStatus; closedAt: Date | null; nextPackageNo: number;
    totalSacks: number; sackCount: number; rollCount: number; swatchCount: number;
    totalQty: Prisma.Decimal | null; weightKg: Prisma.Decimal | null; weighed: number;
  };
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT g.id, g.code, g.name, g.seq, g.note, g."createdAt", g.status, g."closedAt", g."nextPackageNo",
           (SELECT COUNT(*) FROM sacks s WHERE s."packingGroupId" = g.id)::int AS "totalSacks",
           COALESCE(a.sack_count, 0)::int   AS "sackCount",
           COALESCE(a.roll_count, 0)::int   AS "rollCount",
           COALESCE(a.swatch_count, 0)::int AS "swatchCount",
           a.total_qty                       AS "totalQty",
           a.weight_kg                       AS "weightKg",
           COALESCE(a.weighed, 0)::int       AS "weighed"
    FROM packing_groups g
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS sack_count,
             SUM(r.cnt) AS roll_count, SUM(r.qty) AS total_qty,
             SUM(w.cnt) AS swatch_count,
             SUM(s."weightKg") AS weight_kg, COUNT(s."weightKg") AS weighed
      FROM sacks s
      LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt, COALESCE(SUM("currentQty"), 0) AS qty FROM rolls WHERE "sackId" = s.id) r ON TRUE
      LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt FROM swatches WHERE "sackId" = s.id) w ON TRUE
      WHERE s."packingGroupId" = g.id AND s."shipmentId" IS NULL
    ) a ON TRUE
    WHERE ${where}
    ORDER BY ${orderBy}
  `);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    seq: r.seq,
    note: r.note,
    sackCount: r.sackCount,
    rollCount: r.rollCount,
    swatchCount: r.swatchCount,
    totalQty: Number(r.totalQty ?? 0),
    weightKg: r.weighed > 0 ? Number(r.weightKg ?? 0) : null,
    createdAt: r.createdAt,
    status: r.status,
    closedAt: r.closedAt,
    shippedSackCount: r.totalSacks - r.sackCount,
    nextPackageNo: r.nextPackageNo,
  }));
}

/** Tek parti — bulunamazsa null. */
export async function loadPackingGroupDto(db: Pick<Prisma.TransactionClient, "$queryRaw">, id: string): Promise<PackingGroupDto | null> {
  const rows = await loadPackingGroupDtos(db, Prisma.sql`g.id = ${id}::uuid`);
  return rows[0] ?? null;
}
