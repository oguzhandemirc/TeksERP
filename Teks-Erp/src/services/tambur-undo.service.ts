// =============================================================================
// TeksERP - Tambur GERİ AL (undo) Servisi
// =============================================================================
// Tambur işlemlerini operatör-seviyesinde geri alır (2026-07-31), 2026-08-09'da
// SAHA VAKASI sonrası yeniden yazıldı.
//
//   SINGLE — TEK yanlış parçayı iptal. İki alt durumu var ve ayrımı LOAD-BEARING:
//            • kaynak top YAŞIYOR  → metraj kaynağa geri döner (klasik akış)
//            • kaynak top ARŞİVDE  → metraj geri DÖNEMEZ (kaynak tüketilmiş, 0 m).
//              Bunun yerine SAPMA olarak kayda geçer (`RECORD_CORRECTION`) —
//              fiziksel gerçek zaten budur: o top yanlış kaydedilmişti, kumaş ya
//              hiç yoktu ya başka bir topun içinde. Kaynak arşivde, iş emri
//              KAPALI kalır. **2026-08-09'a kadar bu yol HİÇ YOKTU** ve asıl
//              eksik oydu (aşağıya bak).
//   FULL   — kapanışı TÜMDEN ters çevir: TÜM çocuklar CANCELLED, kaynak top geri
//            dirilir, hareket yeniden açılır, kapanan RollError'lar açılır,
//            COMPLETED WO + refakat kartı diriltilir.
//   MANUAL — elle eklenen topun kaydını yok say (2026-08-04).
//
// ── 2026-08-09 SAHA VAKASI (IE0808260001) — dört kök neden ───────────────────
// 15 top kesildi (545 m; kayıtlı 500 m'yi aşıyor — `overQuantityEnabled` AÇIK),
// biri SINGLE ile doğru şekilde geri alındı, iş bitti, WO COMPLETED oldu.
// 26 dakika sonra bir kullanıcı BİR topa "Geri Al" dedi → **14 top birden iptal
// oldu, 520,5 m kaynağa geri yazıldı, iş emri diriltildi.** Kaynak top o günden
// beri `initialQty=500` iken `currentQty=520,5` taşıyor (DB'deki TEK böyle satır).
//
//   1) MOD OPERATÖRÜN NİYETİNDEN DEĞİL SİSTEM DURUMUNDAN türetiliyordu:
//      kaynak yaşıyorsa SINGLE, tüketilmişse FULL. Operatör iki durumda da AYNI
//      butona basıp AYNI şeyi istiyor ("şu topu iptal et") ama finalize'dan
//      sonra 14 topu iptal eden bir diyalog alıyordu. **Asıl kusur budur.**
//      → Artık mod SORULUYOR: `options[]` iki seçeneği de döner, `defaultMode`
//        her zaman en dar olandır (SINGLE varsa SINGLE).
//   2) METRAJ ÇOCUKLARIN TOPLAMINDAN TÜRETİLİYORDU (`currentQty: restored`).
//      Aşımlı kesimde toplam, kayıtlı metrajı geçebildiği için `currentQty >
//      initialQty` gibi imkânsız bir satır doğdu.
//      → Artık toplam `computeRestoredQty` ile hesaplanır (çocuklar + kayıt
//        düzeltmesi sapması) ve aşım varsa `initialQty` YUKARI çekilip fark
//        deftere AŞIM olarak yazılır. Aynı fonksiyonu ÖNİZLEME de çağırır.
//        ⚠️ `preTamburCloseQty` bu hesapta KULLANILMAZ — o kolon "kapanış
//        anındaki currentQty"dir, yani parçalı kesimde KALAN'dır; toplam
//        sanılırsa diyalog 200 m derken kod 500 m yazar (2026-08-09 incelemesi).
//        Kolonun işi statü tarafı (`preTamburCloseStatus`) ve adli izdir.
//   3) DEPO KESİMİ ÇIKMAZI: `finalizeWarehouseCut` kalıcı iz yazmadığı için FULL
//      bloklanıyor, kaynak `TAMBUR_CONSUMED` olduğu için SINGLE de imkânsızdı →
//      **ne tekil ne toplu** geri alma (ölçüm: 9 tüketilmiş kaynağın 6'sı).
//      → `preTamburCloseQty`/`preTamburCloseStatus` bu yolu da açtı.
//   4) SAPMA DEFTERİ TERSLENMİYORDU: geri alınan bir finalize'ın fire/kayıt
//      düzeltmesi satırları defterde KALIYOR olurdu (hayalet fire).
//      → `RollVariance.reversedAt` ile işaretlenir (silinmez — append-only).
//
// ── SEKTÖR STANDARDI: storno bir OLAYDIR, geri sarma değil ───────────────────
// SAP PP'de onay (Rückmeldung) bir BELGEDİR; iptali (CO13) o belgeyi ters çeviren
// YENİ bir belgedir. Kısmi tersleme YOKTUR (bir belge ya tümden ters çevrilir ya
// hiç) — koddaki "ya hepsi ya hiçbiri" kuralı bu yüzden DOĞRU, bozma.
//
// ⚠️ İŞ EMRİNİN YENİDEN AÇILMASI KUSUR DEĞİLDİR: meşru bir terslemede o adımda
// gerçekten iş kalmıştır ve WO durumu kalan gerçeklerden türetilir. Kusur,
// operatörün onu İSTEMEMİŞ olmasıydı (madde 1).
//
// ⚠️ `TAMBUR_PROCESSED` izi FULL'de SİLİNMEZ, geri alınır (`revokedAt` damgası):
// üretim raporu ve adım okumaları `ACTIVE_OPERATION` ile süzdüğü için geri alınmış
// iş sayılmaz. Terslemenin kalıcı izi: (a) bu damga, (b) sapma satırlarının
// `reversedAt` işareti, (c) audit `TAMBUR_UNDO_FULL`.
//
// Kapsam SINIRLARI (bilinçli):
//   • Kısmi FULL yok (bazı çocuklar kalsın) — metraj muhasebesini bozar.
//   • FULL `roll:manual-adjust` ISTER ve SEBEP zorunludur: iş emrinin geçmişini
//     yeniden yazan bir işlem, günlük operatör yetkisi olmamalı.
//
// Yıkıcı-işlem kuralı: apply'dan önce preview zorunlu akış — preview etkilenen
// HER kaydı somut listeler; apply tx-içi TAZE guard'larla (atomik claim) korunur.
// =============================================================================

import { ACTIVE_OPERATION, revokeRollOperations } from "./helpers/roll-operation.helper";
import {
  revokePlanDeviationsTx,
  findPlanDeviationConfirmationsTx,
} from "./helpers/tambur-plan-gate.helper";
import { ACTIVE_MOVEMENT } from "./helpers/roll-movement.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { reverseAllRollStockMoves, reverseStockMove, reverseTransformGroupsOf } from "./helpers/warehouse-ledger-reverse.helper";
import { ACTIVE_ROLL_PROPERTY } from "./helpers/property-revoke.helper";
import { postStockMove } from "./helpers/warehouse-ledger.helper";
import { warehouseStampManyTx } from "./helpers/warehouse.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import { matchesPermission } from "../middlewares/rbac.middleware";
import {
  TAMBUR_UNDO_CANCEL_CODE,
  TAMBUR_UNDO_CANCEL_TEXT,
} from "../constants/reason-presets";
import {
  Prisma,
  RollStatus,
  RollOperationType,
  RollEntrySource,
  RollVarianceKind,
  WarehouseEventType,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { recordVarianceTx } from "./helpers/roll-variance.helper";
import { VARIANCE_SOURCES, type VarianceSource } from "../constants/variance-reasons";
import { resolveTamburUndoFullSameDayOnly } from "./system-setting.service";
import { factoryDayStart } from "../constants/time";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { recomputeStepStatus } from "./helpers/roll-step.helper";
import { setWorkOrderCardStatusesTx } from "./helpers/traveler-card-fanout.helper";
import { InventoryService } from "./inventory.service";

/**
 * Elle eklenen topu geri alırken İKİNCİ BİR İPTAL MOTORU YAZILMAZ.
 *
 * Doğru semantik zaten softDelete'te yaşıyor: CANCELLED + açık hareket
 * qtyOut=0 ile kapanır ("mal bu istasyondan hiç geçmedi" = storno). İkinci bir
 * yol açmak "üçüncü kaynak üçüncü rakam" hatasının ta kendisi olurdu —
 * guard'lar, audit ve adım recompute'u zamanla ayrışırdı.
 */
const inventoryService = new InventoryService();

/** MANUAL modda geri alınabilir statüler — top henüz hiçbir yere bağlanmamış. */
const MANUAL_UNDOABLE_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION, // "Düzelt → Manuel Top Ekle" (adıma bağlı)
  RollStatus.WAREHOUSE,     // "Manuel Mod" (kartsız bitmiş ürün)
  RollStatus.A1_STOCK,
  RollStatus.STOCK,
];

/** Çocuğun iptal edilebilir olduğu statüler — dokunulmamış Tambur çıktıları. */
const CHILD_CANCELABLE_STATUSES: RollStatus[] = [
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.STOCK,
  RollStatus.SCRAP,
];

/**
 * SINGLE = tek kesim parçası · SINGLE_RESTORE = tek parçayı iptal edip
 * metrajını KAYNAK TOPA GERİ KOY (2026-08-12) · FULL = finalize tümden ·
 * MANUAL = elle eklenen topun kaydını geri alma (2026-08-04).
 *
 * SINGLE_RESTORE neden var: kaynak arşivdeyken iki farklı fiziksel gerçek
 * olabilir ve 2026-08-09'a kadar yalnız BİRİ yazılmıştı — (a) kumaş hiç yoktu
 * (çift giriş) → SINGLE'ın kayıt-düzeltmesi dalı doğru cevap; (b) kumaş elde,
 * kaydı yanlış, yeniden kesilecek → metraj iş emrine DÖNMELİ. (b)'nin tek yolu
 * "Tüm işlemi geri al"dı ve o, partinin DİĞER toplarını da iptal ediyordu
 * (saha sorusu 2026-08-12: "diğer topları canlandırmaya ne gerek var?").
 * SINGLE_RESTORE = FULL'ün dirilme makinesi, TEK topun metrajıyla ve kardeş
 * iptali olmadan. Ek izin/sebep İSTEMEZ — operatörün günlük düzeltmesidir
 * (FULL'ün yetki kapısı "iş emri geçmişini toptan yeniden yazma" içindi).
 *
 * MANUAL neden BU serviste: operatörün elindeki buton zaten burada ("Son Çıkan
 * Toplar" satırındaki Geri Al) ve o buton elle eklenen topta da GÖRÜNÜYORDU —
 * yalnız backend 400 veriyordu ("Bu top bir Tambur kesim/finalize işleminin
 * parçası değil"). Yani operatör "Geri Al" yazan modalda çıkmaza giriyordu.
 * Ayrı bir uç/ekran açmak yerine var olan yüzey doğru cevabı verir hâle
 * getirildi; yeni izin kodu da doğmadı (2026-08-01 kurşun bypass dersi).
 */
type UndoMode = "SINGLE" | "SINGLE_RESTORE" | "FULL" | "MANUAL";

/** Bir modun önizlemesi — istemci bunları YAN YANA gösterip operatöre sordurur. */
export interface UndoOption {
  mode: UndoMode;
  label: string;
  /** Ne olacağının tek cümlelik özeti — diyalogda birebir basılır. */
  description: string;
  canApply: boolean;
  blockReason: string | null;
  /** İptal edilecek top adedi (SINGLE'da 1). */
  affectedCount: number;
  /** SINGLE'da kaynağa dönecek metraj; FULL'de kaynağa geri konacak metraj. */
  restoredQty: number;
  /** Sebep zorunlu mu (FULL) — istemci "Uygula"yı sebep yazılana dek kapalı tutar. */
  requiresReason: boolean;
}

interface UndoContext {
  mode: UndoMode;
  /** Sorulacak seçenekler. Tek eleman varsa istemci sormadan uygulayabilir. */
  options: UndoOption[];
  /** Hiçbir şey seçilmezse uygulanacak mod — HER ZAMAN en dar olan. */
  defaultMode: UndoMode;
  /** Kaynak top arşivde mi (SINGLE'da metrajın geri DÖNMEYECEĞİ durum). */
  parentArchived: boolean;
  canApply: boolean;
  blockReason: string | null;
  parentId: string;
  parent: { id: string; barcode: string | null; status: RollStatus; currentQty: number; initialQty: number };
  restoredQty: number;
  children: Array<{ id: string; barcode: string | null; status: RollStatus; qty: number; blockReason: string | null }>;
  reopenErrorCount: number;
  workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus; willRevive: boolean } | null;
  warnings: string[];
}

interface ChildRow {
  id: string;
  barcode: string | null;
  status: RollStatus;
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  sackId: string | null;
  shipmentId: string | null;
  directShipmentId: string | null;
  currentStepId: string | null;
  producedInStepId: string | null;
  qualityGrade: string | null;
}

/** Çocuğun iptalini engelleyen sebep (null = iptal edilebilir). */
function childBlockReason(c: ChildRow, grandchildCount: number): string | null {
  if (c.status === RollStatus.CANCELLED) return null; // zaten iptal — FULL'de atlanır
  if (c.sackId) return "Çuvala okutulmuş — önce çuvaldan çıkarın";
  if (c.shipmentId || c.directShipmentId) return "Sevkiyata girmiş — geri alınamaz";
  if (c.currentStepId) return "Yeni bir iş emrine bağlanmış — önce oradan çözün";
  if (!CHILD_CANCELABLE_STATUSES.includes(c.status)) {
    return `Bu durumda geri alınamaz (${c.status})`;
  }
  if (grandchildCount > 0) return "Tekrar kesilmiş (kendi parçaları var) — geri alınamaz";
  if (!c.currentQty.equals(c.initialQty)) {
    return "Metrajı değişmiş (kısmen tüketilmiş) — geri alınamaz";
  }
  return null;
}

