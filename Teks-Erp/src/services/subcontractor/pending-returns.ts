// =============================================================================
// TeksERP - Subcontractor (Fason) Service / pending-returns
// =============================================================================
// Bekleyen dönüşler: fasondaki/sevk bekleyen toplar listesi ve grup detayı.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { ACTIVE_TARGET_PROPERTY } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { Prisma, RollStatus, StationKind, TravelerCardStatus } from "@prisma/client";
import { OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import { workOrderBoundOnly } from "../helpers/dispatch-header.helper";
import { isRollItem } from "../helpers/dispatch-item-kind.helper";
import { TERIM } from "../../constants/terim";

/**
 * Bekleyen kabul gruplarını PARTİ (sevk) bazında alt-grupla. Çoklu sevkte
 * (aynı adıma parça parça boyahaneye gönderim) operatör "ikisi birlikte mi
 * geldi, tek parti mi?" teyidini ancak partiler ayrı görünürse yapabilir.
 *
 * Parti kimliği = `Roll.batchId` (→ Batch; kaynak sevk `SubcontractorDispatch.batchId`
 * üzerinden bulunur — eski `batchSplitId` kolonu parti-modeli redesign'ıyla kalktı);
 * sevkte daima set edilir, bkz. dispatch() — bu yüzden AT_SUBCONTRACTOR her top
 * tek bir açık sevke eşlenir). Mobil bu diziyi düz render eder; her partiyi
 * ayrı "Geldi/Gelmedi" teyidiyle kabul eder (parti başına bir SubcontractorReceipt).
 */
function buildPendingParties<
  R extends { batchId: string | null; currentQty: Prisma.Decimal },
  D extends {
    id: string;
    batchId: string;
    dispatchNo: string;
    dispatchedAt: Date;
    plateNumber: string | null;
    driverName: string | null;
    subcontractorId: string;
    subcontractor: { id: string; code: string; name: string } | null;
  },
>(rolls: R[], dispatches: D[]) {
  // Parti (batchId) lane'i → dispatch. K10: bir sevk = bir parti → batchId ile eşle.
  const dispatchById = new Map(dispatches.map((d) => [d.batchId, d] as const));
  const byLane = new Map<string, R[]>();
  for (const r of rolls) {
    const key = r.batchId ?? "__none__";
    const arr = byLane.get(key);
    if (arr) arr.push(r);
    else byLane.set(key, [r]);
  }
  const parties = [...byLane.entries()].map(([key, laneRolls]) => {
    const d = key === "__none__" ? null : dispatchById.get(key) ?? null;
    const totalQty = laneRolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0),
    );
    return {
      dispatchId: d?.id ?? null,
      dispatchNo: d?.dispatchNo ?? null,
      dispatchedAt: d?.dispatchedAt ?? null,
      plateNumber: d?.plateNumber ?? null,
      driverName: d?.driverName ?? null,
      subcontractorId: d?.subcontractorId ?? null,
      subcontractor: d?.subcontractor ?? null,
      rolls: laneRolls,
      rollCount: laneRolls.length,
      totalQty,
    };
  });
  // Sevk tarihine göre artan (parti-1 en üstte); kimliksiz (null) en sona.
  parties.sort((a, b) => {
    const at = a.dispatchedAt ? a.dispatchedAt.getTime() : Infinity;
    const bt = b.dispatchedAt ? b.dispatchedAt.getTime() : Infinity;
    return at - bt;
  });
  return parties;
}

/**
 * Bekleyen toplara AÇIK sevk kalemi bilgisini iliştirir (kısmi teslimat, 2026-08-19):
 *   • `dispatchedQty` — sevk edilen metraj. `currentQty < dispatchedQty` ise top
 *     YARIM KALANDIR (bir kısmı önceki teslimatla kabul edildi) → istemci rozet basar.
 *   • `dispatchedAt` — yaş bandı ("N gündür fasonda"); kapama ELLE, gösterge amber.
 * Kalem bulunamazsa alanlar null — istemci rozet çizmez, akış bozulmaz.
 */
