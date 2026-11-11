// =============================================================================
// AÇILIŞ PANOSU — akış kutuları: stok giriş–çıkış (metre + iplik kg) · nakit giriş–çıkış
// =============================================================================
// Stok: DEPO HAREKET DEFTERİ'nin kendi işareti — `toWarehouseId` dolu/`from` boş satır fabrikaya
// GİRİŞ, tersi ÇIKIŞ (mutabakat formülüyle aynı yön). Depolar arası transfer (iki uç dolu) iç
// harekettir, sayılmaz; TRANSFORM (kesim, grup net sıfır) ve OPENING_BALANCE (kesme fotoğrafı)
// hareket değildir. Ters kayıt kendi gününde ters yönde görünür (defter brüttür).
// İplik: `yarnMovementSign` (bakiye artıran = giriş). Nakit: Kasa-Banka Defteri evreni, virman hariç.
// =============================================================================
import { Prisma, type YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { round1 } from "../reports/_breakdown";
import { yarnMovementSign } from "../helpers/yarn-sign.helper";
import { bucketKeySql } from "./pano-donem";
import type { PanoSources } from "./pano-kaynak";
import type { BoxInput } from "./pano-kutu-mevcut";
import { cashFlowCur } from "./pano-kutu-satis";

interface StockFlowRow { k: string; type: string; qtyIn: number | null; qtyOut: number | null }
interface YarnFlowRow { k: string; kind: YarnMovementKind; qty: number | null }

function stockFlow(src: PanoSources): Promise<StockFlowRow[]> {
  const { aralik, kova } = src.window;
  return src.once("stockFlow", () => prisma.$queryRaw<StockFlowRow[]>(Prisma.sql`
    SELECT ${bucketKeySql(kova, `m."createdAt"`)} AS k, m."eventType"::text AS type,
           SUM(m.qty) FILTER (WHERE m."toWarehouseId" IS NOT NULL AND m."fromWarehouseId" IS NULL)::float AS "qtyIn",
           SUM(m.qty) FILTER (WHERE m."fromWarehouseId" IS NOT NULL AND m."toWarehouseId" IS NULL)::float AS "qtyOut"
    FROM warehouse_movements m
    WHERE m."createdAt" >= ${aralik.from} AND m."createdAt" <= ${aralik.to}
      AND m."eventType" NOT IN ('TRANSFORM', 'OPENING_BALANCE')
    GROUP BY 1, 2`));
}

function yarnFlow(src: PanoSources): Promise<YarnFlowRow[]> {
  const { aralik, kova } = src.window;
  return src.once("yarnFlow", () => prisma.$queryRaw<YarnFlowRow[]>(Prisma.sql`
    SELECT ${bucketKeySql(kova, `y."createdAt"`)} AS k, y.kind AS kind, SUM(y."qtyKg")::float AS qty
    FROM yarn_movements y
    WHERE y."createdAt" >= ${aralik.from} AND y."createdAt" <= ${aralik.to}
    GROUP BY 1, 2`));
}

type Pair = { in: number; out: number };
const bump = (m: Map<string, Pair>, key: string, qin: number, qout: number): void => {
  const c = m.get(key) ?? { in: 0, out: 0 };
  c.in += qin;
  c.out += qout;
  m.set(key, c);
};

export async function stockFlowBox({ src, can }: BoxInput) {
  const [rows, yarn] = await Promise.all([stockFlow(src), can.iplik ? yarnFlow(src) : Promise.resolve(null)]);
  const byKey = new Map<string, Pair>();
  const byType = new Map<string, Pair>();
  for (const r of rows) {
    const qin = Number(r.qtyIn ?? 0);
    const qout = Number(r.qtyOut ?? 0);
    bump(byKey, r.k, qin, qout);
    bump(byType, r.type, qin, qout);
  }
  const yarnByKey = new Map<string, Pair>();
  for (const r of yarn ?? []) {
    const q = Number(r.qty ?? 0);
    if (yarnMovementSign(r.kind) > 0) bump(yarnByKey, r.k, q, 0);
    else bump(yarnByKey, r.k, 0, q);
  }
  const sum = (m: Map<string, Pair>): Pair => [...m.values()].reduce((a, p) => ({ in: a.in + p.in, out: a.out + p.out }), { in: 0, out: 0 });
  const total = sum(byKey);
  const yarnTotal = sum(yarnByKey);
  return {
    kova: src.window.kova,
    noktalar: src.window.anahtarlar.map((k) => ({
      anahtar: k,
      girisMetre: round1(byKey.get(k)?.in ?? 0),
      cikisMetre: round1(byKey.get(k)?.out ?? 0),
      iplikGirisKg: yarn ? round1(yarnByKey.get(k)?.in ?? 0) : null,
      iplikCikisKg: yarn ? round1(yarnByKey.get(k)?.out ?? 0) : null,
    })),
    toplam: { girisMetre: round1(total.in), cikisMetre: round1(total.out) },
    turler: [...byType].map(([tur, p]) => ({ tur, girisMetre: round1(p.in), cikisMetre: round1(p.out) }))
      .filter((t) => t.girisMetre > 0 || t.cikisMetre > 0)
      .sort((a, b) => b.girisMetre + b.cikisMetre - (a.girisMetre + a.cikisMetre)),
    iplik: yarn ? { girisKg: round1(yarnTotal.in), cikisKg: round1(yarnTotal.out) } : null,
  };
}

const cents = (v: Prisma.Decimal): number => v.toDecimalPlaces(2).toNumber();

export async function cashFlowBox({ src }: BoxInput) {
  const rows = (await cashFlowCur(src)).filter((r) => !r.transfer);
  const byCur = new Map<string, Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>>();
  for (const r of rows) {
    const series = byCur.get(r.currency) ?? new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
    const c = series.get(r.k) ?? { in: new Prisma.Decimal(0), out: new Prisma.Decimal(0) };
    if (r.direction === "IN") c.in = c.in.add(r.amount);
    else c.out = c.out.add(r.amount);
    series.set(r.k, c);
    byCur.set(r.currency, series);
  }
  return {
    kova: src.window.kova,
    paraBirimleri: [...byCur.keys()].sort().map((currency) => {
      const series = byCur.get(currency)!;
      const zero = new Prisma.Decimal(0);
      const all = [...series.values()];
      return {
        paraBirimi: currency,
        noktalar: src.window.anahtarlar.map((k) => ({ anahtar: k, giris: cents(series.get(k)?.in ?? zero), cikis: cents(series.get(k)?.out ?? zero) })),
        toplamGiris: cents(all.reduce((a, c) => a.add(c.in), zero)),
        toplamCikis: cents(all.reduce((a, c) => a.add(c.out), zero)),
      };
    }),
  };
}
