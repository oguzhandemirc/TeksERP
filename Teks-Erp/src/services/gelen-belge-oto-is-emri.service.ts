// =============================================================================
// GELEN BELGE → ONAYDAN SONRA OTOMATİK İŞ EMRİ (fabrika ayarı `gelenBelge.autoWorkOrder`, varsayılan KAPALI)
// =============================================================================
// İkinci iş emri yaratıcısı DEĞİLDİR: plan servisinin (`buildWorkOrderPlan`) NET gruplarını alır ve her biri için
// panelin kullandığı girdiyle MEVCUT `WorkOrderService.quickStart`ı çağırır (rota = planın `suggestRoute` önerisi, hedef =
// `targetValues` + bayrakları). Denetim noktası ONAY kalır: bu dosya yalnız onay APPROVED/PARTIAL doğurduktan SONRA
// koşar, best-effort'tur — düşen grup onayı geri sarmaz, sonuç grup başına Türkçe nedenle döner.
// Açık rota isteği (onay gövdesi `routeTemplateId`, iş emri ekranından "Belge okut"): ayardan bağımsız koşar, rota = istenen;
// istek onaydan ÖNCE `assertRouteOverride` ile doğrulanır.
// K29: "Rota uygulaması: Okutmayla" iken (açık rota isteği yoksa) iş emri ROTASIZ açılır (`scanRouted`); adımları sahada
// istasyon okutmaları ekler (`helpers/okutmayla-rota.helper.ts`). Belgeden çözülen hedef değerler aynen taşınır.
// Token belirlenimlidir: `uuidv5(noteId | grup anahtarı | bağlanacak top kümesi)` — aynı topları ikinci kez gönderen
// koşum (yeniden onay, yarıda kalma) aynı iş emrini replay eder; PARTIAL yeniden onayında yeni doğan toplar yeni kümedir.
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import { matchesPermission } from "../middlewares/rbac.middleware";
import type { JwtPayload } from "../types/api.types";
import { buildWorkOrderPlan, WORK_ORDER_PLAN_STATUSES, type PlanGroup } from "./gelen-belge-is-emri.service";
import type { ApproveResult } from "./gelen-belge-onay.service";
import { readAutoWorkOrderPatternless, readIncomingDocAutoWorkOrder, readProductionEnabled, readProductionRouteMode, SETTING_KEYS } from "./system-setting.service";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { WorkOrderService } from "./workorder.service";
import { factoryRouteProblem } from "./gelen-belge-rota-onerisi.service";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { settingScreenPath } from "../constants/panel-ayar-yolu";


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

/** Açık rota isteği (P3 iş emri ekranından "Belge okut"): öneri zinciri ve ayar kapısı yerine bu rota. */
export interface AutoWorkOrderOptions {
  routeTemplateId?: string;
}

const hasWorkOrderPermission = (actor: Pick<JwtPayload, "permissions">) => AUTO_WORK_ORDER_PERMISSIONS.some((p) => matchesPermission(actor.permissions, p));

/** İzin (quick-start kümesi, 403) + üretim modülü (403 MODULE_DISABLED, lisans sorusu önce) — onaydan ÖNCE, yazmaz. */
async function assertCanOpenWorkOrder(actor: Pick<JwtPayload, "permissions">, what: string): Promise<void> {
  if (!hasWorkOrderPermission(actor)) {
    throw AppError.forbidden(`${what} ${TERIM.terbiyeIsEmri.tekilKucuk} açma yetkiniz yok (workorder:write ya da mobile:hizli-is-emri); belge onaylanmadı.`, { code: "GELEN_BELGE_ROUTE_OVERRIDE_FORBIDDEN" });
  }
  if (!(await readProductionEnabled())) {
    throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim")
      ?? AppError.forbidden(`Üretim modülü kapalı; ${TERIM.terbiyeIsEmri.tekilKucuk} açılamaz, belge onaylanmadı.`, { code: "MODULE_DISABLED", module: "production" });
  }
}