async function attachOpenDispatchInfo<T extends { id: string }>(
  rolls: T[],
): Promise<Array<T & { dispatchedQty: number | null; dispatchedAt: Date | null }>> {
  if (rolls.length === 0) {
    return rolls.map((r) => ({ ...r, dispatchedQty: null, dispatchedAt: null }));
  }
  const items = await prisma.subcontractorDispatchItem.findMany({
    where: { rollId: { in: rolls.map((r) => r.id) }, ...outstandingItemOfOpenDispatch() },
    select: {
      rollId: true,
      dispatchedQty: true,
      dispatch: { select: { dispatchedAt: true } },
    },
    orderBy: { dispatch: { dispatchedAt: "desc" } },
  });
  const byRoll = new Map<string, { dispatchedQty: number; dispatchedAt: Date }>();
  for (const it of items.filter(isRollItem)) {
    if (!byRoll.has(it.rollId)) {
      byRoll.set(it.rollId, {
        dispatchedQty: Number(it.dispatchedQty),
        dispatchedAt: it.dispatch.dispatchedAt,
      });
    }
  }
  return rolls.map((r) => {
    const info = byRoll.get(r.id) ?? null;
    return {
      ...r,
      dispatchedQty: info?.dispatchedQty ?? null,
      dispatchedAt: info?.dispatchedAt ?? null,
    };
  });
}

// -----------------------------------------------------------------------------
// "Sevk bekliyor" — fason adımında DURAN ama fasona ÇIKMAMIŞ top
// -----------------------------------------------------------------------------

/**
 * Fason adımında bulunup henüz sevk edilmemiş topun statüleri. "Konumu Düzelt"
 * (manuel taşıma) topu fason adımına koyar ama — TASARIM GEREĞİ —
 * `AT_SUBCONTRACTOR` YAPMAZ: mal fiziksel olarak dışarı çıkmadan "dışarıda"
 * işaretlemek envanteri yalanlar. Çıkış ayrıca **Fason Sevk** ile yapılır.
 *
 * TEK KAYNAK: kart-okutma teşhisi (`NEEDS_DISPATCH`), "Bekleyen" listesi ve grup
 * detayı aynı diziyi okur — elle statü listesi kopyalama.
 */
const AWAITING_DISPATCH_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.STOCK,
];

/**
 * Aynı dizinin ham-SQL karşılığı (enum literal — değerler TS enum üyeleridir,
 * kullanıcı girdisi DEĞİL). Elle `'IN_PRODUCTION','STOCK'` yazmak iki kaynağı
 * sessizce ayrıştırırdı.
 */
const awaitingStatusSql = Prisma.join(
  AWAITING_DISPATCH_STATUSES.map((s) => Prisma.raw(`'${s}'`)),
);

