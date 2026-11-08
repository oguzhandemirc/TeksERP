// =============================================================================
// HİZMET KARTI SERVİSİ (`service_items`) — ürün kartından ayrı tablo (plan PLAN-urun-hizmet-karti §2, D1b)
// =============================================================================
// Liste/okuma BaseService'ten (tek where: arama + süzgeç + cursor). Yazım AÇIK alan listesiyle:
// doğuşta code/name/unit/isActive, düzenlemede name/unit — yeni skaler kolon kendiliğinden yazılabilir olmaz.
// Durum yalnız `service-item-lifecycle.helper` tek yazarından değişir. Kod: boşsa `HZM-NNNNNN` serisi.
// Kod/ad tekilliği iki yönlü (ürün kartları dahil) — `card-identity.helper`.
// =============================================================================
import { ItemLifecycleStatus, ItemUnit, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { p2002TargetsCode, withBarcodeRetry } from "../utils/barcode-retry";
import { validateCode, validateName } from "../lib/string-validators";
import { AuditService } from "./audit.service";
import { BaseService, requireActorId, withActor } from "./base.service";
import { nextSeriesNo } from "./number-series.service";
import { codeCountsForCounter } from "./helpers/series-format.helper";
import { normalizeItemName } from "./helpers/name-normalize.helper";
import { assertCodeAvailable, lockCodeScopeTx, type CodeUniquenessTexts } from "./helpers/code-unique.helper";
import { itemBirthLifecycleData, ITEM_LIFECYCLE_LABEL } from "./helpers/item-lifecycle-data.helper";
import {
  CARD_CODE_LOCK_SCOPE,
  assertCodeFreeInOtherKind,
  assertNameFreeInOtherKind,
  cardCodesWithPrefix,
} from "./helpers/card-identity.helper";
import {
  SERVICE_ITEM_TABLE,
  countServiceItemLiveRefTotals,
  listServiceItemLiveRefs,
  totalServiceItemLiveRefs,
  transitionServiceItemLifecycle,
  type ServiceItemTransitionInput,
} from "./helpers/service-item-lifecycle.helper";

const CODE_MAX_LEN = 32;
const NAME_MAX_LEN = 100;
const UNITS: readonly string[] = Object.values(ItemUnit);
/** Otomatik seri önekleri elle yazılamaz: STK- ürün, HZM- hizmet sayacına ayrılmıştır. */
const RESERVED_PREFIX = /^(stk|hzm)-/i;
const CODE_TEXTS: CodeUniquenessTexts = { activeExactLead: "Bu kod ile aktif hizmet kartı zaten var", entityLabel: "hizmet kartı" };
/** Gövdeden yazılabilen alanlar — AÇIK liste (BACKEND-HTTP: yeni skaler kolon kendiliğinden açılmaz). */
const UPDATABLE_FIELDS = ["name", "unit"] as const;

export interface ServiceItemCreateInput {
  code?: string | null;
  name: string;
  unit?: string;
  isActive?: boolean;
}

export interface ServiceItemUpdateInput {
  name?: string;
  unit?: string;
  isActive?: boolean;
}

function readUnit(raw: unknown): ItemUnit {
  if (raw === undefined || raw === null || raw === "") return ItemUnit.MT;
  if (typeof raw !== "string" || !UNITS.includes(raw)) throw AppError.badRequest(`Birim ${UNITS.join(", ")} değerlerinden biri olmalı`);
  return raw as ItemUnit;
}

function readName(raw: unknown): string {
  const v = validateName(raw, { label: "Hizmet adı", required: true, maxLen: NAME_MAX_LEN });
  if (typeof v !== "string") throw AppError.badRequest("Hizmet adı boş bırakılamaz");
  return normalizeItemName(v);
}

function readManualCode(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim() : raw;
  if (t === undefined || t === null || t === "") return null;
  const v = validateCode(t, { label: "Hizmet kodu", required: true, maxLen: CODE_MAX_LEN });
  if (typeof v !== "string") return null;
  if (RESERVED_PREFIX.test(v)) {
    throw AppError.badRequest("Hizmet kodu STK- ya da HZM- ile başlayamaz — bu önekler otomatik kodlara ayrılmıştır (boş bırakın, sistem üretsin)");
  }
  return v;
}

/** Sıradaki `HZM-NNNNNN`; sayaç iki tablonun ön ekli kodlarını görür (elle açılmış çakışan kod atlanır). */
async function nextServiceItemCode(): Promise<string> {
  return nextSeriesNo("serviceItem", async (prefix, fmt) =>
    (await cardCodesWithPrefix(prefix)).filter((r) => codeCountsForCounter(fmt, r.code)), new Date());
}

export class ServiceItemService extends BaseService {
  /** Yalnız açık alan listesi geçer; yaşam döngüsü ve künye kolonları gövdeden yazılamaz. */
  protected sanitizeWriteData(data: Record<string, unknown>): Record<string, unknown> {
    const base = super.sanitizeWriteData(data);
    const out: Record<string, unknown> = {};
    for (const k of UPDATABLE_FIELDS) if (k in base) out[k] = base[k];
    return out;
  }

  /** Ad tekilliği: tablo içi (BaseService) + ürün kartları (iki yönlü). */
  protected async assertNameNotDuplicate(data: Record<string, unknown>, excludeId?: string): Promise<void> {
    await super.assertNameNotDuplicate(data, excludeId);
    if (typeof data.name === "string") await assertNameFreeInOtherKind(prisma, "serviceItem", data.name);
  }

  async create(data: Record<string, unknown>, userId: string | undefined): Promise<ApiResponse<unknown>> {
    const actorId = requireActorId(userId, "Hizmet kartı");
    const input = data as unknown as ServiceItemCreateInput;
    const manualCode = readManualCode(input.code);
    const name = readName(input.name);
    const unit = readUnit(input.unit);
    if (input.isActive !== undefined && typeof input.isActive !== "boolean") throw AppError.badRequest("'isActive' true/false olmalı");
    await this.assertNameNotDuplicate({ name });
    if (manualCode) {
      // Ucuz ön kontrol; nihai karar kilit altında aşağıda.
      assertCodeAvailable(manualCode, await prisma.serviceItem.findMany({ select: { id: true, code: true, name: true, isActive: true } }), CODE_TEXTS);
      await assertCodeFreeInOtherKind(prisma, "serviceItem", manualCode);
    }
    const created = await withBarcodeRetry(
      async () => {
        const code = manualCode ?? (await nextServiceItemCode());
        return prisma.$transaction(async (tx) => {
          if (manualCode) {
            // Kilit tx'in İLK ifadesi; ürün kartı yolu aynı kapsamı kilitler ⇒ çapraz kod yarışı serileşir.
            await lockCodeScopeTx(tx, CARD_CODE_LOCK_SCOPE, manualCode);
            assertCodeAvailable(manualCode, await tx.serviceItem.findMany({ select: { id: true, code: true, name: true, isActive: true } }), CODE_TEXTS);
            await assertCodeFreeInOtherKind(tx, "serviceItem", manualCode);
          }
          return tx.serviceItem.create({
            data: withActor({ code, name, unit, ...itemBirthLifecycleData(input.isActive) }, actorId, "CREATE", "serviceItem") as Prisma.ServiceItemUncheckedCreateInput,
          });
        });
      },
      undefined,
      // Yalnız otomatik kodun sayaç çakışması tekrarlanır; ad seddi (nameFold) P2002'si Türkçe 409'a düşer.
      (err) => manualCode === null && p2002TargetsCode(err),
      "Hizmet kartı kodu",
    );
    await AuditService.log({
      userId: actorId,
      action: "CREATE",
      tableName: SERVICE_ITEM_TABLE,
      recordId: created.id,
      newData: { code: created.code, name: created.name, unit: created.unit, lifecycleStatus: created.lifecycleStatus },
    });
    return { success: true, data: created, message: "Hizmet kartı oluşturuldu" };
  }

  /** Düzenleme: name/unit; `code` değişmez; `isActive` yaşam döngüsü yazıcısına gider (ürün kartı emsali). */
  async update(id: string, rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const { isActive, ...data } = (rawData ?? {}) as Record<string, unknown>;
    for (const k of ["code", "itemType"]) {
      if (Object.prototype.hasOwnProperty.call(data, k)) throw AppError.badRequest(`'${k}' alanı güncellenemez. Yeni bir hizmet kartı tanımlayın.`);
    }
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") throw AppError.badRequest("'isActive' true/false olmalı");
      const res = await this.runTransition({
        serviceItemId: id,
        to: isActive ? ItemLifecycleStatus.ACTIVE : ItemLifecycleStatus.ARCHIVED,
        userId: userId ?? null,
        // true yalnız Pasif kartı döndürür — "Tükenene kadar" kart formun her kaydında değişmesin (ürün emsali).
        ...(isActive ? { onlyFrom: [ItemLifecycleStatus.ARCHIVED] } : {}),
      });
      if (Object.keys(data).length === 0) return res;
    }
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = readName(data.name);
    if (data.unit !== undefined) patch.unit = readUnit(data.unit);
    if (Object.keys(patch).length === 0) throw AppError.badRequest("Güncellenecek alan yok (ad ya da birim)");
    if ((await prisma.serviceItem.count({ where: { id } })) === 0) throw AppError.notFound("Hizmet kartı bulunamadı");
    // Ad gerçekten değişince base kancası `assertNameNotDuplicate`i (tablo içi + karşı tablo) çağırır.
    return super.update(id, patch, userId);
  }

  /** `DELETE` = "Pasif'e geç" (kapılı: canlı referans varsa 409 + kayıt listesi). */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.transitionLifecycle(id, ItemLifecycleStatus.ARCHIVED, null, userId);
  }

  async hardDelete(): Promise<ApiResponse<unknown>> {
    throw AppError.badRequest("Hizmet kartı kalıcı silinemez; Pasif'e alın.");
  }

  async transitionLifecycle(id: string, to: ItemLifecycleStatus, reason: string | null, userId?: string): Promise<ApiResponse<unknown> & { idempotent?: boolean }> {
    return this.runTransition({ serviceItemId: id, to, reason, userId: userId ?? null });
  }

  private async runTransition(input: ServiceItemTransitionInput): Promise<ApiResponse<unknown> & { idempotent?: boolean }> {
    const result = await transitionServiceItemLifecycle(input);
    const row = await prisma.serviceItem.findUnique({ where: { id: input.serviceItemId } });
    return {
      success: true,
      data: row,
      idempotent: result.idempotent,
      message: result.idempotent
        ? `Kart zaten '${ITEM_LIFECYCLE_LABEL[result.to]}' durumunda`
        : `Kart '${ITEM_LIFECYCLE_LABEL[result.to]}' durumuna alındı`,
    };
  }

  /** Geçiş önizlemesi — canlı referanslar TEK TEK (yıkıcı işlem kuralı); şekil ürün kartıyla aynı. */
  async lifecyclePreview(id: string, to: ItemLifecycleStatus): Promise<ApiResponse<unknown>> {
    const row = await prisma.serviceItem.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, lifecycleStatus: true, mergedIntoId: true },
    });
    if (!row) throw AppError.notFound("Hizmet kartı bulunamadı");
    const references = await listServiceItemLiveRefs(prisma, id);
    const liveTotal = totalServiceItemLiveRefs(references);
    const similar = (await this.findSimilarNames(row.name, { excludeId: id, limit: 5 })).filter((s) => s.isActive && !s.mergedIntoName);
    return {
      success: true,
      data: {
        item: { ...row, lifecycleLabel: ITEM_LIFECYCLE_LABEL[row.lifecycleStatus] },
        to,
        toLabel: ITEM_LIFECYCLE_LABEL[to],
        canTransition: row.mergedIntoId === null && row.lifecycleStatus !== to && (to !== ItemLifecycleStatus.ARCHIVED || liveTotal === 0),
        liveTotal,
        references,
        similarActive: similar.map((s) => ({ id: s.id, code: s.code, name: s.name, score: s.score })),
      },
    };
  }

  /** Liste rozeti — kart başına kalan canlı referans (hizmette top yok: `rolls` hep 0). */
  async lifecycleSummary(ids: string[]): Promise<ApiResponse<Array<{ id: string; liveTotal: number; rolls: number }>>> {
    const totals = await countServiceItemLiveRefTotals(prisma, [...new Set(ids)]);
    return { success: true, data: [...totals].map(([id, liveTotal]) => ({ id, liveTotal, rolls: 0 })) };
  }
}

export const serviceItemService = new ServiceItemService({
  modelName: "serviceItem",
  tableName: SERVICE_ITEM_TABLE,
  searchFields: ["name"],
  codeSearchFields: ["code"],
  duplicateNameField: "name",
  entityLabel: "hizmet kartı",
});
