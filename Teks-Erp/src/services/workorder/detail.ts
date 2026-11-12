// =============================================================================
// TeksERP - WorkOrder (Parti) Service / detail
// =============================================================================
// Tekil iş emri detayı (findById).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import {
  ACTIVE_TARGET_PROPERTY,
} from "../helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  RollStatus,
  Prisma,
} from "@prisma/client";
import { resolveProducedOutputWhere } from "../helpers/produced-output.helper";
import { loadCloseSnapshotView } from "../helpers/workorder-close-snapshot.helper";
import { computeWorkOrderLocks } from "../helpers/workorder-locks.helper";
import { targetValueEditLock } from "../helpers/workorder-target-value-step.helper";
import { KURSUN_PROPERTY_CODE } from "../helpers/quality-station.helper";
import { computeWoInput } from "../helpers/coverage.helper";
import { computeWoIncoming, woMemberRootInput, type WoIncoming } from "../helpers/wo-incoming.helper";
import { loadProducedBuckets } from "../helpers/roll-finalize.helper";
import { workOrderBoundOnly } from "../helpers/dispatch-header.helper";
import { hasRoll } from "../helpers/dispatch-item-kind.helper";
import { TERIM } from "../../constants/terim";

export async function findById(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        targetItem: true,
        targetColor: true,
        customer: { select: { id: true, name: true, code: true } },
        // Tablet detay özeti (2026-11-09, additive): canlı partiler, oluşturan, hedef çeşit değerleri (gramaj).
        batches: { where: { mergedIntoId: null }, select: { id: true, batchNumber: true }, orderBy: { createdAt: "asc" } },
        createdBy: { select: { id: true, fullName: true } },
        // propertyId/variantOfPropertyId: tablet hedef değeri hangi adımın istasyon yeteneğine bağlı eşler (2026-11-09, additive).
        // values + edit (aşağıda): tablet "Hedef değeri değiştir" seçenekleri ve adım kilidi (2026-11-09, additive).
        targetValues: {
          where: { revokedAt: null },
          select: {
            propertyId: true, valueId: true, value: { select: { name: true } },
            property: {
              select: {
                name: true, variantOfPropertyId: true, variantOf: { select: { code: true } },
                values: { where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
              },
            },
          },
        },
        // Aktif süzgeç ŞART: panel prefill bu listeyi PUT replace'e echo eder — damgalı
        // hedef burada dönerse replace onu DİRİLTİR.
        targetProperties: { where: ACTIVE_TARGET_PROPERTY, include: { property: true } },
        steps: {
          include: {
            // propertyCapabilities: adım→hedef özellik eşlemesi (tablet rota çipi altı); additive.
            station: { include: { propertyCapabilities: { select: { propertyId: true } } } },
            requiredCategory: true,
            plannedSubcontractor: true,
          },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          where: ACTIVE_ORDER_LINK,
          orderBy: { createdAt: "asc" },
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true, branch: { select: { id: true, name: true, code: true } } } },
                item: true,
                color: true,
                requiredProperties: { include: { property: true } },
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı` };
    }

    // dispatchedTotalQty: iptal edilmemiş fason sevklerinin toplam metrajı
    // (detay panelinde "Sevk: X / Y mt · kaldı Z" gösterimi için)
    const dispatchSum = await prisma.subcontractorDispatch.aggregate({
      where: { workOrderId: id, cancelledAt: null },
      _sum: { totalQty: true },
    });
    const dispatchedTotalQty = dispatchSum._sum.totalQty ?? 0;

    // Adım bazlı anlık ürün özeti + WO geneli üretilen nihai toplar.
    // currentStepId = şu an o adımda fiziksel olarak bekleyen rulolar (ham/boyalı/açık kumaş).
    // producedInStepId + depo/sevk statüsü = WO'nun ürettiği nihai çıktı.
    const stepIds = wo.steps.map((s) => s.id);
    // Sevkin kendi talimatı boşsa düşülecek default: o adımın notu (per-step).
    const stepNotesById = new Map(wo.steps.map((s) => [s.id, s.notes]));
    // Meter alanları Prisma.Decimal — JS float drift'i önlemek için. Response
    // serializer (json-replacer) Decimal → number'a otomatik çevirir, frontend
    // her zaman number görür.
    const stepRollSummaries = new Map<
      string,
      {
        count: number;
        totalMeters: Prisma.Decimal;
        rawCount: number;
        rawMeters: Prisma.Decimal;
        dyedCount: number;
        dyedMeters: Prisma.Decimal;
        openFabricCount: number;
        openFabricMeters: Prisma.Decimal;
        // Durum kırılımı (masaüstü fason sevk aksiyonu gating'i için): adımda
        // fiziksel BEKLEYEN (sevke hazır) vs FASONDA (dışarıda) top ayrımı.
        // EXTERNAL adımda AT_SUBCONTRACTOR top da currentStepId=step taşır →
        // "count" ikisini birleştirir; bu iki alan ayırır.
        waitingCount: number;
        waitingMeters: Prisma.Decimal;
        atSubcontractorCount: number;
        atSubcontractorMeters: Prisma.Decimal;
      }
    >();
    /** Üretim çıktısının kategori bazlı kırılımı.
     *  Tambur tüm çıktıyı `status=WAREHOUSE` olarak yazar; ayrım `qualityGrade`
     *  üzerinden: "1.KALITE" → warehouse, "A1" → a1, "FIRE" → fire.
     *  Toplam top sayısı warehouse+a1+fire (kartela ayrı); toplam metraj
     *  warehouse+a1 (fire metre kaybı sayılmaz). */
    let producedRolls: {
      count: number;
      totalMeters: Prisma.Decimal;
      warehouse: { count: number; totalMeters: Prisma.Decimal };
      a1: { count: number; totalMeters: Prisma.Decimal };
      fire: { count: number; totalMeters: Prisma.Decimal };
      items: Array<{
        id: string;
        barcode: string | null;
        qualityGrade: string | null;
        /** Snapshot için production anındaki metraj (initialQty). */
        currentQty: Prisma.Decimal;
        /** Anlık durum — frontend re-cut/iptal rozetlerini buradan basar. */
        status: RollStatus;
        color: { code: string; name: string; hex: string | null } | null;
        createdAt: Date;
      }>;
    } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
      warehouse: { count: 0, totalMeters: new Prisma.Decimal(0) },
      a1: { count: 0, totalMeters: new Prisma.Decimal(0) },
      fire: { count: 0, totalMeters: new Prisma.Decimal(0) },
      items: [],
    };

    // Üretime giren ham toplar — WO'nun ilk adımına giren ayrık toplar (aşağıda
    // RollMovement üzerinden, stepIds hesaplandıktan sonra doldurulur).
    let inputRolls: { count: number; totalMeters: Prisma.Decimal } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
    };
    // Gelen (belgeden): kök topların belge satırları — metre + kg; belgeden doğmamış İE'de null (2026-11-09 ek alan).
    let incoming: WoIncoming | null = null;

    // Per-step individual roll listesi — detay panelinde "hangi parça kaç metre"
    // sorusunun cevabı. Aggregate ile aynı sorgudan dolduruyoruz, ek round-trip yok.
    const stepRolls = new Map<
      string,
      Array<{
        id: string;
        barcode: string | null;
        /** Anlık durum — UI: AT_SUBCONTRACTOR (fasonda) vs bekliyor ayrımı için. */
        status: RollStatus;
        currentQty: number;
        width: number | null;
        qualityGrade: string | null;
        kind: "raw" | "dyed" | "open";
        item: { id: string; code: string; name: string } | null;
        color: { id: string; code: string; name: string; hex: string | null } | null;
        /** Hangi partiye üye — "hangi top hangi partide" sorusu için (F: Rota&Dağılım). */
        batchNumber: string | null;
      }>
    >();
    // Per-step fason sevk bilgisi — plaka / sürücü / not detayı için.
    const stepDispatches = new Map<
      string,
      Array<{
        id: string;
        dispatchNo: string;
        dispatchedAt: string;
        totalQty: number;
        plateNumber: string | null;
        driverName: string | null;
        notes: string | null;
        instruction: string | null;
        /** Sevk edilen adımın notu (default) — sevkin kendi talimatı boşsa frontend buna düşer. */
        stepNote: string | null;
        subcontractor: { id: string; name: string };
        dispatchedBy: { id: string; fullName: string | null; username: string } | null;
        /** Bir sevk = bir parti (K10) — bu sevkte hangi partinin topları gitti. */
        batchNumber: string | null;
        /** Bu sevkte BİRLİKTE giden toplar (barkod+ürün+renk) — "hangi toplar birlikte gitti". */
        rolls: Array<{
          id: string;
          barcode: string | null;
          dispatchedQty: number;
          item: { name: string } | null;
          color: { name: string; hex: string | null } | null;
        }>;
      }>
    >();

    if (stepIds.length > 0) {
      const currentRolls = await prisma.roll.findMany({
        where: { currentStepId: { in: stepIds } },
        select: {
          id: true,
          barcode: true,
          currentStepId: true,
          status: true,
          colorId: true,
          parentReceiptId: true,
          currentQty: true,
          width: true,
          qualityGrade: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true, hex: true } },
          batch: { select: { batchNumber: true } },
        },
        orderBy: ROLL_DISPLAY_ORDER,
      });
      for (const r of currentRolls) {
        const key = r.currentStepId!;
        const s = stepRollSummaries.get(key) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
        };
        s.count += 1;
        s.totalMeters = s.totalMeters.plus(r.currentQty);
        // Durum kırılımı: AT_SUBCONTRACTOR = fasonda dışarıda; gerisi (IN_PRODUCTION/
        // STOCK) = bu adımda bekliyor, sevke hazır.
        if (r.status === RollStatus.AT_SUBCONTRACTOR) {
          s.atSubcontractorCount += 1;
          s.atSubcontractorMeters = s.atSubcontractorMeters.plus(r.currentQty);
        } else {
          s.waitingCount += 1;
          s.waitingMeters = s.waitingMeters.plus(r.currentQty);
        }
        let kind: "raw" | "dyed" | "open";
        if (r.parentReceiptId) {
          s.openFabricCount += 1;
          s.openFabricMeters = s.openFabricMeters.plus(r.currentQty);
          kind = "open";
        } else if (r.colorId == null) {
          s.rawCount += 1;
          s.rawMeters = s.rawMeters.plus(r.currentQty);
          kind = "raw";
        } else {
          s.dyedCount += 1;
          s.dyedMeters = s.dyedMeters.plus(r.currentQty);
          kind = "dyed";
        }
        stepRollSummaries.set(key, s);

        const list = stepRolls.get(key) ?? [];
        list.push({
          id: r.id,
          barcode: r.barcode,
          status: r.status,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade ?? "",
          kind,
          item: r.item,
          color: r.color,
          batchNumber: r.batch?.batchNumber ?? null,
        });
        stepRolls.set(key, list);
      }

      // Adım kapsamlı: dokuma sevkinin adımı yok — daraltma tip içindir, SQL aynı.
      const dispatches = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
        where: { stepId: { in: stepIds }, cancelledAt: null },
        select: {
          id: true,
          workOrderId: true,
          stepId: true,
          dispatchNo: true,
          dispatchedAt: true,
          totalQty: true,
          plateNumber: true,
          driverName: true,
          notes: true,
          instruction: true,
          subcontractor: { select: { id: true, name: true } },
          dispatchedBy: { select: { id: true, fullName: true, username: true } },
          batch: { select: { batchNumber: true } },
          // Bir sevk = bir parti (K10) — sevkte BİRLİKTE giden topların kimliği.
          items: {
            select: {
              dispatchedQty: true,
              roll: {
                select: {
                  id: true,
                  barcode: true,
                  item: { select: { name: true } },
                  color: { select: { name: true, hex: true } },
                },
              },
            },
          },
        },
        orderBy: { dispatchedAt: "desc" },
      }));
      for (const d of dispatches) {
        const list = stepDispatches.get(d.stepId) ?? [];
        list.push({
          id: d.id,
          dispatchNo: d.dispatchNo,
          dispatchedAt: d.dispatchedAt.toISOString(),
          totalQty: Number(d.totalQty),
          plateNumber: d.plateNumber,
          driverName: d.driverName,
          notes: d.notes,
          instruction: d.instruction,
          // Sevkin kendi talimatı boşsa, sevk edilen adımın notuna düşülür.
          stepNote: stepNotesById.get(d.stepId) ?? null,
          subcontractor: d.subcontractor,
          dispatchedBy: d.dispatchedBy,
          batchNumber: d.batch?.batchNumber ?? null,
          rolls: d.items.filter(hasRoll).map((it) => ({
            id: it.roll.id,
            barcode: it.roll.barcode,
            dispatchedQty: Number(it.dispatchedQty),
            item: it.roll.item,
            color: it.roll.color,
          })),
        });
        stepDispatches.set(d.stepId, list);
      }

      // Üretim çıktısı — SNAPSHOT: liste metriğiyle AYNI küme (producedOutputWhere;
      // Tambur birinci-nesil çocukları + Tambur'suz finalize çıktıları). Tambur
      // dalında status filtresi yok; sonradan re-cut'la TAMBUR_CONSUMED veya
      // CANCELLED olanlar listede kalır (rozetle işaretlenir). Metraj initialQty
      // (production anı), currentQty değil — re-cut sonrası sıfırlanmaz, snapshot sabit.
      const producedRollRows = await prisma.roll.findMany({
        where: await resolveProducedOutputWhere(prisma, stepIds),
        select: {
          id: true,
          barcode: true,
          initialQty: true,
          status: true,
          qualityGrade: true,
          createdAt: true,
          color: { select: { code: true, name: true, hex: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      // Kova KATALOGDAN (`targetStatus`) çözülür — gömülü kod YOK (liste metriğiyle
      // AYNI kaynak). `totalMeters` = warehouse + a1: A1 satılabilir 2. kalitedir,
      // üretim çıktısı sayılır; yalnız FİRE (SCRAP hedefli kalite) dışarıda kalır.
      const detailBuckets = await loadProducedBuckets(prisma);
      for (const r of producedRollRows) {
        const bucket = producedRolls[detailBuckets.bucketOf(r.qualityGrade)];
        bucket.count += 1;
        bucket.totalMeters = bucket.totalMeters.plus(r.initialQty);
      }

      // Headline: tüm rulo çıktıları + üretilen sağlam metraj
      // (fire metresi hariç).
      producedRolls.count =
        producedRolls.warehouse.count +
        producedRolls.a1.count +
        producedRolls.fire.count;
      producedRolls.totalMeters = producedRolls.warehouse.totalMeters.plus(
        producedRolls.a1.totalMeters,
      );

      // Parça parça liste — snapshot. qty = initialQty (production anı), status
      // = mevcut durum (frontend "Bölündü"/"İptal" rozeti basabilsin).
      producedRolls.items = producedRollRows.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        qualityGrade: r.qualityGrade ?? "",
        currentQty: r.initialQty,
        status: r.status,
        color: r.color,
        createdAt: r.createdAt,
      }));

      // Üretime giren ham toplar — SPLIT (tebdil) WO dahil doğru. computeWoInput
      // "girdi kökü" tanımını kullanır (W dışından gelen üye toplar): normal WO'da
      // eskiyle AYNI (tek KK1/supplier kökü; fason-dönüş + Tambur çocuğu elenir),
      // split WO'da reEntry adımında doğan enjekte kökü de sayar (eskiden 0'dı).
      const wi = (await computeWoInput(prisma, [id])).get(id);
      inputRolls = {
        count: wi?.count ?? 0,
        totalMeters: wi?.meters ?? new Prisma.Decimal(0),
      };
      if (wi) incoming = await computeWoIncoming(wi);
    }
    // Rotasız / girdisi adıma işlenmemiş İE: kök parti üyeliğinden — Gelen bloğu boş kalmasın; inputRolls sayımı değişmez.
    if (!incoming && inputRolls.count === 0) {
      const member = await woMemberRootInput(id);
      if (member) incoming = await computeWoIncoming(member);
    }

    const stepsWithRollSummary = wo.steps.map((step) => ({
      ...step,
      currentRolls:
        stepRollSummaries.get(step.id) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
        },
      currentRollList: stepRolls.get(step.id) ?? [],
      dispatches: stepDispatches.get(step.id) ?? [],
    }));

    // Düzenleme kilitleri — frontend formu bu bilgi ile input'ları disable
    // eder, kullanıcıya niye değiştirilemediğini gösterir.
    const locks = await computeWorkOrderLocks(prisma, id);
    // Kapanıştaki hâl (künye) — canlı `producedRolls` ile yan yana gösterilir.
    const closeSnapshot = await loadCloseSnapshotView(prisma, id);

    return {
      success: true,
      data: {
        ...wo,
        // Hedef değer → adım + tablet düzeltme kilidi: yazma kapısıyla AYNI saf fonksiyon (tek kaynak).
        targetValues: wo.targetValues.map((tv) => ({
          ...tv,
          edit: targetValueEditLock(wo.steps, { propertyId: tv.propertyId, variantOfPropertyId: tv.property.variantOfPropertyId, isKursun: tv.property.variantOf?.code === KURSUN_PROPERTY_CODE }),
        })),
        steps: stepsWithRollSummary,
        dispatchedTotalQty,
        producedRolls,
        inputRolls,
        incoming,
        locks,
        closeSnapshot,
      },
    };
  }