export async function listPendingReturns(params?: {
    workOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    if (params?.workOrderId) {
      // ── Refakat kartı akışı: WO'ya özel (küçük sonuç, rolls dahil) ──
      const woId = params.workOrderId;

      // Parti ayırma soy bağı: bu WO'dan ayrılan WO'ları (splitFromId zinciri)
      // kapsama al. Ayrılan parti fiziksel olarak ESKİ refakat kartını taşır —
      // eski kart okutulunca operatör çıkmaza girmesin, ayrılan partinin yeni
      // WO'daki bekleyen grubu da listede görünsün (grup kendi batchNumber'ını
      // taşır, kabul doğru WO'ya düşer). BFS derinlik ≤3 (ayrılanın ayrılması).
      const woIds = [woId];
      let frontier = [woId];
      for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
        const children = await prisma.workOrder.findMany({
          where: { splitFromId: { in: frontier }, isActive: true },
          select: { id: true },
        });
        frontier = children.map((c) => c.id).filter((id) => !woIds.includes(id));
        woIds.push(...frontier);
      }

      const subStepCount = await prisma.workOrderStep.count({
        where: { workOrderId: { in: woIds }, station: { kind: "SUBCONTRACTOR" } },
      });
      if (subStepCount === 0) {
        throw AppError.notFound(`Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} fason adımı tanımlı değil`, {
          code: "NO_SUBCONTRACTOR_STEP",
          workOrderId: woId,
        });
      }

      const pendingCount = await prisma.roll.count({
        where: {
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStep: { workOrderId: { in: woIds }, station: { kind: "SUBCONTRACTOR" } },
        },
      });

      if (pendingCount === 0) {
        // ── TEŞHİS SIRASI (jenerik mesaj EN SONA) ────────────────────────────
        // Eski davranış tek bir cümle basıyordu ve o cümle kendini yalanlıyordu:
        // "fason adımında bekleyen rulo yok. Mevcut konum: Boyahane (Fason) (1
        // rulo)". Operatör ne yapacağını hiçbir yerden öğrenemiyordu.

        // (a) MAL İÇERİDE BEKLİYOR — "Konumu Düzelt" topu fason adımına taşır ama
        //     tasarım gereği AT_SUBCONTRACTOR YAPMAZ (mal fiziksel olarak dışarı
        //     çıkmadan "dışarıda" işaretlemek envanteri yalanlar). Çıkış ayrıca
        //     Fason Sevk ile yapılır → doğru yönlendirme: önce sevk, sonra kabul.
        const awaitingRows = await prisma.roll.groupBy({
          by: ["currentStepId"],
          where: {
            status: { in: AWAITING_DISPATCH_STATUSES },
            currentStep: {
              workOrderId: { in: woIds },
              station: { kind: StationKind.SUBCONTRACTOR },
            },
          },
          _count: { _all: true },
        });
        if (awaitingRows.length > 0) {
          const awaitingCountByStep = new Map(
            awaitingRows
              .filter((r): r is typeof r & { currentStepId: string } => !!r.currentStepId)
              .map((r) => [r.currentStepId, r._count._all] as const),
          );
          const awaitingSteps = await prisma.workOrderStep.findMany({
            where: { id: { in: [...awaitingCountByStep.keys()] } },
            select: {
              id: true,
              workOrderId: true,
              stepSequence: true,
              station: { select: { name: true } },
            },
            orderBy: { stepSequence: "asc" },
          });
          const target = awaitingSteps[0];
          if (target) {
            throw AppError.badRequest(
              `Toplar '${target.station.name}' adımında ama henüz fasona SEVK EDİLMEMİŞ ` +
                `(konum düzeltmesi sonrası mal içeride bekliyor). ` +
                `Önce Fason Sevk yapın, sonra kabul edin.`,
              {
                code: "NEEDS_DISPATCH",
                workOrderId: target.workOrderId,
                stepId: target.id,
                stationName: target.station.name,
                rollCount: awaitingCountByStep.get(target.id) ?? 0,
              },
            );
          }
        }

        // (b) YANLIŞ İŞ EMRİNE KABUL — kayıt burada, mal fiziksel olarak hâlâ
        //     fasonda. Doğru araç "Konumu Düzelt" DEĞİL, KABUL İPTALİ: o,
        //     orijinalleri AT_SUBCONTRACTOR'a döndürür ve sevki yeniden açar.
        const openReceipt = await prisma.subcontractorReceipt.findFirst({
          where: {
            workOrderId: { in: woIds },
            cancelledAt: null,
            step: { station: { kind: StationKind.SUBCONTRACTOR } },
          },
          orderBy: { receivedAt: "desc" },
          select: { id: true, receiptNo: true, receivedAt: true },
        });
        if (openReceipt) {
          throw AppError.badRequest(
            `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} ${openReceipt.receiptNo} makbuzuyla kabul yapılmış. ` +
              `Malı yanlış ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} kabul ettiyseniz o makbuzu iptal edin — ` +
              `toplar fasona geri döner.`,
            {
              code: "MAYBE_WRONG_RECEIPT",
              receiptId: openReceipt.id,
              receiptNo: openReceipt.receiptNo,
              receivedAt: openReceipt.receivedAt,
            },
          );
        }

        // (c) Gerçekten başka bir istasyondayız. Jenerik mesaj KALIR ama "mevcut
        //     konum" listesinden FASON adımları ÇIKARILIR — aksi halde cümle
        //     kendini yalanlar (yukarıdaki saha bulgusu).
        const stepsWithRolls = await prisma.workOrderStep.findMany({
          where: {
            workOrderId: { in: woIds },
            currentRolls: { some: {} },
            station: { kind: { not: StationKind.SUBCONTRACTOR } },
          },
          select: {
            id: true,
            station: { select: { name: true } },
            _count: { select: { currentRolls: true } },
          },
          orderBy: { stepSequence: "asc" },
        });
        const currentSteps = stepsWithRolls.map((s) => ({
          stepId: s.id,
          stationName: s.station.name,
          rollCount: s._count.currentRolls,
        }));

        if (currentSteps.length === 0) {
          throw AppError.badRequest(
            `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} fason adımında bekleyen rulo yok ve şu an aktif başka adım da yok. (Üretim henüz başlamamış veya tamamlanmış.)`,
            { code: "WO_NOT_AT_SUBCONTRACTOR", currentSteps },
          );
        }

        const stepNames = currentSteps
          .map((s) => `${s.stationName} (${s.rollCount} rulo)`)
          .join(", ");
        throw AppError.badRequest(
          `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} fason adımında bekleyen rulo yok. Mevcut konum: ${stepNames}. Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.`,
          { code: "WO_NOT_AT_SUBCONTRACTOR", currentSteps },
        );
      }

      const outstandingRollsBare = await prisma.roll.findMany({
        where: { status: RollStatus.AT_SUBCONTRACTOR, currentStep: { workOrderId: { in: woIds } } },
        select: {
          id: true, barcode: true, currentQty: true, weightKg: true, width: true,
          qualityGrade: true, status: true, currentStepId: true, batchId: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true } },
        },
      });
      // Kısmi teslimat rozeti + yaş bandı için sevk kalemi bilgisi.
      const outstandingRolls = await attachOpenDispatchInfo(outstandingRollsBare);

      const stepIds = [...new Set(outstandingRolls.map((r) => r.currentStepId).filter(Boolean) as string[])];
      const steps = await prisma.workOrderStep.findMany({
        where: { id: { in: stepIds } },
        select: {
          id: true, stepSequence: true, notes: true,
          station: { select: { id: true, code: true, name: true, type: true } },
          // ŞEKİL EŞİTLİĞİ (2026-08-05): bu liste ucu ile adım-detayı ucu AYNI
          // ekranı besliyor ama farklı alanlar dönüyordu — kabulü refakat kartını
          // okutarak açan operatör `appliesColor`'ı hiç görmüyor, renk seçemiyor ve
          // 400 alıyordu; aynı kabul listeden açılınca çalışıyordu. Üç uç artık
          // aynı şekli döner. Renk EKLENİRKEN ÖZELLİKLER DE EKLENMELİ: yalnız
          // rengi eklemek, istemcinin özellik listesini boş görüp kabulde topların
          // özelliklerini (zımparalı/sanforlu) sıfırlamasına yol açardı.
          workOrder: {
            select: {
              id: true, workOrderNumber: true, status: true,
              width: true,
              targetColor: { select: { id: true, code: true, name: true, hex: true } },
              targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { property: { select: { id: true, code: true, name: true } } } },
            },
          },
          plannedSubcontractor: { select: { id: true, code: true, name: true } },
          requiredCategory: {
            select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
          },
        },
      });

      // Adım kapsamlı: daraltma tip içindir, SQL aynı.
      const dispatches = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
        // Doğrudan-sevk edilmiş sevk "son açık sevk" gösteriminde yer almaz.
        // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
        // buildPendingParties batchId→dispatch Map'i last-wins — dönmüş sevk açık
        // sevki ezip mobil kabul gruplamasında yanlış firma/sevk gösterirdi.
        where: { stepId: { in: stepIds }, ...OPEN_OUTSTANDING },
        select: {
          id: true, workOrderId: true, batchId: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
          driverName: true, stepId: true, subcontractorId: true,
          subcontractor: { select: { id: true, code: true, name: true } },
        },
        orderBy: { dispatchedAt: "desc" },
      }));

      const byStep = new Map<string, typeof dispatches>();
      for (const d of dispatches) {
        const arr = byStep.get(d.stepId) ?? [];
        arr.push(d);
        byStep.set(d.stepId, arr);
      }

      const groups = steps.map((step) => {
        const stepRolls = outstandingRolls.filter((r) => r.currentStepId === step.id);
        const stepDispatches = byStep.get(step.id) ?? [];
        const lastDispatch = stepDispatches[0] ?? null;
        const totalQty = stepRolls.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));
        return {
          step: {
            id: step.id, stepSequence: step.stepSequence, station: step.station,
            notes: step.notes, requiredCategory: step.requiredCategory,
            plannedSubcontractor: step.plannedSubcontractor,
          },
          // `targetProperties` DÜZLEŞTİRİLİR (`p.property`) — detay ucu da böyle
          // döner. Pivot satırını ham geçirmek istemciye `{ property: {...} }`
          // kabuğu gönderir ve mobil tarafta sessizce boş liste olarak okunur.
          workOrder: {
            id: step.workOrder.id,
            batchNumber: step.workOrder.workOrderNumber,
            status: step.workOrder.status,
            // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
            width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
            targetColor: step.workOrder.targetColor ?? null,
            targetProperties: step.workOrder.targetProperties.map((p) => p.property),
          },
          lastDispatch,
          parties: buildPendingParties(stepRolls, stepDispatches),
          rolls: stepRolls,
          rollCount: stepRolls.length,
          totalQty,
          // Okutulan karttan FARKLI bir WO'ya ait grup = bu karttan ayrılmış
          // parti. Mobil batchNumber'ı zaten gösterir; bayrak ileride rozet için.
          isSplitChild: step.workOrder.id !== woId,
        };
      });

      return { success: true, data: groups };
    }

    // ── Tüm bekleyenler: DB-side aggregate, rolls yok ──
    // 500+ grup için COUNT/SUM + distinct kumaş/renk adları DB'de hesaplanır;
    // tek tek Roll satırları frontend'e taşınmaz. Bu özet alanlar (itemNames,
    // colorNames, cardNumbers) client-side arama içindir — operatör parti no
    // dışında kumaş/renk/refakat kart no ile de filtreleyebilsin. Seçim anında
    // rolls /pending-returns/step/:stepId ile lazy-load.
    //
    // "SEVK BEKLİYOR" satırları (awaiting_*): fason adımında DURAN ama henüz
    // fasona çıkmamış toplar. Manuel taşıma ("Konumu Düzelt") bunları üretir ve
    // eskiden liste yalnız AT_SUBCONTRACTOR aradığı için iş emri **hata bile
    // vermeden kayboluyordu**. Aynı adımda iki kova yan yana durabilir (kısmi
    // sevk) → tek satırda FILTER'lı iki agregat; grup anahtarı yine stepId
    // (frontend key'i bölünmez). Bu satırlar kabul akışına SOKULMAZ — rollCount
    // yalnız AT_SUBCONTRACTOR sayar, rolls lazy-load'u da öyle.
    const rollStats = await prisma.$queryRaw<
      Array<{
        currentStepId: string;
        roll_count: bigint;
        // adapter-pg ile SUM(numeric) → Prisma.Decimal döner (string DEĞİL; ölçüldü).
        // COUNT(*) → bigint, ::float cast'li toplamlar → number.
        total_qty: Prisma.Decimal | null;
        awaiting_count: bigint;
        awaiting_qty: Prisma.Decimal | null;
        item_names: string[] | null;
        color_names: string[] | null;
      }>
    >`
      WITH pending_src AS (
        -- (1) Gerçek kabul kuyruğu: fasondaki toplar. Orijinal sorgunun planı
        --     korunur (status seçici, tek tablo).
        SELECT r."currentStepId" AS step_id, r."currentQty" AS qty,
               r."itemId" AS item_id, r."colorId" AS color_id, TRUE AS at_sub
        FROM rolls r
        WHERE r.status = 'AT_SUBCONTRACTOR' AND r."currentStepId" IS NOT NULL
        UNION ALL
        -- (2) "Sevk bekliyor". AYRI dal olması bilinçli: tek sorguda OR yazmak
        --     birinci dalın (asıl kabul kuyruğu) planını da bozardı. Bu dal
        --     ADIM tarafından yazıldı ki planlayıcının elinde fason istasyon →
        --     adım → @@index([currentStepId, status]) nested loop seçeneği
        --     olsun; küme zaten CANLI envanterle sınırlı (IN_PRODUCTION/STOCK
        --     tarihçeyle büyümez, WAREHOUSE/SHIPPED büyür). Hacim artınca
        --     EXPLAIN ile tekrar bak — plan seçimi satır tahminine bağlıdır.
        SELECT r."currentStepId", r."currentQty", r."itemId", r."colorId", FALSE
        FROM work_order_steps wos
        JOIN stations st ON st.id = wos."stationId" AND st.kind = 'SUBCONTRACTOR'
        JOIN rolls r ON r."currentStepId" = wos.id AND r.status IN (${awaitingStatusSql})
      )
      SELECT
        s.step_id AS "currentStepId",
        COUNT(*) FILTER (WHERE s.at_sub) AS roll_count,
        SUM(s.qty) FILTER (WHERE s.at_sub) AS total_qty,
        COUNT(*) FILTER (WHERE NOT s.at_sub) AS awaiting_count,
        SUM(s.qty) FILTER (WHERE NOT s.at_sub) AS awaiting_qty,
        ARRAY_AGG(DISTINCT i.name) AS item_names,
        ARRAY_AGG(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) AS color_names
      FROM pending_src s
      JOIN items i ON i.id = s.item_id
      LEFT JOIN colors c ON c.id = s.color_id
      GROUP BY s.step_id
    `;

    if (rollStats.length === 0) return { success: true, data: [] };

    const statsMap = new Map(rollStats.map((s) => [s.currentStepId, s]));
    const stepIds = rollStats.map((s) => s.currentStepId);

    const steps = await prisma.workOrderStep.findMany({
      where: { id: { in: stepIds } },
      select: {
        id: true, stepSequence: true, notes: true,
        station: { select: { id: true, code: true, name: true, type: true } },
        // Şekil eşitliği — yukarıdaki liste ucuyla aynı gerekçe (adım-detayı ucunun
        // şekli kanoniktir; renk ve özellikler BİRLİKTE taşınır).
        workOrder: {
          select: {
            id: true, workOrderNumber: true, status: true,
            width: true,
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { property: { select: { id: true, code: true, name: true } } } },
          },
        },
        plannedSubcontractor: { select: { id: true, code: true, name: true } },
        requiredCategory: {
          select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
        },
      },
    });

    // Adım kapsamlı: daraltma tip içindir, SQL aynı.
    const dispatches = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
      // Doğrudan-sevk edilmiş sevk "son açık sevk" gösteriminde yer almaz.
      // outstanding-scope ŞART (WO'ya-özel kardeş sorguyla aynı — K15 retarget
      // dönmüş sevkleri aynı adıma taşıyabilir): lastDispatch en güncel AÇIK sevk
      // olmalı; dönmüş tarihçe sevki listede yanlış firma/sevk gösterirdi.
      where: { stepId: { in: stepIds }, ...OPEN_OUTSTANDING },
      select: {
        id: true, workOrderId: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
        driverName: true, stepId: true, subcontractorId: true,
        subcontractor: { select: { id: true, code: true, name: true } },
      },
      orderBy: { dispatchedAt: "desc" },
    }));

    const byStep = new Map<string, typeof dispatches>();
    for (const d of dispatches) {
      const arr = byStep.get(d.stepId) ?? [];
      arr.push(d);
      byStep.set(d.stepId, arr);
    }

    // Refakat kart no — arama için (WO başına ACTIVE kartlar). steps'in
    // workOrderId'lerinden tek sorguda toplanır.
    const woIds = [...new Set(steps.map((s) => s.workOrder.id))];
    const cards = await prisma.travelerCard.findMany({
      where: { workOrderId: { in: woIds }, status: TravelerCardStatus.ACTIVE },
      select: { workOrderId: true, cardNumber: true },
    });
    const cardsByWo = new Map<string, string[]>();
    for (const c of cards) {
      const arr = cardsByWo.get(c.workOrderId) ?? [];
      arr.push(c.cardNumber);
      cardsByWo.set(c.workOrderId, arr);
    }

    const groups = steps.map((step) => {
      const stat = statsMap.get(step.id);
      const lastDispatch = byStep.get(step.id)?.[0] ?? null;
      return {
        step: {
          id: step.id, stepSequence: step.stepSequence, station: step.station,
          notes: step.notes, requiredCategory: step.requiredCategory,
          plannedSubcontractor: step.plannedSubcontractor,
        },
        // Düzleştirme detay ucuyla aynı — bkz. yukarıdaki not.
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.workOrderNumber,
          status: step.workOrder.status,
          // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
          width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
          targetColor: step.workOrder.targetColor ?? null,
          targetProperties: step.workOrder.targetProperties.map((p) => p.property),
        },
        lastDispatch,
        rollCount: Number(stat?.roll_count ?? 0),
        totalQty: new Prisma.Decimal(stat?.total_qty ?? "0"),
        // "Sevk bekliyor" rozeti — fason adımında duran ama fasona ÇIKMAMIŞ top.
        // Kabul akışına GİRMEZ (rollCount/rolls yalnız AT_SUBCONTRACTOR sayar);
        // amaç iş emrinin listeden sessizce kaybolmaması.
        awaitingDispatch: Number(stat?.awaiting_count ?? 0) > 0,
        awaitingDispatchRollCount: Number(stat?.awaiting_count ?? 0),
        awaitingDispatchQty: new Prisma.Decimal(stat?.awaiting_qty ?? "0"),
        // Arama özetleri (client-side filtre için)
        itemNames: stat?.item_names ?? [],
        colorNames: stat?.color_names ?? [],
        cardNumbers: cardsByWo.get(step.workOrder.id) ?? [],
      };
    });

    return { success: true, data: groups };
  }

