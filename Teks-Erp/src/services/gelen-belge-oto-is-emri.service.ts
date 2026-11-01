// =============================================================================
// GELEN BELGE → ONAYDAN SONRA OTOMATİK İŞ EMRİ (fabrika ayarı `gelenBelge.autoWorkOrder`, varsayılan KAPALI)
// =============================================================================
// İkinci iş emri yaratıcısı DEĞİLDİR: plan servisinin (`buildWorkOrderPlan`) NET gruplarını alır ve her biri için
// panelin kullandığı girdiyle MEVCUT `WorkOrderService.quickStart`ı çağırır (rota = planın önerisi, hedef =
// `targetValues` + bayrakları). Denetim noktası ONAY kalır: bu dosya yalnız onay APPROVED/PARTIAL doğurduktan SONRA
// koşar, best-effort'tur — düşen grup onayı geri sarmaz, sonuç grup başına Türkçe nedenle döner.
// Token belirlenimlidir: `uuidv5(noteId | grup anahtarı | bağlanacak top kümesi)` — aynı topları ikinci kez gönderen
// koşum (yeniden onay, yarıda kalma) aynı iş emrini replay eder; PARTIAL yeniden onayında yeni doğan toplar yeni kümedir.
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import { matchesPermission } from "../middlewares/rbac.middleware";
import type { JwtPayload } from "../types/api.types";
import { buildWorkOrderPlan, WORK_ORDER_PLAN_STATUSES, type PlanGroup } from "./gelen-belge-is-emri.service";
import type { ApproveResult } from "./gelen-belge-onay.service";
import { readIncomingDocAutoWorkOrder, readProductionEnabled } from "./system-setting.service";
import { WorkOrderService } from "./workorder.service";

/**
 * `POST /work-orders/quick-start` kapısının izin kümesi (`requireAnyPermission`, biri yeter) — onaylayanda yoksa otomatik
 * açma atlanır (SoD delinmez). Route literal'iyle eşitliğini `test_gelen_belge_oto_is_emri` §0 ölçer.
 */
export const AUTO_WORK_ORDER_PERMISSIONS = ["workorder:write", "mobile:hizli-is-emri"] as const;

/** Grup token uzayı (sabit; değişirse yarıda kalan otomatik açma ikinci iş emri doğurur). */
const AUTO_WO_TOKEN_NS = "eeebb0c6-3dcf-443b-af7b-2ba2e5a4791c";

const workOrders = new WorkOrderService();

export type AutoWorkOrderOutcome = "OPENED" | "SKIPPED" | "FAILED";

export interface AutoWorkOrderGroup {
  key: string;
  itemName: string;
  /** Grubun hedef değer adları (desen/gramaj); desensiz grupta boş. */
  targets: string[];
  rollCount: number;
  outcome: AutoWorkOrderOutcome;
  workOrderId?: string;
  workOrderNumber?: string;
  attached?: number;
  /** SKIPPED/FAILED nedeni (Türkçe). */
  reason?: string;
}

export interface AutoWorkOrderResult {
  opened: number;
  /** Elle açılması gereken grup sayısı (atlanan + düşen). */
  manual: number;
  /** Hiçbir grup denenmediyse genel neden (izin yok, rota önerisi yok, üretim kapalı…). */
  reason: string | null;
  groups: AutoWorkOrderGroup[];
}

/** Saf: grup token'ı — belge + grup + top kümesi (sıra bağımsız). */
export function autoWorkOrderToken(noteId: string, groupKey: string, rollIds: readonly string[]): string {
  return uuidv5(`${noteId}|${groupKey}|${[...rollIds].sort().join(",")}`, AUTO_WO_TOKEN_NS);
}

const errText = (err: unknown) => (err instanceof Error ? err.message : "Bilinmeyen hata").slice(0, 300);

function baseGroup(g: PlanGroup): Omit<AutoWorkOrderGroup, "outcome"> {
  return { key: g.key, itemName: g.itemName, targets: g.targets.map((t) => t.valueName), rollCount: g.rolls.length };
}

function allSkipped(groups: readonly PlanGroup[], reason: string): AutoWorkOrderResult {
  return { opened: 0, manual: groups.length, reason, groups: groups.map((g) => ({ ...baseGroup(g), outcome: "SKIPPED", reason })) };
}

