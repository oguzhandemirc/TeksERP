// =============================================================================
// Tambur Service / open-fabric-cut
// =============================================================================
// Açık kumaş kesimi: token replay sarmalayıcısı (cutOpenFabric) + kesim tx'i (cutOpenFabricInner).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (tambur/finalize.ts sayılır) */

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import {
  loadStationPropertyCaps,
} from "../helpers/station-capability-transfer.helper";
import { postOpenFabricChildEntryTx } from "../helpers/production-entry-ledger.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { resolveQualityGradeId, resolveQualityGradeIdStrict } from "../helpers/quality-grade.helper";
import {
  loadQualityRoles,
} from "../helpers/quality-role.helper";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import {
  resolveTamburOverQuantityEnabled,
} from "../system-setting.service";
import { recordVarianceTx, overageOf } from "../helpers/roll-variance.helper";
import {
  assertTamburMeasuresAllowed,
  auditCutReadings,
  toMachineDataSource,
  weakestMeasureSource,
  writeCutReadingsTx,
  type MeterSourceInput,
} from "../helpers/meter-reading.helper";
import {
  VARIANCE_SOURCES,
} from "../../constants/variance-reasons";
import { RollVarianceKind, QualityGradeRole } from "@prisma/client";
import { resolveFoldTypeForWrite } from "../helpers/fold-type";
import { assertRollMatchesPlan, recordPlanDeviationTx } from "../helpers/tambur-plan-gate.helper";
import {
  Prisma,
  Roll,
  RollMeterReading,
  RollStatus,
  RollEntrySource,
  RollOperationType,
  StationKind,
  WorkOrderStatus,
} from "@prisma/client";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { buildIntentSnapshot } from "../label.service";
import { resolveLabelIntent, labelCustomerIdOf } from "../helpers/label-intent.helper";
import { generateRollBarcodeTx } from "../helpers/roll-barcode.helper";
import { TERIM } from "../../constants/terim";
import { resolveTamburCutWeight, resolveTamburLabelBatchNo } from "../helpers/tambur-customer-settings.helper";
import type { TamburService } from "../tambur.service";
import { applyTamburCapabilitiesTx, cutReplay, type TamburServiceThis } from "./shared";

export async function cutOpenFabric(this: TamburServiceThis, 
    ...args: Parameters<TamburService["cutOpenFabricInner"]>
  ): ReturnType<TamburService["cutOpenFabricInner"]> {
    const [openFabricRollId, data] = args;
    return cutReplay<Awaited<ReturnType<TamburService["cutOpenFabricInner"]>>>(openFabricRollId, data.lengthMeters, (child, parent) => ({
      success: true,
      data: { childRoll: child, parentRemainingQty: Number(parent.currentQty) },
      message: "Kesim zaten kaydedilmiş (idempotent retry)",
    })).run(data.clientToken, () => this.cutOpenFabricInner(...args));
  }