async function assertFactoryRoute(routeTemplateId: string): Promise<void> {
  const r = await factoryRouteProblem(routeTemplateId);
  if (r.problem) throw AppError.badRequest(`Seçilen rota şablonu (${r.name ?? "silinmiş"}) kullanılamıyor: ${r.problem}; belge onaylanmadı.`, { code: "GELEN_BELGE_ROUTE_OVERRIDE_INVALID" });
}

/**
 * ONAY ucu (iş emri İSTEĞE BAĞLI): rota yoksa istek yok demektir (`{}` = bugünkü ayar yolu) — iş emri ZORUNLU olan
 * form/toplu yol bunu KULLANMAZ, `resolveFormWorkOrderRoute`'a gider. Açık rota isteği yerine getirilemeyecekse onay
 * HİÇ koşmaz (fail-closed) — onaylanıp iş emri sessizce atlanmaz.
 */
export async function assertRouteOverride(routeTemplateId: string | undefined, actor: Pick<JwtPayload, "permissions">): Promise<AutoWorkOrderOptions> {
  if (!routeTemplateId) return {};
  await assertCanOpenWorkOrder(actor, "Seçilen rotayla");
  await assertFactoryRoute(routeTemplateId);
  return { routeTemplateId };
}

/** İş emrinin rotası: şablon ya da (K29 Okutmayla) rotasız — adımları sahada okutma ekler. */
export type FormWorkOrderRoute = { routeTemplateId: string; scanRouted?: undefined } | { routeTemplateId?: undefined; scanRouted: true };

/** quickStart rota alanı (form tek/çok parti ortak): şablon ya da rotasız (quickStart SIRALI'da ayrıca 400 verir). */
export const routeInput = (r: FormWorkOrderRoute): { routeTemplateId: string } | { scanRouted: true } =>
  (r.scanRouted ? { scanRouted: true } : { routeTemplateId: r.routeTemplateId });

/**
 * FORM/TOPLU kayıt ucu (iş emri ZORUNLU; `POST /irsaliyeler/:id/is-emri`, tek + çok parti) — TEK kapı, onaydan ÖNCE:
 * izin + üretim + rota şablonu geçerli; rota YOKSA yalnız "Rota uygulaması: Okutmayla" iken rotasız, SIRALI'da 400
 * `GELEN_BELGE_ROUTE_REQUIRED` (belge onaylanmaz — onaylı ama iş emirsiz belge kalmaz).
 */