/**
 * Onaydan sonra otomatik iş emri. Ayar kapalıysa `null` (çağıran yanıta anahtar koymaz = bugünkü yanıt).
 * ASLA fırlatmaz: her hata sonuçta nedendir — onay çoktan tamamlanmıştır.
 */
export async function autoOpenWorkOrders(noteId: string, actor: Pick<JwtPayload, "userId" | "permissions">): Promise<AutoWorkOrderResult | null> {
  if (!(await readIncomingDocAutoWorkOrder())) return null;
  let groups: readonly PlanGroup[] = [];
  try {
    const plan = await buildWorkOrderPlan(noteId);
    groups = plan.groups;
    if (groups.length === 0) return { opened: 0, manual: 0, reason: null, groups: [] };
    if (!AUTO_WORK_ORDER_PERMISSIONS.some((p) => matchesPermission(actor.permissions, p))) {
      return allSkipped(groups, "Onaylayanın iş emri açma yetkisi yok (workorder:write ya da mobile:hizli-is-emri); yetkili kişi plan ekranından açmalı.");
    }
    if (!(await readProductionEnabled())) return allSkipped(groups, "Üretim modülü kapalı; iş emri açılamaz.");
    const routeTemplateId = plan.suggestedRouteTemplateId;
    if (!routeTemplateId) {
      return allSkipped(groups, "Bu müşterinin rotalı önceki iş emri yok, rota önerilemedi; ilk iş emrini plan ekranından rota seçerek açın.");
    }
    const out: AutoWorkOrderGroup[] = [];
    // SIRAYLA (paralel değil): aynı belgenin topları; bir grubun hatası ötekini durdurmaz.
    for (const g of groups) {
      const base = baseGroup(g);
      if (g.patternless) {
        out.push({ ...base, outcome: "SKIPPED", reason: "İşlem değeri (desen/gramaj) çözülemedi; grup elle açılmalı." });
        continue;
      }
      const rolls = g.rolls.filter((r) => r.attachable && !r.liveWorkOrder && r.barcode);
      if (rolls.length === 0) {
        out.push({ ...base, outcome: "SKIPPED", reason: "Bağlanabilir top yok (toplar iş emrinde, çuvalda ya da sevkte)." });
        continue;
      }
      try {
        const res = await workOrders.quickStart({
          clientToken: autoWorkOrderToken(noteId, g.key, rolls.map((r) => r.rollId)),
          rollBarcodes: rolls.map((r) => r.barcode!),
          routeTemplateId,
          targetValues: g.targets.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })),
          targetPropertyIds: [...new Set(g.targets.map((t) => t.flagPropertyId))],
        }, actor.userId);
        const wo = res.data?.workOrder;
        out.push({ ...base, outcome: "OPENED", workOrderId: wo?.id, workOrderNumber: wo?.workOrderNumber, attached: res.data?.attached ?? 0 });
      } catch (err) {
        out.push({ ...base, outcome: "FAILED", reason: errText(err) });
      }
    }
    const opened = out.filter((g) => g.outcome === "OPENED").length;
    return { opened, manual: out.length - opened, reason: null, groups: out };
  } catch (err) {
    return allSkipped(groups, `Otomatik iş emri denenemedi: ${errText(err)}`);
  }
}

/**
 * Onay ucu bileşimi: onay (`approveDeliveryNote`) önce ve aynen koşmuş olur; yalnız APPROVED/PARTIAL'da otomatik iş emri.
 * Ayar kapalıyken dönen nesne onay sonucuyla bayt-aynıdır (`autoWorkOrders` anahtarı yok).
 */
export async function withAutoWorkOrders<T extends Pick<ApproveResult, "note">>(
  approved: T,
  actor: Pick<JwtPayload, "userId" | "permissions">,
): Promise<T & { autoWorkOrders?: AutoWorkOrderResult }> {
  if (!WORK_ORDER_PLAN_STATUSES.includes(approved.note.status as DeliveryNoteStatus)) return approved;
  const auto = await autoOpenWorkOrders(approved.note.id, actor);
  return auto ? { ...approved, autoWorkOrders: auto } : approved;
}
