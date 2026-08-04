// =============================================================================
// TeksERP - Tambur GERİ AL (undo) Servisi
// =============================================================================
// Tambur'un iki işlem ailesini operatör-seviyesinde geri alır (2026-07-31,
// "tambura iptal mekanizmaları" talebi):
//
//   SINGLE — kesim serisi sürerken TEK yanlış parçayı iptal: çocuk CANCELLED,
//            metraj parent'a geri döner (depo-kesim çocuğunda initialQty de —
//            cutWarehouseRoll ikisini birden düşer). Parent yaşıyor olmalı.
//   FULL   — finalize'ı TÜMDEN geri al ("yanlışlıkla tüm top envantere gitti"):
//            TÜM çocuklar CANCELLED, parent TAMBUR_CONSUMED → IN_PRODUCTION
//            (Tambur adımına), movement yeniden açılır, bu finalize'ın kapattığı
//            RollError'lar yeniden açılır, TAMBUR_PROCESSED izi silinir (finalize
//            yeniden yapılabilir), COMPLETED WO + refakat kartı diriltilir
//            (manualMove'un geri-taşıma disipliniyle aynı).
//
// Kapsam SINIRLARI (v1, bilinçli):
//   • Depo-kesim KAPANIŞI (finalizeWarehouseCut) geri alınamaz — kalıcı
//     TAMBUR_PROCESSED izi yazmıyor, metraj güvenilir türetilemiyor; discard
//     varyantında mal fiziksel fire. Çözüm yolu: "Düzelt" ile metraj düzeltme.
//   • Kısmi FULL yok (bazı çocuklar kalsın) — metraj muhasebesini bozar;
//     ya hepsi ya hiçbiri.
//
// Yıkıcı-işlem kuralı: apply'dan önce preview zorunlu akış — preview etkilenen
// HER kaydı somut listeler; apply tx-içi TAZE guard'larla (atomik claim) korunur.
// =============================================================================