/** Geri alma isteğinin opsiyonları — mod ARTIK OPERATÖRDEN gelir. */
export interface UndoRequestOptions {
  /** Operatörün seçtiği mod. Verilmezse EN DAR mod uygulanır (bkz. defaultMode). */
  mode?: UndoMode;
  /** FULL için ZORUNLU sebep (iş emrinin geçmişini yeniden yazan işlem). */
  reason?: string | null;
  /**
   * Çağıranın izinleri. F221 deseni: VERİLMEZSE enforcement ATLANIR (dahili
   * çağrı). HTTP yolunda controller her zaman geçirir.
   */
  permissions?: string[];
}

/** FULL modun istediği izin — günlük operatör yetkisi DEĞİL. */
export const UNDO_FULL_PERMISSION = "roll:manual-adjust";

/** FULL sebebinin alt sınırı — `manualReasons.MANUAL_MIN_REASON` ile aynı. */
const UNDO_FULL_MIN_REASON = 3;

/**
 * Çocukların DOĞUM-ANI özellik satırları — geri kurulumda donör kümesi (plan §3.1).
 * Postgres'te `now()` tx başlangıcıdır: kesimde kopyalanan miras satırı çocukla aynı
 * damgayı taşır, depoda sonradan eklenen satır kesinlikle daha büyüktür. Sıra
 * deterministik: en erken doğan çocuk önce, sonra `propertyId` — `donor[0]` rastgele
 * olmasın. Kurulum başına tarih sabiti YOK, kapı veri-güdümlü.
 */