export async function cutOpenFabricInner(
    openFabricRollId: string,
    data: {
      lengthMeters: number;
      status: "WAREHOUSE" | "SCRAP" | "A1_STOCK";
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
      /** Etiket niyeti — açık kumaş child her zaman WAREHOUSE → lastLabelSnapshot.
       *  İkisi de boş = stok (müşterisiz). */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /**
       * Bu kesimde doğan ÇOCUĞUN katı (kalıcı özellik, 2026-08-04).
       * Verilmezse parent → iş emri planı sırasıyla fallback uygulanır — bu
       * MİRAS değil, alanı göndermeyen eski istemciler için geri-uyumluluktur.
       */
      foldType?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID) — cutWarehouseRoll ile aynı. */
      clientToken?: string;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer. */
      confirmMismatch?: boolean;
      /** D4-B1: kesim metresinin ölçüm kaynağı (eski APK göndermez). */
      measure?: MeterSourceInput | null;
      /** Tamburda tartım (Gülkesim S5) — müşteri ayarı açıksa zorunlu; çocuk `weightKg`. */
      weightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — çocuğa yazılır (miras yok). */
      labelBatchNo?: string | null;
    },
    userId?: string,
    /** Kesimin makinesi — "Bu makine" süzgeci + makine raporları (2026-08-12). */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRemainingQty: number }>> {
    if (!(data.lengthMeters > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }
    await assertTamburMeasuresAllowed([data.measure]);
    // Kat katalog doğrulaması — `undefined` korunur (parent → WO fallback zinciri).
    const foldType = await resolveFoldTypeForWrite(data.foldType);

    const parent = await prisma.roll.findUnique({
      where: { id: openFabricRollId },
      include: {
        currentStep: {
          include: {
            station: { select: { kind: true } },
            // WO.foldType = PLANLAMA değeri; istemci ve parent susarsa son fallback.
            // id/targetColorId/width: plan-gerçek sapma kapısı için (aynı select).
            workOrder: { select: { id: true, status: true, foldType: true, targetColorId: true, width: true } },
          },
        },
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true, valueId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Roll bulunamadı");
    // Tamburda tartım — müşteri ayarı (etiket müşterisi ?? sahibi); kapalıysa kg opsiyonel.
    const cutWeightKg = await resolveTamburCutWeight({
      weightKg: data.weightKg,
      targetCustomerId: data.targetCustomerId,
      ownerCustomerId: parent.ownerCustomerId,
    });
    const cutLabelBatchNo = await resolveTamburLabelBatchNo({
      labelBatchNo: data.labelBatchNo,
      targetCustomerId: data.targetCustomerId,
      ownerCustomerId: parent.ownerCustomerId,
    });
    // Barkod-reddi KALDIRILDI (2026-07-16): Tambur adımındaki HER top kesilebilir —
    // barkodsuz açık kumaş VE Konumu-Düzelt ile buraya gelmiş barkodlu TOP. Barkod artık
    // dispatch anahtarı değil, yalnız çocuk-etiketleme semantiği (çocuk hep taze "F" barkod).
    // Ayrım kriteri form/barkod değil, KONUM (canlı Tambur step + IN_PRODUCTION). Barkodlu top
    // eskiden iki kesim metodunun arasındaki delikte kalıp kesilemiyordu (ölü rulo).
    if (!parent.currentStep || parent.currentStep.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Roll Tambur step'inde değil (${parent.currentStep?.station.kind ?? "STEPSIZ"})`,
      );
    }
    // Savunma katmanı (BUG-2): iptal edilmiş iş emrinin Tambur adımına eşzamanlı yarışla
    // sıkışmış açık kumaş kesilmesin — ölü WO'ya çocuk top + bozuk üretim muhasebesi olmaz.
    if (
      parent.currentStep.workOrder?.status === WorkOrderStatus.CANCELLED ||
      parent.currentStep.workOrder?.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} açık kumaşı kesilemez`);
    }
    if (parent.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.badRequest(
        `Açık kumaş aktif değil (${parent.status})`,
      );
    }
    // PLAN-GERÇEK SAPMA KAPISI: per-cut modelde çocuk KESİM ANINDA depoya iner —
    // kapı bitirmeyi bekleyemez. Operatör topta BİR KEZ onaylar; istemci aynı
    // topun sonraki kesimlerine bayrağı kendisi taşır (tek soru / top).
    const planDeviations = await assertRollMatchesPlan(
      { id: parent.id, barcode: parent.barcode, colorId: parent.colorId, width: parent.width },
      {
        workOrderId: parent.currentStep.workOrder?.id ?? null,
        targetColorId: parent.currentStep.workOrder?.targetColorId ?? null,
        width: parent.currentStep.workOrder?.width ?? null,
      },
      data.confirmMismatch,
      userId,
      "cut",
    );
    // Aşım: operatör açık kumaşı kayıtlıdan fazla ölçtü (tambur asıl ölçüm noktası).
    // Flag kapalıyken reddet (bugünkü davranış); açıkken kabul → açık kumaşın tamamı
    // tek topa dönüşür, parent tamamen tüketilir (aşağıda currentQty=0).
    const exceedsRemaining = data.lengthMeters > Number(parent.currentQty);
    // Bayrak ÖN kararda okunur; tx içindeki kilit altındaki kontrol niyeti değiştirmez.
    const asimIzinliOF = await resolveTamburOverQuantityEnabled();
    if (exceedsRemaining && !asimIzinliOF) {
      throw AppError.badRequest(
        `Kesim metresi (${data.lengthMeters}) açık kumaşın kalan metresinden (${parent.currentQty}) büyük olamaz`,
      );
    }

    // Geri uyum: tablet eski input'u (status A1_STOCK/SCRAP) gönderebilir.
    // Yeni kurguda status her zaman WAREHOUSE; eski status değerleri
    // qualityGrade'e dönüştürülür (explicit qualityGrade override eder).
    //
    // Eski STATÜ → ROL → katalog satırı (karar ①). Statü burada "hangi rafa"
    // değil "operatör hangi düğmeye bastı" bilgisini taşıyor — eski tabletin
    // kalite kararının statüye kodlanmış hâli, yani ROL sorusu.
    // Rolsüz katalogda 400 (fail-closed); eskiden "1.KALITE" literaline düşüp
    // katalog dışı snapshot yazılıyordu.
    const roles = await loadQualityRoles(prisma);
    const roleByLegacyStatus: Record<string, QualityGradeRole> = {
      WAREHOUSE: QualityGradeRole.FIRST,
      A1_STOCK: QualityGradeRole.SECOND,
      SCRAP: QualityGradeRole.SCRAP,
    };
    const resolvedQualityGrade =
      data.qualityGrade ??
      roles.require(roleByLegacyStatus[data.status] ?? QualityGradeRole.FIRST).code;
    const childStatus = RollStatus.WAREHOUSE;
    const tamburStepId = parent.currentStep.id;
    const woId = parent.currentStep.workOrderId;
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));
    // İstasyon yeteneği (T1) — tx DIŞINDA bir kez (salt okuma, yapılandırma).
    const tamburStationId = parent.currentStep.stationId;
    const tamburCaps = await loadStationPropertyCaps(prisma, tamburStationId);
    // Açık kumaş child her zaman WAREHOUSE → "F" (final). Barkod sunucudan (atomik sayaç).
    const childBarcode = await generateRollBarcodeTx(prisma, "F");
    // Etiket niyeti (pre-tx çözüm) — açık kumaş child her zaman WAREHOUSE.
    const cutIntent = await resolveLabelIntent(data);
    const cutIntentSnapshot = buildIntentSnapshot(cutIntent);
    const cutLabelCustomerId = labelCustomerIdOf(cutIntent);

    // Operatör explicit kod verdiyse SIKI doğrula (katalog+aktif); rolden çözülen
    // kod ZATEN aktif katalog satırından geldiği için lenient yol yeterli
    // (karar ① sonrası burada artık gömülü sabit YOK).
    const resolvedQualityGradeId = data.qualityGrade
      ? await resolveQualityGradeIdStrict(resolvedQualityGrade)
      : await resolveQualityGradeId(resolvedQualityGrade);

    let result: { child: Roll; newParentQty: number };
    let openCutReadings: RollMeterReading[] = [];
    result = await prisma.$transaction(async (tx) => {
    // F130: WO satırını kilitle → eşzamanlı WO iptaliyle (softDelete cancelClaim
    // aynı WO satırını kilitler) serileş; iptal-guard'ını kilit ALTINDA TAZE oku
    // (pre-tx 2169 guard'ının atomik hali). Lock sırası WO→roll (kardeşlerle tutarlı).
    await touchWorkOrderTx(tx, woId);
    const freshWo = await tx.workOrder.findUnique({
      where: { id: woId },
      select: { status: true },
    });
    if (
      freshWo?.status === WorkOrderStatus.CANCELLED ||
      freshWo?.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} açık kumaşı kesilemez`);
    }
    // ── AÇIK KUMAŞ SATIR KİLİDİ + NİYET KORUNUR (2026-09-25, K-KES2) ──
    // Kilit sırası WO → roll (F130). İş emri kilidi eşzamanlı kesimleri zaten SIRALAR:
    // kural yokken ikinci kesim birincinin commit'inden SONRA "taze" okuyup HER SEFERİNDE
    // aşıma dönüyor, 100 m'lik kumaştan 240 m çocuk doğuyordu (iyimser guard sıralı tx'te
    // tutar). `cutWarehouseRoll` ile aynı kural: normal niyette kilitli kalan yetmiyorsa ya
    // da aşım niyetinde kalan ön okumadan farklıysa 409 — eşzamanlı eksilme aşıma DÖNMEZ.
    const kilitli = await tx.$queryRaw<Array<{ currentQty: Prisma.Decimal }>>`
      SELECT "currentQty" FROM rolls WHERE id = ${parent.id}::uuid FOR UPDATE`;
    if (kilitli.length === 0) throw AppError.conflict("Açık kumaş bu sırada silindi — listeyi yenileyin");
    const tazeKalan = new Prisma.Decimal(kilitli[0]!.currentQty);
    const tazeAsim = exceedsRemaining;
    const degisti = tazeAsim
      ? !tazeKalan.equals(new Prisma.Decimal(parent.currentQty))
      : tazeKalan.lessThan(data.lengthMeters);
    if (degisti) {
      throw AppError.conflict("Bu top siz keserken başka bir işlemle değişti — ekranı yenileyip tekrar deneyin.", {
        code: "ROLL_CHANGED_DURING_CUT",
      });
    }
    // Child Roll oluştur
    const child = await tx.roll.create({
      data: {
        barcode: childBarcode,
        clientToken: data.clientToken ?? null,
        itemId: parent.itemId,
        colorId: parent.colorId,
        width: parent.width,
        // KAT — kesim anında seçilen değer KAZANIR (kullanıcı kararı: "top
        // kesilerek yeni bir kat değeri kazanabilir"). `undefined` = istemci
        // alanı hiç GÖNDERMEDİ → parent, o da yoksa iş emri planı (eski APK
        // geri-uyumluluğu; MİRAS DEĞİL). `null` = istemci açıkça "kat yok" dedi.
        foldType:
          foldType !== undefined
            ? foldType
            : (parent.foldType ?? parent.currentStep?.workOrder?.foldType ?? null),
        initialQty: data.lengthMeters,
        currentQty: data.lengthMeters,
        weightKg: cutWeightKg,
        labelBatchNo: cutLabelBatchNo,
        status: childStatus,
        qualityGrade: resolvedQualityGrade,
        qualityGradeId: resolvedQualityGradeId,
        producedInStepId: tamburStepId,
        parentRollId: parent.id,
        // EMANET sahipliği doğum niteliğidir: müşterinin kumaşından kesilen parça da onundur (H10).
        ownerCustomerId: parent.ownerCustomerId ?? null,
        // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
        batchId: parent.batchId,
        // DEPO parent'tan MİRAS ALINIR — kesmek malı taşımaz (bkz. kesim çocuğu).
        warehouseId: parent.warehouseId ?? (await resolveTargetWarehouseId(tx)),
        // GİRİŞ İSTASYONU — kesim hangi Tambur adımındaysa çocuk orada doğdu.
        // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
        // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
        entryStationId: resolveEntryStationId({ stepStationId: parent.currentStep?.stationId }),
        entrySource: RollEntrySource.TAMBUR_SPLIT,
        createdById: userId ?? null,
        createdMachineId: sessionMachineId ?? null,
        // Sadece depoya giden (WAREHOUSE) çıktı kartelalık işaretlenir.
        markedForKartela:
          (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
        // Etiket niyeti kesim anında kalıcı (yazıcı/ekran bağımsız).
        lastLabelSnapshot: cutIntentSnapshot,
        // Sorgulanabilir ayna — snapshot ile AYNI create'te (bkz. Roll.labelCustomerId).
        labelCustomerId: cutLabelCustomerId,
        // currentStepId: child Tambur'dan çıktı (depo değil bir step) — null.
      },
    });

    // STOK DEFTERİ — çocuk depoda doğdu: üretimden depoya GİRİŞ (hüküm §11 giriş kalemi).
    await postOpenFabricChildEntryTx(tx, child, tamburStepId, userId);

    if (propertySnapshot.length > 0) {
      await inheritRollPropertiesTx(tx, { childId: child.id, rows: propertySnapshot });
    }
    await applyTamburCapabilitiesTx(tx, { caps: tamburCaps, stationId: tamburStationId, rollId: child.id, userId });

    // KURSUN_APPLIED + QC2_COMPLETED kalıtım — parent açık kumaşta yapılan
    // işlemler child top'a `inheritedFromParentRollId=parent.id` ile kopyalanır.
    // Aksi halde child Bitmiş Depo'da "kurşun/KK2 yapılmadı" gözüküyor; oysa
    // operasyonlar fiziksel olarak parent üzerinde yapılmış ve sonucu child'a
    // geçmiş. Bulk split (satır 407-414 / 561-575) bunu yapıyor — open fabric
    // split'te de aynı semantik gerek.
    // Filter KALDIRILDI: zincirleme inherit destekle. Depo topundaki KURSUN/QC2
    // op'ları zaten parent'tan inherit edilmiştir (inheritedFromParentRollId
    // set). Sadece "orijinal" op'lara bakarsak chain kopar, child'da hiç op
    // kalmaz. Çoklu kayıt olabilir; sorun değil — UI find() ilki bulur.
    const inheritedOps = await tx.rollOperation.findMany({
      where: { ...ACTIVE_OPERATION,
        rollId: parent.id,
        operationType: {
          in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED],
        },
      },
      // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
      select: {
        workOrderStepId: true,
        operationType: true,
        operatorId: true,
        metadata: true,
        machineId: true,
        propertyValueId: true,
      },
    });
    if (inheritedOps.length > 0) {
      await tx.rollOperation.createMany({
        data: inheritedOps.map((op) => ({
          rollId: child.id,
          workOrderStepId: op.workOrderStepId,
          operationType: op.operationType,
          operatorId: op.operatorId,
          machineId: op.machineId,
          metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          propertyValueId: op.propertyValueId, // KQ-D4: gramaj mirası
          inheritedFromParentRollId: parent.id,
        })),
      });
    }

    // PLAN-SAPMA DEFTERİ — per-cut modelde geçiş = KESİM, satır çocuk bazlı.
    // ⚠️ TX İÇİNDE: aynı `clientToken` ile replay child create'te P2002 verir →
    // tx rollback → defter satırı da geri sarılır (çift satır imkânsız).
    await recordPlanDeviationTx(tx, {
      mismatches: planDeviations,
      rollId: parent.id,
      childRollId: child.id,
      workOrderId: woId,
      workOrderStepId: tamburStepId,
      qtyM: data.lengthMeters,
      source: "cut",
      confirmedById: userId,
    });

    // Parent atomic decrement — hesap DB-side, gte guard concurrent overdraw'a karşı.
    // Aşımda (lengthMeters > currentQty) decrement negatife düşer → bunun yerine açık
    // kumaşı tamamen tüket (currentQty=0). gt:0 guard eşzamanlı çift-tüketimi engeller.
    // Karar yukarıda satır KİLİDİ altında verildi (niyet korunur); `currentQty: tazeKalan`
    // guard'ı aşım dalında savunma katmanı olarak kalır.
    let updatedParent;
    try {
      // F130: guarded-decrement = atomik claim. status + currentStepId eklendi:
      // eşzamanlı KK2 reopen (currentStepId'yi KK2 step'e çeker) araya girerse
      // WHERE eşleşmez → P2025 → 409 (KK2'ye geri çekilmiş top kesilmez).
      updatedParent = tazeAsim
        ? await tx.roll.update({
            // ⚠️ AŞIM DALINDA `currentQty > 0` ŞARTI YOK (2026-08-12 saha
            // vakası): 500 m kayıtlı kumaş fiziksel 550 m çıkabilir ve fazlalık
            // TEK kesimde bitmeyebilir (50 m'den 3 top). İlk aşım kesimi kalanı
            // 0'a çeker; guard `gt: 0` olarak kalsaydı 0'daki topta İKİNCİ kesim
            // P2025'e düşüp "bu sırada değişti" yarış mesajını basıyordu —
            // oysa yarış yok, mal fiziksel olarak elde. Çifte-harcama koruması
            // burada ANLAMSIZ: 0'ın altına inilecek gerçek stok kalmadı; her
            // aşım kesimi çocuk + sapma satırı üretir (aşağıdaki defter), yani
            // iz kaybolmaz. KK2 reopen/statü guard'ları AYNEN duruyor.
            // ⚠️ `currentQty: tazeKalan` İYİMSER GUARD (2026-08-29 / T1-002):
            // metraj şartı olmadan iki eşzamanlı aşım kesimi ikisi de eşleşiyor
            // ve 100 m'lik kumaştan 240 m çocuk doğuyordu.
            where: {
              id: parent.id,
              status: RollStatus.IN_PRODUCTION,
              currentStepId: tamburStepId,
              currentQty: tazeKalan,
            },
            data: { currentQty: 0 },
          })
        : await tx.roll.update({
            where: { id: parent.id, status: RollStatus.IN_PRODUCTION, currentStepId: tamburStepId, currentQty: { gte: data.lengthMeters } },
            data: { currentQty: { decrement: data.lengthMeters } },
          });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw AppError.conflict(
          "Açık kumaş bu sırada değişti (KK2'ye geri çekilmiş / statü değişmiş / kalan metre yetersiz) — listeyi yenileyip tekrar deneyin"
        );
      }
      throw err;
    }
    const newParentQty = Number(updatedParent.currentQty);

    // AŞIM DEFTERİ (2026-08-09) — sapmanın ARTI yönü. 2026-08-09 öncesinde
    // hiçbir yere yazılmıyordu: bayrak aşımı kabul ediyor, parent tamamen
    // tüketiliyor ve "N m fazla çıktı" bilgisi buharlaşıyordu. Sonuç: rapor
    // yalnız eksi yönü görüyordu ("giriş 100, çıkış 140" açıklamasız kalıyordu).
    // Sebep SORULMAZ — aşımı sistem tespit eder, operatör beyan etmez.
    if (tazeAsim) {
      await recordVarianceTx(tx, {
        rollId: parent.id,
        workOrderStepId: tamburStepId,
        kind: RollVarianceKind.OVERAGE,
        // Defter payı da TAZE metrajdan (bayat değer aşımı eksik yazıyordu).
        qty: overageOf(data.lengthMeters, tazeKalan),
        source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
        // KEŞİF EBEVEYNDE, KAYNAĞI ÇOCUK (hüküm ②) — üretim dalında stok satırı yok,
        // geri alma yalnız bump'ı bu keşifle karşılar.
        sourceRollId: child.id,
        measureSource: toMachineDataSource(weakestMeasureSource([data.measure?.source])),
        userId,
      });
    }
    // D4-B1b: CUT okuması çocuk doğduktan sonra AYNI tx'te (measure'sız kesim okuma yazmaz).
    openCutReadings = await writeCutReadingsTx(tx, {
      stepId: tamburStepId, machineId: sessionMachineId ?? null, userId: userId ?? null,
      cuts: [{ rollId: child.id, meters: child.initialQty, measure: data.measure }],
    });

    return { child, newParentQty };
    });
    await auditCutReadings(userId, openCutReadings);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: result.child.id,
      newData: {
        kind: "TAMBUR_CUT_FROM_OPEN_FABRIC",
        parentOpenFabricId: parent.id,
        parentReceiptId: parent.parentReceiptId,
        lengthMeters: data.lengthMeters,
        status: childStatus,
        qualityGrade: result.child.qualityGrade,
        barcode: result.child.barcode,
        parentRemainingQty: result.newParentQty,
        notes: data.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        childRoll: result.child,
        parentRemainingQty: result.newParentQty,
      },
      message: `Kesim tamam: ${data.lengthMeters} mt → ${childStatus} (${result.child.barcode}). Açık kumaş kalan: ${result.newParentQty} mt.`,
    };
  }
