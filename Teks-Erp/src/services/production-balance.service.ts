// =============================================================================
// TeksERP - Ürün Dengesi (MRP net ihtiyaç) servisi
// =============================================================================
// Spec (ürün+renk+en) bazında arz/talep dengesi. Fabrika DOKUMA YAPMAZ — kumaş
// hazır gelir, sadece işlenir. Bu yüzden iki açık ayrılır:
//   üretilecek    = Talep − Depo − Üretimde   (WO açılacak miktar)
//   malzeme açığı = üretilecek − Ham           (kumaş tedariki gereken kısım)
//
// Talep    = Σ (quantity − shippedQty) açık siparişlerden (CANCELLED/COMPLETED hariç)
// Depo     = WAREHOUSE, sevke okutulmamış (shipmentId=null) toplar
// Ham      = STOCK, sevksiz toplar (işlenecek hazır kumaş)
// Üretimde = canlı WO'ların (PLANNED/IN_PROGRESS) hedef-spec başına
//            in-flight malzemesi = committed − finished (computeWoMaterial).
//            Renk-veren fason (beyaz→kırmızı) doğru spec'e yazılsın diye top
//            statüsünden değil WO HEDEF spec'inden hesaplanır.
// =============================================================================

import prisma from "../lib/prisma";
import { OrderStatus, Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import { ApiResponse } from "../types/api.types";
import { computeWoMaterial } from "./helpers/coverage.helper";

const LIVE_WO: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
];

const D0 = () => new Prisma.Decimal(0);

function specKey(
  itemId: string,
  colorId: string | null,
  width: Prisma.Decimal | number | null
): string {
  const w = width == null ? "" : new Prisma.Decimal(width).toString();
  return `${itemId}|${colorId ?? ""}|${w}`;
}

/** Drill-down: bu spec'in açık sipariş kalemi (WO formuna bind için yeterli alan). */
export interface BalanceLine {
  lineId: string;
  orderId: string;
  orderNumber: string;
  deadline: Date | null;
  orderDate: Date;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  shipped: Prisma.Decimal;
  /** Rezerv YOK (çuval depo modeli) — her zaman 0. Geriye uyum için tutulur. */
  packed: Prisma.Decimal;
  /** istenen − sevk (net açık talep; rezerv yok). */
  remaining: Prisma.Decimal;
  /** istenen − sevk − canlı WO rezervesi = yeni WO'ya serbest tahsis tavanı. */
  open: Prisma.Decimal;
  requiredProperties: { id: string; name: string }[];
}

/** Drill-down: bu spec'i üreten canlı WO. */
export interface BalanceWo {
  id: string;
  batchNumber: string;
  status: WorkOrderStatus;
  inFlight: Prisma.Decimal;
}

/**
 * En (width) alt-satırı. Ham kumaşın eni önemsiz olduğu için ham/malzeme açığı
 * BURADA YOK — onlar (ürün+renk) grubu düzeyinde (bkz. BalanceGroup). Depo
 * (bitmiş mal) en'e göre birebir olduğundan alt-satırda kalır.
 */
export interface BalanceSpecRow {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: Prisma.Decimal | null;
  talep: Prisma.Decimal;
  depo: Prisma.Decimal;
  uretimde: Prisma.Decimal;
  /** max(0, talep − depo − üretimde) → bu en için WO açılacak miktar. */
  uretilecek: Prisma.Decimal;
  lines: BalanceLine[];
  wos: BalanceWo[];
}

/**
 * (ürün, renk) grubu. Ham kumaşın eni önemsiz (KK1'de opsiyonel, fasonda
 * işlenir/boyanır) → ham havuzu + malzeme açığı bu düzeyde TEK hesaplanır,
 * en alt-satırlarına bölünmez (aksi halde aynı havuz her en satırına yazılıp
 * çift sayılırdı). Talep/Depo/Üretimde/Üretilecek başlıkta Σ; kırılım specs[].
 */
export interface BalanceGroup {
  key: string; // itemId|colorId
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  talep: Prisma.Decimal;
  depo: Prisma.Decimal;
  uretimde: Prisma.Decimal;
  uretilecek: Prisma.Decimal;
  /** Sevksiz STOCK havuzu (ürün+renk; en-agnostik, renksiz ham renk-joker). */
  ham: Prisma.Decimal;
  /** max(0, Σüretilecek − ham) → kumaş tedariki gereken kısım. */
  malzemeAcigi: Prisma.Decimal;
  specs: BalanceSpecRow[];
}

interface SpecAcc extends BalanceSpecRow {
  /** İsim doldurulmuş mu — ilk dolduran sabitlesin. */
  named: boolean;
}