async function birthPropertiesOf(
  tx: Prisma.TransactionClient,
  childIds: string[],
): Promise<{ rollId: string; propertyId: string; valueId: string | null }[]> {
  if (childIds.length === 0) return [];
  const births = await tx.roll.findMany({
    where: { id: { in: childIds } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const out: { rollId: string; propertyId: string; valueId: string | null }[] = [];
  for (const b of births) {
    // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): doğum-anı satırı çocukta SONRADAN sürümlenmiş
    // (damgalı) olsa bile ebeveynin kesim anındaki değeri O satırdır; aktif olanı
    // almak çocuğun sonraki düzeltmesini ebeveyne uydururdu (§3.1'in ikinci yüzü).
    const rows = await tx.rollProperty.findMany({
      where: { rollId: b.id, createdAt: { lte: b.createdAt } },
      select: { rollId: true, propertyId: true, valueId: true },
      orderBy: { propertyId: "asc" },
    });
    out.push(...rows);
  }
  return out;
}

export class TamburUndoService {
  /**
   * Geri alma önizlemesi — HİÇBİR ŞEY YAZMAZ.
   *
   * ⚠️ `mode` artık İSTEĞE BAĞLI bir PARAMETREDİR, sistem durumundan türetilen
   * bir sonuç değil. Yanıt `options[]` ile YAPILABİLECEK her modu ayrı ayrı
   * anlatır; istemci sorar. Bu, 2026-08-08 saha vakasının doğrudan düzeltmesidir
   * (operatör tek top iptali isterken 14 topluk diyalog alıyordu).
   */
  async getUndoPreview(
    rollId: string,
    opts?: UndoRequestOptions,
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.resolveContext(rollId, opts);
    return { success: true, data: ctx };
  }

  /**
   * AŞIM BUMP'I — yalnız KEŞİFLE KARŞILANMAYAN kısım (hüküm ② a, 2026-09-13).
   *
   * Geri konan metraj kayıtlı girişi aşarsa `initialQty` fark kadar yukarı çekilir
   * (CHECK `currentQty ≤ initialQty`). Ama o fark çoğu kez YENİ bir olgu değildir:
   * kesim anında ebeveyne `TAMBUR_OVERCUT` keşfi zaten yazıldı ve `sourceRollId` o
   * çocuğu adlıyor. Aynı 20 m için ikinci bir canlı OVERAGE yazmak Σ'yı ikiye
   * katlıyordu (1c ölçtü: n=2 Σ=40, gerçek 20). Sapma satırı yalnız
   * `bump − Σ(bu çocukların keşfi)` > 0 ise yazılır; `sourceRollId`siz eski keşif
   * (klasik finalize, göç öncesi veri) kimseye sayılmaz — açık fazla sayım, sessiz
   * yanlış atıf yerine.
   */
  private async restoreBumpTx(
    tx: Prisma.TransactionClient,
    args: {
      parentId: string; childIds: string[]; newCurrent: Prisma.Decimal; parentInitial: Prisma.Decimal;
      workOrderStepId: string | null; userId: string | undefined;
      /** Karşılanmayan kısmın kaynağı — tekil dallarda RESTORE, FULL'de FULL. */
      source?: VarianceSource;
    },
  ): Promise<Prisma.Decimal> {
    const initialBump = args.newCurrent.greaterThan(args.parentInitial)
      ? args.newCurrent.minus(args.parentInitial)
      : new Prisma.Decimal(0);
    if (!initialBump.greaterThan(0)) return initialBump;
    // KARŞILAYAN KEŞİF KÜMESİ = bu ailenin Tambur geri almasıyla iptal edilmiş
    // çocukları ∪ şimdi iptal edilenler. Sıra bağımsızlığı bundan: aşım 3. kesimde
    // keşfedilir ama bump hangi parçanın geri alınışında girişi aştıysa orada doğar
    // (3→2→1 sırasında 1.'de). Σ bump = Σ keşif olduğu için (her aşım kesimi kendi
    // keşfini yazar) aynı keşif iki bump'ı karşılayamaz — cebir kapatıyor, sayaç gerekmez.
    const undoneSiblings = await tx.roll.findMany({
      where: { parentRollId: args.parentId, cancelReasonCode: TAMBUR_UNDO_CANCEL_CODE },
      select: { id: true },
    });
    const coveringChildIds = [...new Set([...args.childIds, ...undoneSiblings.map((r) => r.id)])];
    const covered = await tx.rollVariance.aggregate({
      where: {
        rollId: args.parentId,
        kind: RollVarianceKind.OVERAGE,
        source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
        reversedAt: null,
        sourceRollId: { in: coveringChildIds },
      },
      _sum: { qty: true },
    });
    const uncovered = initialBump.minus(covered._sum.qty ?? new Prisma.Decimal(0));
    if (uncovered.greaterThan(0)) {
      await recordVarianceTx(tx, {
        rollId: args.parentId,
        workOrderStepId: args.workOrderStepId,
        kind: RollVarianceKind.OVERAGE,
        qty: uncovered,
        source: args.source ?? VARIANCE_SOURCES.TAMBUR_UNDO_RESTORE,
        userId: args.userId,
      });
    }
    return initialBump;
  }

  /**
   * Çocukların terslenmemiş AŞIM stok satırları (`OVERAGE`, kesim anı keşfinin
   * depo etkisi) — geri alma çocuğun bütün satırlarını terslemeden ÖNCE okunur.
   */
  private async readChildOverageRowsTx(
    tx: Prisma.TransactionClient,
    childIds: string[],
  ): Promise<Array<{ qty: Prisma.Decimal; rollVarianceId: string | null }>> {
    if (childIds.length === 0) return [];
    return tx.warehouseMovement.findMany({
      where: { rollId: { in: childIds }, reasonCode: STOCK_MOVE_REASON.OVERAGE, reversesMovementId: null, reversedBy: { none: {} } },
      select: { qty: true, rollVarianceId: true },
    });
  }

  /**
   * KEŞİF TERMİNAL — depo etkisi EBEVEYNE TAŞINIR (hüküm ② a): çocuğun aşım satırı
   * terslendi (kumaş o çocukta değil) ama kumaş yok olmadı, ebeveyne döndü. Ebeveyn
   * stok kümesindeyse aynı `rollVarianceId` ile ADJUST +aşım yazılır; üretimdeyse
   * yazılmaz (üretim dalının stok defteri yok — sapma-yalnız).
   */
  private async transferOverageRowsToParentTx(
    tx: Prisma.TransactionClient,
    parentId: string,
    rows: Array<{ qty: Prisma.Decimal; rollVarianceId: string | null }>,
    userId: string | undefined,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const parent = await tx.roll.findUnique({ where: { id: parentId }, select: { warehouseId: true, status: true } });
    if (!parent || parent.warehouseId === null || !WAREHOUSE_STOCK_STATUSES.includes(parent.status)) return 0;
    for (const r of rows) {
      await postStockMove(tx, {
        rollId: parentId,
        eventType: WarehouseEventType.ADJUST,
        qty: r.qty,
        to: { warehouseId: parent.warehouseId, status: parent.status },
        reasonCode: STOCK_MOVE_REASON.OVERAGE,
        rollVarianceId: r.rollVarianceId,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });
    }
    return rows.length;
  }

  /**
   * Damgalanan kapanış sapmalarına `rollVarianceId` ile BAĞLI, henüz
   * terslenmemiş stok satırlarını (`CUT_DISCARD` · `SCRAP` çıkışı) bugüne
   * tersler. Bağ karar verir, sebep kodu değil — yarın aynı bağla yazılan her
   * satır kendiliğinden kurala girer.
   */
  private async reverseVarianceBoundStockMovesTx(
    tx: Prisma.TransactionClient,
    varianceIds: string[],
    userId: string | undefined,
  ): Promise<number> {
    if (varianceIds.length === 0) return 0;
    const boundRows = await tx.warehouseMovement.findMany({
      where: { rollVarianceId: { in: varianceIds }, reversesMovementId: null, reversedBy: { none: {} } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const m of boundRows) {
      await reverseStockMove(tx, m.id, {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });
    }
    return boundRows.length;
  }

  /**
   * Arşiv-SINGLE ile ölmüş çocukların TRANSFORM gruplarında kalan (ebeveyn OUT)
   * satırlarını tersler. `reverseTransformGroupsOf` grubu topun TERSLENMEMİŞ
   * satırından bulur; ölü çocuğun IN'i o gün terslendiği için grup oradan
   * bulunamaz — grup kimliği çocuğun ileri satırından (terslenmiş de olsa) okunur,
   * gruptaki henüz terslenmemiş üyeler (OVERAGE hariç) bugüne terslenir.
   */
  private async reverseDeadChildGroupsTx(
    tx: Prisma.TransactionClient,
    deadChildIds: string[],
    userId: string | undefined,
  ): Promise<number> {
    if (deadChildIds.length === 0) return 0;
    const members = await tx.warehouseMovement.findMany({
      where: { rollId: { in: deadChildIds }, transformGroupId: { not: null }, reversesMovementId: null },
      select: { transformGroupId: true },
      distinct: ["transformGroupId"],
    });
    const groupIds = members.map((u) => u.transformGroupId).filter((g): g is string => g !== null);
    if (groupIds.length === 0) return 0;
    const openMembers = await tx.warehouseMovement.findMany({
      where: {
        transformGroupId: { in: groupIds },
        reasonCode: { not: STOCK_MOVE_REASON.OVERAGE },
        reversesMovementId: null,
        reversedBy: { none: {} },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const m of openMembers) {
      await reverseStockMove(tx, m.id, {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });
    }
    return openMembers.length;
  }

  /** Geri almayı uygular. Önizlemedeki mod tx içinde TAZE yeniden çözülür. */
  async applyUndo(
    rollId: string,
    userId?: string,
    opts?: UndoRequestOptions,
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.resolveContext(rollId, opts);
    // ⚠️ FULL'ün YETKİ/SEBEP kapıları genel `canApply` dalından ÖNCE koşar.
    // Sıra load-bearing: yetki bloğu artık `ctx.blockReason`a da yansıyor
    // (önizleme dürüst olsun diye), dolayısıyla aşağıdaki genel dal önce
    // koşsaydı YETKİ hatası 409 olarak dönerdi — istemci interceptor'ları
    // 403'ü ayrı ele alıyor ("yetkin yok" toast'ı) ve 409'u yarış/çakışma
    // sanıp "yenileyin" derdi. Aynı hata, farklı teşhis.
    if (ctx.mode === "FULL") this.assertFullAllowed(opts);
    if (!ctx.canApply) {
      throw AppError.conflict(ctx.blockReason ?? "Bu işlem geri alınamaz");
    }
    if (ctx.mode === "MANUAL") return this.applyManual(ctx.parentId, userId);
    if (ctx.mode === "SINGLE") {
      return this.applySingle(ctx.parentId, ctx.children[0]!.id, userId, ctx.parentArchived, ctx.workOrder?.id ?? null);
    }
    if (ctx.mode === "SINGLE_RESTORE") {
      return this.applySingleRestore(ctx.parentId, ctx.children[0]!.id, userId, ctx.workOrder?.id ?? null);
    }
    return this.applyFull(ctx.parentId, userId, opts?.reason ?? null, ctx.workOrder?.id ?? null);
  }

  /** FULL'ün iki kapısı — TEK KAYNAK (preview + apply aynı yüklemi çağırır). */
  private assertFullAllowed(opts?: UndoRequestOptions): void {
    const block = this.fullPermissionBlockReason(opts) ?? this.fullReasonBlockReason(opts);
    if (block) throw AppError.forbidden(block);
  }

  /**
   * FULL'ün YETKİ kapısı — `null` = geçebilir.
   *
   * ⚠️ ÖNİZLEME DE BUNU ÇAĞIRIR (`previewFull`). Ayrışırsa diyalog "Tüm işlemi
   * geri al" düğmesini AÇIK gösterir, operatör basar ve ham 403 yer — yani tam
   * da bu dosyanın düzeltmek için var olduğu "diyalog yapmayacağı şeyi ilan
   * ediyor" hatası, bu kez yetki tarafından geri gelirdi. (2026-08-09 kod
   * incelemesinde ölçüldü: önizleme `canApply:true` derken uç 403 veriyordu.)
   *
   * ⚠️ `permissions` VERİLMEZSE yetki kontrolü ATLANIR (F221 deseni: dahili
   * çağrı). Bunu "izin yoksa serbest" diye okuma — HTTP yolunda controller
   * `req.user.permissions`i HER ZAMAN geçirir.
   */
  private fullPermissionBlockReason(opts?: UndoRequestOptions): string | null {
    if (!opts?.permissions) return null;
    // ⚠️ `matchesPermission` — düz `includes` DEĞİL. Süperadmin `["*"]` taşır ve
    // düz karşılaştırma onu TANIMAZDI: kapı middleware'den SONRA, servis içinde
    // koştuğu için hata 403 gibi bile görünmez ("yetkiniz yok" iş kuralı reddi).
    // ⚠️ `admin:*` KISAYOLU KORUNUR (ikinci yüklem): düz çevirme
    // `matchesPermission(["admin:*"], "tambur:undo-full")` = false demek olurdu →
    // bugün bu kısayolla geri alma yapabilen kullanıcılar yetki KAYBEDERDİ.
    const ok =
      matchesPermission(opts.permissions, UNDO_FULL_PERMISSION) ||
      matchesPermission(opts.permissions, "admin:*");
    if (ok) return null;
    return (
      "Tümden geri alma yetkiniz yok — bu işlem iş emrinin geçmişini yeniden yazar " +
      `(${UNDO_FULL_PERMISSION} gerekir). Tek parça iptali yapabilirsiniz.`
    );
  }

  /**
   * FULL'ün SEBEP kapısı — yalnız UYGULAMADA koşar, önizlemede KOŞMAZ.
   *
   * Ayrım bilinçli: yetki kullanıcının DEĞİŞTİREMEYECEĞİ bir gerçektir (önizleme
   * onu söylemeli), sebep ise aynı diyalogda DOLDURULACAK bir alandır. Önizlemede
   * de aranırsa FULL seçeneği her zaman "sebep yazılmalı" ile engelli görünür ve
   * operatör hiç deneyemez; istemci bunu zaten `requiresReason` ile biliyor.
   */
  private fullReasonBlockReason(opts?: UndoRequestOptions): string | null {
    const reason = opts?.reason?.trim() ?? "";
    if (reason.length < UNDO_FULL_MIN_REASON) {
      return `Tümden geri alma için sebep yazılmalı (en az ${UNDO_FULL_MIN_REASON} karakter)`;
    }
    return null;
  }

  /**
   * TÜMDEN geri almada kaynağa dönecek metraj — **ÖNİZLEME VE UYGULAMA İÇİN TEK
   * KAYNAK**. İkisi ayrı formül kullanırsa diyalog bir sayı söyler, kod başka bir
   * sayı yazar; 2026-08-09 kod incelemesinde tam bu ölçüldü (önizleme 200 m dedi,
   * uygulama 500 m geri koydu).
   *
   * Formül:  Σ(iptal edilecek çocuklar) + Σ(bu kapanışın KAYIT DÜZELTMESİ sapması)
   *
   *   • discard  → çocuklar = kesimler, sapma = atılan kalan  → kesim + kalan ✓
   *   • scrap    → çocuklar = kesimler + FİRE topu(kalan)     → kesim + kalan ✓
   *                (SCRAP sapması EKLENMEZ — kalan zaten FİRE topunda)
   *   • keep_*   → çocuklar = kesimler + kalan topu, sapma yok → kesim + kalan ✓
   *
   * ⚠️ **`preTamburCloseQty` BU HESAPTA KULLANILMAZ.** O kolon "kapanış anında
   * kaynağın `currentQty`'si"dir — parçalı kesim akışında (`cutOpenFabric` /
   * `cutWarehouseRoll` ile tek tek kesilip sonra `Bitir`) kesimler kaynağın
   * metrajını ÇOKTAN düşürmüştür, yani o değer **kalan**dır, toplam değil.
   * Kolonun işi statü tarafıdır (`preTamburCloseStatus`) ve adli iz olmaktır.
   */
  private async computeRestoredQty(
    client: Prisma.TransactionClient,
    parentId: string,
    children: Array<{ initialQty: Prisma.Decimal }>,
  ): Promise<Prisma.Decimal> {
    const childSum = children.reduce((acc, c) => acc.plus(c.initialQty), new Prisma.Decimal(0));
    const discardedAgg = await client.rollVariance.aggregate({
      where: {
        rollId: parentId,
        reversedAt: null,
        kind: RollVarianceKind.RECORD_CORRECTION,
        source: {
          in: [VARIANCE_SOURCES.TAMBUR_FINALIZE, VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE],
        },
      },
      _sum: { qty: true },
    });
    // TEKİL İPTALLERİN "KAYBOLAN" METRAJI DA GERİ SAYILIR (2026-08-12, F0402).
    // Arşiv dalındaki tekil iptal, metrajı ÇOCUĞUN satırına kayıt düzeltmesi
    // olarak yazar (`applySingle` → rollId: childId, source: TAMBUR_UNDO_SINGLE)
    // ve çocuk CANCELLED olduğu için yukarıdaki children toplamına GİRMEZ.
    // Sayılmasaydı: tüm çocukları tek tek iptal edilmiş bir kapanışta (saha
    // vakası F0402, 208 m) "iptal edilebilir çocuk kalmamış" + geri konacak
    // metraj 0 → tümden geri alma da imkânsız, metraj sonsuza dek kayıp.
    // ⚠️ SENKRON SÖZLEŞMESİ: buraya eklenen HER kaynak, applyFull 5b'deki
    // tersleme süzgecine de eklenmek ZORUNDA — yoksa metraj geri konur ama
    // sapma satırı canlı kalır ve dönem raporu aynı metrajı İKİ KEZ görür.
    const singleUndoAgg = await client.rollVariance.aggregate({
      where: {
        reversedAt: null,
        kind: RollVarianceKind.RECORD_CORRECTION,
        source: VARIANCE_SOURCES.TAMBUR_UNDO_SINGLE,
        roll: { parentRollId: parentId },
      },
      _sum: { qty: true },
    });
    return childSum
      .plus(discardedAgg._sum.qty ?? new Prisma.Decimal(0))
      .plus(singleUndoAgg._sum.qty ?? new Prisma.Decimal(0));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bağlam çözümü (preview + apply ortak)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Dokunulan çocuk, kapanışın `scrap` KALANI mı? Yapısal işaret yok (çocuk da
   * `TAMBUR_SPLIT` doğar); tanım hükümdeki üçlü: SCRAP statüsü ∧ TAMBUR_SPLIT ∧
   * ebeveynde o metraja eşit, canlı `TAMBUR_WAREHOUSE_FINALIZE` SCRAP sapması.
   */
  private async isScrapRemainderChild(
    child: { status: RollStatus; entrySource: RollEntrySource | null; initialQty: Prisma.Decimal },
    parentId: string,
  ): Promise<boolean> {
    if (child.status !== RollStatus.SCRAP || child.entrySource !== RollEntrySource.TAMBUR_SPLIT) return false;
    const sapma = await prisma.rollVariance.findFirst({
      where: {
        rollId: parentId,
        reversedAt: null,
        kind: RollVarianceKind.SCRAP,
        source: VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE,
        qty: child.initialQty,
      },
      select: { id: true },
    });
    return sapma !== null;
  }

  private async resolveContext(
    rollId: string,
    opts?: UndoRequestOptions,
  ): Promise<UndoContext> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, parentRollId: true, status: true, entrySource: true, initialQty: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // ── MOD ÇÖZÜMÜ (2026-08-09'da yeniden yazıldı) ──────────────────────────
    // ESKİ kural: kaynak yaşıyorsa SINGLE, tüketilmişse FULL — yani mod SİSTEM
    // DURUMUNDAN türetiliyordu ve operatör "şu topu iptal et" derken 14 topluk
    // bir işlem alıyordu (saha vakası IE0808260001).
    //
    // YENİ kural: hangi modların MÜMKÜN olduğu sistemden çözülür, hangisinin
    // UYGULANACAĞI operatörden gelir. `defaultMode` her zaman EN DAR olandır.
    let parentId: string;
    let touchedChildId: string | null = null;
    let parentArchived = false;

    if (roll.status === RollStatus.TAMBUR_CONSUMED) {
      // Kaynak topun KENDİSİNE dokunuldu → yapılabilecek tek şey tümden geri alma.
      parentId = roll.id;
    } else if (roll.parentRollId) {
      const p = await prisma.roll.findUnique({
        where: { id: roll.parentRollId },
        select: { id: true, status: true },
      });
      if (!p) throw AppError.notFound("Kaynak top bulunamadı");
      parentId = p.id;
      touchedChildId = roll.id;
      parentArchived = p.status === RollStatus.TAMBUR_CONSUMED;
    } else if (roll.entrySource === RollEntrySource.TAMBUR_MANUAL) {
      // ELLE EKLENEN TOP — kesim soyağacı yok, olamaz da. Geri alma burada
      // "kaydı yok say" demektir, "kesimi geri al" değil.
      return this.resolveManualContext(rollId);
    } else {
      throw AppError.badRequest("Bu top bir Tambur kesim/finalize işleminin parçası değil");
    }

    // Hangi modlar MÜMKÜN: bir çocuğa dokunulduysa tekil iptal her zaman
    // masadadır (kaynak arşivde olsa bile — o durumda metraj geri dönmez,
    // SAPMA olarak kayda geçer). Tekil CANLANDIRMA yalnız kaynak arşivdeyken
    // anlamlı — kaynak yaşıyorsa SINGLE metrajı zaten geri veriyor, ikinci bir
    // "geri koy" seçeneği aynı işi iki adla sunmak olurdu. Tümden geri alma
    // yalnız kapanmış kaynakta.
    // ⚠️ KAPANIŞIN SCRAP-KALANI bir "kesim parçası" DEĞİLDİR (hüküm ① b3-DAR,
    // 2026-09-13): ham ebeveynde `scrap` kapanışı gerçek bir SCRAP çocuğu doğurur;
    // ona SINGLE/SINGLE_RESTORE sunulursa metraj ebeveyne döner, kapanış sapması
    // canlı kalır, `SCRAP` çıkışı terslenmez ve ebeveyn dirildiği için FULL bir
    // daha sunulmaz ⇒ KALICI 60 ↔ 0 (S10, çalıştırılarak ölçüldü). Kalan yalnız
    // kapanışla birlikte geri alınır: FULL.
    const isScrapRemainder = touchedChildId !== null && parentArchived && (await this.isScrapRemainderChild(roll, parentId));
    const canOfferSingle = touchedChildId !== null && !isScrapRemainder;
    const canOfferRestore = touchedChildId !== null && parentArchived && !isScrapRemainder;
    const canOfferFull = parentArchived || roll.status === RollStatus.TAMBUR_CONSUMED;
    const defaultMode: UndoMode = canOfferSingle ? "SINGLE" : "FULL";

    // ⚠️ AÇIKÇA İSTENEN MOD UYGULANAMIYORSA SESSİZCE DİĞERİNE DÜŞÜLMEZ (409).
    // Eskiden düşülüyordu ve bu, düzeltilen hatanın küçük bir kopyasıydı:
    // operatör "tümünü geri al" der, sistem tek parça iptal eder, mesaj da
    // tek parçadan bahseder — kimse yanlış olduğunu anlamaz. Gerçek senaryo:
    // iki kişi aynı anda bakar, biri FULL'ü uygular, diğerinin ekranı bayatlar.
    // Doğru cevap "yenileyin"dir. Mod GÖNDERMEYEN eski istemci etkilenmez —
    // o `defaultMode`a düşer ve bu bilinçli olarak EN DAR olandır.
    if (opts?.mode) {
      const available =
        opts.mode === "SINGLE"
          ? canOfferSingle
          : opts.mode === "SINGLE_RESTORE"
            ? canOfferRestore
            : canOfferFull;
      if (!available) {
        if (isScrapRemainder && opts.mode !== "FULL") {
          throw AppError.conflict(
            "Bu top kapanışın FİRE kalanıdır, bir kesim parçası değil — tek başına iptal edilemez; " +
              "kapanışı tümden geri alın (Tüm İşlemi Geri Al).",
            { code: "UNDO_SCRAP_REMAINDER_FULL_ONLY", parentId },
          );
        }
        throw AppError.conflict(
          opts.mode === "FULL"
            ? "Bu top için tümden geri alma artık yapılamıyor (kapanış bu sırada değişmiş olabilir) — ekranı yenileyin"
            : opts.mode === "SINGLE_RESTORE"
              ? "Bu top için iş emrine geri alma yapılamıyor (kaynak top artık arşivde değil) — ekranı yenileyin"
              : "Bu top için tek parça iptali yapılamıyor — ekranı yenileyin",
        );
      }
    }
    const mode: UndoMode = opts?.mode ?? defaultMode;

    const parent = await prisma.roll.findUnique({
      where: { id: parentId },
      select: {
        id: true, barcode: true, status: true, currentQty: true, initialQty: true,
        currentStepId: true, sackId: true, shipmentId: true, batchId: true,
        // Kapanış anında KAYDEDİLEN hâl — geri alma bunları TÜRETMEZ, geri koyar.
        preTamburCloseQty: true, preTamburCloseStatus: true,
      },
    });
    if (!parent) throw AppError.notFound("Kaynak top bulunamadı");

    // ── İKİ MODU DA HESAPLA ─────────────────────────────────────────────────
    // Seçilen mod ne olursa olsun İKİSİ de hesaplanır: `options[]` operatöre
    // "hangisi ne yapacak" diye sorabilmek için ikisinin de somut sayısını
    // (kaç top, kaç metre) taşımak zorunda. Tek modu hesaplayıp diğerini
    // "muhtemelen yapılabilir" diye göstermek, tam da düzeltmeye çalıştığımız
    // "diyalog yapmayacağı şeyi ilan ediyor" hatası olurdu.
    const single = touchedChildId && canOfferSingle
      ? await this.previewSingle(touchedChildId, parent, parentArchived)
      : null;
    const restore =
      canOfferRestore && touchedChildId
        ? await this.previewSingleRestore(touchedChildId, parentId)
        : null;
    const full = canOfferFull ? await this.previewFull(parentId, parent, opts) : null;

    // SIRA = GÖSTERİM SIRASI: canlandırma ÖNCE — sahadaki asıl ihtiyaç o
    // ("kumaş elimde, yeniden keseceğim"); kayıt düzeltmesi ikinci; tümden
    // geri alma en sonda (süpervizör aracı). `defaultMode` bundan bağımsız
    // olarak EN DAR kalır (mod göndermeyen eski istemci güvenliği).
    const options: UndoOption[] = [];
    if (restore) options.push(restore.option);
    if (single) options.push(single.option);
    if (full) options.push(full.option);

    const selected =
      mode === "SINGLE" ? single : mode === "SINGLE_RESTORE" ? restore : full;
    if (!selected) {
      // Buraya düşmek mantıksal olarak imkânsız (mod çözümü yalnız mümkün
      // olanlardan seçiyor) — yine de sessiz undefined dönmek yerine konuş.
      throw AppError.badRequest("Bu top için uygulanabilir bir geri alma yolu yok");
    }

    return {
      ...selected.ctx,
      mode,
      options,
      defaultMode,
      parentArchived,
      parentId,
      parent: this.parentView(parent),
    };
  }

  /**
   * TEK PARÇA iptali önizlemesi.
   *
   * İki dünya, tek fonksiyon — ayrımı `parentArchived` yapar:
   *  • kaynak YAŞIYOR  → metraj kaynağa döner; kaynağın hâlâ doğru yerde olması
   *    ŞART (kesim yapılan adımda / serbest depoda).
   *  • kaynak ARŞİVDE  → metraj DÖNMEZ, sapma yazılır. Kaynağın nerede olduğu
   *    ÖNEMSİZ (zaten tüketilmiş) → parent guard'ları UYGULANMAZ. Bu dal
   *    2026-08-09'da açıldı; öncesinde bu durumda hiçbir yol yoktu.
   */
  private async previewSingle(
    childId: string,
    parent: { status: RollStatus; currentStepId: string | null; sackId: string | null; shipmentId: string | null },
    parentArchived: boolean,
  ): Promise<{ option: UndoOption; ctx: Omit<UndoContext, "mode" | "options" | "defaultMode" | "parentArchived" | "parentId" | "parent"> }> {
    const warnings: string[] = [];
    const child = await this.loadChild(childId);
    const alreadyCancelled =
      child.status === RollStatus.CANCELLED ? "Bu parça zaten iptal edilmiş" : null;
    const grandchildren = await prisma.roll.count({ where: { parentRollId: child.id } });
    const childBlock = alreadyCancelled ?? childBlockReason(child, grandchildren);

    // Kaynak tarafı guard'ları YALNIZ kaynak yaşıyorken anlamlıdır.
    let parentBlock: string | null = null;
    if (!parentArchived) {
      if (child.producedInStepId != null) {
        if (parent.status !== RollStatus.IN_PRODUCTION || parent.currentStepId !== child.producedInStepId) {
          parentBlock = "Kaynak top artık kesimin yapıldığı Tambur adımında değil — tek parça iptali yapılamaz";
        }
      } else if (parent.status !== RollStatus.WAREHOUSE && parent.status !== RollStatus.STOCK) {
        parentBlock = `Kaynak top serbest depoda değil (${parent.status}) — tek parça iptali yapılamaz`;
      } else if (parent.sackId || parent.shipmentId) {
        parentBlock = "Kaynak top çuvalda/sevkiyatta — önce oradan çıkarın";
      }
    }

    const finalBlock = childBlock ?? parentBlock;
    const qty = Number(child.initialQty);
    if (child.barcode) warnings.push(`Basılmış ${child.barcode} etiketi varsa imha edilmeli`);
    // ⚠️ ARŞİV UYARISI BURAYA GERİ EKLENMEZ: aynı bilgi `description`'da kelimesi
    // kelimesine var ("kaynağa geri dönmez … kayıt düzeltmesi olarak yazılır") ve
    // istemci ikisini alt alta basıyordu — 2026-08-12 "modal çok kalabalık" saha
    // geri bildiriminin kalemlerinden biri. warnings[] YALNIZ description'da
    // olmayan bilgiyi taşır (örn. etiket imhası).

    return {
      option: {
        mode: "SINGLE",
        // METİN SETİ (2026-08-12 kullanıcı kararı): tuş yaptığı İŞİN adını
        // taşır. Arşiv dalında hiçbir şey "geri alınmıyor" — top iptal ediliyor;
        // "Geri Al" adı operatörü metrajın döneceğine inandırıyordu.
        label: parentArchived ? "Topu iptal et (kayıt yanlıştı)" : "Kesimi geri al",
        description: parentArchived
          ? `${child.barcode ?? "bu parça"} iptal edilir. ${qty} m kaynağa geri dönmez (kaynak arşivde) — kayıt düzeltmesi olarak yazılır. İş emri KAPALI kalır.`
          : `${child.barcode ?? "bu parça"} iptal edilir, ${qty} m kaynak topa geri döner.`,
        canApply: finalBlock == null,
        blockReason: finalBlock,
        affectedCount: 1,
        restoredQty: parentArchived ? 0 : qty,
        requiresReason: false,
      },
      ctx: {
        canApply: finalBlock == null,
        blockReason: finalBlock,
        restoredQty: parentArchived ? 0 : qty,
        children: [
          {
            id: child.id,
            barcode: child.barcode,
            status: child.status,
            qty,
            blockReason: childBlock,
          },
        ],
        reopenErrorCount: 0,
        workOrder: null,
        warnings,
      },
    };
  }

  /**
   * TEKİL CANLANDIRMA önizlemesi (İş Emrine Geri Al, 2026-08-12).
   *
   * Yalnız kaynak ARŞİVDEYKEN sunulur. Fiziksel gerçek: kesilen parça elde ama
   * kaydı yanlış (metraj/kesim) ve yeniden işlenecek — metrajı kaynak topa geri
   * konur, kaynak Tambur adımına (ya da depo kesiminde kapanış-öncesi rafına)
   * dirilir, KARDEŞ TOPLARA DOKUNULMAZ. İş emri KAPALI ise yeniden açılır.
   *
   * ⚠️ Aynı-gün ayarı (`tamburUndoFullSameDayOnly`) BURAYA UYGULANMAZ — o ayar
   * adıyla ve anlamıyla TÜMDEN geri almayı kapılar (iş emri geçmişini toptan
   * yeniden yazma). Tekil canlandırma tek topun düzeltmesidir; kapsamını
   * sessizce genişletmek ayarın sözleşmesini bozar.
   */
  private async previewSingleRestore(
    childId: string,
    parentId: string,
  ): Promise<{ option: UndoOption; ctx: Omit<UndoContext, "mode" | "options" | "defaultMode" | "parentArchived" | "parentId" | "parent"> }> {
    const warnings: string[] = [];
    const child = await this.loadChild(childId);
    const alreadyCancelled =
      child.status === RollStatus.CANCELLED ? "Bu parça zaten iptal edilmiş" : null;
    const grandchildren = await prisma.roll.count({ where: { parentRollId: child.id } });
    const childBlock = alreadyCancelled ?? childBlockReason(child, grandchildren);

    // Kapanışın adımı + iş emri — FULL ile aynı çözüm (depo kesiminde ikisi de
    // yok ve bu meşru: kaynak, kapanış-öncesi rafına döner).
    const op = await prisma.rollOperation.findFirst({
      where: { ...ACTIVE_OPERATION, rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
      orderBy: { createdAt: "desc" },
      select: { workOrderStepId: true },
    });
    let wo: UndoContext["workOrder"] = null;
    let woBlock: string | null = null;
    if (op) {
      const step = await prisma.workOrderStep.findUnique({
        where: { id: op.workOrderStepId },
        select: { workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
      });
      const w = step?.workOrder ?? null;
      if (w) {
        if (w.status === WorkOrderStatus.CANCELLED || w.status === WorkOrderStatus.SUPERSEDED) {
          // manualMove disipliniyle aynı: iptal/devredilmiş iş emrine top
          // diriltmek "canlı ama kimsenin okutamadığı" çıkmazı üretir.
          woBlock = `İş emri ${w.status === WorkOrderStatus.CANCELLED ? "iptal edilmiş" : "devredilmiş"} — iş emrine geri alınamaz`;
        }
        wo = {
          id: w.id,
          workOrderNumber: w.workOrderNumber,
          status: w.status,
          willRevive: w.status === WorkOrderStatus.COMPLETED,
        };
      }
    }

    const finalBlock = childBlock ?? woBlock;
    const qty = Number(child.initialQty);
    if (child.barcode) warnings.push(`Basılmış ${child.barcode} etiketi varsa imha edilmeli`);
    if (wo?.willRevive) {
      warnings.push("Tamamlanmış iş emri yeniden AÇILACAK (refakat kartı tekrar aktif olur)");
    }

    return {
      option: {
        mode: "SINGLE_RESTORE",
        label: "İş emrine geri al (kumaş elimde)",
        description: op
          ? `${child.barcode ?? "bu parça"} iptal edilir, ${qty} m kaynak topa geri konur ve top Tambur adımına döner — yeniden kesilebilir. Diğer toplara dokunulmaz.`
          : `${child.barcode ?? "bu parça"} iptal edilir, ${qty} m kaynak topa geri konur ve top depoya döner. Diğer toplara dokunulmaz.`,
        canApply: finalBlock == null,
        blockReason: finalBlock,
        affectedCount: 1,
        restoredQty: qty,
        requiresReason: false,
      },
      ctx: {
        canApply: finalBlock == null,
        blockReason: finalBlock,
        restoredQty: qty,
        children: [
          {
            id: child.id,
            barcode: child.barcode,
            status: child.status,
            qty,
            blockReason: childBlock,
          },
        ],
        reopenErrorCount: 0,
        workOrder: wo,
        warnings,
      },
    };
  }

  /**
   * TÜMDEN geri alma önizlemesi. İki kapanış türünü de kapsar:
   *  • ÜRETİM akışı  → `TAMBUR_PROCESSED` izi var, iş emri adımı çözülür
   *  • DEPO kesimi   → iz yok, adım da yok. **2026-08-09'a kadar bu yol
   *    tamamen kapalıydı** ve kaynak tüketildiği için tekil iptal de
   *    yapılamıyordu → operatör çıkmazdaydı (9 kaynağın 6'sı bu durumdaydı).
   */
  private async previewFull(
    parentId: string,
    parent: { barcode: string | null; preTamburCloseQty: Prisma.Decimal | null },
    opts?: UndoRequestOptions,
  ): Promise<{ option: UndoOption; ctx: Omit<UndoContext, "mode" | "options" | "defaultMode" | "parentArchived" | "parentId" | "parent"> }> {
    const warnings: string[] = [];
    const op = await prisma.rollOperation.findFirst({
      where: { ...ACTIVE_OPERATION, rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
      orderBy: { createdAt: "desc" },
      select: { workOrderStepId: true, createdAt: true },
    });

    const bail = (
      reason: string,
      wo: UndoContext["workOrder"] = null,
    ): { option: UndoOption; ctx: Omit<UndoContext, "mode" | "options" | "defaultMode" | "parentArchived" | "parentId" | "parent"> } => ({
      option: {
        mode: "FULL",
        label: "Tüm işlemi geri al",
        description: "Bu kapanıştan çıkan TÜM toplar iptal edilir ve kaynak top geri dirilir.",
        canApply: false,
        blockReason: reason,
        affectedCount: 0,
        restoredQty: 0,
        requiresReason: true,
      },
      ctx: {
        canApply: false,
        blockReason: reason,
        restoredQty: 0,
        children: [],
        reopenErrorCount: 0,
        workOrder: wo,
        warnings,
      },
    });

    let wo: UndoContext["workOrder"] = null;
    let stepId: string | null = null;
    if (op) {
      const step = await prisma.workOrderStep.findUnique({
        where: { id: op.workOrderStepId },
        select: { id: true, workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
      });
      if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
      stepId = step.id;
      const w = step.workOrder;
      if (w.status === WorkOrderStatus.CANCELLED || w.status === WorkOrderStatus.SUPERSEDED) {
        // manualMove disipliniyle aynı: iptal/devredilmiş WO'ya top diriltmek
        // "canlı ama kimsenin okutamadığı" çıkmazı üretir.
        return bail(
          `İş emri ${w.status === WorkOrderStatus.CANCELLED ? "iptal edilmiş" : "devredilmiş"} — geri alma yapılamaz`,
          { id: w.id, workOrderNumber: w.workOrderNumber, status: w.status, willRevive: false },
        );
      }
      wo = {
        id: w.id,
        workOrderNumber: w.workOrderNumber,
        status: w.status,
        willRevive: w.status === WorkOrderStatus.COMPLETED,
      };
    }

    // AYNI GÜN sınırı — bayrağa bağlı, varsayılan KAPALI. Yalnız FULL'ü kapılar;
    // tekil iptal ETKİLENMEZ (asıl koruma parçaların kendi guard'larındadır).
    if (await resolveTamburUndoFullSameDayOnly()) {
      const closedAt = op?.createdAt ?? null;
      if (closedAt && closedAt < factoryDayStart()) {
        return bail(
          "Tümden geri alma yalnız aynı gün yapılabilir (ayar açık) — bu kapanış daha eski. " +
            "Tek parça iptali hâlâ yapılabilir.",
          wo,
        );
      }
    }

    const childRows = await prisma.roll.findMany({
      where: { parentRollId: parentId, status: { not: RollStatus.CANCELLED } },
      select: {
        id: true, barcode: true, status: true, initialQty: true, currentQty: true,
        sackId: true, shipmentId: true, directShipmentId: true,
        currentStepId: true, producedInStepId: true, qualityGrade: true,
      },
    });
    // SIFIR ÇOCUK ≠ HER ZAMAN ÇIKMAZ (2026-08-12, F0402 düzeltmesi): tüm
    // çocuklar tek tek iptal edilmişse iptal edilecek parça kalmaz ama tekil
    // iptallerin sapma defterine yazdığı metraj hâlâ geri konabilir. Yalnız
    // geri konacak metraj da 0 ise gerçekten yapılacak şey yok.
    const restoredEarly =
      childRows.length === 0
        ? await this.computeRestoredQty(prisma, parentId, childRows)
        : null;
    if (childRows.length === 0 && (restoredEarly == null || restoredEarly.lte(0))) {
      return bail("Bu işlemin iptal edilebilir çocuğu kalmamış", wo);
    }

    const grandCounts = await prisma.roll.groupBy({
      by: ["parentRollId"],
      where: { parentRollId: { in: childRows.map((c) => c.id) } },
      _count: { _all: true },
    });
    const grandByParent = new Map(grandCounts.map((g) => [g.parentRollId as string, g._count._all]));

    const children = childRows.map((c) => ({
      id: c.id, barcode: c.barcode, status: c.status, qty: Number(c.initialQty),
      blockReason: childBlockReason(c, grandByParent.get(c.id) ?? 0),
    }));
    const blocked = children.filter((c) => c.blockReason);

    // ⚠️ METRAJ **UYGULAMAYLA AYNI FONKSİYONDAN** gelir. Burada ayrı bir formül
    // yazmak (eskiden `preTamburCloseQty` okunuyordu) diyaloğa 200 m dedirtip
    // koda 500 m yazdırıyordu — 2026-08-09 kod incelemesinde ölçüldü.
    const restored = await this.computeRestoredQty(prisma, parentId, childRows);

    const reopenErrorCount = stepId
      ? await prisma.rollError.count({
          where: { rollId: parentId, isProcessed: true, processedAtStepId: stepId },
        })
      : 0;

    if (children.some((c) => c.barcode)) {
      warnings.push("İptal edilen parçaların basılmış etiketleri imha edilmeli");
    }
    if (wo?.willRevive) {
      warnings.push("Tamamlanmış iş emri yeniden AÇILACAK (refakat kartı tekrar aktif olur)");
    }

    // ⚠️ YETKİ ÖNCE: parça engeli veriyle ilgilidir (biri çuvaldan çıkarınca
    // düşer), yetki ise kullanıcıyla ilgilidir ve yenilemekle değişmez. Sırayı
    // ters çevirmek, yetkisiz operatöre çözemeyeceği bir iş listesi verirdi.
    const blockReason =
      this.fullPermissionBlockReason(opts) ??
      (blocked.length
        ? `Geri alınamaz — ${blocked.length} parça engelli (ör. ${blocked[0]!.barcode ?? blocked[0]!.id}: ${blocked[0]!.blockReason})`
        : null);

    return {
      option: {
        mode: "FULL",
        label:
          children.length > 0
            ? `Tüm işlemi geri al (${children.length} top)`
            : "Tüm işlemi geri al",
        description:
          (children.length > 0
            ? `${children.length} top iptal edilir, ${Number(restored)} m kaynak topa geri döner`
            : `İptal edilecek parça kalmamış (hepsi tek tek iptal edilmiş); ${Number(restored)} m kaynak topa geri konur`) +
          (wo?.willRevive ? ", tamamlanmış iş emri yeniden açılır" : "") +
          ". Sebep yazmanız gerekir.",
        canApply: blockReason == null,
        blockReason,
        affectedCount: children.length,
        restoredQty: Number(restored),
        requiresReason: true,
      },
      ctx: {
        canApply: blockReason == null,
        blockReason,
        restoredQty: Number(restored),
        children,
        reopenErrorCount,
        workOrder: wo,
        warnings,
      },
    };
  }

  private parentView(p: { id: string; barcode: string | null; status: RollStatus; currentQty: Prisma.Decimal; initialQty: Prisma.Decimal }) {
    return { id: p.id, barcode: p.barcode, status: p.status, currentQty: Number(p.currentQty), initialQty: Number(p.initialQty) };
  }

  private async loadChild(id: string): Promise<ChildRow> {
    const c = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true, barcode: true, status: true, initialQty: true, currentQty: true,
        sackId: true, shipmentId: true, directShipmentId: true,
        currentStepId: true, producedInStepId: true, qualityGrade: true,
      },
    });
    if (!c) throw AppError.notFound("Parça bulunamadı");
    return c;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SINGLE — tek parça iptali (parent yaşıyor)
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // MANUAL — elle eklenen topun kaydını geri al (2026-08-04)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Kapsam BİLEREK DAR: yalnız elle eklenmiş ve HENÜZ HİÇ İŞLEM GÖRMEMİŞ top.
   *
   * "Hiç işlem görmemiş"in üç ölçütü var ve üçü de gerçek bir soruya karşılık
   * gelir: (a) kesilmemiş — çocuğu varsa metraj başka kayıtlara dağılmıştır;
   * (b) istasyon işlemi görmemiş — kurşun/QC2/Tambur kararı yazılmışsa o karar
   * da geri alınmalıdır ve bu, bu ucun işi değildir; (c) çuval/sevkiyata
   * girmemiş. Bunlardan biri bile ihlal edilmişse operatör düzeltemez — iş
   * süpervizörün "Düzelt"/dispozisyon yollarına aittir ve blockReason bunu
   * AÇIKÇA söyler (çıkmaz bırakmak, yanlış işlem yaptırmaktan sonra en kötüsü).
   */
  private async resolveManualContext(rollId: string): Promise<Awaited<ReturnType<TamburUndoService["resolveContext"]>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true, barcode: true, status: true, currentQty: true, initialQty: true,
        entryReason: true, currentStepId: true, sackId: true, shipmentId: true,
        directShipmentId: true, batchId: true,
        batch: { select: { batchNumber: true } },
        currentStep: {
          select: {
            workOrder: { select: { id: true, workOrderNumber: true, status: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const warnings: string[] = [];
    let blockReason: string | null = null;

    if (roll.status === RollStatus.CANCELLED) {
      blockReason = "Bu top zaten iptal edilmiş";
    } else if (roll.sackId) {
      blockReason = "Çuvala okutulmuş — önce çuvaldan çıkarın";
    } else if (roll.shipmentId || roll.directShipmentId) {
      blockReason = "Sevkiyata girmiş — geri alınamaz";
    } else if (!MANUAL_UNDOABLE_STATUSES.includes(roll.status)) {
      blockReason = `Bu durumda geri alınamaz (${roll.status})`;
    }

    if (!blockReason) {
      const [childCount, opCount, movementCount] = await Promise.all([
        prisma.roll.count({ where: { parentRollId: rollId } }),
        prisma.rollOperation.count({ where: { ...ACTIVE_OPERATION, rollId } }),
        prisma.rollMovement.count({ where: { ...ACTIVE_MOVEMENT, rollId } }),
      ]);
      if (childCount > 0) {
        blockReason = "Bu top kesilmiş (parçaları var) — önce kesimi geri alın";
      } else if (opCount > 0) {
        blockReason =
          "Bu top istasyon işlemi görmüş (kurşun/kalite/Tambur kararı yazılmış) — " +
          "operatör geri alamaz, süpervizöre başvurun";
      } else if (movementCount > 1) {
        // Elle ekleme TEK açık hareket doğurur. Fazlası, topun istasyonlar
        // arasında gezdiği anlamına gelir.
        blockReason =
          "Bu top eklendikten sonra istasyon değiştirmiş — operatör geri alamaz, " +
          "süpervizöre başvurun";
      }
    }

    if (!blockReason && roll.barcode) {
      warnings.push(`Basılmış ${roll.barcode} etiketi varsa imha edilmeli`);
    }
    if (!blockReason && roll.batch?.batchNumber) {
      // Parti bağı iptalde TOPTA KALIR (softDelete batchId'ye dokunmaz) — bu
      // bilinçlidir: "hangi partiye yanlış top yazılmıştı" izi korunur.
      warnings.push(`${roll.batch.batchNumber} partisinden düşecek`);
    }

    const wo = roll.currentStep?.workOrder ?? null;
    return {
      mode: "MANUAL",
      // Elle eklenen topta seçenek YOKTUR — yapılabilecek tek şey kaydı yok
      // saymaktır. Tek elemanlı `options` istemcinin dallanmasını basitleştirir
      // (her yanıt aynı şekli taşır), soru sordurmaz.
      options: [
        {
          mode: "MANUAL" as const,
          label: "Kaydı iptal et",
          description: "Elle eklenen bu kayıt iptal edilir (top hiç eklenmemiş sayılır).",
          canApply: blockReason === null,
          blockReason,
          affectedCount: 1,
          restoredQty: 0,
          requiresReason: false,
        },
      ],
      defaultMode: "MANUAL" as const,
      parentArchived: false,
      canApply: blockReason === null,
      blockReason,
      parentId: roll.id,
      parent: {
        id: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        currentQty: Number(roll.currentQty),
        initialQty: Number(roll.initialQty),
      },
      restoredQty: 0,
      // Tek kayıt etkileniyor ve o da topun KENDİSİ — yıkıcı-işlem kuralı
      // gereği somut listelenir ("1 kayıt etkilenecek" gibi soyut sayı yetmez).
      children: [
        {
          id: roll.id,
          barcode: roll.barcode,
          status: roll.status,
          qty: Number(roll.currentQty),
          blockReason,
        },
      ],
      reopenErrorCount: 0,
      // İş emri DİRİLTİLMEZ/kapatılmaz: bu top oraya hiç ait olmamalıydı.
      // willRevive=false — önizleme yanlış vaat etmesin.
      workOrder: wo
        ? { id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status, willRevive: false }
        : null,
      warnings,
    };
  }

  /**
   * Uygulama: motor `InventoryService.softDelete` — burada YENİDEN YAZILMAZ.
   * `confirmActive` veriyoruz çünkü top bilerek istasyonda aktif olabilir
   * (IN_PRODUCTION); onayı zaten önizleme + operatörün butonu temsil ediyor.
   * softDelete adım/WO durumunu kendi recompute eder.
   */
  /**
   * TX'İN İLK İŞİ: iş emri satırını KİLİTLE ve durumunu TAZE doğrula.
   *
   * BULGU-T1-003. Geri alma iş emri satırını hiç kilitlemiyordu ve durumu tx
   * DIŞINDA okumuş oluyordu. Planlamacı aynı saniyede iş emrini iptal ederse
   * (ölçülen pencere: 6 ms) READ COMMITTED altında geri alma hâlâ IN_PROGRESS
   * görüyor, kapıyı geçiyor ve topu İPTAL EDİLMİŞ iş emrinin SKIPPED adımına
   * `IN_PRODUCTION` olarak diriltiyordu — üstüne kapanmayan bir hareket satırı.
   * İki istek de 200 alıyordu.
   *
   * Sonuç, fiziksel olarak elde olan kumaşın sistemde ÇIKMAZA düşmesi: hiçbir
   * istasyon okutamaz (refakat kartı VOIDED), envanter ve Üretim Akışı panosu
   * onu üretimde sayar, kapanmayan hareket WIP sayacını kalıcı şişirir. Çıkış
   * yolu yalnız `roll:manual-adjust` yetkili "Kurtar". Hiçbir alarm yok.
   *
   * Kilit ayrıca kilit SIRASINI kardeş yollarla (fason ailesi, `assign`,
   * `completeWorkOrder`) hizalar → ABBA deadlock kolu da kapanır.
   */
  private async lockAndAssertWorkOrderLive(
    tx: Prisma.TransactionClient,
    workOrderId: string | null,
  ): Promise<void> {
    if (!workOrderId) return; // depo kesimi — iş emrine bağlı değil
    await touchWorkOrderTx(tx, workOrderId);
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true, workOrderNumber: true },
    });
    if (!wo) return;
    if (wo.status === WorkOrderStatus.CANCELLED || wo.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.conflict(
        `${wo.workOrderNumber} iş emri bu sırada ${
          wo.status === WorkOrderStatus.CANCELLED ? "iptal edildi" : "devredildi"
        } — geri alma yapılamaz. Listeyi yenileyin.`,
        { code: "WORKORDER_TERMINAL_DURING_UNDO" },
      );
    }
  }

  private async applyManual(rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    // Tazeleme: önizleme ile uygulama arasında top kesilmiş/çuvala girmiş
    // olabilir. Guard'ı tekrar koştur (yıkıcı-işlem kuralı: apply kendi
    // guard'ına sahiptir, preview'a güvenmez).
    const fresh = await this.resolveManualContext(rollId);
    if (!fresh.canApply) {
      throw AppError.conflict(fresh.blockReason ?? "Bu işlem geri alınamaz");
    }
    const res = await inventoryService.softDelete(rollId, userId, { confirmActive: true });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: {
        event: "TAMBUR_MANUAL_ROLL_UNDO",
        barcode: fresh.parent.barcode,
        qty: fresh.parent.currentQty,
        previousStatus: fresh.parent.status,
        workOrderNumber: fresh.workOrder?.workOrderNumber ?? null,
      },
    });

    return {
      success: true,
      data: { rollId, barcode: fresh.parent.barcode, mode: "MANUAL" as const },
      message: `Elle eklenen top geri alındı (iptal edildi)${
        fresh.parent.barcode ? `: ${fresh.parent.barcode}` : ""
      }. ${res.message ?? ""}`.trim(),
    };
  }
  private async applySingle(
    parentId: string,
    childId: string,
    userId: string | undefined,
    /** Kaynak arşivde mi — metrajın geri DÖNEMEYECEĞİ durum (2026-08-09). */
    parentArchived: boolean,
    /** Kilitlenecek iş emri (null = depo kesimi) — tx'in İLK işi (T1-003). */
    workOrderId: string | null,
  ): Promise<ApiResponse<unknown>> {
    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İŞİ (2026-08-29 / BULGU-T1-003) — gerekçe helper'da.
      await this.lockAndAssertWorkOrderLive(tx, workOrderId);
      const child = await tx.roll.findUnique({
        where: { id: childId },
        select: {
          id: true, barcode: true, status: true, initialQty: true, currentQty: true,
          sackId: true, shipmentId: true, directShipmentId: true,
          currentStepId: true, producedInStepId: true, qualityGrade: true,
        },
      });
      if (!child) throw AppError.notFound("Parça bulunamadı");
      const grandchildren = await tx.roll.count({ where: { parentRollId: childId } });
      const block = childBlockReason(child, grandchildren);
      if (block) throw AppError.conflict(block);

      // Çocuk claim — arada çuvala/sevke/WO'ya kaçtıysa count 0 → 409.
      const cancelled = await tx.roll.updateMany({
        where: {
          id: childId,
          status: { in: CHILD_CANCELABLE_STATUSES },
          sackId: null, shipmentId: null, currentStepId: null,
        },
        // ⚠️ İZ + METRAJ BİRLİKTE (2026-08-29 / BULGU-T1-011). Geri alma bu
        // parçanın metrajını KAYNAK TOPA İADE ediyor; parçada bırakmak "iptal
        // ama metrajı üstünde" bir kayıt üretiyordu ve Envanter→Arşiv'den
        // "İptali Geri Al" onu diriltince AYNI metraj iki yerde sayılıyordu
        // (sahada 50 top / 1.834,8 m diriltilmeye hazır bekliyordu).
        //   • `currentQty: 0` → dirilse bile 0 m dirilir (giriş metrajı
        //     `initialQty`de DURUYOR, arşiv "bu kesim 40 m'ydi" diyebiliyor),
        //   • `cancelReasonCode` → geri alma kaynaklı iptal SATIRIN KENDİSİNDEN
        //     tanınır; geri alma kapısı buna bakıp reddeder. Audit'e dayanmak
        //     olmazdı: 6 ayda arşivleniyor, kural sessizce açılırdı.
        data: {
          status: RollStatus.CANCELLED,
          currentQty: 0,
          cancelReasonCode: TAMBUR_UNDO_CANCEL_CODE,
          cancelReason: TAMBUR_UNDO_CANCEL_TEXT,
        },
      });
      if (cancelled.count !== 1) {
        throw AppError.conflict("Parça bu sırada başka bir akışa girdi — geri alınamadı, yenileyin");
      }

      // DEPO DEFTERİ — çocuğun doğarken yazdığı GİRİŞ satırı terslenir. Yoksa
      // iptal edilen metraj defterde depoda kalır ve her geri alma turu depoya
      // hayalet metre ekler (yeniden finalize ikinci bir giriş yazar).
      // ⚠️ ÖNCE GRUP, AMA YALNIZ EBEVEYN GERİ ALINIYORSA: depo kesimi çocuğu bir
      // TRANSFORM çiftiyle doğar (ebeveyn OUT + çocuk IN). Ebeveyne metraj geri
      // konan dallarda çiftin iki ucu da terslenir, yoksa OUT yetim kalır (durum
      // 100 ↔ defter 60). Kaynak ARŞİVDE dalında metraj geri DÖNMEZ (aşağıda
      // RECORD_CORRECTION): orada ebeveynin OUT'u gerçek kalır — terslenirse
      // defter ebeveyne 40 m yazar, durum 0 der. Defter durumu izler, tersi değil.
      const childOverageRows = parentArchived ? [] : await this.readChildOverageRowsTx(tx, [childId]);
      if (!parentArchived) {
        await reverseTransformGroupsOf(tx, [childId], {
          reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
          userId: userId ?? null,
          notes: TAMBUR_UNDO_CANCEL_TEXT,
        });
      }
      await reverseAllRollStockMoves(tx, [childId], {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });

      // PLAN-SAPMA: YALNIZ bu çocuğa bağlı imza (2026-09-13). O kesimin metrajı
      // depoda kalmadı ⇒ karne o kadar fazla sayardı.
      // ⛔ `finalize` imzası (childRollId NULL) DAMGALANMAZ: kardeşler ayakta,
      // topun geri kalanı hâlâ sapan kimlikle depoda.
      const singleConfirmations = await findPlanDeviationConfirmationsTx(tx, {
        childRollId: childId,
      });
      await revokePlanDeviationsTx(tx, {
        confirmationIds: singleConfirmations,
        reason: "TAMBUR_UNDO_SINGLE",
        userId,
      });

      const len = child.initialQty;
      let restoredTo: string;
      if (parentArchived) {
        // ── KAYNAK ARŞİVDE (2026-08-09, YENİ YOL) ────────────────────────────
        // Metraj geri DÖNEMEZ: kaynak top tüketilmiş, 0 m ve arşivde. Ona metraj
        // yazmak "ölü topu diriltmek" olurdu ve envanterde hayalet stok üretirdi.
        //
        // Fiziksel gerçek: bu top yanlış kaydedilmişti — kumaş ya hiç yoktu ya
        // başka bir topun içinde. Sektörel karşılığı KAYIT DÜZELTMESİDİR
        // (SAP 701/702), fire DEĞİL — o yüzden `RECORD_CORRECTION`.
        //
        // ⚠️ Kaynak arşivde KALIR ve iş emri KAPALI kalır. Tek top için iş emrini
        // diriltmek, tam da düzeltmeye çalıştığımız aşırı-kapsam davranışı olurdu.
        await recordVarianceTx(tx, {
          rollId: childId,
          workOrderStepId: child.producedInStepId,
          kind: RollVarianceKind.RECORD_CORRECTION,
          qty: len,
          source: VARIANCE_SOURCES.TAMBUR_UNDO_SINGLE,
          // Sebep operatörden İSTENMEZ: "geri al" butonuna basmanın kendisi
          // beyandır ve kaynak zaten `source` ile ayırt edilebiliyor.
          reasonCode: "YANLIS_TOP",
          userId,
        });
        restoredTo = "VARIANCE";
      } else if (child.producedInStepId != null) {
        // cutOpenFabric: parent Tambur adımında IN_PRODUCTION olmalı; yalnız currentQty geri
        // (kesim yalnız onu düşmüştü; `initialQty` orijinal girişte durur).
        //
        // ⚠️ AŞIM KORUMASI — `applySingleFromArchive`/`applyFull` ikizlerinin AYNISI
        // (2026-08-22). Aşımlı kesimde (`tambur.overQuantityEnabled`, varsayılan AÇIK)
        // çıkan toplam kayıtlı girişi aşabilir: 100 m'lik topa 40+40+40 kesilir,
        // `currentQty` 0'a tıkanır ve aşım kesim anında deftere yazılır. Parçalar
        // tek tek geri alınırken metraj geri konur ve ÜÇÜNCÜSÜNDE `currentQty (120)`
        // kayıtlı girişi (100) AŞAR. Koruma olmadan bu, §13 invariantını kıran
        // ("top yalnız kesimle azalır, artamaz") ve deftere HİÇ satır bırakmayan
        // sessiz bir sapma üretiyordu — ölçüldü, canlıda 2 satır bu şekilde doğdu
        // (2026-08-08 / 08-11, sapma defteri gelmeden önce). Arşiv dalındaki yorum
        // iki yolun "birebir ayna" olduğunu söylüyordu; ayna BURADA kırıktı.
        const parentRow = await tx.roll.findUnique({
          where: { id: parentId },
          select: { initialQty: true, currentQty: true },
        });
        const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
        const newCurrent = (parentRow?.currentQty ?? new Prisma.Decimal(0)).plus(len);
        const initialBump = await this.restoreBumpTx(tx, {
          parentId, childIds: [childId], newCurrent, parentInitial, workOrderStepId: child.producedInStepId, userId,
        });
        const claimed = await tx.roll.updateMany({
          where: { id: parentId, status: RollStatus.IN_PRODUCTION, currentStepId: child.producedInStepId },
          data: {
            currentQty: { increment: len },
            ...(initialBump.greaterThan(0) ? { initialQty: { increment: initialBump } } : {}),
          },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict("Kaynak top artık Tambur adımında değil — tek parça iptali yapılamadı");
        }
        restoredTo = "IN_PRODUCTION";
      } else {
        // cutWarehouseRoll: parent serbest depoda. Kesim yalnız `currentQty`
        // düşmüştü (`initialQty` üretim anı snapshot'ı, tambur.service şerhi) →
        // yalnız o geri konur; `initialQty` yalnız AŞIMDA yukarı çekilir ve fark
        // deftere yazılır — düz `+len` her geri almada girişi şişiriyordu (ölçüldü 2026-09-13: 100→140).
        const parentRow = await tx.roll.findUnique({
          where: { id: parentId },
          select: { initialQty: true, currentQty: true },
        });
        const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
        const newCurrent = (parentRow?.currentQty ?? new Prisma.Decimal(0)).plus(len);
        const initialBump = await this.restoreBumpTx(tx, {
          parentId, childIds: [childId], newCurrent, parentInitial, workOrderStepId: null, userId,
        });
        const claimed = await tx.roll.updateMany({
          where: {
            id: parentId,
            status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
            sackId: null, shipmentId: null,
          },
          data: {
            currentQty: { increment: len },
            ...(initialBump.greaterThan(0) ? { initialQty: { increment: initialBump } } : {}),
          },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict("Kaynak top artık serbest depoda değil — tek parça iptali yapılamadı");
        }
        await this.transferOverageRowsToParentTx(tx, parentId, childOverageRows, userId);
        restoredTo = "WAREHOUSE";
      }
      return { childBarcode: child.barcode, restoredLen: Number(len), restoredTo };
    });

    await AuditService.log({
      userId, action: "UPDATE", tableName: "ROLL", recordId: parentId,
      newData: {
        event: "TAMBUR_UNDO_SINGLE",
        cancelledChildId: childId, cancelledChildBarcode: result.childBarcode,
        restoredLen: result.restoredLen, restoredTo: result.restoredTo,
      },
    });
    return {
      success: true,
      data: {
        mode: "SINGLE",
        cancelledChildIds: [childId],
        // Arşiv dalında metraj kaynağa DÖNMEZ → 0 raporlanır. İstemcinin
        // "N m geri döndü" demesi için tek doğru sayı budur; `restoredLen`i
        // döndürmek ekranı yalan söyletirdi.
        restoredQty: result.restoredTo === "VARIANCE" ? 0 : result.restoredLen,
        recordedAsVariance: result.restoredTo === "VARIANCE",
        varianceQty: result.restoredTo === "VARIANCE" ? result.restoredLen : 0,
      },
      message:
        result.restoredTo === "VARIANCE"
          ? `Parça iptal edildi — ${result.restoredLen} m "kayıt düzeltmesi" olarak kayda geçti (kaynak top arşivde, metraj geri dönmez)`
          : `Parça iptal edildi — ${result.restoredLen} m kaynak topa geri döndü`,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SINGLE_RESTORE — tek parçayı iptal et, metrajını kaynak topa geri koy
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * FULL'ün dirilme makinesi, TEK topun metrajıyla — kardeşlere DOKUNULMAZ.
   *
   * FULL'den bilinçli farklar (her biri "kapanış kısmen ayakta" gerçeğinden):
   *  • Kapanışın SAPMA satırları TERSLENMEZ — kapanıştaki kalan-metraj kararı
   *    (discard/scrap) hâlâ doğrudur, yalnız bu parça geri dönüyor.
   *  • `RollError` kayıtları YENİDEN AÇILMAZ — kapanıştaki kalite kararları
   *    diğer parçalar üzerinden ayakta; yeniden finalize açık hata istemez.
   *  • TAMBUR_PROCESSED izi yine GERİ ALINIR (damga) — kaynak adıma geri döndü,
   *    iş henüz bitmedi; aktif kalsaydı üretim raporu açık işi "kapanmış" sayardı
   *    ve yeniden finalize ikinci bir iz yazıp çift sayım üretirdi.
   */
  private async applySingleRestore(
    parentId: string,
    childId: string,
    userId: string | undefined,
    /** Kilitlenecek iş emri (null = depo kesimi) — tx'in İLK işi (T1-003). */
    workOrderId: string | null,
  ): Promise<ApiResponse<unknown>> {
    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İŞİ (2026-08-29 / BULGU-T1-003) — gerekçe helper'da.
      await this.lockAndAssertWorkOrderLive(tx, workOrderId);
      // Çocuk — taze guard'lar (önizlemeden bu yana değişmiş olabilir).
      const child = await tx.roll.findUnique({
        where: { id: childId },
        select: {
          id: true, barcode: true, status: true, initialQty: true, currentQty: true,
          sackId: true, shipmentId: true, directShipmentId: true,
          currentStepId: true, producedInStepId: true, qualityGrade: true,
        },
      });
      if (!child) throw AppError.notFound("Parça bulunamadı");
      const grandchildren = await tx.roll.count({ where: { parentRollId: childId } });
      const block = childBlockReason(child, grandchildren);
      if (block) throw AppError.conflict(block);

      // Kapanışın adımı + iş emri (depo kesiminde ikisi de yok — meşru).
      const op = await tx.rollOperation.findFirst({
        where: { ...ACTIVE_OPERATION, rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
        orderBy: { createdAt: "desc" },
        select: { workOrderStepId: true },
      });
      const stepId = op?.workOrderStepId ?? null;
      let step: { id: string; workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus } } | null =
        null;
      if (stepId) {
        step = await tx.workOrderStep.findUnique({
          where: { id: stepId },
          select: { id: true, workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
        });
        if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
        if (
          step.workOrder.status === WorkOrderStatus.CANCELLED ||
          step.workOrder.status === WorkOrderStatus.SUPERSEDED
        ) {
          throw AppError.conflict("İş emri iptal/devredilmiş — iş emrine geri alınamaz");
        }
      }

      // 1) Çocuğu iptal et — atomik claim (applySingle ile aynı).
      const cancelled = await tx.roll.updateMany({
        where: {
          id: childId,
          status: { in: CHILD_CANCELABLE_STATUSES },
          sackId: null, shipmentId: null, currentStepId: null,
        },
        // ⚠️ İZ + METRAJ BİRLİKTE (2026-08-29 / BULGU-T1-011). Geri alma bu
        // parçanın metrajını KAYNAK TOPA İADE ediyor; parçada bırakmak "iptal
        // ama metrajı üstünde" bir kayıt üretiyordu ve Envanter→Arşiv'den
        // "İptali Geri Al" onu diriltince AYNI metraj iki yerde sayılıyordu
        // (sahada 50 top / 1.834,8 m diriltilmeye hazır bekliyordu).
        //   • `currentQty: 0` → dirilse bile 0 m dirilir (giriş metrajı
        //     `initialQty`de DURUYOR, arşiv "bu kesim 40 m'ydi" diyebiliyor),
        //   • `cancelReasonCode` → geri alma kaynaklı iptal SATIRIN KENDİSİNDEN
        //     tanınır; geri alma kapısı buna bakıp reddeder. Audit'e dayanmak
        //     olmazdı: 6 ayda arşivleniyor, kural sessizce açılırdı.
        data: {
          status: RollStatus.CANCELLED,
          currentQty: 0,
          cancelReasonCode: TAMBUR_UNDO_CANCEL_CODE,
          cancelReason: TAMBUR_UNDO_CANCEL_TEXT,
        },
      });
      if (cancelled.count !== 1) {
        throw AppError.conflict("Parça bu sırada başka bir akışa girdi — geri alınamadı, yenileyin");
      }

      // DEPO DEFTERİ — ÖNCE grup (ebeveyn OUT + çocuk IN), sonra çocuğun kalan
      // ileri satırları. Bu modda metraj ebeveyne DAİMA geri konur (aşağısı),
      // yani grup koşulsuz terslenir (applySingle'daki koşulun gerekçesi orada).
      const childOverageRows = await this.readChildOverageRowsTx(tx, [childId]);
      await reverseTransformGroupsOf(tx, [childId], {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });
      await reverseAllRollStockMoves(tx, [childId], {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });

      const restored = child.initialQty;
      const parentRow = await tx.roll.findUnique({
        where: { id: parentId },
        select: { preTamburCloseStatus: true, initialQty: true, currentQty: true },
      });

      // Metraj geri koyma İKİ DALDA AYNI KURAL — `applySingle`ın canlı-kaynak
      // dallarının birebir aynası: kesim her iki dalda da yalnız `currentQty`
      // düşmüştü (`initialQty` üretim anı snapshot'ı), yalnız o geri konur; geri
      // konan metraj kayıtlı girişi aşarsa `initialQty` yukarı çekilir ve fark
      // deftere yazılır (FULL invariantının tekil ikizi — imkânsız satır kalmaz).
      const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
      const newCurrent = (parentRow?.currentQty ?? new Prisma.Decimal(0)).plus(restored);
      const initialBump = await this.restoreBumpTx(tx, {
        parentId, childIds: [childId], newCurrent, parentInitial, workOrderStepId: stepId, userId,
      });

      // 2) Kaynağın hareketini yeniden aç (üretim akışı) — FULL ile aynı.
      //    Geri alınmış kapalı hareket seçilmez ve yeniden açılmaz.
      if (stepId) {
        const closedMove = await tx.rollMovement.findFirst({
          where: { ...ACTIVE_MOVEMENT, rollId: parentId, workOrderStepId: stepId, exitedAt: { not: null } },
          orderBy: { exitedAt: "desc" },
          select: { id: true },
        });
        if (closedMove) {
          await tx.rollMovement.update({
            where: { id: closedMove.id, ...ACTIVE_MOVEMENT },
            data: { exitedAt: null, qtyOut: null, weightOut: null, notes: "TAMBUR_UNDO_REOPEN" },
          });
        } else {
          await tx.rollMovement.create({
            data: { rollId: parentId, workOrderStepId: stepId, qtyIn: restored, notes: "TAMBUR_UNDO_REOPEN" },
          });
        }
      }

      // 3) Kaynağı dirilt — atomik claim; metraj YALNIZ bu çocuğunki
      //    (increment: tüketilmiş kaynakta 0'dan başlar; drift varsa da
      //    üzerine yazmak yerine eklemek `applySingle` ile aynı sözleşme).
      const revivedStatus = stepId
        ? RollStatus.IN_PRODUCTION
        : (parentRow?.preTamburCloseStatus ?? RollStatus.WAREHOUSE);
      // Diriliş STOK KÜMESİNE dönüyorsa depo damgası dirilişin parçası (claim'den
      // ÖNCE — sonra `status` değişmiş olur ve yüklem eşleşmez). `TAMBUR_CONSUMED`
      // topun deposu NULL olabilir ve damgasız hâlde "depoda ama hangi depoda belli
      // değil" olarak geri gelirdi. Damga mevcut depoyu EZMEZ.
      if (WAREHOUSE_STOCK_STATUSES.includes(revivedStatus)) {
        await warehouseStampManyTx(tx, [parentId]);
      }
      const revived = await tx.roll.updateMany({
        where: { id: parentId, status: RollStatus.TAMBUR_CONSUMED },
        data: {
          status: revivedStatus,
          currentStepId: stepId,
          currentQty: { increment: restored },
          ...(initialBump.greaterThan(0) ? { initialQty: { increment: initialBump } } : {}),
          // Kapanış-öncesi kayıt tüketildi — bir sonraki kapanış kendi
          // değerini yazacak (FULL ile aynı gerekçe).
          preTamburCloseQty: null,
          preTamburCloseStatus: null,
        },
      });
      if (revived.count !== 1) {
        throw AppError.conflict("Kaynak top bu sırada değişti — geri alma iptal edildi");
      }
      await this.transferOverageRowsToParentTx(tx, parentId, childOverageRows, userId);

      // 4) TAMBUR_PROCESSED izini geri al (gerekçe fonksiyon yorumunda).
      if (stepId) {
        await revokeRollOperations(tx, {
          rollIds: [parentId],
          workOrderStepIds: [stepId],
          operationTypes: [RollOperationType.TAMBUR_PROCESSED],
          reason: "TAMBUR_UNDO",
          userId,
        });
      }

      // 4a) PLAN-SAPMA: YALNIZ bu çocuğa bağlı imza damgalanır (2026-09-13).
      //     ⛔ `finalize` kaynaklı imza (childRollId NULL, qtyM = topun TAMAMI)
      //     DAMGALANMAZ — kardeşler iptal edilmiyor, topun geri kalanı hâlâ sapan
      //     kimlikle depoda ve o onay AYAKTA. FULL'den ayrıldığı yer burası.
      const restoreConfirmations = await findPlanDeviationConfirmationsTx(tx, {
        childRollId: childId,
      });
      await revokePlanDeviationsTx(tx, {
        confirmationIds: restoreConfirmations,
        reason: "TAMBUR_UNDO_SINGLE",
        userId,
      });

      // 5) Ebeveynin özelliği yoksa (legacy: eski finalize silmişti; ya da HİÇ yoktu)
      //    iptal edilen çocuğun DOĞUM-ANI kopyasından geri kur (FULL 6 ile aynı).
      //    Donör = çocukla aynı tx'te yazılmış satırlar (`createdAt <= çocuk.createdAt`):
      //    çocuğun depoda SONRADAN kazandığı özellik ebeveyne UYDURULMAZ (plan §3.1).
      const parentPropCount = await tx.rollProperty.count({ where: { rollId: parentId, ...ACTIVE_ROLL_PROPERTY } });
      if (parentPropCount === 0) {
        const donor = await birthPropertiesOf(tx, [childId]);
        if (donor.length > 0) {
          await tx.rollProperty.createMany({
            data: donor.map((d) => ({ rollId: parentId, propertyId: d.propertyId, valueId: d.valueId ?? null })),
            skipDuplicates: true,
          });
        }
      }

      // 6) Adım + iş emri + refakat kartı — FULL 7 ile aynı disiplin.
      let woRevivedCount = 0;
      if (stepId && step) {
        await recomputeStepStatus(tx, stepId);
        const woRevived = await tx.workOrder.updateMany({
          where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        woRevivedCount = woRevived.count;
        if (woRevived.count > 0) {
          await setWorkOrderCardStatusesTx(tx, step.workOrder.id, "COMPLETED", "ACTIVE");
        }
      }

      return {
        childBarcode: child.barcode,
        restoredQty: Number(restored),
        workOrderNumber: step?.workOrder.workOrderNumber ?? null,
        woRevived: woRevivedCount > 0,
        warehouseClosure: stepId === null,
      };
    });

    await AuditService.log({
      userId, action: "UPDATE", tableName: "ROLL", recordId: parentId,
      newData: {
        event: "TAMBUR_UNDO_RESTORE",
        cancelledChildId: childId,
        cancelledChildBarcode: result.childBarcode,
        restoredQty: result.restoredQty,
        workOrderNumber: result.workOrderNumber,
        woRevived: result.woRevived,
        warehouseClosure: result.warehouseClosure,
      },
    });
    return {
      success: true,
      data: {
        mode: "SINGLE_RESTORE",
        cancelledChildIds: [childId],
        restoredQty: result.restoredQty,
        woRevived: result.woRevived,
      },
      message: result.warehouseClosure
        ? `Parça iptal edildi — ${result.restoredQty} m kaynak topa geri kondu (top depoya döndü)`
        : `Parça iptal edildi — ${result.restoredQty} m ${result.workOrderNumber ?? "iş emrinin"} Tambur adımına geri kondu${
            result.woRevived ? " (iş emri yeniden açıldı)" : ""
          }`,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FULL — finalize'ı tümden geri al
  // ───────────────────────────────────────────────────────────────────────────

  private async applyFull(
    parentId: string,
    userId: string | undefined,
    reason: string | null,
    /** Kilitlenecek iş emri (null = depo kesimi) — tx'in İLK işi (T1-003). */
    workOrderId: string | null,
  ): Promise<ApiResponse<unknown>> {
    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İŞİ (2026-08-29 / BULGU-T1-003) — gerekçe helper'da.
      await this.lockAndAssertWorkOrderLive(tx, workOrderId);
      const op = await tx.rollOperation.findFirst({
        where: { ...ACTIVE_OPERATION, rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
        orderBy: { createdAt: "desc" },
        select: { workOrderStepId: true },
      });
      // ⚠️ `op` YOKSA ARTIK HATA DEĞİL — depo kesimi kapanışıdır (2026-08-09).
      // Eskiden burada "İşlem izi bulunamadı" ile düşülüyordu ve kaynak
      // tüketilmiş olduğu için tekil iptal de yapılamıyordu → tam ÇIKMAZ.
      // Depo kesiminin adımı YOKTUR ve olmamalıdır (uydurma step yazma);
      // metraj/statü `preTamburCloseQty`/`preTamburCloseStatus`ten gelir.
      const stepId = op?.workOrderStepId ?? null;

      let step: { id: string; workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus } } | null =
        null;
      if (stepId) {
        step = await tx.workOrderStep.findUnique({
          where: { id: stepId },
          select: { id: true, workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
        });
        if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
        if (
          step.workOrder.status === WorkOrderStatus.CANCELLED ||
          step.workOrder.status === WorkOrderStatus.SUPERSEDED
        ) {
          throw AppError.conflict("İş emri iptal/devredilmiş — geri alma yapılamaz");
        }
      }

      // Çocuklar — TAZE küme + guard'lar (önizlemeden bu yana değişmiş olabilir).
      const children = await tx.roll.findMany({
        where: { parentRollId: parentId, status: { not: RollStatus.CANCELLED } },
        select: {
          id: true, barcode: true, status: true, initialQty: true, currentQty: true,
          sackId: true, shipmentId: true, directShipmentId: true,
          currentStepId: true, producedInStepId: true, qualityGrade: true,
        },
      });
      // SIFIR ÇOCUK burada artık hata DEĞİL (F0402): tüm çocuklar tek tek
      // iptal edilmiş olabilir ve sapma defterindeki metraj hâlâ geri konur.
      // Gerçek çıkmaz kontrolü `restored` hesaplandıktan sonra aşağıda.
      const grandCounts = await tx.roll.groupBy({
        by: ["parentRollId"],
        where: { parentRollId: { in: children.map((c) => c.id) } },
        _count: { _all: true },
      });
      const grandByParent = new Map(grandCounts.map((g) => [g.parentRollId as string, g._count._all]));
      for (const c of children) {
        const block = childBlockReason(c, grandByParent.get(c.id) ?? 0);
        if (block) throw AppError.conflict(`${c.barcode ?? c.id}: ${block}`);
      }

      // 1) Çocuklar → CANCELLED (atomik; biri kaçtıysa count uyuşmaz → rollback).
      const ids = children.map((c) => c.id);
      const cancelled = await tx.roll.updateMany({
        where: {
          id: { in: ids },
          status: { in: CHILD_CANCELABLE_STATUSES },
          sackId: null, shipmentId: null, currentStepId: null,
        },
        // ⚠️ İZ + METRAJ BİRLİKTE (2026-08-29 / BULGU-T1-011). Geri alma bu
        // parçanın metrajını KAYNAK TOPA İADE ediyor; parçada bırakmak "iptal
        // ama metrajı üstünde" bir kayıt üretiyordu ve Envanter→Arşiv'den
        // "İptali Geri Al" onu diriltince AYNI metraj iki yerde sayılıyordu
        // (sahada 50 top / 1.834,8 m diriltilmeye hazır bekliyordu).
        //   • `currentQty: 0` → dirilse bile 0 m dirilir (giriş metrajı
        //     `initialQty`de DURUYOR, arşiv "bu kesim 40 m'ydi" diyebiliyor),
        //   • `cancelReasonCode` → geri alma kaynaklı iptal SATIRIN KENDİSİNDEN
        //     tanınır; geri alma kapısı buna bakıp reddeder. Audit'e dayanmak
        //     olmazdı: 6 ayda arşivleniyor, kural sessizce açılırdı.
        data: {
          status: RollStatus.CANCELLED,
          currentQty: 0,
          cancelReasonCode: TAMBUR_UNDO_CANCEL_CODE,
          cancelReason: TAMBUR_UNDO_CANCEL_TEXT,
        },
      });
      if (cancelled.count !== ids.length) {
        throw AppError.conflict("Parçalardan biri bu sırada başka akışa girdi — geri alma iptal edildi, yenileyin");
      }

      // DEPO DEFTERİ — TÜM çocukların giriş satırları terslenir. FULL'de öksüz
      // satır sayısı çocuk sayısı kadar olurdu (2026-08-09 vakasında 14 top).
      // ⚠️ ÖNCE GRUP: her depo-kesimi çocuğu kendi TRANSFORM grubunu getirir;
      // ebeveyn kapanış öncesine DÖNDÜĞÜ için her OUT'u da terslenir. Kapanışın
      // kendi çıkışı (CUT_DISCARD / SCRAP, grupsuz) BURADA TERSLENMEZ — açık borç,
      // hükmü sahibinde (defter-beyan §13).
      const childOverageRows = await this.readChildOverageRowsTx(tx, ids);
      await reverseTransformGroupsOf(tx, ids, {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });
      await reverseAllRollStockMoves(tx, ids, {
        reasonCode: STOCK_MOVE_REASON.TAMBUR_UNDO,
        userId: userId ?? null,
        notes: TAMBUR_UNDO_CANCEL_TEXT,
      });

      // ── METRAJ GERİ KOYMA ────────────────────────────────────────────────
      // Formül + gerekçe `computeRestoredQty`'de (TEK KAYNAK — önizleme de onu
      // çağırır; ayrı yazmak diyalogla kodu ayrıştırıyordu, bkz. o fonksiyon).
      const parentRow = await tx.roll.findUnique({
        where: { id: parentId },
        select: { preTamburCloseQty: true, preTamburCloseStatus: true, initialQty: true },
      });
      const restored = await this.computeRestoredQty(tx, parentId, children);
      if (children.length === 0 && restored.lte(0)) {
        throw AppError.conflict("İptal edilebilir parça kalmamış");
      }

      // ⚠️ `currentQty <= initialQty` İNVARİANTI — saha vakasının somut hasarı.
      // Aşımlı kesimde geri konan toplam, kayıtlı giriş metrajını geçebilir
      // (operatör 500 m kayıtlı topu 545 m ölçtü ve Tambur ASIL ÖLÇÜM
      // NOKTASIDIR). Bu durumda `initialQty` YUKARI çekilir ve fark AŞIM olarak
      // deftere yazılır — sessizce imkânsız bir satır bırakmak yerine sapmayı
      // KAYDA GEÇİRMEK doğru cevaptır (2026-08-09 kullanıcı kararı: "aşım da
      // sapma olarak kayda geçsin").
      const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
      const initialBump = await this.restoreBumpTx(tx, {
        parentId, childIds: ids, newCurrent: restored, parentInitial, workOrderStepId: stepId, userId,
        source: VARIANCE_SOURCES.TAMBUR_UNDO_FULL,
      });

      // 2) Parent movement'ı yeniden aç (finalize kapatmıştı). Yoksa taze aç.
      //    Depo kesiminde adım YOK → hareket de yok; bu blok atlanır.
      //    Geri alınmış kapalı hareket seçilmez ve yeniden açılmaz.
      if (stepId) {
        const closedMove = await tx.rollMovement.findFirst({
          where: { ...ACTIVE_MOVEMENT, rollId: parentId, workOrderStepId: stepId, exitedAt: { not: null } },
          orderBy: { exitedAt: "desc" },
          select: { id: true },
        });
        if (closedMove) {
          await tx.rollMovement.update({
            where: { id: closedMove.id, ...ACTIVE_MOVEMENT },
            data: { exitedAt: null, qtyOut: null, weightOut: null, notes: "TAMBUR_UNDO_REOPEN" },
          });
        } else {
          await tx.rollMovement.create({
            data: { rollId: parentId, workOrderStepId: stepId, qtyIn: restored, notes: "TAMBUR_UNDO_REOPEN" },
          });
        }
      }

      // 3) Parent'ı dirilt — atomik claim (TAMBUR_CONSUMED değilse yarış → 409).
      //    STATÜ: üretim akışında IN_PRODUCTION (adıma geri konur); depo
      //    kesiminde kapanış öncesi RAF (`preTamburCloseStatus`). ⚠️ Renkten
      //    TÜRETİLEMEZ — renksiz ama WAREHOUSE'a inmiş top yanlış rafa yazılırdı.
      //    Kolon NULL ise (eski kayıt) WAREHOUSE varsayılır: depo kesiminin
      //    kaynağı tanım gereği WAREHOUSE ya da ham STOCK'tur ve çoğunluk odur.
      const revivedStatus = stepId
        ? RollStatus.IN_PRODUCTION
        : (parentRow?.preTamburCloseStatus ?? RollStatus.WAREHOUSE);
      // Diriliş STOK KÜMESİNE dönüyorsa depo damgası dirilişin parçası (claim'den
      // ÖNCE — sonra `status` değişmiş olur ve yüklem eşleşmez). `TAMBUR_CONSUMED`
      // topun deposu NULL olabilir ve damgasız hâlde "depoda ama hangi depoda belli
      // değil" olarak geri gelirdi. Damga mevcut depoyu EZMEZ.
      if (WAREHOUSE_STOCK_STATUSES.includes(revivedStatus)) {
        await warehouseStampManyTx(tx, [parentId]);
      }
      const revived = await tx.roll.updateMany({
        where: { id: parentId, status: RollStatus.TAMBUR_CONSUMED },
        data: {
          status: revivedStatus,
          currentStepId: stepId,
          currentQty: restored,
          // Aşımda giriş metrajı da yukarı çekilir → `currentQty <= initialQty`
          // invariantı korunur (yukarıdaki nota bak). Aşım yoksa 0 eklenir,
          // yani dokunulmamış olur.
          ...(initialBump.greaterThan(0) ? { initialQty: { increment: initialBump } } : {}),
          // Kapanış-öncesi kayıt TÜKETİLDİ — bayat değer kalmasın (bir sonraki
          // kapanış kendi değerini yazacak).
          preTamburCloseQty: null,
          preTamburCloseStatus: null,
        },
      });
      if (revived.count !== 1) {
        throw AppError.conflict("Kaynak top bu sırada değişti — geri alma iptal edildi");
      }
      await this.transferOverageRowsToParentTx(tx, parentId, childOverageRows, userId);

      // 4) Bu finalize'ın kapattığı hata kayıtlarını yeniden aç (adım varsa).
      const reopened = stepId
        ? await tx.rollError.updateMany({
            where: { rollId: parentId, isProcessed: true, processedAtStepId: stepId },
            data: { isProcessed: false, actionTaken: null, processedAtStepId: null, processedByUserId: null, processedAt: null },
          })
        : { count: 0 };

      // 5) TAMBUR_PROCESSED izini geri al (damga) — finalize yeniden yapılabilir:
      //    upsert ve rapor yalnız aktif ize bakar. Terslemenin kalıcı izi bu damga,
      //    aşağıdaki sapma işareti ve audit TAMBUR_UNDO_FULL.
      if (stepId) {
        await revokeRollOperations(tx, {
          rollIds: [parentId],
          workOrderStepIds: [stepId],
          operationTypes: [RollOperationType.TAMBUR_PROCESSED],
          reason: "TAMBUR_UNDO",
          userId,
        });
        // 5a) PLAN-SAPMA İMZASINI GERİ AL (2026-09-13). Kapı geçişinin TAMAMI geri
        //     alınıyor ⇒ plan-dışı kimliğin depoya inmesine izin veren onay artık
        //     geçersiz. Damgalanmazsa karne o kapanışı saymaya devam eder ve
        //     yeniden finalize edilen top İKİ tam imza + İKİ tam metraj üretir
        //     (`finalize` kaynağında `qtyM` topun TAMAMIdır).
        //     ⚠️ `revokedAt: null` yüklemi undo→yeniden-finalize→undo döngüsünü
        //     KENDİLİĞİNDEN çözer: eski imzalar zaten damgalı, kümeye girmez.
        const fullConfirmations = await findPlanDeviationConfirmationsTx(tx, {
          rollId: parentId,
          workOrderStepId: stepId,
        });
        await revokePlanDeviationsTx(tx, {
          confirmationIds: fullConfirmations,
          reason: "TAMBUR_UNDO",
          userId,
        });
      }

      // 5b) SAPMA DEFTERİNİ TERSLE (2026-08-09). Bu kapanışta yazılan fire /
      //     kayıt düzeltmesi satırları artık geçersizdir. SİLİNMEZ — append-only
      //     defterde satır silmek geçmişi değiştirmek olurdu; işaretlenir.
      //     İşaretlenmeseydi defterde HAYALET FİRE kalırdı: iptal edilmiş bir
      //     işin firesi raporda sonsuza dek görünürdü.
      //     ⚠️ Aşım (OVERAGE) satırları KAPSAM DIŞI: onlar kesim anında doğdu ve
      //     kesimler gerçekten yapıldı; kapanışın terslenmesi onları geçersiz
      //     kılmaz. Süzgeç bu yüzden `source` üzerinden dar tutulur.
      //     ⚠️ AYNI KARARIN İKİ DEFTERİ BİRLİKTE DÖNER (hüküm ① b1, 2026-09-13):
      //     kapanış sapması `rollVarianceId` ile stok defterine bağlı bir ÇIKIŞ
      //     yazmıştı (`CUT_DISCARD` / `SCRAP`); damga tek başına o çıkışı defterde
      //     yetim bırakıyordu (100 ↔ 60 / 100 ↔ 0, ölçüldü). Damgalanan sapmalar
      //     ÖNCE okunur, sonra bağlı satırları bağ üzerinden terslenir — sebep
      //     koduna bakılmaz, bağ karar verir.
      const closingVariances = await tx.rollVariance.findMany({
        where: {
          rollId: parentId,
          reversedAt: null,
          source: { in: [VARIANCE_SOURCES.TAMBUR_FINALIZE, VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE] },
        },
        select: { id: true },
      });
      const reversedVariances = await tx.rollVariance.updateMany({
        where: { id: { in: closingVariances.map((v) => v.id) }, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });
      await this.reverseVarianceBoundStockMovesTx(tx, closingVariances.map((v) => v.id), userId);
      // ÇOCUK-KAPSAMLI tekil-iptal düzeltmeleri de terslenir (2026-08-12) —
      // `computeRestoredQty` o metrajı geri saydı; satır canlı kalsaydı dönem
      // raporu aynı metrajı hem stokta hem sapmada görürdü (senkron sözleşmesi:
      // restore-toplamına giren HER kaynak burada da terslenir).
      //     ⚠️ SÖZLEŞMENİN DEFTER AYAĞI (hüküm ① b2, S9): arşiv-SINGLE ile ölmüş
      //     çocuk `status ≠ CANCELLED` kümesine girmediği için yukarıdaki grup
      //     terslemesi onu görmüyordu; ebeveynin CUT_SPLIT çıkışı yetim kalıyordu
      //     (100 ↔ 0). Damgalanan sapmanın `rollId`si = ölü çocuk ⇒ onun grubu da.
      const deadChildVariances = await tx.rollVariance.findMany({
        where: {
          reversedAt: null,
          kind: RollVarianceKind.RECORD_CORRECTION,
          source: VARIANCE_SOURCES.TAMBUR_UNDO_SINGLE,
          roll: { parentRollId: parentId },
        },
        select: { id: true, rollId: true },
      });
      const reversedChildVariances = await tx.rollVariance.updateMany({
        where: { id: { in: deadChildVariances.map((v) => v.id) }, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });
      const deadChildIds = [...new Set(deadChildVariances.map((v) => v.rollId))];
      await this.reverseDeadChildGroupsTx(tx, deadChildIds, userId);

      // 6) Ebeveynin özelliği yoksa çocuğun DOĞUM-ANI kopyasından geri kur (plan §3.1):
      //    donör yalnız çocukla aynı tx'te yazılmış satırlar (`createdAt <= çocuk.createdAt`);
      //    (a) donör çocuk DETERMİNİSTİK (en erken doğan); (b) canlı çocuk kalmadıysa
      //    (F0402: hepsi tek tek iptal edilmiş) iptal edilmiş çocuklar da donör olabilir —
      //    doğum-anı satırı ölü çocukta da durur; (c) `propsRestored === 0` sessiz geçmez
      //    (audit + yanıt), "ebeveyn hiç özellik taşımıyordu" ile "donör bulunamadı" ayrışsın.
      const parentPropCount = await tx.rollProperty.count({ where: { rollId: parentId, ...ACTIVE_ROLL_PROPERTY } });
      let propsRestored = 0;
      let propsDonorMissing = false;
      if (parentPropCount === 0) {
        let donorIds = ids;
        if (donorIds.length === 0) {
          const deadChildren = await tx.roll.findMany({
            where: { parentRollId: parentId },
            select: { id: true },
          });
          donorIds = deadChildren.map((c) => c.id);
        }
        const donor = await birthPropertiesOf(tx, donorIds);
        if (donor.length > 0) {
          const donorId = donor[0].rollId;
          const donorRows = new Map(
            donor.filter((d) => d.rollId === donorId).map((d) => [d.propertyId, d.valueId ?? null]),
          );
          await tx.rollProperty.createMany({
            data: [...donorRows].map(([propertyId, valueId]) => ({
              rollId: parentId,
              propertyId,
              valueId,
            })),
            skipDuplicates: true,
          });
          propsRestored = donorRows.size;
        } else {
          propsDonorMissing = true;
        }
      }

      // 7) Adım + WO + refakat kartı — manualMove diriltme disipliniyle.
      //    Depo kesiminde iş emri YOK → bu blok tamamen atlanır.
      let woRevivedCount = 0;
      if (stepId && step) {
        await recomputeStepStatus(tx, stepId);
        const woRevived = await tx.workOrder.updateMany({
          where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        woRevivedCount = woRevived.count;
        if (woRevived.count > 0) {
          await setWorkOrderCardStatusesTx(tx, step.workOrder.id, "COMPLETED", "ACTIVE");
        }
      }

      return {
        stepId,
        workOrderId: step?.workOrder.id ?? null,
        workOrderNumber: step?.workOrder.workOrderNumber ?? null,
        cancelledChildIds: ids,
        cancelledBarcodes: children.map((c) => c.barcode).filter(Boolean),
        restoredQty: Number(restored),
        reopenedErrors: reopened.count,
        woRevived: woRevivedCount > 0,
        propsRestored,
        propsDonorMissing,
        reversedVariances: reversedVariances.count + reversedChildVariances.count,
        warehouseClosure: stepId === null,
      };
    });

    await AuditService.log({
      userId, action: "UPDATE", tableName: "ROLL", recordId: parentId,
      newData: {
        event: "TAMBUR_UNDO_FULL",
        cancelledChildIds: result.cancelledChildIds,
        restoredQty: result.restoredQty,
        reopenedErrors: result.reopenedErrors,
        workOrderId: result.workOrderId,
        woRevived: result.woRevived,
        propsRestored: result.propsRestored,
        // Donörsüz sıfır: ebeveyn özelliksiz KALDI — "hiç yoktu" ile "geri gelmedi" ayrımı
        // burada; sessiz geçseydi kayıp kayıtsız kalırdı (plan Y4-c).
        propsDonorMissing: result.propsDonorMissing,
        reversedVariances: result.reversedVariances,
        warehouseClosure: result.warehouseClosure,
        // SEBEP audit'e yazılır: bu, iş emrinin geçmişini yeniden yazan bir
        // işlemdir ve "neden" sorusunun cevabı kayıtta durmalı.
        reason: reason ?? null,
      },
    });
    return {
      success: true,
      data: {
        mode: "FULL",
        cancelledChildIds: result.cancelledChildIds,
        restoredQty: result.restoredQty,
        reopenedErrors: result.reopenedErrors,
        woRevived: result.woRevived,
        reversedVariances: result.reversedVariances,
        // Özellik geri kurulumu: kaç satır donörden geldi; donörsüz sıfır AYRICA
        // bayraklı (ebeveyn özelliksiz kaldı — sessiz geçmez, plan Y4-c). Eklemeli alan.
        propsRestored: result.propsRestored,
        propsDonorMissing: result.propsDonorMissing,
      },
      message:
        `İşlem geri alındı — ` +
        (result.cancelledChildIds.length > 0
          ? `${result.cancelledChildIds.length} parça iptal, `
          : "") +
        (result.warehouseClosure
          ? `${result.restoredQty} m kaynak topa geri döndü (depo kesimi)`
          : `${result.restoredQty} m ${result.workOrderNumber} Tambur adımına döndü`) +
        (result.woRevived ? " (iş emri yeniden açıldı)" : ""),
    };
  }
}
