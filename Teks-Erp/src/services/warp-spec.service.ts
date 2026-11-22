// =============================================================================
// TeksERP — ÇÖZGÜ KARTI (WarpSpec) Servisi · devere modülü
// =============================================================================
// Çözgü kartı ("çözgü föyü") bir ANA VERİDİR: bir çözgü tanımı N kumaş desenini
// besler (saha kartında el yazısıyla "Çözgü = UA6007"). Leventler bu karta göre
// sarılır ve doğuş anında tel/denye değerini KOPYALAR — kart sonradan
// düzeltilse bile geçmiş leventin kg'ı değişmez.
//
// Fason devere D3: kart çok iplikli olabilir. Gövde `yarns: [{ yarnItemId, endsCount }]` taşırsa satır kümesi
// REPLACE edilir ve kolonlar (`yarnItemId` = ilk satırın ipliği, `endsCount` = Σ tel) satırlardan TÜRETİLİR —
// gövdedeki kolon değerleri yok sayılır. Eski gövde (`yarnItemId` + `endsCount`, satırsız) tek satıra çevrilir;
// çok iplikli kartta özeti bozan eski gövde 400 (eski panel satırları sessizce silemesin).
// =============================================================================
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { BaseService, type CreateTxContext, type UpdateTxContext } from "./base.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { warpSpecSummaryFromLines, warpSpecYarnLines, WARP_SPEC_YARN_DENIER_INCLUDE, type WarpSpecYarnLine } from "./helpers/warp-spec-yarn.helper";
import { expandWarpSequence } from "./helpers/warp-sequence.helper";
import {
  assertWarpYarnItem,
  normalizeSequenceNote,
  parseWarpYarnRows,
  readWarpYarnRows,
  replaceWarpYarnRowsTx,
  sameWarpYarnRows,
} from "./helpers/warp-spec-yarn-write.helper";

const MULTI_YARN_LOCKED =
  "Çok iplikli çözgü kartının ipliği ve teli iplik satırlarından düzenlenir — kart formundaki İplikler bölümünü kullanın.";

/** Bu istekte yazılacak satır kümesi; BaseService kancası (aynı tx) buradan okur. Yoksa eski gövde yolu. */
interface PendingRows {
  rows: ReadonlyArray<WarpSpecYarnLine>;
  /** Pasif kart diriltildiyse onun eski kümesi (audit'in "eski" tarafı); yeni doğuşta boş. */
  before: WarpSpecYarnLine[];
}
const pendingRows = new AsyncLocalStorage<PendingRows>();

/**
 * Eski gövde yolu: tek iplikli kartın satırını kolonlarla aynı tutar (aynı tx). Çok iplikli kartta kolonlar
 * satırların özetidir; özeti bozan yazım 400 (tx geri alınır).
 */
async function syncSingleYarnRowTx(tx: Prisma.TransactionClient, warpSpecId: string): Promise<void> {
  const spec = await tx.warpSpec.findUniqueOrThrow({ where: { id: warpSpecId }, select: { yarnItemId: true, endsCount: true } });
  const rows = await tx.warpSpecYarn.findMany({ where: { warpSpecId }, select: { yarnItemId: true, endsCount: true, sortOrder: true } });
  if (rows.length > 1) {
    const s = warpSpecSummaryFromLines(rows);
    if (s.yarnItemId !== spec.yarnItemId || s.endsCount !== spec.endsCount) throw AppError.badRequest(MULTI_YARN_LOCKED);
    return;
  }
  const r = rows[0];
  if (r && r.yarnItemId === spec.yarnItemId && r.endsCount === spec.endsCount && r.sortOrder === 0) return;
  await replaceWarpYarnRowsTx(tx, warpSpecId, [{ yarnItemId: spec.yarnItemId, endsCount: spec.endsCount, sortOrder: 0 }]);
}

async function writeRowsOrSyncTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const pending = pendingRows.getStore();
  if (pending) await replaceWarpYarnRowsTx(tx, id, pending.rows);
  else await syncSingleYarnRowTx(tx, id);
}

/** 0 ≤ x < 100; "" / null / gönderilmemiş = bilinmiyor (boş bırakılabilir). */
function assertPct(v: unknown, message: string): void {
  if (v === undefined || v === null || v === "") return;
  // true/[]/" " Number() ile sayıya döner; Prisma'nın genel hatasına düşmeden 400.
  if ((typeof v !== "number" && typeof v !== "string") || (typeof v === "string" && v.trim() === "")) {
    throw AppError.badRequest(message);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 100) throw AppError.badRequest(message);
}

interface PreparedBody {
  body: Record<string, unknown>;
  rows: WarpSpecYarnLine[] | null;
}

export class WarpSpecService extends BaseService {
  /**
   * Gövdeyi hazırlar: `yarns` varsa doğrulanır ve kolonlar satırlardan türetilir; yoksa eski kolon girdisi denetlenir.
   * @param partial `update` yolunda alan GÖNDERİLMEMİŞ olabilir (kısmi güncelleme); `create`te iplik ve tel zorunlu.
   */
  private async prepare(rawData: Record<string, unknown>, partial: boolean): Promise<PreparedBody> {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) throw AppError.badRequest("Geçersiz istek gövdesi");
    const body: Record<string, unknown> = { ...rawData };
    let rows: WarpSpecYarnLine[] | null = null;
    if (body.yarns !== undefined) {
      rows = await parseWarpYarnRows(body.yarns);
      Object.assign(body, warpSpecSummaryFromLines(rows));
    }
    delete body.yarns;
    const note = normalizeSequenceNote(body.sequenceNote);
    if (note !== undefined) body.sequenceNote = note;