export async function resolveFormWorkOrderRoute(routeTemplateId: string | undefined, actor: Pick<JwtPayload, "permissions">): Promise<FormWorkOrderRoute> {
  await assertCanOpenWorkOrder(actor, routeTemplateId ? "Seçilen rotayla" : "Rotasız");
  if (routeTemplateId) {
    await assertFactoryRoute(routeTemplateId);
    return { routeTemplateId };
  }
  if ((await readProductionRouteMode()) === "SCAN") return { scanRouted: true };
  throw AppError.badRequest(`Rota seçin: rotasız ${TERIM.terbiyeIsEmri.tekilKucuk} yalnız rota uygulaması 'Okutmayla' iken açılır; belge onaylanmadı.`, { code: "GELEN_BELGE_ROUTE_REQUIRED" });
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
export async function autoOpenWorkOrders(noteId: string, actor: Pick<JwtPayload, "userId" | "permissions">, opts: AutoWorkOrderOptions = {}): Promise<AutoWorkOrderResult | null> {
  // Açık rota isteği ayardan bağımsızdır (operatör iş emrini istedi); istek yoksa bugünkü ayar kapısı aynen.
  if (!opts.routeTemplateId && !(await readIncomingDocAutoWorkOrder())) return null;
  let groups: readonly PlanGroup[] = [];
  try {
    const plan = await buildWorkOrderPlan(noteId);
    groups = plan.groups;
    if (groups.length === 0) return { opened: 0, manual: 0, reason: null, groups: [] };
    if (!hasWorkOrderPermission(actor)) {
      return allSkipped(groups, `Onaylayanın ${TERIM.terbiyeIsEmri.tekilKucuk} açma yetkisi yok (workorder:write ya da mobile:hizli-is-emri); yetkili kişi plan ekranından açmalı.`);
    }
    if (!(await readProductionEnabled())) return allSkipped(groups, `Üretim modülü kapalı; ${TERIM.terbiyeIsEmri.tekilKucuk} açılamaz.`);
    const scanRouted = !opts.routeTemplateId && (await readProductionRouteMode()) === "SCAN";
    const routeTemplateId = scanRouted ? undefined : opts.routeTemplateId ?? plan.suggestedRouteTemplateId;
    if (!routeTemplateId && !scanRouted) {
      return allSkipped(groups, `Rota önerilemedi: ${plan.routeSuggestionNotes.join(" ")} ${TERIM.terbiyeIsEmri.cekim.belirtme} plan ekranından rota seçerek açın ya da ${settingScreenPath("gelen-belge")} ekranında fabrika varsayılan rotasını seçin.`);
    }
    const out: AutoWorkOrderGroup[] = [];
    // OPEN (Gülkesim, §2.7 K5): gramajsız grup hedef değersiz açılır; gramaj makine başında girilir.
    // K29 rotasız (S14b): hedefi istasyon okutmasında S10 çözücüsü yazar → desensiz grup da açılır (ayar SKIP olsa da).
    const patternlessOpen = scanRouted || (await readAutoWorkOrderPatternless()) === "OPEN";
    // SIRAYLA (paralel değil): aynı belgenin topları; bir grubun hatası ötekini durdurmaz.
    for (const g of groups) {
      const base = baseGroup(g);
      if (g.patternless && !patternlessOpen) {
        out.push({ ...base, outcome: "SKIPPED", reason: "İşlem değeri (desen/gramaj) çözülemedi; grup elle açılmalı." });
        continue;
      }
      const rolls = g.rolls.filter((r) => r.attachable && !r.liveWorkOrder && r.barcode);
      if (rolls.length === 0) {
        out.push({ ...base, outcome: "SKIPPED", reason: `Bağlanabilir top yok (toplar ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma}, çuvalda ya da sevkte).` });
        continue;
      }
      try {
        const res = await workOrders.quickStart({
          clientToken: autoWorkOrderToken(noteId, g.key, rolls.map((r) => r.rollId)),
          rollBarcodes: rolls.map((r) => r.barcode!),
          ...(scanRouted ? { scanRouted: true } : { routeTemplateId }),
          targetValues: g.targets.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })),
          targetPropertyIds: [...new Set(g.targets.map((t) => t.flagPropertyId))],
          sourceNoteId: noteId,
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
    return allSkipped(groups, `Otomatik ${TERIM.terbiyeIsEmri.tekilKucuk} denenemedi: ${errText(err)}`);
  }
}

/**
 * Onay ucu bileşimi: onay (`approveDeliveryNote`) önce ve aynen koşmuş olur; yalnız APPROVED/PARTIAL'da otomatik iş emri.
 * Ayar kapalıyken dönen nesne onay sonucuyla bayt-aynıdır (`autoWorkOrders` anahtarı yok).
 */
export async function withAutoWorkOrders<T extends Pick<ApproveResult, "note">>(
  approved: T,
  actor: Pick<JwtPayload, "userId" | "permissions">,
  opts: AutoWorkOrderOptions = {},
): Promise<T & { autoWorkOrders?: AutoWorkOrderResult }> {
  if (!WORK_ORDER_PLAN_STATUSES.includes(approved.note.status as DeliveryNoteStatus)) return approved;
  const auto = await autoOpenWorkOrders(approved.note.id, actor, opts);
  return auto ? { ...approved, autoWorkOrders: auto } : approved;
}