export async function getPendingReturnGroupDetail(stepId: string): Promise<ApiResponse<unknown>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: {
        id: true, stepSequence: true, notes: true,
        station: { select: { id: true, code: true, name: true, type: true, kind: true } },
        workOrder: {
          select: {
            id: true, workOrderNumber: true, status: true,
            width: true,
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { property: { select: { id: true, code: true, name: true } } } },
          },
        },
        plannedSubcontractor: { select: { id: true, code: true, name: true } },
        requiredCategory: {
          select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
        },
      },
    });

    if (!step) throw AppError.notFound("Fason adımı bulunamadı");

    const rollsBare = await prisma.roll.findMany({
      where: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: stepId },
      select: {
        id: true, barcode: true, currentQty: true, weightKg: true, width: true,
        qualityGrade: true, status: true, currentStepId: true, batchId: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
      },
    });
    // Kısmi teslimat rozeti + yaş bandı için sevk kalemi bilgisi.
    const rolls = await attachOpenDispatchInfo(rollsBare);

    // Bu adımın TÜM sevkleri (parti gruplaması için) — iptal edilmemiş.
    // Eskiden tek `lastDispatch` (findFirst) dönüyordu; çoklu sevkte partiler
    // ayrışamıyordu. lastDispatch geriye-uyumluluk için en güncel sevk olarak korunur.
    // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
    // buildPendingParties batchId→dispatch Map'i last-wins — dönmüş sevk açık
    // sevki ezip mobil kabul gruplamasında yanlış firma/sevk gösterirdi.
    // Adım kapsamlı: dokuma sevkinin adımı yok — daraltma tip içindir, SQL aynı.
    const dispatches = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
      where: { stepId, ...OPEN_OUTSTANDING },
      select: {
        id: true, workOrderId: true, batchId: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
        driverName: true, stepId: true, subcontractorId: true,
        subcontractor: { select: { id: true, code: true, name: true } },
      },
      orderBy: { dispatchedAt: "desc" },
    }));
    const lastDispatch = dispatches[0] ?? null;

    // "Sevk bekliyor": fason adımında DURAN ama fasona ÇIKMAMIŞ toplar (manuel
    // taşıma sonrası). Kabul akışına GİRMEZ — `rolls`/`parties`/`rollCount`
    // yalnız AT_SUBCONTRACTOR sayar; bu blok sadece görünürlük içindir.
    const awaiting =
      step.station.kind === StationKind.SUBCONTRACTOR
        ? await prisma.roll.aggregate({
            where: { currentStepId: stepId, status: { in: AWAITING_DISPATCH_STATUSES } },
            _count: { _all: true },
            _sum: { currentQty: true },
          })
        : null;
    const awaitingCount = awaiting?._count._all ?? 0;

    const totalQty = rolls.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));

    return {
      success: true,
      data: {
        step: {
          id: step.id, stepSequence: step.stepSequence, station: step.station,
          notes: step.notes, requiredCategory: step.requiredCategory,
          plannedSubcontractor: step.plannedSubcontractor,
        },
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.workOrderNumber,
          status: step.workOrder.status,
          // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
          width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
          targetColor: step.workOrder.targetColor ?? null,
          targetProperties: step.workOrder.targetProperties.map((p) => p.property),
        },
        lastDispatch,
        parties: buildPendingParties(rolls, dispatches),
        rolls,
        rollCount: rolls.length,
        totalQty,
        awaitingDispatch: awaitingCount > 0,
        awaitingDispatchRollCount: awaitingCount,
        awaitingDispatchQty: new Prisma.Decimal(awaiting?._sum.currentQty ?? 0),
      },
    };
  }