    // Faz 4 take-up (%): 0 ≤ x < 100 (DB CHECK `warp_specs_take_up_pct_range` ikinci hat); "" / null = bilinmiyor.
    assertPct(body.takeUpPct, "Take-up yüzdesi 0 ile 100 arasında olmalı (100 hariç).");
    // SY-C1 kart firesi: maliyet zincirinde YAPI'dan sonra, PARAMETRE'den önce (DB CHECK `warp_specs_waste_pct_range` ikinci hat).
    assertPct(body.wastePct, "Fire yüzdesi 0 ile 100 arasında olmalı (100 hariç).");
    if (!rows) await this.assertLegacyColumns(body, partial);
    return { body, rows };
  }

  /** Eski gövde: tek iplik + toplam tel. Satırlı gövdede bu alanlar türetildiği için denetim gerekmez. */
  private async assertLegacyColumns(data: Record<string, unknown>, partial: boolean): Promise<void> {
    const ends = data.endsCount;
    if (ends !== undefined && ends !== null && ends !== "") {
      const n = Number(ends);
      if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest("Tel adedi sıfırdan büyük bir tam sayı olmalı.");
    } else if (!partial) {
      throw AppError.badRequest("Tel adedi zorunludur (devere hesabının ilk çarpanı).");
    }
    const yarnItemId = data.yarnItemId;
    if (typeof yarnItemId === "string" && yarnItemId.length > 0) await assertWarpYarnItem(yarnItemId);
    else if (!partial) throw AppError.badRequest("Çözgü ipliği zorunludur.");
  }

  /** Yazımdan sonra: dönen kayıt satırlarla TAZE okunur (kanca include'dan sonra koştu); küme değiştiyse audit. */
  private async finish(res: ApiResponse<unknown>, before: WarpSpecYarnLine[], rows: WarpSpecYarnLine[] | null, userId?: string): Promise<ApiResponse<unknown>> {
    const id = (res.data as { id?: string } | null)?.id;
    if (!id) return res;
    const after = await readWarpYarnRows(id);
    if (rows && !sameWarpYarnRows(before, after)) {
      const view = (l: WarpSpecYarnLine[]) => l.map((r) => ({ yarnItemId: r.yarnItemId, endsCount: r.endsCount }));
      await AuditService.log({ userId, action: "UPDATE", tableName: "WARP_SPEC", recordId: id, oldData: { yarns: view(before) }, newData: { yarns: view(after) } });
    }
    const fresh = await prisma.warpSpec.findUnique({ where: { id }, include: WARP_SPEC_YARN_DENIER_INCLUDE });
    return { ...res, data: fresh ?? res.data };
  }

  /** Tekil okuma kart görseli için dizilim açılımını da taşır (`endsSequence`; liste taşımaz). Panel notu açmaz. */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const res = await super.findById(id);
    const spec = res.data as (Parameters<typeof warpSpecYarnLines>[0] & { sequenceNote: string | null }) | null;
    if (!res.success || !spec) return res;
    const endsSequence = expandWarpSequence(spec.sequenceNote, warpSpecYarnLines(spec).map((l) => l.endsCount));
    return { ...res, data: { ...spec, endsSequence } };
  }

  async create(rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const { body, rows } = await this.prepare(rawData, false);
    if (!rows) return this.finish(await super.create(body, userId), [], null, userId);
    const store: PendingRows = { rows, before: [] };
    const res = await pendingRows.run(store, () => super.create(body, userId));
    return this.finish(res, store.before, rows, userId);
  }

  async update(id: string, rawData: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const { body, rows } = await this.prepare(rawData, true);
    if (!rows) return this.finish(await super.update(id, body, userId), [], null, userId);
    const store: PendingRows = { rows, before: await readWarpYarnRows(id) };
    const res = await pendingRows.run(store, () => super.update(id, body, userId));
    return this.finish(res, store.before, rows, userId);
  }

  protected override async afterCreateTx(tx: Prisma.TransactionClient, c: CreateTxContext): Promise<void> {
    await writeRowsOrSyncTx(tx, c.id);
  }

  protected override async afterUpdateTx(tx: Prisma.TransactionClient, c: UpdateTxContext): Promise<void> {
    await writeRowsOrSyncTx(tx, c.id);
  }

  /** Pasif kartın diriltilmesi kanca yolundan geçmez: çok iplikli kartta eski gövde özeti ÖNCE denetlenir, satır SONRA yazılır. */
  protected override async reactivate(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    const pending = pendingRows.getStore();
    if (!pending) {
      const rows = await readWarpYarnRows(id);
      if (rows.length > 1) {
        const s = warpSpecSummaryFromLines(rows);
        const touchesYarn = data.yarnItemId !== undefined && data.yarnItemId !== s.yarnItemId;
        const touchesEnds = data.endsCount !== undefined && Number(data.endsCount) !== s.endsCount;
        if (touchesYarn || touchesEnds) throw AppError.badRequest(MULTI_YARN_LOCKED);
      }
    }
    else pending.before = await readWarpYarnRows(id);
    const res = await super.reactivate(id, data, userId);
    await prisma.$transaction((tx) => writeRowsOrSyncTx(tx, id));
    return res;
  }
}