import { Prisma, RollStatus, RollOperationType, RollEntrySource, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { recomputeStepStatus } from "./helpers/roll-step.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
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
 * SINGLE = tek kesim parçası · FULL = finalize tümden · MANUAL = elle eklenen
 * topun kaydını geri alma (2026-08-04).
 *
 * MANUAL neden BU serviste: operatörün elindeki buton zaten burada ("Son Çıkan
 * Toplar" satırındaki Geri Al) ve o buton elle eklenen topta da GÖRÜNÜYORDU —
 * yalnız backend 400 veriyordu ("Bu top bir Tambur kesim/finalize işleminin
 * parçası değil"). Yani operatör "Geri Al" yazan modalda çıkmaza giriyordu.
 * Ayrı bir uç/ekran açmak yerine var olan yüzey doğru cevabı verir hâle
 * getirildi; yeni izin kodu da doğmadı (2026-08-01 kurşun bypass dersi).
 */
type UndoMode = "SINGLE" | "FULL" | "MANUAL";

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

export class TamburUndoService {
  /**
   * Geri alma önizlemesi — HİÇBİR ŞEY YAZMAZ. rollId çocuk da olabilir parent da:
   * mod sunucuda çözülür. canApply=false ise blockReason'lar somut listelenir.
   */
  async getUndoPreview(rollId: string): Promise<ApiResponse<unknown>> {
    const ctx = await this.resolveContext(rollId);
    return { success: true, data: ctx };
  }

  /** Geri almayı uygular. Önizlemedeki mod tx içinde TAZE yeniden çözülür. */
  async applyUndo(rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const ctx = await this.resolveContext(rollId);
    if (!ctx.canApply) {
      throw AppError.conflict(ctx.blockReason ?? "Bu işlem geri alınamaz");
    }
    if (ctx.mode === "MANUAL") return this.applyManual(ctx.parentId, userId);
    if (ctx.mode === "SINGLE") return this.applySingle(ctx.parentId, ctx.children[0].id, userId);
    return this.applyFull(ctx.parentId, userId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bağlam çözümü (preview + apply ortak)
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveContext(rollId: string): Promise<{
    mode: UndoMode;
    canApply: boolean;
    blockReason: string | null;
    parentId: string;
    parent: { id: string; barcode: string | null; status: RollStatus; currentQty: number; initialQty: number };
    restoredQty: number;
    children: Array<{ id: string; barcode: string | null; status: RollStatus; qty: number; blockReason: string | null }>;
    reopenErrorCount: number;
    workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus; willRevive: boolean } | null;
    warnings: string[];
  }> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, parentRollId: true, status: true, entrySource: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Mod: dokunulan top TAMBUR_CONSUMED ise kendisi parent'tır (FULL);
    // bir kesim çocuğuysa parent'ın durumuna bakılır.
    let parentId: string;
    let mode: UndoMode;
    if (roll.status === RollStatus.TAMBUR_CONSUMED) {
      parentId = roll.id;
      mode = "FULL";
    } else if (roll.parentRollId) {
      const parent = await prisma.roll.findUnique({
        where: { id: roll.parentRollId },
        select: { id: true, status: true },
      });
      if (!parent) throw AppError.notFound("Kaynak top bulunamadı");
      parentId = parent.id;
      mode = parent.status === RollStatus.TAMBUR_CONSUMED ? "FULL" : "SINGLE";
    } else if (roll.entrySource === RollEntrySource.TAMBUR_MANUAL) {
      // ELLE EKLENEN TOP — kesim soyağacı yok, olamaz da. Geri alma burada
      // "kaydı yok say" demektir, "kesimi geri al" değil.
      return this.resolveManualContext(rollId);
    } else {
      throw AppError.badRequest("Bu top bir Tambur kesim/finalize işleminin parçası değil");
    }

    const parent = await prisma.roll.findUnique({
      where: { id: parentId },
      select: {
        id: true, barcode: true, status: true, currentQty: true, initialQty: true,
        currentStepId: true, sackId: true, shipmentId: true, batchId: true,
      },
    });
    if (!parent) throw AppError.notFound("Kaynak top bulunamadı");

    const warnings: string[] = [];
    let blockReason: string | null = null;

    if (mode === "SINGLE") {
      // Tek parça iptali: yalnız dokunulan çocuk.
      const child = await this.loadChild(rollId);
      if (child.status === RollStatus.CANCELLED) {
        blockReason = "Bu parça zaten iptal edilmiş";
      }
      const grandchildren = await prisma.roll.count({ where: { parentRollId: child.id } });
      const childBlock = blockReason ?? childBlockReason(child, grandchildren);
      // Parent tarafı: cutOpenFabric çocuğu (producedInStepId dolu) parent'ı
      // Tambur adımında IN_PRODUCTION ister; depo-kesim çocuğu (null) parent'ı
      // serbest WAREHOUSE/ham STOCK'ta ister.
      let parentBlock: string | null = null;
      if (child.producedInStepId != null) {
        if (parent.status !== RollStatus.IN_PRODUCTION || parent.currentStepId !== child.producedInStepId) {
          parentBlock = "Kaynak top artık kesimin yapıldığı Tambur adımında değil — tek parça iptali yapılamaz";
        }
      } else {
        if (parent.status !== RollStatus.WAREHOUSE && parent.status !== RollStatus.STOCK) {
          parentBlock = `Kaynak top serbest depoda değil (${parent.status}) — tek parça iptali yapılamaz`;
        } else if (parent.sackId || parent.shipmentId) {
          parentBlock = "Kaynak top çuvalda/sevkiyatta — önce oradan çıkarın";
        }
      }
      const finalBlock = childBlock ?? parentBlock;
      if (child.barcode) warnings.push(`Basılmış ${child.barcode} etiketi varsa imha edilmeli`);
      return {
        mode, parentId,
        canApply: finalBlock == null,
        blockReason: finalBlock,
        parent: this.parentView(parent),
        restoredQty: Number(child.initialQty),
        children: [{ id: child.id, barcode: child.barcode, status: child.status, qty: Number(child.initialQty), blockReason: finalBlock === parentBlock ? null : childBlock }],
        reopenErrorCount: 0,
        workOrder: null,
        warnings,
      };
    }

    // FULL: parent TAMBUR_CONSUMED — üretim-akışı finalize'ı mı? (TAMBUR_PROCESSED izi şart)
    const op = await prisma.rollOperation.findFirst({
      where: { rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
      orderBy: { createdAt: "desc" },
      select: { workOrderStepId: true },
    });
    if (!op) {
      // Depo-kesim kapanışı (finalizeWarehouseCut) — v1 kapsam dışı, gerekçeli.
      return {
        mode, parentId,
        canApply: false,
        blockReason:
          "Bu, depo kesimi kapanışı — güvenle geri alınamaz (kalıcı işlem izi yok, fire verilmiş metraj geri gelmez). " +
          "Yanlışlık metrajdaysa 'Düzelt' ile düzeltin; parçalar yanlışsa süpervizöre başvurun.",
        parent: this.parentView(parent),
        restoredQty: 0, children: [], reopenErrorCount: 0, workOrder: null, warnings,
      };
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: op.workOrderStepId },
      select: {
        id: true,
        workOrder: { select: { id: true, workOrderNumber: true, status: true } },
      },
    });
    if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
    const wo = step.workOrder;
    if (wo.status === WorkOrderStatus.CANCELLED || wo.status === WorkOrderStatus.SUPERSEDED) {
      // manualMove disipliniyle aynı: iptal/devredilmiş WO'ya top diriltmek
      // "canlı ama okutulamayan" çıkmazı üretir.
      return {
        mode, parentId, canApply: false,
        blockReason: `İş emri ${wo.status === WorkOrderStatus.CANCELLED ? "iptal edilmiş" : "devredilmiş"} — geri alma yapılamaz`,
        parent: this.parentView(parent),
        restoredQty: 0, children: [], reopenErrorCount: 0,
        workOrder: { id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status, willRevive: false },
        warnings,
      };
    }

    const childRows = await prisma.roll.findMany({
      where: { parentRollId: parentId, status: { not: RollStatus.CANCELLED } },
      select: {
        id: true, barcode: true, status: true, initialQty: true, currentQty: true,
        sackId: true, shipmentId: true, directShipmentId: true,
        currentStepId: true, producedInStepId: true, qualityGrade: true,
      },
    });
    if (childRows.length === 0) {
      return {
        mode, parentId, canApply: false,
        blockReason: "Bu işlemin iptal edilebilir çocuğu kalmamış",
        parent: this.parentView(parent),
        restoredQty: 0, children: [], reopenErrorCount: 0,
        workOrder: { id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status, willRevive: false },
        warnings,
      };
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
    const restored = childRows.reduce((acc, c) => acc.plus(c.initialQty), new Prisma.Decimal(0));
    const reopenErrorCount = await prisma.rollError.count({
      where: { rollId: parentId, isProcessed: true, processedAtStepId: op.workOrderStepId },
    });

    if (children.some((c) => c.barcode)) {
      warnings.push("İptal edilen parçaların basılmış etiketleri imha edilmeli");
    }
    if (wo.status === WorkOrderStatus.COMPLETED) {
      warnings.push("Tamamlanmış iş emri yeniden AÇILACAK (refakat kartı tekrar aktif olur)");
    }

    return {
      mode, parentId,
      canApply: blocked.length === 0,
      blockReason: blocked.length
        ? `Geri alınamaz — ${blocked.length} parça engelli (ör. ${blocked[0].barcode ?? blocked[0].id}: ${blocked[0].blockReason})`
        : null,
      parent: this.parentView(parent),
      restoredQty: Number(restored),
      children,
      reopenErrorCount,
      workOrder: {
        id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status,
        willRevive: wo.status === WorkOrderStatus.COMPLETED,
      },
      warnings,
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
        prisma.rollOperation.count({ where: { rollId } }),
        prisma.rollMovement.count({ where: { rollId } }),
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
  private async applySingle(parentId: string, childId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const result = await prisma.$transaction(async (tx) => {
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
        data: { status: RollStatus.CANCELLED },
      });
      if (cancelled.count !== 1) {
        throw AppError.conflict("Parça bu sırada başka bir akışa girdi — geri alınamadı, yenileyin");
      }

      const len = child.initialQty;
      let restoredTo: string;
      if (child.producedInStepId != null) {
        // cutOpenFabric: parent Tambur adımında IN_PRODUCTION olmalı; yalnız currentQty geri.
        const claimed = await tx.roll.updateMany({
          where: { id: parentId, status: RollStatus.IN_PRODUCTION, currentStepId: child.producedInStepId },
          data: { currentQty: { increment: len } },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict("Kaynak top artık Tambur adımında değil — tek parça iptali yapılamadı");
        }
        restoredTo = "IN_PRODUCTION";
      } else {
        // cutWarehouseRoll: parent serbest depoda; currentQty VE initialQty geri
        // (kesim ikisini birden düşmüştü).
        const claimed = await tx.roll.updateMany({
          where: {
            id: parentId,
            status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
            sackId: null, shipmentId: null,
          },
          data: { currentQty: { increment: len }, initialQty: { increment: len } },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict("Kaynak top artık serbest depoda değil — tek parça iptali yapılamadı");
        }
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
      data: { mode: "SINGLE", cancelledChildIds: [childId], restoredQty: result.restoredLen },
      message: `Parça iptal edildi — ${result.restoredLen} m kaynak topa geri döndü`,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FULL — finalize'ı tümden geri al
  // ───────────────────────────────────────────────────────────────────────────

  private async applyFull(parentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const result = await prisma.$transaction(async (tx) => {
      const op = await tx.rollOperation.findFirst({
        where: { rollId: parentId, operationType: RollOperationType.TAMBUR_PROCESSED },
        orderBy: { createdAt: "desc" },
        select: { workOrderStepId: true },
      });
      if (!op) throw AppError.conflict("İşlem izi bulunamadı — geri alınamaz");
      const stepId = op.workOrderStepId;

      const step = await tx.workOrderStep.findUnique({
        where: { id: stepId },
        select: { id: true, workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
      });
      if (!step) throw AppError.notFound("Tambur adımı bulunamadı");
      if (step.workOrder.status === WorkOrderStatus.CANCELLED || step.workOrder.status === WorkOrderStatus.SUPERSEDED) {
        throw AppError.conflict("İş emri iptal/devredilmiş — geri alma yapılamaz");
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
      if (children.length === 0) throw AppError.conflict("İptal edilebilir parça kalmamış");
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
        data: { status: RollStatus.CANCELLED },
      });
      if (cancelled.count !== ids.length) {
        throw AppError.conflict("Parçalardan biri bu sırada başka akışa girdi — geri alma iptal edildi, yenileyin");
      }

      const restored = children.reduce((acc, c) => acc.plus(c.initialQty), new Prisma.Decimal(0));

      // 2) Parent movement'ı yeniden aç (finalize kapatmıştı). Yoksa taze aç.
      const closedMove = await tx.rollMovement.findFirst({
        where: { rollId: parentId, workOrderStepId: stepId, exitedAt: { not: null } },
        orderBy: { exitedAt: "desc" },
        select: { id: true },
      });
      if (closedMove) {
        await tx.rollMovement.update({
          where: { id: closedMove.id },
          data: { exitedAt: null, qtyOut: null, weightOut: null, notes: "TAMBUR_UNDO_REOPEN" },
        });
      } else {
        await tx.rollMovement.create({
          data: { rollId: parentId, workOrderStepId: stepId, qtyIn: restored, notes: "TAMBUR_UNDO_REOPEN" },
        });
      }

      // 3) Parent'ı dirilt — atomik claim (TAMBUR_CONSUMED değilse yarış → 409).
      const revived = await tx.roll.updateMany({
        where: { id: parentId, status: RollStatus.TAMBUR_CONSUMED },
        data: { status: RollStatus.IN_PRODUCTION, currentStepId: stepId, currentQty: restored },
      });
      if (revived.count !== 1) {
        throw AppError.conflict("Kaynak top bu sırada değişti — geri alma iptal edildi");
      }

      // 4) Bu finalize'ın kapattığı hata kayıtlarını yeniden aç.
      const reopened = await tx.rollError.updateMany({
        where: { rollId: parentId, isProcessed: true, processedAtStepId: stepId },
        data: { isProcessed: false, actionTaken: null, processedAtStepId: null, processedByUserId: null, processedAt: null },
      });

      // 5) TAMBUR_PROCESSED izini sil — finalize yeniden yapılabilir (idempotency sıfırlanır).
      await tx.rollOperation.deleteMany({
        where: { rollId: parentId, workOrderStepId: stepId, operationType: RollOperationType.TAMBUR_PROCESSED },
      });

      // 6) finalize parent'ın property'lerini SİLMİŞTİ — çocuk kopyasından geri kur.
      const parentPropCount = await tx.rollProperty.count({ where: { rollId: parentId } });
      let propsRestored = 0;
      if (parentPropCount === 0) {
        const donor = await tx.rollProperty.findMany({
          where: { rollId: { in: ids } },
          select: { rollId: true, propertyId: true },
        });
        if (donor.length > 0) {
          const donorId = donor[0].rollId;
          const propertyIds = [...new Set(donor.filter((d) => d.rollId === donorId).map((d) => d.propertyId))];
          await tx.rollProperty.createMany({
            data: propertyIds.map((propertyId) => ({ rollId: parentId, propertyId })),
            skipDuplicates: true,
          });
          propsRestored = propertyIds.length;
        }
      }

      // 7) Adım + WO + refakat kartı — manualMove diriltme disipliniyle.
      await recomputeStepStatus(tx, stepId);
      const woRevived = await tx.workOrder.updateMany({
        where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED },
        data: { status: WorkOrderStatus.IN_PROGRESS },
      });
      if (woRevived.count > 0) {
        await setWorkOrderCardStatuses(tx, step.workOrder.id, "COMPLETED", "ACTIVE");
      }

      return {
        stepId,
        workOrderId: step.workOrder.id,
        workOrderNumber: step.workOrder.workOrderNumber,
        cancelledChildIds: ids,
        cancelledBarcodes: children.map((c) => c.barcode).filter(Boolean),
        restoredQty: Number(restored),
        reopenedErrors: reopened.count,
        woRevived: woRevived.count > 0,
        propsRestored,
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
      },
      message:
        `İşlem geri alındı — ${result.cancelledChildIds.length} parça iptal, ` +
        `${result.restoredQty} m ${result.workOrderNumber} Tambur adımına döndü` +
        (result.woRevived ? " (iş emri yeniden açıldı)" : ""),
    };
  }
}
