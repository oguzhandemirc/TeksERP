// =============================================================================
// Inventory Service / initial-entry
// =============================================================================
// KK1 ham mal girişi (createInitialEntry): token replay + taze giriş tx'i (mükerrer tuzağı, muayene doğumu, depo damgası, defter).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (inventory/list.ts sayılır) */

import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import prisma from "../../lib/prisma";
import { claimDoffForRollTx } from "../helpers/machine-doff-link.helper";
import { autoConsumeForRollTx } from "../warp-beam-auto-consume.service";
import { resolveKk1BirthTx, type Kk1BirthInput, type Kk1BirthResolution } from "../helpers/kk1-roll-birth.helper";
import { reserveDoffCode } from "../helpers/machine-doff-open.helper";
import { readDbNow } from "../helpers/machine-run-open.helper";
import { AuditService } from "../audit.service";
import { resolveBirthWarehouseIdTx } from "../helpers/emanet-warehouse.helper";
import {
  postStockMove,
} from "../helpers/warehouse-ledger.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { AppError } from "../../utils/app-error";
import { assertMasterDataLiveTx } from "../helpers/master-data-live.helper";
import { assertItemUsable, assertItemUsableTx, type ItemUsage } from "../helpers/item-usage.helper";
import { assertRollReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import { ApiResponse } from "../../types/api.types";
import { resolveQualityGradeIdStrict } from "../helpers/quality-grade.helper";
import {
  readKk1WeightEntryEnabled,
  readKaliteGuvenceEnabled,
  readKk1DuplicateGuardEnabled,
  readQualityGradeRequiredEnabled,
} from "../system-setting.service";
// Mükerrer tuzağının saf parçaları (pencere sabiti, kilit anahtarı, damga
// kelepçesi, index çıpası) `helpers/duplicate-guard.helper` içinde — DB'ye
// dokunmadıkları için birim testlenebilirler.
import {
  DUPLICATE_ENTRY_WINDOW_MS,
  DUPLICATE_GUARD_LOCK_NS,
  duplicateGuardLockKey,
  duplicateGuardCreatedAtFloor,
  resolveEntryStamp,
} from "../helpers/duplicate-guard.helper";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  RollStage,
  ItemType,
  WarehouseEventType,
} from "@prisma/client";
import { birthStageForEntry } from "../helpers/roll-stage.helper";
import {
  STEP_QUALITY_SELECT,
  stepCanApplyQuality,
} from "../helpers/quality-station.helper";
import {
  assertTargetablePropertyIds,
} from "../helpers/targetable-property.helper";
import { generateRollBarcodeTx, type RollBarcodeType } from "../helpers/roll-barcode.helper";
import {
  inspectionNotSaved,
  resolveInspectionOnBirth,
  type BirthInspectionInput,
  type InspectionNotSaved,
  type InspectionOnBirthDecision,
} from "../helpers/inspection-on-birth.helper";
import { createInspectionTx, INSPECTION_AUDIT_TABLE } from "../quality-inspection.service";
import { finalBarcodeType } from "../helpers/roll-finalize.helper";
import { assertEmanetWritableTx } from "../helpers/emanet-owner.helper";
import { assertCariNotHeldTx } from "../helpers/cari-hold.helper";
import type { InventoryService } from "../inventory.service";
import type { InventoryServiceThis } from "./shared";

/**
 * `createInitialEntry`in yanıtı — `ApiResponse<Roll>` + REPLAY İŞARETİ.
 *
 * ⚠️ `idempotent: true` = "bu çağrıda YENİ top DOĞMADI, aynı `clientToken`la
 * daha önce yazılmış olan geri döndü". Alan bilgi amaçlı DEĞİL, KARAR
 * verdiricidir: çağıran taraf bir DEFTER tutuyorsa (miktar sayacı, kapasite,
 * kota) replay'i saymamalıdır — o mal zaten bir kez sayılmıştır.
 *
 * Neden mesaj metnine bakılmıyor: "Top zaten kayıtlı (idempotent retry)"
 * cümlesi operatöre gösterilen bir METİNDİR; ilk düzenleyen kişi onu
 * değiştirdiğinde metne bakan çağıran replay'i sessizce "yeni top" saymaya
 * başlar — hata yok, log yok, yalnız iki kez sayılmış mal. Karar alanı ayrı.
 *
 * Alan OPSİYONELDİR ve yalnız replay'de doldurulur: mevcut çağıranların
 * hiçbiri (`inventory.controller`, `tambur-manual.service`) etkilenmez.
 */
/** S1: KK1 doğuşunda sunucunun doğurduğu indirme yalnız BU yanıtta (`ROLL_LIST_INCLUDE` genişlemez; tablet rozet basar). */
/** K4P-KK1: doğuş muayenesi yalnız gövde `inspection` taşıdıysa (`data.inspection`); yazılmadıysa `inspectionNotSaved` + `warnings` metni. */
export type BirthInspectionSummary = { id: string; pointsPer100M2: Prisma.Decimal | null; suggestedGradeCode: string | null };
export type InitialEntryResult = ApiResponse<Roll & { doffEvent?: { id: string; code: string }; inspection?: BirthInspectionSummary | null }> & {
  idempotent?: true;
  inspectionNotSaved?: InspectionNotSaved;
};

/**
 * K4P-KK1b: giriş istasyonu muayeneye kapalı mı? (tx DIŞINDA, kapı kararı için) `null` = istasyonsuz ya da
 * bulunamayan istasyon — o durumda karar tx içindeki tek yazarın doğrulamasına kalır.
 */
async function entryStationCapableForInspection(stationId: string | null | undefined): Promise<boolean | null> {
  if (!stationId) return null;
  const st = await prisma.station.findUnique({ where: { id: stationId }, select: STEP_QUALITY_SELECT });
  return st ? stepCanApplyQuality(st) : null;
}

export async function createInitialEntry(this: InventoryServiceThis, ...args: Parameters<InventoryService["createInitialEntryFresh"]>): Promise<InitialEntryResult> {
    const [data, , , , opts] = args;
    return this.initialEntryReplay(data, opts).run(data.clientToken, () => this.createInitialEntryFresh(...args));
  }