export class ProductionBalanceService {
  /**
   * @param opts.itemId Verilirse arz/talep/üretim havuzları tek ürüne daraltılır
   *   (orderLine + roll groupBy + workOrder where'lerine eklenir) → daha az
   *   hesap + küçük payload. Verilmezse tüm spec'ler (eski davranış).
   */
  async getBalance(
    opts: { itemId?: string } = {}
  ): Promise<ApiResponse<BalanceGroup[]>> {
    const { itemId } = opts;
    const map = new Map<string, SpecAcc>();

    const ensure = (
      itemId: string,
      colorId: string | null,
      width: Prisma.Decimal | null,
      names?: {
        itemName?: string | null;
        colorName?: string | null;
        colorHex?: string | null;
      }
    ): SpecAcc => {
      const key = specKey(itemId, colorId, width);
      let acc = map.get(key);
      if (!acc) {
        acc = {
          key,
          itemId,
          colorId,
          width,
          itemName: names?.itemName ?? "—",
          colorName: names?.colorName ?? null,
          colorHex: names?.colorHex ?? null,
          talep: D0(),
          depo: D0(),
          uretimde: D0(),
          uretilecek: D0(),
          lines: [],
          wos: [],
          named: Boolean(names?.itemName),
        };
        map.set(key, acc);
      } else if (!acc.named && names?.itemName) {
        acc.itemName = names.itemName;
        acc.colorName = names.colorName ?? acc.colorName;
        acc.colorHex = names.colorHex ?? acc.colorHex;
        acc.named = true;
      }
      return acc;
    };

    // 1) Talep — açık sipariş kalemleri
    const lines = await prisma.orderLine.findMany({
      where: {
        order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
        ...(itemId ? { itemId } : {}),
      },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        item: { select: { name: true } },
        color: { select: { name: true, hex: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            orderDate: true,
            customer: { select: { id: true, name: true } },
          },
        },
        requiredProperties: {
          select: { propertyId: true, property: { select: { name: true } } },
        },
      },
    });

    // F237: computeLineCoverage(coverage=shippedQty) tüm açık kalemleri GEREKSİZ
    // ikinci kez tarıyordu. lines zaten shippedQty ile yüklü; remaining =
    // max(0, quantity - shippedQty) → open = remaining.floor() (birebir eşdeğer, bir DB round-trip elenir).
    for (const l of lines) {
      const acc = ensure(l.itemId, l.colorId, l.width, {
        itemName: l.item.name,
        colorName: l.color?.name ?? null,
        colorHex: l.color?.hex ?? null,
      });
      // Talep = quantity − sevk − çuvallanmış (havuz/planlı rezerv). Çuvallanmış mal
      // fiziksel olarak üretilmiş → talebi karşılar, arz havuzundan (sackId:null) düşülür.
      const remaining = Prisma.Decimal.max(
        0,
        new Prisma.Decimal(l.quantity).minus(l.shippedQty)
      );
      acc.talep = acc.talep.plus(remaining);
      if (remaining.greaterThan(0)) {
        acc.lines.push({
          lineId: l.id,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          orderDate: l.order.orderDate,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          itemId: l.itemId,
          itemName: l.item.name,
          colorId: l.colorId,
          colorName: l.color?.name ?? null,
          colorHex: l.color?.hex ?? null,
          width: l.width,
          quantity: new Prisma.Decimal(l.quantity),
          shipped: new Prisma.Decimal(l.shippedQty),
          packed: new Prisma.Decimal(0),
          remaining,
          // Tabana yuvarla: metre tamsayı; pro-rata bölme artığı (…,371) atılır.
          // floor → backend remaining (ondalıklı) asla aşılmaz. F237: remaining'den türetilir.
          open: remaining.floor(),
          requiredProperties: l.requiredProperties.map((rp) => ({
            id: rp.propertyId,
            name: rp.property.name,
          })),
        });
      }
    }

