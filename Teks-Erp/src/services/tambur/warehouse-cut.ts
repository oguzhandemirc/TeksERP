// =============================================================================
// Tambur Service / warehouse-cut
// =============================================================================
// Depo topu kesimi: token replay sarmalayıcısı (cutWarehouseRoll) + kesim tx'i (cutWarehouseRollInner).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (tambur/finalize.ts sayılır) */

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import {
  loadStationPropertyCaps,
} from "../helpers/station-capability-transfer.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { postStockMove, qtyYazilabilir } from "../helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { randomUUID } from "node:crypto";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { resolveQualityGradeIdStrict } from "../helpers/quality-grade.helper";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import {
  resolveTamburOverQuantityEnabled,
  readQualityGradeRequiredEnabled,
} from "../system-setting.service";
import { recordVarianceTx, overageOf } from "../helpers/roll-variance.helper";
import {
  assertTamburMeasuresAllowed,
  toMachineDataSource,
  weakestMeasureSource,
  type MeterSourceInput,
} from "../helpers/meter-reading.helper";
import {
  VARIANCE_SOURCES,
} from "../../constants/variance-reasons";
import { WarehouseEventType, RollVarianceKind } from "@prisma/client";
import { resolveFoldTypeForWrite } from "../helpers/fold-type";
import { sackBlockMessage } from "../helpers/sack-invariants.helper";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  RollOperationType,
  StationKind,
} from "@prisma/client";
import { buildIntentSnapshot } from "../label.service";
import { resolveLabelIntent, labelCustomerIdOf } from "../helpers/label-intent.helper";
import { generateRollBarcodeTx } from "../helpers/roll-barcode.helper";
import { resolveTamburConsignee, resolveTamburCutWeight, resolveTamburLabelBatchNo, resolveTamburWeightSource } from "../helpers/tambur-customer-settings.helper";
import { inheritedChildWidth, resolveTamburChildWidth } from "../helpers/tambur-child-label.helper";
import { resolveRollLabelTexts } from "../helpers/label-batch-no.helper";
import type { TamburService } from "../tambur.service";
import { applyTamburCapabilitiesTx, cutReplay, type TamburServiceThis } from "./shared";

export async function cutWarehouseRoll(this: TamburServiceThis, 
    ...args: Parameters<TamburService["cutWarehouseRollInner"]>
  ): ReturnType<TamburService["cutWarehouseRollInner"]> {
    const [rollId, data] = args;
    return cutReplay<Awaited<ReturnType<TamburService["cutWarehouseRollInner"]>>>(rollId, data.cutLength, (child, parent) => ({
      success: true,
      data: { childRoll: child, parentRoll: parent, parentRemainingQty: Number(parent.currentQty) },
      message: "Kesim zaten kaydedilmiş (idempotent retry)",
    })).run(data.clientToken, () => this.cutWarehouseRollInner(...args));
  }