export function initialEntryReplay(
    data: { itemId: string; colorId?: string | null; initialQty: number },
    opts?: { goodsReceiptId?: string | null; parentReceiptId?: string | null; doffEventId?: string | null; kk1Birth?: Kk1BirthInput | null; inspection?: unknown },
  ) {
    // S1: doff `id/code` rozet için, `machine.code` + `machineRun.weavingOrderId` replay KİMLİĞİ için (bağlam alanları).
    const PRIOR_INCLUDE = {
      item: true,
      color: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      doffEvent: { select: { id: true, code: true, machine: { select: { code: true } }, machineRun: { select: { weavingOrderId: true } } } },
      // K4P-KK1: doğuş muayenesi (RAW, ilk revizyon) — yalnız gövde `inspection` taşıdıysa yanıta girer.
      inspections: { where: { phase: "RAW", revision: 1 }, select: { id: true, pointsPer100M2: true, suggestedGradeCode: true }, take: 1 },
    } satisfies Prisma.RollInclude;
    type Prior = Prisma.RollGetPayload<{ include: typeof PRIOR_INCLUDE }>;
    // Bağlam: [alan, gelen, mevcut okuyucusu] — doff yoluyla doğan A-yolu topunda kolon NULL, iş koşumdan okunur.
    const context: ReadonlyArray<readonly [string, string | null | undefined, (r: Prior) => string | null]> = [
      ["goodsReceiptId", opts?.goodsReceiptId, (r) => r.goodsReceiptId],
      ["parentReceiptId", opts?.parentReceiptId, (r) => r.parentReceiptId],
      ["doffEventId", opts?.doffEventId, (r) => r.doffEventId],
      ["machineCode", opts?.kk1Birth?.machineCode, (r) => r.doffEvent?.machine.code ?? null],
      ["weavingOrderId", opts?.kk1Birth?.weavingOrderId, (r) => r.weavingOrderId ?? r.doffEvent?.machineRun?.weavingOrderId ?? null],
    ];
    const strip = (r: Prior): InitialEntryResult["data"] => {
      const { doffEvent, inspections, ...rest } = r;
      const base = doffEvent ? { ...rest, doffEvent: { id: doffEvent.id, code: doffEvent.code } } : rest;
      // Alansız gövdede yanıt bayt bayt eskisi; alanlıda muayene yeniden YAZILMAZ, doğuşta yazılanı (ya da null) döner.
      return opts?.inspection ? { ...base, inspection: inspections[0] ?? null } : base;
    };
    return tokenReplay<Prior, InitialEntryResult>({
      find: (db, clientToken) => db.roll.findUnique({ where: { clientToken }, include: PRIOR_INCLUDE }),
      alive: (r) => assertRollReplayAlive(r),
      identity: (r) => [
        { ad: "itemId", mevcut: r.itemId, gelen: data.itemId },
        { ad: "colorId", mevcut: r.colorId, gelen: data.colorId ?? null },
        { ad: "initialQty", mevcut: r.initialQty, gelen: data.initialQty },
        ...context.filter(([, v]) => v).map(([ad, v, oku]) => ({ ad, mevcut: oku(r), gelen: v })),
        // `inspection` kimliğe BİLEREK girmez: modül/izin kapısında muayenesiz doğan topun tekrarı (ya da operatörün
        // ilk denemeden sonra hata eklemesi) çakışma değil AYNI toptur; muayene düzeltmesi revizyon ucunun işidir.
      ],
      collision: "Bu istemci anahtarı farklı bir topla kullanılmış. Topu yeniden okutup tekrar deneyin.",
      collisionEk: (r) => ({
        barcode: r.barcode,
        existing: { id: r.id, itemId: r.itemId, colorId: r.colorId, initialQty: Number(r.initialQty) },
        incoming: { itemId: data.itemId, colorId: data.colorId ?? null, initialQty: data.initialQty },
      }),
      // ⚠️ YENİ TOP DOĞMADI — defter tutan çağıran bunu SAYMAMALI (`InitialEntryResult` başlığı).
      respond: (r) => ({ success: true, data: strip(r), message: `Top zaten kayıtlı (idempotent retry). Barkod: ${r.barcode}`, idempotent: true }),
    });
  }