    // 2) Arz havuzu (sevksiz) — depo (WAREHOUSE, bitmiş) + ham (STOCK, işlenecek).
    // Satıra ENSURE ile eklenmez; aşağıda eşleşir.
    //   Depo: birebir (ürün+renk+en) — renk + en zaten bitmiş malda sabit → en
    //         alt-satırına yazılır.
    //   Ham : EN-AGNOSTİK (ham kumaşın eni önemsiz) — (ürün, renk) GRUBU düzeyinde
    //         tek sayılır. Renksiz (color=null) ham, boyanacağı için aynı ürünün
    //         her rengine joker sayılır (mevcut davranış korunur).
    const supply = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width", "status"],
      where: {
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
        shipmentId: null,
        sackId: null, // çuvaldaki (bekleyen) mal serbest arz sayılmaz → çift sayım olmasın (§4)
        ...(itemId ? { itemId } : {}),
      },
      _sum: { currentQty: true },
    });

    // 3) Üretimde — canlı WO'lar, hedef spec başına in-flight (committed − finished)
    const wos = await prisma.workOrder.findMany({
      where: {
        status: { in: LIVE_WO },
        isActive: true,
        targetItemId: itemId ?? { not: null },
      },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
        targetItem: { select: { name: true } },
        targetColor: { select: { name: true, hex: true } },
      },
    });
    const woMat = await computeWoMaterial(prisma, wos.map((w) => w.id));
    for (const w of wos) {
      if (!w.targetItemId) continue;
      const acc = ensure(w.targetItemId, w.targetColorId, w.width, {
        itemName: w.targetItem?.name ?? null,
        colorName: w.targetColor?.name ?? null,
        colorHex: w.targetColor?.hex ?? null,
      });
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? D0()).minus(mat?.finished ?? D0())
      );
      acc.uretimde = acc.uretimde.plus(inFlight);
      if (inFlight.greaterThan(0)) {
        acc.wos.push({
          id: w.id,
          batchNumber: w.batchNumber,
          status: w.status,
          inFlight,
        });
      }
    }

    // 4) Depo eşleştirme (per-en birebir) + türev kolon + filtre → en alt-satırları.
    //    Ham bu aşamada DEĞİL — (ürün,renk) grubu düzeyinde, aşağıda (5).
    //
    // Perf: supply gruplarını TEK SEFER indeksle → her acc/grp için tüm supply'ı
    // taramak yerine doğrudan arama. Eskiden O(spec × arz) iç içe döngüydü;
    // büyük katalogda (binlerce spec × binlerce arz) milyonlarca karşılaştırma
    // yapıyordu. Davranış birebir aynı:
    //   - WAREHOUSE: (itemId,colorId,width) groupBy anahtarında zaten tekil →
    //     specKey ile birebir Map (acc.key = specKey(itemId,colorId,width)).
    //   - STOCK: en-agnostik + renk-joker → item bazında listele, joker mantığı korunur.
    const warehouseByKey = new Map<string, Prisma.Decimal>();
    const stockByItem = new Map<
      string,
      { colorId: string | null; qty: Prisma.Decimal }[]
    >();
    for (const g of supply) {
      const qty = new Prisma.Decimal(g._sum.currentQty ?? 0);
      if (qty.lessThanOrEqualTo(0)) continue;
      if (g.status === RollStatus.WAREHOUSE) {
        warehouseByKey.set(specKey(g.itemId, g.colorId, g.width), qty);
      } else if (g.status === RollStatus.STOCK) {
        let list = stockByItem.get(g.itemId);
        if (!list) {
          list = [];
          stockByItem.set(g.itemId, list);
        }
        list.push({ colorId: g.colorId, qty });
      }
    }

    const rows: BalanceSpecRow[] = [];
    for (const acc of map.values()) {
      // Depo: birebir ürün+renk+en (acc.key = specKey(itemId,colorId,width)).
      acc.depo = acc.depo.plus(warehouseByKey.get(acc.key) ?? 0);

      acc.uretilecek = Prisma.Decimal.max(
        0,
        acc.talep.minus(acc.depo).minus(acc.uretimde)
      );
      if (acc.talep.greaterThan(0) || acc.uretimde.greaterThan(0)) {
        // termin sırasıyla göster (bind seed'i için de hazır sıra)
        acc.lines.sort((a, b) => {
          const ad = a.deadline ? a.deadline.getTime() : Infinity;
          const bd = b.deadline ? b.deadline.getTime() : Infinity;
          if (ad !== bd) return ad - bd;
          return a.orderDate.getTime() - b.orderDate.getTime();
        });
        const { named: _named, ...spec } = acc;
        void _named;
        rows.push(spec);
      }
    }

    // 5) (ürün, renk) grubu: en alt-satırlarını topla; ham + malzeme açığı
    //    grup düzeyinde TEK hesaplanır (en-agnostik havuz → çift sayım yok).
    const groupMap = new Map<string, BalanceGroup>();
    for (const row of rows) {
      const gKey = `${row.itemId}|${row.colorId ?? ""}`;
      let grp = groupMap.get(gKey);
      if (!grp) {
        grp = {
          key: gKey,
          itemId: row.itemId,
          itemName: row.itemName,
          colorId: row.colorId,
          colorName: row.colorName,
          colorHex: row.colorHex,
          talep: D0(),
          depo: D0(),
          uretimde: D0(),
          uretilecek: D0(),
          ham: D0(),
          malzemeAcigi: D0(),
          specs: [],
        };
        groupMap.set(gKey, grp);
      }
      grp.talep = grp.talep.plus(row.talep);
      grp.depo = grp.depo.plus(row.depo);
      grp.uretimde = grp.uretimde.plus(row.uretimde);
      grp.uretilecek = grp.uretilecek.plus(row.uretilecek);
      grp.specs.push(row);
    }

    for (const grp of groupMap.values()) {
      // Ham havuzu: sevksiz STOCK, ürün+renk uyumlu, EN-AGNOSTİK (tek sayım).
      // Yalnız bu ürünün STOCK satırlarını gez (renk-joker mantığı korunur).
      for (const s of stockByItem.get(grp.itemId) ?? []) {
        const colorOk =
          s.colorId == null || grp.colorId == null || s.colorId === grp.colorId;
        if (colorOk) grp.ham = grp.ham.plus(s.qty);
      }
      grp.malzemeAcigi = Prisma.Decimal.max(0, grp.uretilecek.minus(grp.ham));
      // En alt-satırlarını en çok üretilecek olan üste.
      grp.specs.sort((a, b) => b.uretilecek.comparedTo(a.uretilecek));
    }

    // En çok üretilecek olan grup üste — planlamacı önceliği.
    const data = [...groupMap.values()].sort((a, b) =>
      b.uretilecek.comparedTo(a.uretilecek)
    );

    return { success: true, data };
  }
}
