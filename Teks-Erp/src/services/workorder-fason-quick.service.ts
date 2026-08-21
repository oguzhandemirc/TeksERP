// =============================================================================
// FASON HIZLI KABUL — iş emrini kapatmanın önündeki tek fiziksel engel (2026-08-17)
// =============================================================================
// Saha şikâyeti: iş emri manuel kapatılamıyor çünkü "toplar fasonda". Doğru
// cevap "önce fason kabul yapın" ama o akış ayrı bir ekranda, çok adımlı ve
// operatör orada kayboluyor. Bu servis aynı işi KAPATMA EKRANINDAN, iki
// seçenekle ve tek gönderimle yaptırır.
//
// İKİ SEÇENEK — ikisi de gerçek saha davranışı:
//   ONE_TO_ONE → giden top sayısı kadar top geri gelir (klasik dönüş).
//   MERGE      → toplar DİKİLEREK tek top hâlinde gelir; 10 top = 1 top,
//                metrajlar TOPLANIR. Boyahane pratiğinde çok yaygın.
//
// ⚠️ MOTOR YENİDEN YAZILMADI. Kabul, mevcut ve test edilmiş
// `SubcontractorService.receive` ile yapılır — makbuz, doğan toplar, hareket
// kayıtları, renk/en uygulaması hep orada. Burası yalnız "hangi sevk, hangi
// toplar, kaç parça" sorusunu cevaplayıp o motora devreder. İkinci bir fason
// muhasebesi açmak, zamanla ayrışacak iki gerçek üretirdi.
// =============================================================================

import { RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { SubcontractorService } from "./subcontractor.service";
import { OPEN_OUTSTANDING, OUTSTANDING_ITEM } from "./helpers/fason-open-dispatch.helper";

/** Kabul edilecek bir sevk grubu — adım + firma + o sevkteki toplar. */
export interface FasonQuickGroup {
  dispatchId: string;
  dispatchNo: string;
  stepId: string;
  stationName: string;
  subcontractorId: string;
  subcontractorName: string;
  rolls: { id: string; barcode: string | null; qty: number }[];
  /** Giden toplam metraj — MERGE modunda doğacak tek topun varsayılan metrajı. */
  totalQty: number;
  /**
   * Bu sevkin kabulünde RENK sorulmak zorunda mı?
   *
   * Kabul motoru, fason kategorisi renk uyguluyorsa (`appliesColor`) ve iş
   * emrinin hedef rengi YOKSA renk ister. Bu durum bizde gerçek: "ekru"
   * vakasında iş emri bilinçli renksiz gidiyor. Önizleme bunu SÖYLEMEZSE
   * arayüz renk alanı çizmez ve kabul, operatöre hiçbir çıkış bırakmayan bir
   * 400 ile düşer (ilk yazımda tam bu oldu).
   */
  colorRequired: boolean;
}

export interface FasonQuickPreview {
  groups: FasonQuickGroup[];
  /** Fasonda olup AÇIK SEVKE bağlanamayan toplar (kalıntı/eski veri). */
  orphanRolls: { id: string; barcode: string | null; qty: number }[];
}

/** İstemcinin gönderdiği (düzenlenebilir) parça listesi. */
export interface FasonQuickApplyInput {
  mode: "ONE_TO_ONE" | "MERGE";
  /** Grup başına parça metrajları — verilmezse moddan türetilir. */
  overrides?: Array<{ dispatchId: string; pieces: number[] }>;
  /** Kabulde uygulanan renk — yalnız `colorRequired` gruplar için gerekli. */
  appliedColorId?: string | null;
  notes?: string;
}

export class WorkOrderFasonQuickService {
  /**
   * Kapatmayı engelleyen fason yükünü sevk bazında gruplar.
   *
   * "Açık sevk" = iptal edilmemiş VE hiçbir kalemi henüz kabul edilmemiş.
   * Kısmi kabul edilmiş sevkler bilinçli DIŞARIDA: onların doğru yolu normal
   * fason kabul ekranıdır (kalem kalem karar gerekir) ve burada basitleştirmek
   * kısmi kabulü sessizce ezerdi.
   */
  async preview(workOrderId: string): Promise<ApiResponse<FasonQuickPreview>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        targetColorId: true,
        steps: { select: { id: true, requiredCategory: { select: { appliesColor: true } } } },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    const stepIds = wo.steps.map((s) => s.id);
    const appliesColorByStep = new Map(
      wo.steps.map((s) => [s.id, Boolean(s.requiredCategory?.appliesColor)]),
    );

    // AÇIK + OUTSTANDING sevk koşulu TEK KAYNAKTAN. Eski elle yazım
    // `directShippedAt`/`receipt.cancelledAt` taşımıyordu → tamamen doğrudan-sevk
    // edilmiş sevk hayalet grup olarak listeleniyor, kabul iptali (LIFO) sonrası
    // yeniden açılan sevkin grubu ise hiç gösterilmiyordu.
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId, ...OPEN_OUTSTANDING },
      select: {
        id: true,
        dispatchNo: true,
        stepId: true,
        subcontractorId: true,
        subcontractor: { select: { name: true } },
        step: { select: { station: { select: { name: true } } } },
        items: {
          where: OUTSTANDING_ITEM,
          select: {
            roll: { select: { id: true, barcode: true, currentQty: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const seen = new Set<string>();
    const groups: FasonQuickGroup[] = dispatches.map((d) => {
      const rolls = d.items
        .map((i) => i.roll)
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => {
          seen.add(r.id);
          return { id: r.id, barcode: r.barcode, qty: Number(r.currentQty ?? 0) };
        });
      return {
        dispatchId: d.id,
        dispatchNo: d.dispatchNo,
        stepId: d.stepId,
        stationName: d.step?.station?.name ?? "—",
        subcontractorId: d.subcontractorId,
        subcontractorName: d.subcontractor?.name ?? "—",
        rolls,
        totalQty: rolls.reduce((s, r) => s + r.qty, 0),
        colorRequired: Boolean(appliesColorByStep.get(d.stepId)) && !wo.targetColorId,
      };
    }).filter((g) => g.rolls.length > 0);

    // Sevke bağlanamayan fason topları: kullanıcıya GÖRÜNÜR yapılır ama bu uçtan
    // kabul edilmez — kaynağı belirsiz bir mal için makbuz üretmek, izlenebilirlik
    // zincirini uydurmak olurdu. Onların yolu "Konumu Düzelt" / manuel kabul.
    const orphans =
      stepIds.length > 0
        ? await prisma.roll.findMany({
            where: {
              currentStepId: { in: stepIds },
              status: RollStatus.AT_SUBCONTRACTOR,
              ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
            },
            select: { id: true, barcode: true, currentQty: true },
          })
        : [];

    return {
      success: true,
      data: {
        groups,
        orphanRolls: orphans.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          qty: Number(r.currentQty ?? 0),
        })),
      },
    };
  }

  /**
   * Seçilen modda TÜM açık sevkleri kabul eder.
   *
   * Parça metrajları: `overrides` verilmişse o, yoksa moddan türetilir
   *   ONE_TO_ONE → giden topların metrajları birebir
   *   MERGE      → tek parça, metrajların toplamı
   *
   * ⚠️ Sevk sevk ilerlenir ve HATA YUTULMAZ: bir grup düşerse istisna yükselir
   * ve kullanıcı hangi sevkin kaldığını görür. Kısmi başarıyı sessizce "başarılı"
   * saymak, fasonda kalan malı görünmez yapardı.
   */
  async apply(
    workOrderId: string,
    input: FasonQuickApplyInput,
    userId?: string,
  ): Promise<ApiResponse<{ receipts: number; newRolls: number }>> {
    const { data } = await this.preview(workOrderId);
    if (data.groups.length === 0) {
      throw AppError.badRequest("Kabul edilecek açık fason sevki yok.");
    }

    const overrideByDispatch = new Map(
      (input.overrides ?? []).map((o) => [o.dispatchId, o.pieces]),
    );
    const subService = new SubcontractorService();
    let receipts = 0;
    let newRollCount = 0;

    for (const g of data.groups) {
      const pieces =
        overrideByDispatch.get(g.dispatchId) ??
        (input.mode === "MERGE" ? [g.totalQty] : g.rolls.map((r) => r.qty));

      const clean = pieces.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
      if (clean.length === 0) {
        throw AppError.badRequest(
          `${g.dispatchNo}: en az bir geçerli parça metrajı gerekli.`,
        );
      }

      if (g.colorRequired && (input.appliedColorId === undefined || input.appliedColorId === null)) {
        throw AppError.badRequest(
          `${g.dispatchNo}: bu iş emrinin hedef rengi yok — kabulde uygulanan rengi seçin.`,
        );
      }

      await subService.receive(
        {
          workOrderId,
          stepId: g.stepId,
          subcontractorId: g.subcontractorId,
          returns: g.rolls.map((r) => ({ rollId: r.id })),
          newRolls: clean.map((qty) => ({ qty })),
          notes: input.notes,
          // Yalnız GEREKLİ olduğunda gönder: `undefined` bırakmak, hedef rengi
          // olan iş emirlerinde motorun kendi otomatik kopyalamasını korur.
          ...(g.colorRequired ? { appliedColorId: input.appliedColorId } : {}),
        },
        userId,
      );
      receipts += 1;
      newRollCount += clean.length;
    }

    return {
      success: true,
      data: { receipts, newRolls: newRollCount },
      message: `${receipts} fason sevki kabul edildi, ${newRollCount} top içeri alındı.`,
    };
  }
}

export const workOrderFasonQuickService = new WorkOrderFasonQuickService();
