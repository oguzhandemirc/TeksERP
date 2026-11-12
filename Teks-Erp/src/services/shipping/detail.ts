// =============================================================================
// Shipping Service / detail
// =============================================================================
// Sevkiyat / doğrudan sevk detayı ve sevkiyat çuval içerikleri.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { batchLoadAliases, colorScopeOf, resolveName } from "../helpers/customer-name.helper";
import {
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { formatSackSeqLabel, readSackSeqFormat } from "../helpers/sack-seq.helper";
import { ApiResponse } from "../../types/api.types";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { formatCustomerAddress } from "../helpers/shipment-delivery.helper";
import { formatPlannedDate } from "../helpers/shipment-planned-date.helper";

/** Özet birim sayıları (9.4): `sackCount` içindeki araba / dökme — eski istemci alanları yok sayar. */
function countLoadUnits(units: readonly { unitKind: LoadUnitKind }[]): { cartCount: number; bulkCount: number } {
  return {
    cartCount: units.filter((u) => u.unitKind === LoadUnitKind.CART).length,
    bulkCount: units.filter((u) => u.unitKind === LoadUnitKind.BULK).length,
  };
}

export async function getDirectShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shippedBy: { select: { fullName: true, username: true } },
        dispatch: {
          select: {
            id: true,
            dispatchNo: true,
            workOrderId: true,
            subcontractor: { select: { id: true, name: true, code: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
            step: { select: { stepSequence: true, station: { select: { name: true, code: true } } } },
          },
        },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        allocations: {
          select: {
            qty: true,
            orderLine: {
              select: {
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
                order: { select: { orderNumber: true } },
              },
            },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");
    // DSK yalnız iş emri sevkinden doğar (top sevki); daraltma tip içindir.
    assertWorkOrderBound(ds.dispatch, "Doğrudan sevkin fason sevki");

    return {
      success: true,
      data: {
        id: ds.id,
        kind: "DIRECT" as const,
        shipmentNo: ds.shipmentNo,
        reason: ds.reason,
        totalQty: Number(ds.totalQty),
        rollCount: ds.rollCount,
        shippedAt: ds.shippedAt.toISOString(),
        createdAt: ds.createdAt.toISOString(),
        customer: ds.customer,
        branch: ds.branch,
        shippedBy: ds.shippedBy?.fullName ?? ds.shippedBy?.username ?? null,
        dispatch: {
          id: ds.dispatch.id,
          dispatchNo: ds.dispatch.dispatchNo,
          subcontractor: ds.dispatch.subcontractor,
          workOrder: ds.dispatch.workOrder,
          stationName: ds.dispatch.step.station.name,
          stepSequence: ds.dispatch.step.stepSequence,
        },
        rolls: ds.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          itemName: r.item?.name ?? "",
          colorName: r.color?.name ?? null,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade,
        })),
        allocations: ds.allocations.map((a) => ({
          orderNumber: a.orderLine.order.orderNumber,
          itemName: a.orderLine.item.name,
          colorName: a.orderLine.color?.name ?? null,
          qty: Number(a.qty),
        })),
      },
    };
  }

export async function getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true, shipmentNo: true, status: true, destination: true, procedureCode: true,
        plateNumber: true, driverName: true, carrier: true, dispatchedAt: true, createdAt: true,
        dispatchNote: true,
        manualSackCount: true,
        sackSeqPrefix: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        deliveryAddress: true,
        plannedDate: true,
        deliveryCustomer: { select: { id: true, code: true, name: true, address: true, district: true, city: true, country: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true,
                    customerItemName: true, customerColorName: true, createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: { select: { id: true, barcode: true, itemId: true, colorId: true, width: true, currentQty: true, qualityGrade: true, sackId: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          // Çözülmüş (boşalmış) dökme/araba sayılmaz, listelenmez, belgeye girmez.
          where: LIVE_LOAD_UNIT_WHERE,
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true, packageNo: true, unitKind: true, unitLabel: true, dissolvedAt: true, packingGroup: { select: { name: true, code: true } },
            // ADLİ/DETAY görünüm — hayalet BURADA FİLTRELENMEZ, aksine `status` ile
            // görünür kılınır: "ne oldu?" sorusunun cevabı bu ekranda okunur ve
            // operatörün topu çuvaldan çıkarma yolu buradan geçer. Filtrelemek sorunu
            // gizler. Sayım/belge yüzeyleri ayrıca dışlar (bkz. collectShipmentDocContent).
            // orderBy AÇIK: iade satırları listenin SONUNA eklenecek (aşağıda) ve
            // "önce elindeki mal" sırası ancak canlı taraf da deterministikse
            // anlamlı olur. Eskiden orderBy yoktu → sıra DB'nin keyfiydi.
            rolls: {
              orderBy: { createdAt: "asc" },
              select: { id: true, barcode: true, status: true, width: true, currentQty: true, qualityGrade: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } },
            },
            swatches: { select: { id: true, barcode: true, length: true, width: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
            allocations: { where: ACTIVE_SACK_ALLOCATION, select: { orderLineId: true, qty: true } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // Bu sevkiyatın satır bazlı tahsisi (çuval tahsislerinin toplamı).
    const thisShipmentByLine = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        thisShipmentByLine.set(a.orderLineId, (thisShipmentByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      }
    }

    // MÜŞTERİDEKİ AD — EKRAN İLE KÂĞIT AYNI YÜKLEMİ KULLANIR (2026-09-06).
    // Bu projeksiyon eskiden YALNIZ `OrderLine` override'ını taşıyordu; belge ise
    // `override > CustomerItemAlias/CustomerColorAlias (master) > bizim ad`
    // kademesini çözüyordu. Sonuç ölçüldü: sevk edilmiş 1.778 topun 424'ünde (%24)
    // kumaş için master alias VARDI ama override YOKTU → irsaliyede müşteri adı
    // basılıyor, elemanın ekranında hiç görünmüyordu (renk için 152 top / %9).
    // Aynı soruyu iki yüzeyin iki farklı yüklemle cevaplaması kök CLAUDE.md'nin
    // "türetilmiş alan / ayrışan yüzey" sınıfıdır; tek kaynak `customer-name.helper`.
    // Maliyet: müşteri başına 2 sorgu (`batchLoadAliases`), satır başına DEĞİL.
    const siparisKalemleri = shipment.orders.flatMap((so) => so.order.lines);
    const { itemAliasByItemId, colors } = await batchLoadAliases(
      prisma,
      shipment.customer.id,
      siparisKalemleri.map((l) => l.itemId),
      siparisKalemleri.map((l) => l.colorId),
    );

    const orders = shipment.orders.map((so) => ({
      id: so.order.id,
      orderNumber: so.order.orderNumber,
      status: so.order.status,
      deadline: so.order.deadline,
      lines: so.order.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        // ⚠️ Yalnız GERÇEKTEN bir müşteri karşılığı varsa dolu döner: `resolveName`
        // DEFAULT'a düşerse (bizim adımız) alan null kalır — arayüz "(Müşteride: X)"
        // etiketini bizim adımızla basıp kullanıcıya sahte bir karşılık göstermesin.
        const musteriKumas = resolveName(l.customerItemName, itemAliasByItemId.get(l.itemId), "");
        const renkMaster = colors.master(shipment.customer.id, l.itemId, l.colorId);
        const musteriRenk = resolveName(l.customerColorName, renkMaster?.alias, "");
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: musteriKumas.source === "DEFAULT" ? null : musteriKumas.name,
          customerColorName: musteriRenk.source === "DEFAULT" ? null : musteriRenk.name,
          colorNameScope: colorScopeOf(musteriRenk, renkMaster),
          requested,
          shipped,
          openQty: requested.minus(shipped),
          thisShipment: thisShipmentByLine.get(l.id) ?? D0(),
        };
      }),
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // İADELER — SACKS'TEN ÖNCE OKUNUR (2026-08-03)
    //
    // NEDEN: iade `RollReturn` satırı yazıp topun `sackId`/`shipmentId` FK'larını
    // NULL'lar (return.service.ts:322-325). Bu yüzden canlı `sacks[].rolls` ve
    // `shipment.rolls` iadeden SONRA eksilir — sevk EDİLMİŞ bir sevkiyatın
    // "hangi çuvalda ne gitti" cevabı geriye dönük değişirdi (saha vakası
    // SVK0308260001: 4 top iade alındı, detay ekranı "0 top · 0 m" dedi).
    //
    // Kök CLAUDE.md 2026-08-02 kuralı: "sevk rakamı BRÜT'tür; iade onu geriye
    // dönük değiştiremez." O gün fiş/irsaliye/liste/muhasebe brüte çekildi; ÇUVAL
    // İÇERİĞİ yüzeyi atlanmıştı. Burası o boşluğun kapatılması.
    //
    // Kaynak SNAPSHOT DEĞİL `RollReturn`: satır iade anını zaten donmuş taşıyor
    // (qty/width/prevQualityGrade/prevSackId) ve `attachTotals` (:2147) ile
    // `accounting-export.service.ts:257` aynı kaynağı seçti — üçüncü bir kaynak
    // üçüncü bir rakam demekti. Ek sorgu YOK: bu findMany zaten koşuyordu,
    // yalnız yukarı taşındı ve select'i genişledi.
    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, qty: true, width: true, createdAt: true, reasonText: true,
        prevSackId: true,
        // rollId: satır kimliği (`id` RollReturn'ün kendi id'si — canlı topla
        // aynı uzayda DEĞİL; dedup ve React key için gerçek top id'si lazım).
        rollId: true,
        // prevQualityGrade: iade anındaki kalite. Canlı `roll.qualityGrade`
        // okunamaz — iade topu WAREHOUSE'a çekerken kaliteyi değiştirebilir.
        prevQualityGrade: true,
        // Çok kalemli iade belgesinin kaynağı — irsaliye GRUP LİDERİNE bağlıdır;
        // üye id'siyle sorulursa belge bulunamaz (builder bilinçli null döner).
        returnGroupId: true,
        roll: { select: { barcode: true } },
        // ⚠️ `id` ŞART: Electron facet süzgeci (useShipmentDetailFilter) kumaş/renk
        // eşleşmesini ID ile yapar. id olmadan iade satırları "Kumaş" filtresi
        // seçilir seçilmez tablodan DÜŞER — üst sayaç brüt kalırken tablo nete
        // dönerdi, yani düzeltmeye çalıştığımız hastalığın aynısı.
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        reason: { select: { name: true, color: true } },
      },
    });

    // YARIŞ KORUMASI: `shipment.findUnique` ile bu findMany AYRI sorgulardır (tx
    // yok). İkisi arasında bir iade commit olursa aynı top HEM canlı `sk.rolls`
    // içinde HEM iade satırı olarak gelir → çuval ve sevkiyat sayaçları şişer.
    // Canlı id kümesiyle dedup, o pencereyi kapatır.
    const liveRollIds = new Set<string>(shipment.rolls.map((r) => r.id));
    for (const sk of shipment.sacks) for (const r of sk.rolls) liveRollIds.add(r.id);
    const freshReturnRows = returnRows.filter((rr) => !liveRollIds.has(rr.rollId));

    /** Çuval içinde basılacak iade satırı — canlı top satırıyla AYNI şekil + `returned`. */
    const toReturnedRow = (rr: (typeof freshReturnRows)[number]) => ({
      id: rr.rollId,
      barcode: rr.roll.barcode,
      item: rr.item,
      color: rr.color,
      width: rr.width,
      currentQty: rr.qty,
      qualityGrade: rr.prevQualityGrade,
      // `sackId` TAŞINIR: üst `rolls` dizisinde "çuvalsız" ayrımı bu alandan
      // yapılıyor; yazılmazsa `undefined == null` ile iade satırı hem çuvalın
      // içinde hem "çuvalsız" kümesinde görünürdü.
      sackId: rr.prevSackId,
      // Tek ayrım noktası. `status` alanına ikinci anlam YÜKLENMEZ — o alan
      // hayalet-top (SACK_ABSENT) sözleşmesine ait, karıştırmak sonraki
      // geliştirici için sessiz tuzak olur.
      returned: {
        returnId: rr.id,
        returnedAt: rr.createdAt,
        reasonName: rr.reason?.name ?? rr.reasonText ?? null,
        reasonColor: rr.reason?.color ?? null,
      },
    });

    const returnsBySack = new Map<string, ReturnType<typeof toReturnedRow>[]>();
    for (const rr of freshReturnRows) {
      if (!rr.prevSackId) continue; // legacy (kolon 2026-06'da eklendi) → çuvala düşmez
      const arr = returnsBySack.get(rr.prevSackId);
      if (arr) arr.push(toReturnedRow(rr));
      else returnsBySack.set(rr.prevSackId, [toReturnedRow(rr)]);
    }

    const totalKg = shipment.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0());

    // Sıra etiketi ("SP3"): ön ek sevkiyatta donmuş (`sackSeqPrefix`), "n/N" canlı — belgeyle aynı kural.
    const seqFmt = await readSackSeqFormat(shipment.sackSeqPrefix);
    const seqLabelOf = (seq: number | null) => {
      const l = formatSackSeqLabel(seq, shipment.sacks.length, seqFmt);
      return l && l !== String(seq) ? l : null; // düz sayıysa etiket yok (ekran "Çuval #n" basar)
    };
    const sacks = shipment.sacks.map((sk) => {
      // Çuvalın BRÜT içeriği = hâlâ içindeki toplar + bu çuvaldan iade alınanlar.
      // İade satırları SONA eklenir: operatörün elindeki mal önce okunur, iade
      // edilen mal artık orada değildir.
      const sackReturned = returnsBySack.get(sk.id) ?? [];
      const grossRolls = [...sk.rolls, ...sackReturned];

      const summaryMap = new Map<string, { itemCode: string; itemName: string; colorCode: string | null; colorName: string | null; width: Prisma.Decimal | null; totalQty: Prisma.Decimal; rollCount: number }>();
      for (const r of grossRolls) {
        const key = `${r.item.code}|${r.color?.code ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
        let e = summaryMap.get(key);
        if (!e) {
          e = { itemCode: r.item.code, itemName: r.item.name, colorCode: r.color?.code ?? null, colorName: r.color?.name ?? null, width: r.width, totalQty: D0(), rollCount: 0 };
          summaryMap.set(key, e);
        }
        e.totalQty = e.totalQty.plus(r.currentQty);
        e.rollCount += 1;
      }
      return {
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, seqLabel: seqLabelOf(sk.seq), weightKg: sk.weightKg,
        // Sevk partisi (2026-09-21) — detay/önizleme rozeti; partisiz çuvalda null.
        packageNo: sk.packageNo, packingGroupName: sk.packingGroup?.name ?? null, packingGroupCode: sk.packingGroup?.code ?? null,
        // Yük birimi (çuvalsız sevk): eski panel alanı yok sayar, çuval gibi çizer.
        unitKind: sk.unitKind, unitLabel: sk.unitLabel, dissolvedAt: sk.dissolvedAt,
        rolls: grossRolls,
        swatches: sk.swatches,
        productSummary: [...summaryMap.values()],
        rollCount: grossRolls.length,
        // Ayrı sayaç: satır basmayan yüzeyler (mobil çuval kartı) rozeti bundan
        // kurar — orada `rolls` dizisi hiç render edilmiyor, yalnız bu iki sayı
        // okunuyor. Olmasaydı mobilde işaretsiz şişmiş rakam doğardı.
        returnedCount: sackReturned.length,
        returnedQty: sackReturned.reduce((s, r) => s.plus(r.currentQty), D0()),
        swatchCount: sk.swatches.length,
      };
    });

    // prevSackId = iade anındaki çuval (top artık o çuvalda değil ama iz burada); UI
    // sackNo/seq'i sevkiyatın YÜKLÜ sacks[]'ından çözer (çuval sevkiyatta kalır).
    // Bu dizi ekrandaki "BU SEVKİYATTAN İADE EDİLENLER" kartını besler ve AYNEN
    // KALIR — sektör standardındaki ayrı "iade defteri"nin karşılığıdır; çuval
    // içindeki rozetli satır onun yerine geçmez, konumunu söyler.
    const returnedRolls = returnRows.map((rr) => ({ id: rr.id, documentSourceId: rr.returnGroupId ?? rr.id, barcode: rr.roll.barcode, item: rr.item, color: rr.color, width: rr.width, qty: rr.qty, returnedAt: rr.createdAt, reasonName: rr.reason?.name ?? rr.reasonText ?? null, reasonColor: rr.reason?.color ?? null, prevSackId: rr.prevSackId }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    // ⚠️ TEK KAYNAK: brüt top dizisi BİR KEZ kurulur, hem payload'daki `rolls`
    // hem `summary` ONDAN türetilir. İkisini ayrı ayrı toplamak (canlı + iade)
    // klasik çift-sayım tuzağıdır — mobilin bugün yaptığı hatanın (istemcide
    // `rollCount + returnedCount`) backend ikizi olurdu.
    const grossShipmentRolls = [
      ...shipment.rolls.map((r) => ({ id: r.id, barcode: r.barcode, item: r.item, color: r.color, width: r.width, currentQty: r.currentQty, qualityGrade: r.qualityGrade, sackId: r.sackId })),
      ...freshReturnRows.map(toReturnedRow),
    ];
    const totalMeters = grossShipmentRolls.reduce((s, r) => s.plus(r.currentQty), D0());

    // DEFTER BOŞLUĞU (2026-09-06) — "çıkan mal ↔ siparişe yazılan" farkı.
    // Bugüne kadar bu sayı YALNIZ audit izinde vardı (`tahsissizMetraj`), yani
    // hiçbir ekranda görünmüyordu. Ölçüldü: sevk edilmiş 89 sevkiyatın 42'sinde
    // fark var (11.384,7 m) ve sipariş "Açık" kaldığı için aynı mal yeniden
    // üretime verilebiliyordu. Sayı, siparişi OLAN sevkiyatlarda anlamlıdır.
    const defterYazilan = shipment.sacks.reduce(
      (a2, sk) => a2 + sk.allocations.reduce((b2, x) => b2 + Number(x.qty), 0),
      0,
    );
    const defterCikan = shipment.sacks.reduce(
      (a2, sk) => a2 + sk.rolls.reduce((b2, r) => b2 + Number(r.currentQty), 0),
      0,
    );
    const defterBoslugu =
      shipment.orders.length === 0 ? null : Math.max(0, Math.round((defterCikan - defterYazilan) * 1000) / 1000);

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        /** Siparişe yazılamayan metraj; `null` = sevkiyatın siparişi yok (soru anlamsız). */
        defterBoslugu,
        destination: shipment.destination,
        procedureCode: shipment.procedureCode,
        dispatchNote: shipment.dispatchNote,
        manualSackCount: shipment.manualSackCount,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        // Teslim yeri (K18): kayıtlı adres; boşsa `deliveryCustomer.address` kart adresinin tek satırı (belge de bunu basar).
        deliveryCustomer: shipment.deliveryCustomer
          ? { id: shipment.deliveryCustomer.id, code: shipment.deliveryCustomer.code, name: shipment.deliveryCustomer.name, address: formatCustomerAddress(shipment.deliveryCustomer) }
          : null,
        deliveryAddress: shipment.deliveryAddress,
        plannedDate: formatPlannedDate(shipment.plannedDate),
        orders,
        rolls: grossShipmentRolls,
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        // rollCount/totalMeters artık BRÜT — `attachTotals` (liste) ile birebir
        // aynı anlam. Eskiden liste "4 top / 212 m" derken detay "0 top / 0 m"
        // diyordu; alan adları aynı kaldı, anlamları BİRLEŞTİ. Net isteyen
        // `rollCount − returnedCount` yapar (ikisi de yanıtta).
        // `totalKg` DEĞİŞMEZ: iade `Sack.weightKg`'a dokunmuyor → zaten brüt;
        // geri-ekleme yapmak çift sayardı.
        // Birim sayıları (9.4): `sackCount` BÜTÜN canlı birimlerdir (eski istemci sözleşmesi, board ile aynı);
        // araba/dökme ayrıca sayılır ki özet dökme sevkiyatı "1 çuval" diye yazmasın.
        summary: { rollCount: grossShipmentRolls.length, swatchCount: shipment.swatches.length, totalMeters, sackCount: shipment.sacks.length, ...countLoadUnits(shipment.sacks), totalKg, returnedCount: returnedRolls.length, returnedMeters },
      },
    };
  }

export async function getShipmentSackContents(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true, plateNumber: true, driverName: true, carrier: true, sackSeqPrefix: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        sacks: {
          // Çözülmüş (boşalmış) dökme/araba sayılmaz, listelenmez, belgeye girmez.
          where: LIVE_LOAD_UNIT_WHERE,
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true, notes: true, unitKind: true, unitLabel: true,
            // `status`: hayalet top görünür kalsın (array FİLTRELENMEZ — operatörün
            // görüp çıkarabilmesi için); sayaçlar/gruplar aşağıda dışlar.
            rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, status: true, currentQty: true, width: true, qualityGrade: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
            swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const seqFmt = await readSackSeqFormat(sh.sackSeqPrefix);
    const seqLabelOf = (seq: number | null) => {
      const l = formatSackSeqLabel(seq, sh.sacks.length, seqFmt);
      return l && l !== String(seq) ? l : null;
    };
    const sacks = sh.sacks.map((sk) => {
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: Prisma.Decimal; rollCount: number }>();
      let sackQty = D0();
      // Gruplar + sayaçlar yalnız FİZİKSEL OLARAK ÇUVALDA olan toplardan (etiket ve
      // irsaliye ile aynı küme); `sk.rolls` görünümde tamamıyla döner.
      const present = sk.rolls.filter((r) => !SACK_ABSENT_STATUSES.includes(r.status));
      for (const r of present) {
        const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
        const g = groups.get(key) ?? { itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width ? Number(r.width) : null, qty: D0(), rollCount: 0 };
        g.qty = g.qty.plus(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        sackQty = sackQty.plus(r.currentQty);
      }
      return {
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, seqLabel: seqLabelOf(sk.seq), weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        notes: sk.notes, unitKind: sk.unitKind, unitLabel: sk.unitLabel,
        rollCount: present.length, swatchCount: sk.swatches.length, totalQty: Number(sackQty),
        contents: [...groups.values()].map((g) => ({ itemName: g.itemName, colorName: g.colorName, width: g.width, qty: Number(g.qty), rollCount: g.rollCount })),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, status: r.status, qty: Number(r.currentQty), width: r.width != null ? Number(r.width) : null, qualityGrade: r.qualityGrade ?? "", item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });

    return { success: true, data: { id: sh.id, shipmentNo: sh.shipmentNo, status: sh.status, plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, customer: sh.customer, branch: sh.branch, sackCount: sh.sacks.length, ...countLoadUnits(sh.sacks), sacks } };
  }