// eslint-disable-next-line max-params -- özgün metot 5 parametreli ve uyarısı cephedeki imzada sayılır; ailenin max-params katkısı bölme öncesi gibi TEK
export async function createInitialEntryFresh(
    data: {
      itemId: string;
      colorId?: string | null;
      initialQty: number;
      weightKg?: number;
      qualityGrade?: string;
      width?: number | null;  // En (cm) — opsiyonel, ölçülmediyse null
      propertyIds?: string[];
      /**
       * Opsiyonel idempotency anahtarı (UUID) — offline KK1 / ağ-retry için mobil
       * üretir. Barkod artık SUNUCU'da sıralı atandığından (T+GGAAYY+H/F+NNNN)
       * dedup barkodla değil bu token'la yapılır: Roll.clientToken @unique → aynı
       * token'la 2. çağrı cached Roll döner. Verilmezse (backend-içi çağrı) dedup yok.
       */
      clientToken?: string;
      /**
       * İstemcinin BEYAN ETTİĞİ giriş anı — operatörün "Kaydet"e bastığı an.
       * Mükerrer tuzağının penceresi bununla ölçülür (sunucu `createdAt`'i offline
       * flush'ta girişin anı DEĞİLDİR — bkz. `Roll.clientEnteredAt` şema notu).
       * Verilmezse / makul aralık dışındaysa sunucu saatine düşülür.
       */
      clientEnteredAt?: Date | null;
    },
    userId?: string,
    /** KK1 makine atfı — aktif çalışma oturumundan (controller çözer). KK1 girişi
     *  RollOperation üretmediği için atıf Roll.createdMachineId üstünde kapanır. */
    machineId?: string | null,
    /** İsteğin kaynağı — eşleşmiş mobil cihazdan mı (KK1 istasyon taraması) geldi,
     *  yoksa Electron admin panelinden mi ("Manuel Top Ekle")? entrySource bunu
     *  ayırt eder (controller `Boolean(req.device)` ile çözer — Electron ASLA
     *  x-device-id göndermez). */
    isMobileOrigin?: boolean,
    /**
     * KK1-DIŞI (bitmiş ürün) çağrılarının açık niyeti. Verilmezse metot bugünkü
     * KK1 davranışını BİREBİR korur — üç alanın hiçbiri KK1 create payload'ına
     * girmez (spread ile koşullu eklenir).
     */
    opts?: {
      /**
       * Topun doğacağı statü — **renk sezgisini BYPASS eder**.
       *
       * KK1 yolunda statü renkten çıkarılır (`colorId != null ? WAREHOUSE : STOCK`)
       * ve orada DOĞRUDUR: renksiz kumaş ham demektir, üretime girecektir. Ama
       * "bitmiş ürünü acilen depoya al" niyetinde bu sezgi SESSİZCE YANLIŞTIR —
       * renksiz (ham beyaz) bitmiş bir top Ham Stok'a düşer, operatör onu Bitmiş
       * Depo'da arar ve bulamaz. Bu yüzden bitmiş-ürün çağrıları statüyü AÇIKÇA
       * söyler; sezgi yalnız söylenmediğinde çalışır.
       *
       * Barkod tip damgası (H/F) da bu statüden türer (`finalBarcodeType`) —
       * renkten değil; renksiz bitmiş top "H" (ham) damgalı barkod ALMAZ.
       */
      forcedStatus?: RollStatus;
      /** Kartelalık işareti — yalnız WAREHOUSE'a doğan topta anlamlı (Tambur emsali). */
      markedForKartela?: boolean;
      /**
       * Topun GİRİŞ YERİ — `isMobileOrigin` sezgisini BYPASS eder.
       *
       * Sezgi iki kapı bilir: eşleşmiş mobil cihaz = KK1 istasyon taraması
       * (`SUPPLIER_RECEIPT`), cihazsız istek = Electron admin paneli
       * (`MANUAL_ENTRY`). Tambur'un "Manuel Ekle" modu bu ikisine de UYMAZ —
       * istek mobilden gelir ama KK1 taraması DEĞİLDİR; sezgiye bırakılırsa
       * kartsız üretilen bitmiş top envanterde ham tedarikçi girişi gibi görünür
       * ve topun detay panelindeki "giriş yeri" YANLIŞ olur. O yüzden o yol
       * kendi değerini (`TAMBUR_MANUAL`) AÇIKÇA söyler; sezgi yalnız
       * söylenmediğinde çalışır.
       */
      forcedEntrySource?: RollEntrySource;
      /** Topun AŞAMASI — verilmezse `birthStageForEntry` (yarı mamul girişi > bitmiş stok > ham). */
      stage?: RollStage;
      /**
       * BU TOP HANGİ İNDİRMEDEN (dokuma P3/§3.8b) — yalnız `forcedEntrySource: WEAVING`
       * ile anlamlı; verilmezse NULL kalır ("atanmamış", tahmin edilmez). Bağ tx
       * içinde doff satırı KİLİTLENEREK kurulur (`claimDoffForRollTx`).
       */
      doffEventId?: string | null;
      /**
       * S1 — TOP KK1'DE DOĞAR (`dokuma.rollBirth` KK1_*): tezgah etiketi (`machineCode`) ya da iş emri
       * (`weavingOrderId`); indirme bu tx'te SUNUCUDA doğar (`resolveKk1BirthTx` → `createDoffTx`), sonra
       * mevcut bağ + levent zinciri aynen. `doffEventId` ile birlikte VERİLMEZ (controller zod'u ayırır).
       * Kapılar (modül, mod) controller'da — burası çağıranın beyanına güvenir (dahili çağıran vermez).
       */
      kk1Birth?: Kk1BirthInput | null;
      /**
       * K4P-KK1 — doğuşta muayene: yalnız HTTP doğuş yolu verir. Kapı (modül + `inspection:write`) burada
       * `resolveInspectionOnBirth`; yazım topla AYNI tx'te `createInspectionTx` (tek yazar), istasyon `entryStationId`.
       */
      inspection?: (BirthInspectionInput & { permissions: readonly string[]; deviceId?: string | null }) | null;
      /**
       * Elle eklenen topun SEBEBİ — kalıcı kolona (`Roll.entryReason`) yazılır.
       * Zincire dayanan yollar (KK1 / kesim / fason) bunu VERMEZ; onların sebebi
       * belgesidir ve alan NULL kalır. Audit kaydı ayrıca yazılmaya devam eder
       * (bağlamıyla birlikte) — kolon görünen/raporlanan kaynaktır.
       */
      entryReason?: string | null;
      /**
       * Ekleme sebebinin KATALOG KODU (`Roll.entryReasonCode`, 2026-08-21) — rapor
       * anahtarı. Çağıran `resolveReasonCode(ROLL_MANUAL_ENTRY, …)` ile tx DIŞINDA
       * çözer (açık kod doğrulanır, yoksa metinden türetilir); burada TÜRETİLMEZ —
       * bu metot tx açar ve katalog okuması tx'e girmemeli. NULL = serbest metin.
       */
      entryReasonCode?: string | null;
      /**
       * Kaç kat sarıldığı ("2-KAT" | "4-KAT"). MİRAS ALINMAZ: çağıran o an
       * geçerli olan değeri AÇIKÇA verir; verilmezse NULL ("bilinmiyor").
       */
      foldType?: string | null;
      /**
       * GİRİŞ İSTASYONU — topun doğduğu istasyon (Roll.entryStationId).
       *
       * ⚠️ Bu metot içinde TÜRETİLMEZ. `machineId` elde olsa bile ondan
       * `Machine.stationId`e gitmek YANLIŞTIR: makine sonradan taşınırsa
       * geçmiş toplar başka istasyonda doğmuş görünür (kolonun var olma
       * sebebi tam da bu). Ayrıca bu TEK create noktası ÜÇ farklı mantıksal
       * yolu besliyor (KK1 ham giriş / Electron manuel / Tambur manuel) ve
       * üçünün doğru cevabı farklı — sezgi burada sessizce yanlış olur.
       * Çağıran `resolveEntryStationId` ile çözer ve AÇIKÇA verir
       * (`forcedEntrySource` emsali).
       */
      entryStationId?: string | null;
      /**
       * Topun gireceği DEPO (ticaret paketi, 2026-08-13).
       *
       * VERİLMEZSE varsayılan depoya düşer — fabrika akışlarının (KK1 ham giriş,
       * Tambur manuel) hiçbiri bunu göndermez ve davranışları güncelleme
       * öncesiyle bayt-bayt aynı kalır. Yalnız Mal Kabul fişi açıkça verir.
       * Doğrulama (var mı/aktif mi) `resolveTargetWarehouseId`'de.
       */
      warehouseId?: string | null;
      /**
       * Satın alma birim fiyatı (mal kabul yolu) — topun kalıcı alış bedeli.
       *
       * ⚠️ Tip `Prisma.Decimal.Value` (number | string | Decimal), düz `number`
       * DEĞİL: kalem kartından çözülen fiyat (D2 `resolveItemPrice`) bir
       * `Decimal`dır ve `number`a çevirmek Decimal kolonuna JS float sokmak
       * demekti (CLAUDE.md perf/doğruluk kuralı). Prisma `Decimal.Value`u
       * doğrudan kabul eder.
       */
      purchasePrice?: Prisma.Decimal.Value | null;
      /** Topu doğuran mal kabul fişi (yalnız `GoodsReceipt` yolu doldurur). */
      goodsReceiptId?: string | null;
      /**
       * Topu doğuran FASON DOKUMA makbuzu (G2, 2026-09-14) — yalnız
       * `forcedEntrySource: WEAVING` ile ve yalnız `subcontractor-weaving.service`
       * doldurur; top↔dokuma işi bağı buradan türer (`weavingOrderOfRoll`).
       */
      parentReceiptId?: string | null;
      /**
       * G3 EMANET — topun SAHİBİ olan müşteri (doğum niteliği; PATCH yolu yok). KK1 seçicisi ya da fason dokuma
       * makbuzunda leventlerden kalıtım (`resolveOwnerFromBeamsTx`) verir; `emanet.enabled` kapalıyken 403.
       */
      ownerCustomerId?: string | null;
      /**
       * Topun KARŞILADIĞI alış siparişi kalemi (J2, 2026-08-15) — yalnız
       * `GoodsReceipt` yolu doldurur, orada da yalnız fiş bir siparişe bağlıysa.
       *
       * ⚠️ BURADA TÜRETİLMEZ (`entryStationId` / `forcedEntrySource` emsali):
       * kalem seçimi FIFO kapasite defterine bakar ve o defter fiş boyunca
       * yaşar (satırlar ayrı tx'lerde doğuyor) — tek satırlık bu create
       * noktasından görülemez. Çağıran çözer, AÇIKÇA verir.
       *
       * ⚠️ İZ BİLGİLENDİRİCİDİR, KARŞILANMA HESABI DEĞİL: `receivedQty`nin tek
       * kaynağı `purchase-order.service` rollup zinciridir (şema yorumu).
       */
      purchaseOrderLineId?: string | null;
      /**
       * Kartın KULLANIM SINIFI (URUN-YASAM-DONGUSU.md §4). Verilmezse belge bağından
       * türer: doff ya da alış satırı = açık belgeyi tamamlayan giriş (C′), değilse
       * belgesiz yeni stok (C — "Tükenene kadar" kartta kapalı, fail-closed).
       * Mevcut malı yürüten dahili yollar (tambur) `EXISTING_GOODS` verir.
       */
      itemUsage?: Extract<ItemUsage, "NEW_STOCK" | "DOC_COMPLETION" | "EXISTING_GOODS">;
      /**
       * KK1 AĞIRLIK POLİTİKASINDAN MUAFİYET (saha planı A1, 2026-08-15).
       *
       * `kk1.weightEntryEnabled` bir KK1 İSTASYON politikasıdır: o istasyonda
       * kantar yoksa/kapalıysa operatörün elle kg girmesi engellenir. Mal Kabul
       * ise bir DEPO GİRİŞİDİR — perde/tekstil ticaretinde kumaş kg+metre çift
       * birimle alınır ve kg girişi standarttır. Muafiyet verilmeden önce bu
       * bayrak KAPALI kurulumlarda mal kabulün kg'li HER satırı "Ağırlık (kg)
       * girişi bu istasyonda kapalı" ile reddediliyordu (saha vakası: 10 satır).
       *
       * F221 deseni: alan verilmezse politika AYNEN uygulanır (KK1 + tambur
       * yolları davranış değiştirmez); yalnız Mal Kabul yolu bilerek geçer.
       */
      skipKk1WeightPolicy?: boolean;
      /**
       * D4-I1 cari kilidi (INTAKE): sahibin carisi kilitliyse doğum tx'inde 409 `CARI_HOLD`. Yalnız gelen belge onayı
       * verir (yeni iş kabulü); KK1/fason/bölme doğumları davranış değiştirmez.
       */
      cariHoldIntakeGate?: boolean;
      /**
       * `lastLabelSnapshot`'a yazılacak minimal etiket NİYETİ
       * (`{orderLineId}` | `{customerId}` | `{stock:true}`). Çözümü ÇAĞIRAN yapar
       * (`helpers/label-intent.helper`) — burada DB okuması yok.
       */
      labelIntentSnapshot?: Prisma.InputJsonValue;
      /**
       * MÜKERRER TOP TUZAĞI — **yalnız HTTP yolu geçer** (controller doldurur).
       *
       * F221 deseni: alan verilmezse enforcement ATLANIR. Bu bilinçlidir —
       * `createInitialEntry`'nin dahili çağıranları var (`tambur-manual.service`
       * ×2) ve onlar programatik olarak arka arkaya birebir aynı topu
       * üretebilir (eşit parçaya bölme); koşulsuz bir tuzak o akışları kırardı.
       *
       * `confirmed: true` = operatör "evet, bu gerçekten ayrı bir top" dedi →
       * kontrol atlanır. Tuzak ayrıca `kk1.duplicateGuardEnabled` bayrağına
       * bağlıdır (default KAPALI — bkz. system-setting.service).
       */
      duplicateGuard?: { confirmed: boolean };
      /**
       * KALİTE ZORUNLULUĞU (D6, 2026-09-03) — **yalnız HTTP yolu geçer**.
       *
       * F221 deseni (`duplicateGuard` ikizi): alan verilmezse enforcement
       * ATLANIR. Bu bilinçlidir — dahili çağıranlar (`tambur-manual.service`
       * ×2, `goods-receipt.service`, `warehouse-transfer.service`) kaliteyi
       * kendi bağlamlarından çözer ya da bilerek NULL bırakır; koşulsuz bir
       * kural mal kabulü ve elle top eklemeyi de kilitlerdi.
       *
       * Kural ayrıca `quality.gradeRequiredEnabled` bayrağına bağlıdır
       * (default KAPALI). ⚠️ Bayrak açılmadan önce sahadaki tabletler kalite
       * alanı gönderen APK'ya güncellenmiş olmalı: çevrimdışı kuyruktaki
       * kalitesiz kayıtlar flush'ta 400 alır ve `entryAttempt` 400'ü "kesin
       * hata" saydığı için tekrar denemez (kayıt toast bırakıp kaybolur).
       */
      gradeRequired?: boolean;
      /**
       * TX KAPISI (Sınıf 4 — I1, 2026-08-14): top'u yazan transaction'ın İLK
       * ifadesi olarak çağrılır. Mal Kabul yolu buradan fişi
       * `updateMany WHERE status=ACTIVE` ile kilitler (satır doğumu ile fiş
       * iptali AYNI satır kilidinde serileşir); kapı throw ederse tx geri
       * sarılır — top hiç doğmaz, barkod sayacı da artmaz (kilit barkod
       * üretiminden ÖNCE olduğu için boşluk oluşmaz).
       *
       * F221 deseni: verilmezse TEK ifade bile eklenmez — KK1 ham giriş /
       * Tambur manuel yolları bayt-bayt aynı kalır. Kilit sırası notu: kapı
       * (goods_receipts satır kilidi) mükerrer tuzağının advisory kilidinden
       * (8021) ÖNCE koşar; iki kilidi birden alan başka yazar yok (KK1
       * fiş satırına, `cancel` 8021'e hiç dokunmaz) → ABBA imkânsız. Mal Kabul
       * yolu `duplicateGuard` da geçirmediği için bugün ikisi aynı tx'te
       * zaten buluşmuyor.
       */
      txGate?: (tx: Prisma.TransactionClient) => Promise<void>;
    },
  ): Promise<InitialEntryResult> {
    // KK1 istasyonunda ağırlık (kg) girişi admin ayarıyla kapatılabilir (default kapalı).
    // UI alanı gizlemek yetmez — kapalıyken gelen ağırlık payload'ını (yanlışlıkla ya da
    // kötü niyetle) backend REDDEDER. Tüm istemcilerin (mobil + Electron + script) tek
    // choke-point'i burası (defense-in-depth). Zod weightKg'yi pozitif zorunlu kıldığından
    // >0 kontrolü, undefined/eksik girişleri serbest bırakır.
    if ((data.weightKg ?? 0) > 0 && !opts?.skipKk1WeightPolicy && !(await readKk1WeightEntryEnabled())) {
      throw AppError.badRequest("Ağırlık (kg) girişi bu istasyonda kapalı");
    }

    // Kart kullanılabilir mi (yaşam döngüsü, §4) — ön kontrol; nihai karar tx içinde
    // kilit altında tekrarlanır (aşağıda `assertItemUsableTx`).
    const itemUsage: ItemUsage =
      opts?.itemUsage ?? (opts?.doffEventId || opts?.purchaseOrderLineId ? "DOC_COMPLETION" : "NEW_STOCK");
    const item = await assertItemUsable(prisma, data.itemId, itemUsage);
    // `Roll` yalnız KUMAŞ doğurur. Kapı FAIL-CLOSED: "CONSUMABLE değilse geç"
    // değil, "FABRIC ise geç" — enuma dördüncü tür eklendiği gün sessizce
    // barkodlu top doğurmasın. İplik kg defterine gider (`YarnMovement`).
    if (item.itemType !== ItemType.FABRIC) {
      throw AppError.badRequest(
        item.itemType === ItemType.YARN
          ? "İplik kalemi top olarak eklenemez — iplik girişi kg defterine yapılır."
          : "Bu kalem türü top olarak eklenemez; yalnız kumaş kalemi top doğurur.",
      );
    }

    // Renk verilmişse: var ve aktif olmalı + Item'ın allowed listesindeyse listede
    if (data.colorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { id: true, isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.notFound("Renk bulunamadı veya pasif");
      }
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: data.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: data.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
      }
    }

    // Özellikler: dedupe, var ve aktif olmalı + Item'ın allowed listesindeyse listede
    const dedupedProps = [...new Set(data.propertyIds ?? [])];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      // SEÇİM tipli özellik KK1 girişinden verilemez (denetim F2): değersiz
      // "GRAMAJ var ama hangisi belli değil" satırı doğardı. İleride KK1'e
      // değerli giriş istenirse sözleşme {propertyId, valueCode} olarak
      // genişletilir (station-capability-transfer.helper hazır).
      await assertTargetablePropertyIds(dedupedProps, "KK1 giriş özelliği");
      const allowedPropCount = await prisma.itemAllowedProperty.count({
        where: { itemId: data.itemId },
      });
      if (allowedPropCount > 0) {
        const inAllowed = await prisma.itemAllowedProperty.findMany({
          where: { itemId: data.itemId, propertyId: { in: dedupedProps } },
          select: { propertyId: true },
        });
        if (inAllowed.length !== dedupedProps.length) {
          throw AppError.badRequest(
            "Seçilen özelliklerden biri bu ürüne uygulanabilir listesinde değil",
          );
        }
      }
    }

    // Giriş yeri: çağıran AÇIKÇA söylediyse o (Tambur "Manuel Ekle" yolu),
    // söylemediyse cihaz sezgisi — mobil KK1 istasyonundan (eşleşmiş cihaz) mı,
    // Electron admin'den elle mi girildi. "Ham Giriş" / "Manuel Giriş" /
    // "Tambur (Manuel)" ayrımı raporlama ve top detayı için kritik.
    const entrySource: RollEntrySource =
      opts?.forcedEntrySource ??
      (isMobileOrigin ? RollEntrySource.SUPPLIER_RECEIPT : RollEntrySource.MANUAL_ENTRY);

    // Operatör explicit kalite verdiyse SIKI doğrula (katalog + aktif —
    // soft-delete giriş guard'ı; typo'lu kod byQuality istatistiklerini
    // parçalayıp FIRE-dışlama string filtresinden kaçıyordu).
    // Kalite VERİLMEDİYSE (boş/whitespace) → qualityGrade + qualityGradeId null
    // kalır (kaliteye bakılmadı); artık sabit "1.KALITE" default'u yazılmaz.
    const trimmedQuality = data.qualityGrade?.trim();
    const qualityGradeCode = trimmedQuality || null;
    const qualityGradeId = trimmedQuality
      ? await resolveQualityGradeIdStrict(trimmedQuality)
      : null;

    // KALİTE ZORUNLU (D6) — F221 opt-in; yalnız HTTP (KK1 / Electron manuel)
    // yolu bu bayrağı taşır. Okuma KOŞULLU: kalite zaten doluysa bayrağa hiç
    // bakılmaz (her ham girişe bir PK araması eklemek istemiyoruz).
    if (!qualityGradeCode && opts?.gradeRequired && (await readQualityGradeRequiredEnabled())) {
      throw AppError.badRequest("Top kalitesi zorunlu — kalite seçmeden giriş yapılamaz", {
        code: "GRADE_REQUIRED",
      });
    }

    // Statü: çağıran AÇIKÇA söylediyse o (bitmiş ürün yolu), söylemediyse KK1
    // sezgisi. Renkli manuel giriş = hazır/işlenmiş kumaş (dışarıdan boyalı/işlemli
    // geldi), doğrudan depoya gider. Renksiz giriş = ham kumaş, üretim akışına
    // girecek (STOCK'ta bekler, KK1/Kurşun/Tambur'da işlenir).
    const initialStatus =
      opts?.forcedStatus ?? (data.colorId != null ? RollStatus.WAREHOUSE : RollStatus.STOCK);
    const initialStage = birthStageForEntry({ explicit: opts?.stage, entrySource, status: initialStatus });

    // Barkod SUNUCU'da sıralı atanır (tx öncesi generateRollBarcodeTx) — offline istemci
    // sırayı bilemez. Tip damgası STATÜDEN türer ("F" = final/depoya inen, "H" = ham):
    // `finalBarcodeType` zaten bu eşlemenin tek kaynağı ve KK1 yolunda eski
    // renk-sezgisiyle BİREBİR aynı sonucu verir (renkli→WAREHOUSE→"F", renksiz→
    // STOCK→"H") — yani bu satır KK1 davranışını değiştirmez, ikinci hüristiği
    // kaldırır. Mükerrer-top koruması clientToken (@unique) ile — barkod DEDUP
    // ANCHOR'I DEĞİL (aşağıdaki catch).
    const rollType: RollBarcodeType = finalBarcodeType(initialStatus);

    // ── MÜKERRER TOP TUZAĞI (2026-08-03 saha vakası, 2026-08-05 atomikleştirildi) ──
    // `clientToken` istemcinin DÜRÜST olmasına bağlıdır: token'ı her basışta
    // yenileyen bir istemci (ki tam bu yüzden N kopya doğdu) korumayı boşa
    // düşürür. Bu kontrol istemciye GÜVENMEZ — farklı cihaz, uygulama yeniden
    // kurulumu, hatta doğrudan API çağrısı da yakalanır.
    //
    // ENGELLEME DEĞİL ONAYLATMA: tekstilde arka arkaya birebir aynı top
    // gerçekten gelir (aynı partiden eşit metrajlı toplar). Bu yüzden 409 +
    // açık `confirmDuplicate` ile geçilir; sessizce reddedilmez.
    //
    // ⚠️ BAYRAK OKUMASI TX DIŞINDA — `readKk1DuplicateGuardEnabled()` argümansız
    // çağrıldığında global `prisma`'yı kullanır; tx İÇİNDEN çağrılırsa havuzdan
    // İKİNCİ bir bağlantı ister. 30 eşzamanlı tx aynı anda bunu yaparsa havuz
    // (max 30) kendi kendini kilitler ve tüm uygulama 503'e döner.
    const guardActive =
      opts?.duplicateGuard && !opts.duplicateGuard.confirmed
        ? await readKk1DuplicateGuardEnabled()
        : false;

    // Giriş anı damgası: istemcinin beyanı MAKUL ise pencerenin çapası odur,
    // değilse sunucu saati (fail-open — bozuk tablet saati üretimi durdurmaz).
    const nowForEntry = new Date();
    const { storedEnteredAt, anchorMs } = resolveEntryStamp(data.clientEnteredAt, nowForEntry);

    let roll: Awaited<ReturnType<typeof prisma.roll.create>>;
    // Devere Faz 4: bağlı leventten otomatik tüketim uyarıları (bayrak kapalıyken dizi boş kalır, yanıta girmez).
    const autoConsumeWarnings: string[] = [];
    // S1: KK1 doğuşunun çözümü (tx içinde dolar) — doğan doff'un id/kodu yanıta, uyarıları `warnings`a.
    // Tutucu nesne: tx closure'undaki atama TS akış daraltmasında görünmez (`let` sonrası tip `null`a daralıyordu).
    const kk1: { birth: Kk1BirthResolution | null } = { birth: null };
    // Barkod tx AÇILMADAN ÖNCE ve ayrı bağlantıda rezerve edilir: sayaç satır kilidi
    // tx içinde commit'e kadar tutulup bütün top girişlerini serileştiriyordu. Tx geri
    // sararsa (ikiz 409, ana veri 409, token P2002) numara boşluğu kalır — barkod kimliktir.
    // K4P-KK1: muayene kapısı tx DIŞINDA (ayar okuması); kapalıysa top yine doğar, yanıt uyarı taşır.
    const inspectionDecision: InspectionOnBirthDecision | null = opts?.inspection
      ? userId
        ? resolveInspectionOnBirth(
            { permissions: opts.inspection.permissions },
            { kaliteGuvenceEnabled: await readKaliteGuvenceEnabled() },
            await entryStationCapableForInspection(opts.entryStationId),
          )
        : { write: false, reason: "PERMISSION_DENIED" }
      : null;
    const birthInspection: { saved: (BirthInspectionSummary & { auditData: Record<string, unknown> }) | null } = { saved: null };
    const barcode = await generateRollBarcodeTx(prisma, rollType);
    // S1: indirme kodu da tx AÇILMADAN ÖNCE havuzdan (`test_perf_sayac_tx_disi §2`); doff doğmazsa
    // (çok tezgahlı iş, 4xx) numara boşta kalır — boşluk serbest (dokuma.md, barkod emsali).
    const doffCode = opts?.kk1Birth ? await reserveDoffCode(await readDbNow(prisma)) : null;
    // Token P2002'si boğaza düşer (`run` yeniden okur).
    {
      roll = await prisma.$transaction(async (tx) => {
        // TX KAPISI (Sınıf 4 — I1): İLK ifade. Mal Kabul satırı burada fişi
        // claim'ler; `cancel` ile yarış bu satır kilidinde serileşir. Kapı
        // verilmemişse (fabrika yolları) tek ifade bile eklenmez.
        if (opts?.txGate) await opts.txGate(tx);
        if (guardActive) {
          // ⚠️ SIRA LOAD-BEARING — kilit `findFirst`'ten ÖNCE (barkod sayacı tx dışında, kilitsiz).
          //
          //  · Kilit SONRA alınırsa guard hiçbir şey kazanmaz: READ COMMITTED'da her
          //    ifade taze snapshot alır, yani kilidi bekleyen tx uyandığında öndekinin
          //    commit'ini GÖRÜR — ama sorguyu çoktan koşmuş olurdu (bugünkü hatanın
          //    aynısı, sadece tx içinde). Eski kod `prisma.roll.findFirst`'ü tx DIŞINDA
          //    koşturuyordu: 2026-08-04'te 5 eşzamanlı giriş 46 ms içinde hiçbirinin
          //    commit'ini görmeden geçti (klasik TOCTOU).
          //  · Barkod sayacı tx DIŞINDA kendi ifadesiyle commit eder; bu tx sayaç
          //    satırını hiç tutmaz → advisory ↔ sayaç ABBA'sı doğamaz.
          //
          // `$executeRaw` parametreli → injection yok. `$queryRaw` yolu ise pg driver
          // adapter'ında `void` kolonunu deserialize edemediği için alt-sorgu
          // sarmalaması ister (bkz. permission-management.service) — gereksiz mayın.
          const lockKey = duplicateGuardLockKey({
            entrySource,
            itemId: data.itemId,
            colorId: data.colorId ?? null,
            initialQty: data.initialQty,
            width: data.width ?? null,
            userId: userId ?? null,
            machineId: machineId ?? null,
          });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DUPLICATE_GUARD_LOCK_NS}::int, hashtext(${lockKey}))`;

          const since = new Date(anchorMs - DUPLICATE_ENTRY_WINDOW_MS);
          const until = new Date(anchorMs + DUPLICATE_ENTRY_WINDOW_MS);
          const twin = await tx.roll.findFirst({
            where: {
              entrySource,
              // Yalnız INDEX ÇIPASI — doğruluk aşağıdaki OR'da. Sağlamlık ispatı
              // `duplicateGuardCreatedAtFloor` başlığında.
              createdAt: { gte: duplicateGuardCreatedAtFloor(anchorMs, nowForEntry.getTime()) },
              // Pencere İKİ YÖNLÜ: "iki girişin damgaları birbirinden 90 sn içinde"
              // simetrik ve sıra bağımsız bir tanımdır (offline kuyruk sırayı bozabilir).
              // Tek yönlü `gte` ile saati ileri kaymış bir cihazın satırları sonsuza
              // kadar "ikiz" görünürdü.
              OR: [
                { clientEnteredAt: { gte: since, lte: until } },
                // İkizin damgası yoksa (eski istemci / bu karardan önceki top)
                // sunucu saatine düşülür — tek kural, iki taşıyıcı.
                { clientEnteredAt: null, createdAt: { gte: since, lte: until } },
              ],
              itemId: data.itemId,
              colorId: data.colorId ?? null,
              initialQty: new Prisma.Decimal(data.initialQty),
              width: data.width ?? null,
              // Aynı ELDEN çıkmış olmalı — iki operatörün aynı anda benzer top
              // girmesi meşrudur ve uyarılmamalıdır.
              createdById: userId ?? null,
              createdMachineId: machineId ?? null,
              // İptal/fire edilmiş top yeniden girilebilir — o bir kopya değil,
              // düzeltmedir.
              status: { notIn: [RollStatus.CANCELLED, RollStatus.SCRAP] },
              // Aynı token zaten idempotent yoldan (P2002) dönecek; onu kopya sayma.
              ...(data.clientToken ? { clientToken: { not: data.clientToken } } : {}),
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, barcode: true, createdAt: true, clientEnteredAt: true },
          });
          if (twin) {
            // tx İÇİNDE throw: Prisma callback'i rollback eder ve hatayı DEĞİŞTİRMEDEN
            // yeniden fırlatır (emsal: session-registry.service). Rollback yan etkisiz —
            // tek iz, tx öncesi rezerve edilen barkodun bıraktığı numara boşluğudur.
            throw AppError.conflict(
              `Bu top az önce girilmiş olabilir (barkod ${twin.barcode}). Gerçekten ayrı bir topsa onaylayın.`,
              {
                code: "POSSIBLE_DUPLICATE",
                barcode: twin.barcode,
                existing: {
                  id: twin.id,
                  barcode: twin.barcode,
                  createdAt: twin.createdAt,
                  // İstemci "3 dakika önce girilmişti" diyebilsin diye — mevcut
                  // alanlar KALDIRILMADI (mobil + Electron onları okuyor).
                  clientEnteredAt: twin.clientEnteredAt,
                },
                windowSeconds: DUPLICATE_ENTRY_WINDOW_MS / 1000,
              },
            );
          }
        }

        // ⚠️ ANA VERİ TAZE DOĞRULAMA — KİLİT ALTINDA (BULGU-T3-007). Yukarıdaki
        // ürün/renk kontrolleri tx DIŞINDA koştu; o pencerede panelden bir
        // birleştirme commit etmiş olabilir ve bu kayıt MEZAR TAŞI bir kumaşa
        // yazılırdı: top canlı ve barkodlu olur ama ürün filtresinde, Ürün
        // Dengesi'nde ve sipariş karşılamada HİÇ GÖRÜNMEZ (hepsi
        // `mergedIntoId IS NULL` süzer). Birleştirmenin taşıma turu da o satırı
        // göremezdi — henüz yoktu.
        // ⚠️ YENİ KISIT DEĞİL: pasif ürün zaten reddediliyordu; burada aynı kural
        // yarış penceresini de kapatacak şekilde TEKRARLANIYOR.
        // ⚠️ SIRA LOAD-BEARING: önce PAYLAŞIMLI kilit, sonra taze okuma. Kilit
        // olmadan taze okuma da yetmez — ölçüldü: repro §2, 12 turun 3'ünde
        // hâlâ mezar taşına yazıyordu (birleştirme henüz commit etmemişti).
        await assertItemUsableTx(tx, data.itemId, itemUsage);
        await assertMasterDataLiveTx(tx, { colorId: data.colorId ?? null });

        // S1 KK1 DOĞUŞU — 8021'den SONRA, bağdan ÖNCE: tezgah/iş çözülür, indirme bu tx'te doğar
        // (`createDoffTx`, damga DB saati); çok tezgahlı işte doff yok, iş bağı kolona (D11).
        if (opts?.kk1Birth) kk1.birth = await resolveKk1BirthTx(tx, opts.kk1Birth, { userId: userId ?? null, itemId: data.itemId, doffCode });
        const birth = kk1.birth;
        const linkedDoffEventId = birth?.doffEventId ?? opts?.doffEventId ?? null;
        // DOFF BAĞI — satır kilidi (FOR UPDATE) ile; düz okuma eşzamanlı DOFF_CANCEL'e
        // pencere açar. Sıra: advisory kilit (yukarıda) → doff satırı; barkod sayacı
        // tx dışında. İptal yolu yalnız doff satırını tutar, ABBA yok.
        await claimDoffForRollTx(tx, { doffEventId: linkedDoffEventId, entrySource, createdMachineId: machineId ?? null });

        // DEPO: çağıran açıkça verdiyse o (var+aktif doğrulanır), yoksa sahipli doğumda emanet deposu (F1b ayarı;
        // boş/emanet kapalı = bugünkü), o da yoksa varsayılan. Fabrika yolları parametre vermez → davranış aynı.
        const targetWarehouseId = await resolveBirthWarehouseIdTx(tx, opts?.warehouseId ?? null, opts?.ownerCustomerId ?? null);
        // G3 emanet: sahip verildiyse modül açık olmalı (403) — gövde kapısı tek yazıcıda, çağıran bazlı değil.
        await assertEmanetWritableTx(tx, opts?.ownerCustomerId ?? null, "top");
        // Onay sürerken konan kilit kalan satırları burada keser (precheck tx dışıdır).
        if (opts?.cariHoldIntakeGate && opts.ownerCustomerId) await assertCariNotHeldTx(tx, opts.ownerCustomerId, "INTAKE");
        const created = await sequentialTx(tx).roll.create({
          data: {
            barcode,
            warehouseId: targetWarehouseId,
            purchasePrice: opts?.purchasePrice ?? null,
            goodsReceiptId: opts?.goodsReceiptId ?? null,
            // Sipariş kalemi izi (J2) — verilmezse NULL (fabrika yolları hiç vermez).
            purchaseOrderLineId: opts?.purchaseOrderLineId ?? null,
            clientToken: data.clientToken ?? null,
            itemId: data.itemId,
            colorId: data.colorId ?? null,
            initialQty: data.initialQty,
            currentQty: data.initialQty,
            weightKg: data.weightKg ?? null,
            status: initialStatus,
            stage: initialStage,
            qualityGrade: qualityGradeCode,
            qualityGradeId,
            width: data.width ?? null,
            entrySource,
            createdById: userId ?? null,
            createdMachineId: machineId ?? null,
            doffEventId: linkedDoffEventId,
            // S1 A-yolu: YALNIZ doff'suz (çok tezgahlı iş) — doff varsa iş koşumdan okunur (CHECK XOR, D11).
            weavingOrderId: birth && !birth.doffEventId ? birth.weavingOrderId : null,
            parentReceiptId: opts?.parentReceiptId ?? null,
            ownerCustomerId: opts?.ownerCustomerId ?? null,
            // GİRİŞ İSTASYONU — çağıranın AÇIKÇA verdiği değer, burada
            // TÜRETİLMEZ (`machineId` elde olsa bile; bkz. opts dokümanı).
            entryStationId: opts?.entryStationId ?? null,
            // Koşulsuz yazılır — `null` da doğru cevaptır ("beyan yok / güvenilmez").
            // Kolon doluysa "bu damgaya güvenildi" demektir; kelepçeyi geçemeyen
            // beyan saklanmaz (bkz. resolveEntryStamp).
            clientEnteredAt: storedEnteredAt,
            // `form` YAZILMAZ → şema varsayılanı TOP. KK1 girişi de, bitmiş-ürün
            // girişi de fiziksel olarak bir TOP'tur (açık kumaş yalnız istasyon
            // çıktısı olarak doğar — `roll-finalize.helper` ACIK yazan tek yer).
            ...(opts?.entryReason ? { entryReason: opts.entryReason.slice(0, 500) } : {}),
            ...(opts?.entryReasonCode ? { entryReasonCode: opts.entryReasonCode.slice(0, 64) } : {}),
            ...(opts?.foldType ? { foldType: opts.foldType } : {}),
            ...(opts?.markedForKartela && initialStatus === RollStatus.WAREHOUSE
              ? { markedForKartela: true }
              : {}),
            ...(opts?.labelIntentSnapshot !== undefined
              ? { lastLabelSnapshot: opts.labelIntentSnapshot }
              : {}),
          },
          include: {
            item: true,
            color: true,
            createdBy: { select: { id: true, username: true, fullName: true } },
          },
        });
        if (dedupedProps.length > 0) {
          await tx.rollProperty.createMany({
            data: dedupedProps.map((propertyId) => ({ rollId: created.id, propertyId })),
          });
        }
        // DEPO DEFTERİ — mal DIŞARIDAN geldi (KK1 ham giriş / elle ekleme / Tambur
        // manuel / Mal Kabul). Kesim çocuğu bu yoldan geçmez ve satır yazmaz:
        // kesim bir dönüşümdür, hareket değil (bkz. warehouse-ledger.helper).
        // ⚠️ YALNIZ STOK KÜMESİNE doğan top için: `forcedStatus` ile üretime
        // (`IN_PRODUCTION`) ya da fasona (`AT_SUBCONTRACTOR`) doğan top RAFTA
        // DEĞİLDİR — ona giriş satırı yazmak depoya girmemiş malı depoda
        // göstermek olur. Ölçüldü (fabrika kopyası): bu sınıftan 129 top var
        // (46 + 83). Bu, "koşulsuz yaz" kalıbının ÜÇÜNCÜ kopyasıydı; ilk ikisi
        // fason dönüşü (`cb1d0304`) ve topun iptali (`3c15208c`).
        //
        // ⚠️ 0 metrajlı top DOĞMAZ (giriş metrajı uçta doğrulanıyor) ve buradaki
        // 0 bir veri hatasıdır: `postStockMove` FIRLATIR — eski çağrının
        // `onUnwritable: "throw"` davranışı birebir korunuyor.
        if (targetWarehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(initialStatus)) {
          await postStockMove(tx, {
            rollId: created.id,
            eventType: WarehouseEventType.ENTRY,
            qty: data.initialQty,
            to: { warehouseId: targetWarehouseId, status: initialStatus },
            reasonCode: STOCK_MOVE_REASON.ENTRY_RECEIPT,
            goodsReceiptId: opts?.goodsReceiptId ?? null,
            userId: userId ?? null,
          });
        }
        // LEVENT TÜKETİMİ (Faz 4) — yalnız tezgahtan inen top (doff bağı); aynı tx, top doğuşundan SONRA.
        if (opts?.doffEventId) {
          autoConsumeWarnings.push(...(await autoConsumeForRollTx(tx, { rollId: created.id, doffEventId: opts.doffEventId, fabricLengthM: data.initialQty, userId: userId ?? null })));
        } else if (birth?.doffEventId) {
          // S1: sunucunun doğurduğu doff — aynı zincir; beyan edilen levent override (D10, pencere kapısı helper'da).
          autoConsumeWarnings.push(...(await autoConsumeForRollTx(tx, { rollId: created.id, doffEventId: birth.doffEventId, fabricLengthM: data.initialQty, userId: userId ?? null, beamOverrideId: opts?.kk1Birth?.warpBeamId ?? null })));
        }
        // K4P-KK1: muayene topla AYNI tx'te — yapısal hata (bilinmeyen tür, tekrar, yeteneksiz istasyon) topu da geri alır.
        if (opts?.inspection && inspectionDecision?.write && userId) {
          const insp = await createInspectionTx(tx, {
            roll: created,
            phase: "RAW",
            defects: opts.inspection.defects,
            inspectedLengthM: opts.inspection.inspectedLengthM ?? created.initialQty,
            note: opts.inspection.note ?? null,
            stationId: opts.entryStationId ?? null,
            deviceId: opts.inspection.deviceId ?? null,
            userId,
          });
          birthInspection.saved = {
            id: insp.id,
            pointsPer100M2: insp.pointsPer100M2,
            suggestedGradeCode: insp.suggestedGradeCode,
            auditData: {
              rollId: insp.rollId, phase: insp.phase, revision: insp.revision, defectCount: insp.defectCount, totalPoints: insp.totalPoints,
              pointsPer100M2: insp.pointsPer100M2?.toFixed(2) ?? null, suggestedGradeCode: insp.suggestedGradeCode, gradeMismatch: insp.gradeMismatch, origin: "KK1_BIRTH",
            },
          };
        }
        return created;
      });
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        barcode: roll.barcode,
        itemId: roll.itemId,
        colorId: roll.colorId,
        initialQty: roll.initialQty,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg,
        status: roll.status,
        entrySource: roll.entrySource,
        propertyIds: dedupedProps,
        // İstemcinin HAM beyanı — kelepçeyi geçemediyse kolon NULL kalır ama
        // beyan burada durur. Saha teşhisi bunu ister: "bu tabletin saati 2 gün
        // ileri" sorusu ancak reddedilen değeri görerek cevaplanır.
        declaredEnteredAt: data.clientEnteredAt ?? null,
        clientEnteredAt: roll.clientEnteredAt,
      },
    });

    const saved = birthInspection.saved;
    if (saved) {
      await AuditService.log({ userId, action: "CREATE", tableName: INSPECTION_AUDIT_TABLE, recordId: saved.id, newData: saved.auditData });
    }

    // S1: doğuş uyarıları (çok tezgah · kumaş uyuşmazlığı · işsiz koşum) önce, levent uyarıları sonra; alansız gövdede ikisi de boş → anahtar yok.
    const birth = kk1.birth;
    // K4P-KK1: `warnings` tel sözleşmesi `string[]` (istemciler metni toast basar); yapılı kod ayrı alanda.
    const notSaved = inspectionDecision && !inspectionDecision.write ? inspectionNotSaved(inspectionDecision.reason) : null;
    const warnings = [...(birth?.warnings ?? []), ...autoConsumeWarnings, ...(notSaved ? [notSaved.message] : [])];
    const withDoff = birth?.doffEventId && birth.doffCode ? { ...roll, doffEvent: { id: birth.doffEventId, code: birth.doffCode } } : roll;
    return {
      success: true,
      // Sunucunun doğurduğu indirme yalnız bu yanıtta (tablet rozet basar); eski yolda `data` bayt bayt aynı.
      data: opts?.inspection
        ? { ...withDoff, inspection: saved ? { id: saved.id, pointsPer100M2: saved.pointsPer100M2, suggestedGradeCode: saved.suggestedGradeCode } : null }
        : withDoff,
      message: `Top oluşturuldu. Barkod: ${roll.barcode}`,
      ...(warnings.length ? { warnings } : {}),
      ...(notSaved ? { inspectionNotSaved: notSaved } : {}),
    };
  }