// eslint-disable-next-line max-params -- özgün metot 5 parametreli ve uyarısı cephedeki imzada sayılır; ailenin max-params katkısı bölme öncesi gibi İKİ
export async function cutWarehouseRollInner(
    rollId: string,
    data: {
      cutLength: number;
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
      /**
       * Ham (renksiz STOCK) top kesiminde çıkan parçanın hedefi:
       *   STOCK     → üretime geri döner (yeni iş emrine bağlanabilir: boyahane/KK2/tambur),
       *   WAREHOUSE → ham-bitmiş, sevke hazır (renksiz olarak depoya iner).
       * Bitmiş depo topu (WAREHOUSE parent) kesiminde YOK SAYILIR — çıktı her zaman WAREHOUSE.
       */
      rawDestination?: "STOCK" | "WAREHOUSE";
      /** Parçanın katı — verilmezse parent'tan devralınır (bu yolda WO yok). */
      foldType?: string | null;
      /** Etiket niyeti — WAREHOUSE child'ın `lastLabelSnapshot`'ına yazılır;
       *  raw→STOCK (üretime devam) child stok'a düşer. İkisi de boş = stok. */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID). Barkod sunucuda sıralı atanır;
       *  aynı token'la 2. çağrı child'ı idempotent döner (ikinci kesim/decrement YOK). */
      clientToken?: string;
      /** D4-B1: kesim metresinin ölçüm kaynağı (eski APK göndermez). */
      measure?: MeterSourceInput | null;
      /** Tamburda tartım (Gülkesim S5) — müşteri ayarı açıksa zorunlu; çocuk `weightKg`. */
      weightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — çocuğa yazılır (miras yok). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kg kaynağı beyanı (SCALE | MANUAL | SIMULATED); kaynaksız kg MANUAL yazılır. */
      weightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /**
     * Aktif çalışma oturumunun istasyonu — çıkan parçanın GİRİŞ İSTASYONU damgası.
     *
     * Bu yolda İŞ EMRİ/ADIM YOKTUR (depo topu kesimi), dolayısıyla adım kaynağı
     * kullanılamaz ve tek doğru kaynak oturumdur. Verilmezse damga NULL kalır —
     * eski istemciler ve dahili çağrılar kırılmaz.
     */
    sessionStationId?: string | null,
    /** Kesimin yapıldığı makine — "Bu makine" süzgeci + makine raporları için.
     *  (2026-08-12: kesim çocukları createdById alıyordu ama createdMachineId
     *  ALMIYORDU → makine süzgeci kesimleri hiç göremiyordu.) */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> {
    await assertTamburMeasuresAllowed([data.measure]);
    if (!(data.cutLength > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }
    // Kat katalog doğrulaması — `undefined` korunur (parent'tan miras dalı ona bakar).
    const foldType = await resolveFoldTypeForWrite(data.foldType);

    const parent = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true, valueId: true } },
        // Çuval kodu — aşağıdaki çuval guard'ının mesajı için (operatör çuvalı bulmalı).
        sack: { select: { sackNo: true } },
      },
    });
    if (!parent) throw AppError.notFound("Top bulunamadı");
    if (parent.barcode === null) {
      throw AppError.badRequest(
        "Bu Roll açık kumaş; cutWarehouseRoll sadece barkodlu depo topu için",
      );
    }
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
    // Etikete basılacak kumaş adı / renk — topun kendi değeri (miras yok), ayara bağlı değil.
    const labelTexts = resolveRollLabelTexts(data);
    // Kg kaynağı (tek boğaz) + emanet alıcısı + en (miras/belge/ölçülen, K7) — tx'ten önce.
    const cutWeightSource = await resolveTamburWeightSource({ weightKg: cutWeightKg, weightSource: data.weightSource, stamp: { machineId: sessionMachineId } });
    const cutConsigneeId = await resolveTamburConsignee({
      labelConsigneeId: data.labelConsigneeId, targetCustomerId: data.targetCustomerId, ownerCustomerId: parent.ownerCustomerId,
    });
    const cutWidth = await resolveTamburChildWidth(await inheritedChildWidth(parent.id, parent.width), data.widthCm);
    // Ham (renksiz STOCK) top da "Top Kesme" aracında kesilebilir. Bitmiş depo
    // topu (WAREHOUSE) klasik akış; ham stok ise operatörün seçtiği hedefe göre
    // çıktı verir. Diğer statüler (IN_PRODUCTION vb.) kesime uygun değil.
    const isRawParent =
      parent.status === RollStatus.STOCK && parent.colorId === null;
    if (parent.status !== RollStatus.WAREHOUSE && !isRawParent) {
      throw AppError.badRequest(
        `Top kesime uygun değil (${parent.status}) — yalnız depodaki bitmiş toplar veya renksiz ham stok kesilebilir`,
      );
    }
    // Çuvala/sevkiyata rezerve top serbest stok DEĞİL — kesilirse sevkiyat içeriği
    // ve karşılanma bozulur. WAREHOUSE statüsüyle görünse de önce çıkarılmalı.
    // ÇUVAL ÖNCE (2026-07-30): DEPO çuvalındaki topun `shipmentId`'si NULL'dır, o
    // yüzden aşağıdaki kontrol onu KAÇIRIYORDU. Kesilirse üç şey bozulur:
    //   (1) parent'ın metrajı çuvalın İÇİNDE sessizce eksilir (aşağıda decrement),
    //   (2) burada `markSackContentChangedTx` ÇAĞRILMADIĞI için çuvalın brüt kg'si bayatlar,
    //   (3) çocuk top çuval DIŞINDA doğar → çuval içeriği ile fiziksel gerçek ayrışır.
    if (parent.sackId) {
      throw AppError.badRequest(
        sackBlockMessage(parent.barcode ?? parent.id, parent.sack?.sackNo ?? null, "kesilemez"),
      );
    }
    if (parent.shipmentId) {
      throw AppError.badRequest(
        "Bu top bir sevkiyatın çuvalında (rezerve) — kesilemez. Önce sevkiyattan çıkar.",
      );
    }
    // Çocuk top statüsü: ham parent → operatör hedefi (default üretime devam =
    // STOCK; sevke hazır = WAREHOUSE). Bitmiş parent → her zaman WAREHOUSE.
    const childStatus: RollStatus = isRawParent
      ? data.rawDestination === "WAREHOUSE"
        ? RollStatus.WAREHOUSE
        : RollStatus.STOCK
      : RollStatus.WAREHOUSE;
    // Aşım: operatör topu kayıtlıdan fazla ölçtü (tambur asıl ölçüm noktası).
    // Flag kapalıyken reddet (bugünkü davranış); açıkken kabul → parent top tamamen
    // tüketilir (aşağıda currentQty=0; `initialQty` giriş metrajı olarak KORUNUR —
    // 2026-08-29 denetimi, BULGU-T2-016).
    const exceedsRemaining = data.cutLength > Number(parent.currentQty);
    // Bayrak ÖN kararda okunur: aşım niyeti buradan doğar; tx içindeki kilit altındaki
    // kontrol niyeti DEĞİŞTİRMEZ, yalnız araya giren yazımı yakalar (409).
    const asimIzinli = await resolveTamburOverQuantityEnabled();
    if (exceedsRemaining && !asimIzinli) {
      throw AppError.badRequest(
        `Kesim metresi (${data.cutLength}) topun kalan metresinden (${parent.currentQty}) büyük olamaz`,
      );
    }

    const resolvedQualityGrade = data.qualityGrade ?? parent.qualityGrade;
    const resolvedQualityGradeId =
      data.qualityGrade && data.qualityGrade !== parent.qualityGrade
        ? await resolveQualityGradeIdStrict(data.qualityGrade)
        : parent.qualityGradeId;
    // KALİTE ZORUNLU (D6) — DEPO KESİMİ. Çözülen kalite (operatörün seçtiği ya
    // da parent'tan miras) NULL kalıyorsa çocuk top kalitesiz doğar; bayrak
    // açıkken bu yol kapalıdır. Okuma KOŞULLU: kalite doluysa sorgu yapılmaz.
    //
    // ⚠️ `cutOpenFabric` KAPSAM DIŞI ve bu bilinçli — orada kalite her hâlükârda
    // dolu ("1.KALITE" varsayılanına düşer), yani kapının ısıracağı bir durum
    // yok; eklemek yalnız her açık-kumaş kesimine bir sorgu ekletirdi.
    if (!resolvedQualityGrade && (await readQualityGradeRequiredEnabled())) {
      throw AppError.badRequest(
        "Kesilen parçanın kalitesi zorunlu — kaynak topun kalitesi de yok, kaliteyi seçin.",
        { code: "GRADE_REQUIRED" },
      );
    }
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));
    // İstasyon yeteneği (T1) — oturum istasyonu YALNIZ Tambur türündeyse (Top Kesme başka
    // istasyonun oturumundan da yapılabilir; o istasyonun yeteneği kesim çocuğuna yazılmaz).
    const tamburStationId = sessionStationId ?? null;
    const tamburCaps = tamburStationId
      ? await loadStationPropertyCaps(prisma, tamburStationId, { kind: StationKind.TAMBUR })
      : [];
    // Barkod SUNUCU'da sıralı atanır (atomik sayaç). WAREHOUSE child → "F", raw→STOCK → "H".
    const childBarcode = await generateRollBarcodeTx(prisma, childStatus === RollStatus.WAREHOUSE ? "F" : "H");
    // Etiket niyeti (pre-tx çözüm) — yalnız WAREHOUSE child anlamlı; raw→STOCK
    // (üretime devam) child stok etiketle doğar.
    // Niyeti BİR KEZ çöz, hem snapshot'a hem sorgulanabilir aynaya kullan —
    // iki kez çözülseydi araya giren bir müşteri pasifleştirmesi ikisini
    // ayrıştırabilirdi.
    const cutIntent =
      childStatus === RollStatus.WAREHOUSE
        ? await resolveLabelIntent({ ...data, ownerCustomerId: parent.ownerCustomerId })
        : { stock: true as const };
    const cutIntentSnapshot = buildIntentSnapshot(cutIntent);
    const cutLabelCustomerId = labelCustomerIdOf(cutIntent);

    let result: {
      child: Roll;
      newParentQty: number;
      updatedParent: Roll;
      defter: { pair: boolean; overage: boolean };
    };
    result = await prisma.$transaction(async (tx) => {
    // ── KİLİT tx'in İLK ifadesi, NİYET KORUNUR (2026-09-25, BULGU-T1-002 daraltıldı) ──
    // Ebeveyn satır kilidiyle alınır, kalan kilit ALTINDA okunur. Karar ÖN OKUMADAKİ
    // niyete göre verilir: normal niyette kalan artık yetmiyorsa ya da aşım niyetinde
    // kalan ön okumadan farklıysa araya başka bir yazım girmiştir (eşzamanlı kesim,
    // çift gönderim) → 409. Eşzamanlı eksilme sessizce AŞIMA DÖNMEZ: iki tablet aynı
    // topu aynı anda kesemez, onu aşım diye yazmak yoktan kumaş yazmaktır.
    const kilitli = await tx.$queryRaw<Array<{ currentQty: Prisma.Decimal }>>`
      SELECT "currentQty" FROM rolls WHERE id = ${parent.id}::uuid FOR UPDATE`;
    if (kilitli.length === 0) throw AppError.conflict("Top bu sırada silindi — listeyi yenileyin");
    const tazeKalan = new Prisma.Decimal(kilitli[0]!.currentQty);
    const tazeAsim = exceedsRemaining;
    const degisti = tazeAsim
      ? !tazeKalan.equals(new Prisma.Decimal(parent.currentQty))
      : tazeKalan.lessThan(data.cutLength);
    if (degisti) {
      throw AppError.conflict("Bu top siz keserken başka bir işlemle değişti — ekranı yenileyip tekrar deneyin.", {
        code: "ROLL_CHANGED_DURING_CUT",
      });
    }

    const child = await tx.roll.create({
      data: {
        barcode: childBarcode,
        clientToken: data.clientToken ?? null,
        itemId: parent.itemId,
        colorId: parent.colorId,
        width: cutWidth.width,
        // KAT — kesim anında seçilen değer KAZANIR. Bu yolda iş emri/adım YOK
        // (depo topu kesimi), tek bağlam parent → fallback yalnız parent.
        foldType: foldType !== undefined ? foldType : (parent.foldType ?? null),
        initialQty: data.cutLength,
        currentQty: data.cutLength,
        weightKg: cutWeightKg,
        weightSource: cutWeightSource,
        labelConsigneeId: cutConsigneeId,
        labelBatchNo: cutLabelBatchNo,
        labelItemName: labelTexts.labelItemName,
        labelColorName: labelTexts.labelColorName,
        // Bitmiş re-cut → WAREHOUSE; ham kesim → operatör hedefi (STOCK/WAREHOUSE).
        status: childStatus,
        qualityGrade: resolvedQualityGrade,
        qualityGradeId: resolvedQualityGradeId,
        parentRollId: parent.id,
        // EMANET sahipliği doğum niteliğidir: müşterinin kumaşından kesilen parça da onundur (H10).
        ownerCustomerId: parent.ownerCustomerId ?? null,
        // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
        batchId: parent.batchId,
        // DEPO parent'tan MİRAS ALINIR (giriş istasyonunun TERSİNE): kesmek malı
        // TAŞIMAZ, çocuk ebeveynin durduğu depodadır. Sorgu yalnız ebeveyn deposuz
        // ise (backfill öncesi kayıt) koşar — `??` sağ tarafı kısa devre yapar.
        warehouseId: parent.warehouseId ?? (await resolveTargetWarehouseId(tx)),
        // GİRİŞ İSTASYONU — bu yolda ADIM YOK (depo topu kesimi) → oturum tek kaynak.
        // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
        // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
        entryStationId: resolveEntryStationId({ sessionStationId }),
        entrySource: RollEntrySource.TAMBUR_SPLIT,
        stage: parent.stage, // Top Kesme çocuğu atanın aşamasını alır
        createdById: userId ?? null,
        createdMachineId: sessionMachineId ?? null,
        // Kartelalık yalnız depoya (WAREHOUSE) inen çıktıda anlamlı; ham stoğa
        // dönen (üretime devam) parçada işaretlenmez.
        markedForKartela:
          (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
        // Etiket niyeti kesim anında kalıcı (yazıcı/ekran bağımsız).
        lastLabelSnapshot: cutIntentSnapshot,
        // Sorgulanabilir ayna — snapshot ile AYNI create'te (bkz. Roll.labelCustomerId).
        labelCustomerId: cutLabelCustomerId,
      },
    });

    if (propertySnapshot.length > 0) {
      await inheritRollPropertiesTx(tx, { childId: child.id, rows: propertySnapshot });
    }
    await applyTamburCapabilitiesTx(tx, { caps: tamburCaps, stationId: tamburStationId, rollId: child.id, userId });

    // KURSUN_APPLIED + QC2_COMPLETED kalıtım — parent topta yapılmış operasyonlar
    // child'a `inheritedFromParentRollId=parent.id` ile kopyalanır. Aksi halde
    // child Bitmiş Depo'da "kurşun/KK2 yapılmadı" gözüküyor.
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

    // Parent kısalıyor — YALNIZ `currentQty` düşer, `initialQty` DOKUNULMAZ.
    //
    // ⚠️ 2026-08-29 DENETİMİ ÖNCESİ buraya `initialQty` de yazılıyordu ("her
    // kesim sonrası reset") ve gerekçesi gösterimdi: "70 / 100" yanıltıcı
    // görünüyordu. Ama kolonun anlamı GÖSTERİM değil ÜRETİM ANI SNAPSHOT'ıdır
    // ve onu düşürmek üç ayrı kusur üretiyordu:
    //   ① İş emrinin ÜRETİLEN metrajı geriye dönük azalıyordu (BULGU-T2-016;
    //      ölçüm: IE1408260004 −76,7 m; saha kopyasında 120 top bu durumda).
    //   ② `rollWhole = initialQty.equals(currentQty)` kesimden SONRA da TRUE
    //      kalıyordu → "yalnız bütün topta metraj düzeltilir" kuralı kesilmiş
    //      topu da geçiriyor, operatör ekrandaki eski değeri yazınca 100 m'lik
    //      fiziksel toptan sistemde 140,5 m doğuyordu (BULGU-T1-001 repro'su).
    //   ③ "Tümden Geri Al" çocuk toplamını yazarken `initialQty` düşük kaldığı
    //      için sapma defterine OLMAYAN bir AŞIM satırı yazılıyordu (BULGU-T2-002).
    // Geri alma aritmetiği bundan ETKİLENMEZ: `computeRestoredQty` ebeveynin
    // değil ÇOCUKLARIN `initialQty`'sini toplar (tambur-undo.service.ts:344).
    // Gösterim tarafı: "60 / 100" artık doğru cümledir — "bu top 100 m girdi,
    // 60 m'si elde" — ve kesilmiş topun metrajı ARTIK DÜZELTİLEMEZ (istenen).
    //
    // Atomic decrement — hesap DB-side, gte guard concurrent overdraw'a karşı.
    // Aşımda (cutLength > currentQty) decrement negatife düşer → bunun yerine topu
    // tamamen tüket (currentQty=0; initialQty korunur). gt:0 guard eşzamanlı
    // çift-tüketimi engeller.
    // F128: guarded-decrement = atomik claim. WHERE'e status + shipmentId:null +
    // sackId:null eklenerek pre-tx (check-then-act) statü/rezervasyon/çuval kontrolü
    // tx içine alınır: eşzamanlı sevkiyat rezervasyonu (shipping updateMany {id,
    // shipmentId:null, status:WAREHOUSE}) ya da ÇUVALA OKUTMA (scanIntoSack
    // updateMany {id, sackId:null}) araya girerse WHERE eşleşmez → P2025 → 409.
    // `sackId: null` şart: çuvaldaki topun metrajını eksiltmek çuval içeriğini
    // sessizce bozar (2026-07-30 hayalet-içerik bulgusu).
    // Aşım dalının WHERE'indeki `currentQty: tazeKalan` guard'ı KİLİTLE birlikte kalır
    // (savunma katmanı): kilit altında okunan değerden başka bir değere yazılamaz.
    // ⚠️ `currentQty > 0` ŞARTI YİNE YOK: 0'a inmiş topta ikinci aşım kesimi
    //    MEŞRU (mal fiziksel olarak elde, 2026-08-12 saha vakası).
    let updatedParent;
    try {
      updatedParent = tazeAsim
        ? await tx.roll.update({
            where: {
              id: parent.id,
              status: parent.status,
              shipmentId: null,
              sackId: null,
              // İYİMSER GUARD — okunan taze değer. Bkz. yukarıdaki not.
              currentQty: tazeKalan,
            },
            data: { currentQty: 0 },
          })
        : await tx.roll.update({
            where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null, currentQty: { gte: data.cutLength } },
            data: { currentQty: { decrement: data.cutLength } },
          });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw AppError.conflict(
          "Top bu sırada değişti (statü değişmiş / çuvala okutulmuş / sevkiyata rezerve edilmiş / kalan metre yetersiz) — listeyi yenileyip tekrar deneyin"
        );
      }
      throw err;
    }
    const newParentQty = Number(updatedParent.currentQty);
    // Kapanış öncesi metraj = kesimden ÖNCEKİ kalan (satır KİLİDİ altında okunan
    // `tazeKalan`; normal niyette ön okumadan küçük olabilir), çocukların toplamı DEĞİL.
    const kesimOncesiQty = Number(tazeKalan);

    // AŞIM DEFTERİ — `cutOpenFabric` ikizi. Depo kesimi adıma bağlı DEĞİL.
    const overageQty = tazeAsim ? overageOf(data.cutLength, tazeKalan) : new Prisma.Decimal(0);
    let overageVarianceId: string | null = null;
    if (tazeAsim) {
      overageVarianceId = await recordVarianceTx(tx, {
        rollId: parent.id,
        workOrderStepId: null,
        kind: RollVarianceKind.OVERAGE,
        // Defter payı da TAZE metrajdan (bayat değer 140 m'lik aşımı 20 m yazıyordu).
        qty: overageQty,
        source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
        // KEŞİF EBEVEYNDE, KAYNAĞI ÇOCUK: geri alma bu çocuğun keşfini buradan bulur
        // ve bump'ı yalnız karşılanmayan kısım için yazar (hüküm ②).
        sourceRollId: child.id,
        measureSource: toMachineDataSource(weakestMeasureSource([data.measure?.source])),
        userId,
      });
    }

    // ── STOK DEFTERİ — KESİM MALI TAŞIMAZ, BÖLER ──────────────────────────
    // Ebeveynden çıkan metraj çocuğa girer: satır TEK değil ÇİFT yazılır ve
    // ikisi aynı `transformGroupId` altında toplanır → grup neti SIFIR, depo
    // toplamı kesimden etkilenmez. "Çocuğa yazmak çift saydırır" korkusu
    // yalnız EBEVEYN ÇIKIŞI yazılmadığında geçerliydi.
    //
    // DEVREDEN metraj ebeveynin GERÇEKTEN kaybettiği kadardır: aşımda ebeveyn
    // `tazeKalan`ı kaybeder, çocuk `cutLength` ile doğar.
    const transferQty = tazeAsim ? tazeKalan : new Prisma.Decimal(data.cutLength);
    let ledgerPairWritten = false;
    let ledgerOverageWritten = false;
    // HEPSİ YA HİÇ: bir uç yazılamıyorsa (deposuz defter-öncesi top) hiçbiri
    // yazılmaz — tek başına çocuk girişi, karşılığı olmayan bir ARTI olurdu.
    if (
      parent.warehouseId !== null &&
      child.warehouseId !== null &&
      WAREHOUSE_STOCK_STATUSES.includes(parent.status) &&
      WAREHOUSE_STOCK_STATUSES.includes(child.status) &&
      qtyYazilabilir(transferQty)
    ) {
      const transformGroupId = randomUUID();
      await postStockMove(tx, {
        rollId: parent.id,
        eventType: WarehouseEventType.TRANSFORM,
        qty: transferQty,
        from: { warehouseId: parent.warehouseId, status: parent.status },
        reasonCode: STOCK_MOVE_REASON.CUT_SPLIT,
        transformGroupId,
        userId: userId ?? null,
      });
      await postStockMove(tx, {
        rollId: child.id,
        eventType: WarehouseEventType.TRANSFORM,
        qty: transferQty,
        to: { warehouseId: child.warehouseId, status: child.status },
        reasonCode: STOCK_MOVE_REASON.CUT_SPLIT,
        transformGroupId,
        userId: userId ?? null,
      });
      ledgerPairWritten = true;
    }
    // AŞIM bir DEVİR değil KEŞİF: gruba GİRMEZ, yoksa "grup neti sıfır"
    // değişmezi aşımda sessizce kırılırdı. Kapı ÇİFTTEN AYRI sorulur çünkü
    // 0 m'ye inmiş topta ikinci aşım kesimi meşrudur ve orada devredecek
    // metraj yoktur (2026-08-12 saha vakası).
    if (
      child.warehouseId !== null &&
      WAREHOUSE_STOCK_STATUSES.includes(child.status) &&
      qtyYazilabilir(overageQty)
    ) {
      await postStockMove(tx, {
        rollId: child.id,
        eventType: WarehouseEventType.ADJUST,
        qty: overageQty,
        to: { warehouseId: child.warehouseId, status: child.status },
        reasonCode: STOCK_MOVE_REASON.OVERAGE,
        rollVarianceId: overageVarianceId,
        userId: userId ?? null,
      });
      ledgerOverageWritten = true;
    }

    // ── KAYNAK TÜKENDİYSE EMEKLİ ET (2026-08-29 / BULGU-T1-039) ────────────
    // Operatör 36,7 m'lik depo topunu tek parça hâlinde keser ve ekranı
    // "Bitir" demeden kapatırsa kaynak top WAREHOUSE / 0 m / BARKODLU olarak
    // depoda kalıyordu: Bitmiş Depo listesinde fazla bir satır, çuvala
    // okutulabilen ve çuvalın "top adedi"ni şişiren bir hayalet, irsaliyede
    // 0 m'lik bir kalem. Metraj toplamları etkilenmez (0 m), ADET metrikleri
    // etkilenir — ve mutabakat kapısı bu satırları sonsuza dek anomali diye
    // raporlar, yani kapının sinyali körelir.
    //
    // `finalizeWarehouseCut`in kapanışıyla AYNI hâl yazılır: kapanış öncesi
    // metraj + statü. Geri alma yolu (`tambur-undo` depo dalı) bu iki kolonu
    // OKUR — yazmazsak diriltme metrajı çocuklardan TÜRETMEYE çalışır ve
    // aşımda `currentQty > initialQty` üretir (2026-08-09 dersi).
    // ⚠️⚠️ AŞIM DALI HARİÇ — bu iki kural ÇARPIŞIYOR ve sınır burada (bekçi
    //    `test_tambur_cut_concurrency` §3 ilk yazımda bunu kırmızı verdi):
    //    aşım kesiminde parent 0'a iner ama FİZİKSEL kumaş bitmemiştir
    //    (2026-08-12: "500 m kayıtlı kumaş 550 m çıkabilir, fazlalık tek
    //    kesimde bitmeyebilir"). Orada emekli etmek, operatörün elindeki malı
    //    kesmesini engeller ve "top işlenebilir durumda değil" 400'ü verir.
    //    Emeklilik yalnız TAM BİTEN kesimde: kalan tam tükendi ve aşım YOK.
    if (!tazeAsim && newParentQty === 0 && parent.status !== RollStatus.TAMBUR_CONSUMED) {
      await tx.roll.update({
        where: { id: parent.id },
        data: {
          status: RollStatus.TAMBUR_CONSUMED,
          currentStepId: null,
          preTamburCloseQty: new Prisma.Decimal(kesimOncesiQty),
          preTamburCloseStatus: parent.status,
        },
      });
    }

    return {
      child,
      newParentQty,
      updatedParent,
      defter: { pair: ledgerPairWritten, overage: ledgerOverageWritten },
    };
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: result.child.id,
      newData: {
        kind: isRawParent ? "TAMBUR_CUT_RAW" : "TAMBUR_CUT_FROM_WAREHOUSE",
        parentRollId: parent.id,
        parentBarcode: parent.barcode,
        cutLength: data.cutLength,
        childBarcode: result.child.barcode,
        childQualityGrade: result.child.qualityGrade,
        childStatus,
        rawDestination: isRawParent ? (data.rawDestination ?? "STOCK") : null,
        parentRemainingQty: result.newParentQty,
        // Defter etkisi: çift yazıldı mı, aşım keşfi yazıldı mı. Yazılmayan hâl
        // (deposuz defter-öncesi top) sessiz kalmasın.
        defter: result.defter,
        notes: data.notes ?? null,
        ...(cutWidth.trace ? { measuredWidth: cutWidth.trace } : {}),
        ...(labelTexts.labelItemName || labelTexts.labelColorName ? labelTexts : {}),
      },
    });

    return {
      success: true,
      data: {
        childRoll: result.child,
        parentRoll: result.updatedParent as Roll,
        parentRemainingQty: result.newParentQty,
      },
      message: `Kesim: ${data.cutLength} mt → ${result.child.barcode}. Top kalan: ${result.newParentQty} mt.`,
    };
  }
