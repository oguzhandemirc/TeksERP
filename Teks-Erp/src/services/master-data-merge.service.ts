// =============================================================================
// ANA VERİ BİRLEŞTİRME (Faz B2)
// =============================================================================
// Mükerrer müşteri/kumaş/renk/fason firma kaydını survivor'a birleştirir.
//
// ── ÜÇ TASARIM KARARI, ÜÇÜ DE GERİ ALINMADAN ÖNCE OKUNMALI ──────────────
// 1) KAYNAK SİLİNMEZ, tombstone olur (`mergedIntoId`). Silmek 46 FK'nın çoğunu
//    implicit SET NULL'a düşürürdü ve `Roll.colorId IS NULL` bu sistemde
//    "HAM KUMAŞ" demektir — boyalı kumaş sessizce hama dönerdi.
// 2) ÇAKIŞMALARDA SABİT POLİTİKA, per-satır kullanıcı seçimi YOK. Gerekçe:
//    12 aliası olan iki müşteride satır satır seçim, operatörün gerçekten
//    okumadığı 12 soru üretir ("onay yorgunluğu"); politika yazılı ve
//    önizlemede somut gösteriliyor, karar noktası TEK: birleştir / vazgeç.
// 3) GERİ ALINABİLİR AMA SIRAYLA (2026-09-12): her birleştirme `MergeOperation`
//    defterine yazılır — taşınan satırın KİMLİĞİ, silinen çakışma satırının TAM
//    fotoğrafı, survivor'a yazılan alanların önceki değeri. Geri alma
//    `master-data-unmerge.service.ts`tedir ve LIFO'dur (kaydı ilgilendiren daha
//    sonraki birleştirme varsa önce o geri alınır). Defter ÖNCESİ birleştirmeler
//    geri alınamaz; emniyet ağı onlar için gece yedeği + kopyaya geri yüklemedir.
//
// ⚠️ `PrintedDocument` / snapshot'lara DOKUNULMAZ ve bu `mergeBatches`'ten
// BİLİNÇLİ AYRILIKTIR: orada belge VOID edilir çünkü OLAY iptal edilmiştir.
// Burada hiçbir olay iptal edilmiyor — belge basıldığı an ad doğruydu. Sevk
// edilmiş bir irsaliyeyi geriye dönük "İPTAL" damgalamak yanlış bir HUKUKİ
// İDDİA olurdu. Aynı gerekçe `Roll.lastLabelSnapshot`, `Manifest.snapshot`,
// `TravelerCard.snapshot` ve `SystemLog` için de geçerli.

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { syncSubcontractorRoleTx } from "./subcontractor-management.service";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { markTravelerCardsDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";
import { DuplicateReviewService } from "./duplicate-review.service";
import {
  MERGEABLE_FIELDS,
  MERGE_NAME_FIELD,
  isMergeableField,
} from "../constants/merge-fields";
import {
  MERGE_ENTITIES,
  MERGE_MAP,
  type MergeEntity,
  type MoveRule,
} from "../constants/merge-map";
import { ItemLifecycleStatus, MergeRefKind } from "@prisma/client";
import { itemLifecycleWriteData } from "./helpers/item-lifecycle-data.helper";
import {
  deleteCapturingTx,
  movePerSourceTx,
  newPkCache,
  snapshotRowsTx,
  type PkCache,
} from "./helpers/merge-ledger.helper";

/**
 * GLOBAL advisory kilit. Kaynak/survivor id'lerine göre değil TEK anahtarla
 * alınır: birleştirme ayda bir yapılan bir işlemdir, iki eşzamanlı merge'in
 * kilitlenme muhakemesini (A→B ile B→C aynı anda) tamamen ortadan kaldırmak,
 * kaybedilen paralelliğe fazlasıyla değer.
 *
 * Uzay envanteri TEK KAYNAK: `helpers/period-guard.helper.ts` başlığı — kopya
 * liste tutulmaz. Bu uzay **8030 master-data birleştirme**dir.
 * ⚠️ 8027'DEN TAŞINDI: birleştirme ile ALIŞ SİPARİŞİ senkronu aynı numarayı
 * paylaşıyordu; ikisi birbirini sessizce serileştiriyordu.
 * `: number` BİLEREK — literal tipe daralırsa bekçideki "uzaylar farklı"
 * karşılaştırması TS2367 ile derlenmez (SHIPMENT_LOCK_NS emsali).
 */
const MERGE_LOCK_NS: number = 8030;
const MERGE_LOCK_KEY = 1;

/** Tek çağrıda birleştirilebilecek kaynak sayısı. */
export const MAX_MERGE_SOURCES = 20;

/**
 * Önizlemede "bu iş çok büyük" eşiği. 20 sn'lik varsayılan tx tavanına karşı
 * ÜÇ katmanlı savunmanın birincisi (ikincisi çağrıya özel timeout, üçüncüsü
 * paneldeki "vardiya dışı" uyarısı).
 */
const MAX_ROWS_TO_MOVE = 200_000;

/** Bu çağrıya özel tx tavanı — varsayılan 5 sn/20 sn birleştirmeye yetmez. */
const MERGE_TX_TIMEOUT_MS = 120_000;

export interface MergeBlocker {
  key: string;
  count: number;
  message: string;
}

export interface MergeMoveRow {
  model: string;
  table: string;
  column: string;
  label: string;
  /** ⚠️ `null` = ÖLÇÜLEMEDİ, `0` DEĞİL (`backup-impact.service.ts` disiplini). */
  count: number | null;
}

export interface MergeConflictRow {
  table: string;
  label: string;
  policy: string;
  why: string;
  count: number;
  /** Operatöre gösterilecek somut örnekler (kırpılmış olabilir). */
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}

/**
 * ALAN SEÇİMİ (survivorship, P2 2026-08-22) — panelde alan başına bir satır.
 * `values` gruptaki HER kaydın o alandaki değeri; `suggestedFromId` sunucunun
 * önerisi (kural: survivor'ın değeri DOLUYSA o; değilse en çok referanslı kaynağın
 * dolu değeri; hiçbiri dolu değilse survivor). Öneri BAĞLAYICI DEĞİL — seçim
 * operatörün; ama boş bırakılırsa uygulanan da budur.
 */
export interface MergeFieldChoice {
  field: string;
  label: string;
  kind: "text" | "ref" | "number";
  values: Array<{ recordId: string; value: string | null }>;
  suggestedFromId: string;
  /** Kayıtlar arasında gerçekten FARK var mı — panel yalnız farklıları öne çıkarır. */
  differs: boolean;
}

export interface MergePreview {
  entity: MergeEntity;
  survivor: { id: string; code: string | null; name: string } | null;
  sources: Array<{ id: string; code: string | null; name: string; isActive: boolean }>;
  suggestedSurvivorId: string | null;
  canMerge: boolean;
  blockers: MergeBlocker[];
  warnings: string[];
  moves: MergeMoveRow[];
  conflicts: MergeConflictRow[];
  /** Alan alan hangi değer kalsın (P2). Boş dizi = bu varlıkta seçilebilir alan yok. */
  fieldChoices: MergeFieldChoice[];
  sideEffects: string[];
  totalRowsToMove: number;
  /** Tüm sayımlar gerçekten ölçülebildi mi (biri bile `null` ise false). */
  measuredAll: boolean;
  computedAt: string;
}

interface EntityMeta {
  delegate: () => {
    findMany: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  /** FİZİKSEL tablo adı — ham SQL / Prisma delegate işleri için. */
  table: string;
  /**
   * AUDIT tablo adı — sistemin MANTIKSAL adı (`ITEM`, `COLOR`…).
   *
   * ⚠️ BULGU-T2-011: audit satırı `meta.table` ile, yani FİZİKSEL adla
   * (`items`) yazılıyordu. Diğer HER yol mantıksal adı (`ITEM`) kullanıyor →
   * Denetim Raporu'nda "Kumaş" seçen denetçi birleştirmeyi HİÇ göremiyordu.
   * Ölçüldü: saha kopyasındaki 13 birleştirmenin 13'ü fiziksel adla yazılmış.
   * Ana veri birleştirmesi bu sistemdeki EN YIKICI ve geri alınamayan işlemdir
   * (42 kurallık eşleme haritası) — izlenebilirliğin tam orada kopması, kayıt
   * bütünlüğü açığıdır.
   */
  auditTable: string;
  label: string;
  /** Birleştirmeyi engelleyen "aynı olmalı" kolonları (varsa). */
  identityFields: Array<{ field: string; label: string }>;
}

const META: Record<MergeEntity, EntityMeta> = {
  customer: {
    delegate: () => prisma.customer as never,
    table: "customers",
    auditTable: "CUSTOMER",
    label: "müşteri",
    // Rol modeli (2026-09-17): kimlik iki TİCARİ rol bayrağıdır (`type` bunların türetilmiş kopyası — eski
    // "müşteri tipi" guard'ıyla birebir). Fason rolü kimlik DEĞİL: profil `subcontractors.customerId`
    // kuralıyla taşınır/bloklanır ve bayrak claim'den sonra profil gerçeğinden yeniden türetilir; kimliğe
    // konsaydı fason kartı fasonsuz karta hiç birleşemezdi (bayrak yalnız profil bağıyla yazılabilir).
    identityFields: [
      { field: "isCustomerRole", label: "Müşteri rolü" },
      { field: "isSupplierRole", label: "Tedarikçi rolü" },
    ],
  },
  item: {
    delegate: () => prisma.item as never,
    table: "items",
    auditTable: "ITEM",
    label: "kumaş",
    // ⚠️ EN SİNSİ VERİ BOZMA YOLU: MT ölçülen kumaşı KG ölçülen kumaşa
    // birleştirmek, tüm metraj/ağırlık toplamlarını sessizce anlamsızlaştırır.
    // Tek satırlık guard kapatıyor.
    identityFields: [{ field: "unit", label: "birim" }],
  },
  color: {
    delegate: () => prisma.color as never,
    table: "colors",
    auditTable: "COLOR",
    label: "renk",
    identityFields: [],
  },
  subcontractor: {
    delegate: () => prisma.subcontractor as never,
    table: "subcontractors",
    auditTable: "SUBCONTRACTOR",
    label: "fason firma",
    identityFields: [],
  },
};

function assertEntity(entity: string): MergeEntity {
  if (!(MERGE_ENTITIES as readonly string[]).includes(entity)) {
    throw AppError.badRequest(`Birleştirme desteklenmiyor: '${entity}'.`);
  }
  return entity as MergeEntity;
}

interface Record4 {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  mergedIntoId: string | null;
  [k: string]: unknown;
}

/**
 * Alan değerini panel/karşılaştırma için METNE indirger; boş/anlamsız değer `null`.
 * ⚠️ `null` ile `""` AYNI kovaya düşer (ikisi de "boş") — yoksa öneri kuralı boş
 * string'i "dolu" sayıp gerçekten dolu bir kaynağı elemiş olurdu.
 */
function fieldValueOf(row: Record4, field: string): string | null {
  const raw = row[field];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "boolean") return raw ? "true" : "false";
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

async function loadRecords(entity: MergeEntity, ids: string[]): Promise<Record4[]> {
  const meta = META[entity];
  const rows = (await (meta.delegate() as never as {
    findMany: (a: unknown) => Promise<Record4[]>;
  }).findMany({ where: { id: { in: ids } } })) as Record4[];
  return rows;
}

// —————————————————————————————————————————————————————————————————————————————
// ÖNİZLEME
// —————————————————————————————————————————————————————————————————————————————

export class MasterDataMergeService {
  static async preview(
    rawEntity: string,
    survivorId: string,
    sourceIds: string[],
  ): Promise<MergePreview> {
    const entity = assertEntity(rawEntity);
    const meta = META[entity];
    const uniqueSources = [...new Set(sourceIds)].filter((id) => id && id !== survivorId);
    const blockers: MergeBlocker[] = [];
    const warnings: string[] = [];

    if (uniqueSources.length === 0) {
      blockers.push({
        key: "NO_SOURCE",
        count: 0,
        message: "Birleştirilecek kayıt seçilmedi (kaynak, hedefin kendisi olamaz).",
      });
    }
    if (uniqueSources.length > MAX_MERGE_SOURCES) {
      blockers.push({
        key: "TOO_MANY_SOURCES",
        count: uniqueSources.length,
        message: `Tek seferde en fazla ${MAX_MERGE_SOURCES} kayıt birleştirilebilir.`,
      });
    }

    const all = await loadRecords(entity, [survivorId, ...uniqueSources]);
    const survivor = all.find((r) => r.id === survivorId) ?? null;
    const sources = uniqueSources
      .map((id) => all.find((r) => r.id === id))
      .filter((r): r is Record4 => Boolean(r));

    if (!survivor) {
      blockers.push({ key: "SURVIVOR_NOT_FOUND", count: 0, message: "Hedef kayıt bulunamadı." });
    }
    const missing = uniqueSources.filter((id) => !sources.some((s) => s.id === id));
    if (missing.length > 0) {
      blockers.push({
        key: "SOURCE_NOT_FOUND",
        count: missing.length,
        message: `${missing.length} kaynak kayıt bulunamadı.`,
      });
    }

    // Zaten birleşmiş kayıt hem hedef hem kaynak olarak reddedilir: tombstone'a
    // birleştirmek zinciri uzatır ("A→B→C"), tombstone'u birleştirmek ise
    // ikinci kez taşınacak satır olmadığı için sessiz bir no-op olurdu.
    if (survivor?.mergedIntoId) {
      blockers.push({
        key: "SURVIVOR_ALREADY_MERGED",
        count: 1,
        message: "Hedef kayıt daha önce başka bir kayda birleştirilmiş; hedef olarak seçilemez.",
      });
    }
    const alreadyMerged = sources.filter((s) => s.mergedIntoId);
    if (alreadyMerged.length > 0) {
      blockers.push({
        key: "SOURCE_ALREADY_MERGED",
        count: alreadyMerged.length,
        message: `${alreadyMerged.length} kaynak kayıt zaten birleştirilmiş.`,
      });
    }

    // Kimlik alanları (birim / müşteri tipi)
    if (survivor) {
      for (const idf of meta.identityFields) {
        const mismatched = sources.filter((s) => s[idf.field] !== survivor[idf.field]);
        if (mismatched.length > 0) {
          blockers.push({
            key: `IDENTITY_${idf.field.toUpperCase()}`,
            count: mismatched.length,
            message:
              `${mismatched.length} kaynak kaydın ${idf.label} değeri hedeften farklı ` +
              `(hedef: ${String(survivor[idf.field])}). Farklı ${idf.label} taşıyan kayıtlar ` +
              `birleştirilemez — sayılar anlamını yitirir.`,
          });
        }
      }
    }

    const sourceIdList = sources.map((s) => s.id);
    const moves: MergeMoveRow[] = [];
    const conflicts: MergeConflictRow[] = [];

    if (sourceIdList.length > 0 && survivor) {
      for (const rule of MERGE_MAP[entity]) {
        if (rule.kind === "EXEMPT") continue;
        const count = await countRows(rule, sourceIdList);
        moves.push({
          model: rule.model,
          table: rule.table,
          column: rule.column,
          label: rule.label,
          count,
        });
        if (rule.kind === "CONFLICT") {
          const c = await describeConflict(rule, survivor.id, sourceIdList);
          if (c.count > 0) {
            conflicts.push(c);
            if (rule.policy === "BLOCK") {
              blockers.push({
                key: `CONFLICT_${rule.table.toUpperCase()}`,
                count: c.count,
                message:
                  `${c.count} ${rule.label} kaydı hedefteki bir kayıtla ÇAKIŞIYOR ve otomatik ` +
                  `çözülemez. Önce çakışan kayıtları elle düzeltin. (${rule.why.split(".")[0]}.)`,
              });
            }
          }
        }
      }
    }

    const measured = moves.filter((m) => m.count !== null);
    const totalRowsToMove = measured.reduce((a, m) => a + (m.count ?? 0), 0);
    const measuredAll = measured.length === moves.length;
    if (!measuredAll) {
      warnings.push(
        "Bazı tablolar sayılamadı — aşağıda '?' ile işaretli. Bu satırlar YİNE DE taşınacak; " +
          "yalnız kaç tane olduğu ölçülemedi.",
      );
    }
    if (totalRowsToMove > MAX_ROWS_TO_MOVE) {
      blockers.push({
        key: "TOO_LARGE",
        count: totalRowsToMove,
        message:
          `${totalRowsToMove.toLocaleString("tr-TR")} satır taşınacak — bu işlem tek bir ` +
          `işlemde yapılamayacak kadar büyük. Kayıtları daha küçük gruplar hâlinde birleştirin.`,
      });
    }
    if (totalRowsToMove > 10_000) {
      warnings.push(
        "Bu birleştirme çok sayıda satıra dokunuyor; vardiya dışında yapılması önerilir " +
          "(işlem sırasında ilgili tablolar kısa süre kilitli kalır).",
      );
    }

    // ── ALAN SEÇENEKLERİ (P2) ────────────────────────────────────────────────
    // Öneri kuralı MDM standardıdır (completeness → trust → recency): DOLU olan
    // kazanır; ikisi de doluysa survivor'ınki (operatör onu "kalacak kayıt" seçti);
    // survivor boşsa EN ÇOK REFERANSLI kaynağın dolu değeri (en çok kullanılan kayıt
    // en güvenilir veriyi taşır varsayımı), eşitlikte ilk kaynak.
    const fieldChoices: MergeFieldChoice[] = [];
    if (survivor) {
      const ordered = [survivor, ...sources];
      const refCounts = new Map<string, number>();
      for (const r of sources) refCounts.set(r.id, (await countReferences(entity, r.id)) ?? 0);
      const sourcesByRef = [...sources].sort(
        (a, b) => (refCounts.get(b.id) ?? 0) - (refCounts.get(a.id) ?? 0),
      );
      for (const f of MERGEABLE_FIELDS[entity]) {
        const values = ordered.map((r) => ({ recordId: r.id, value: fieldValueOf(r, f.field) }));
        const survivorValue = fieldValueOf(survivor, f.field);
        const donor = sourcesByRef.find((s) => fieldValueOf(s, f.field) !== null);
        const suggestedFromId = survivorValue !== null ? survivor.id : (donor?.id ?? survivor.id);
        const distinct = new Set(values.map((v) => v.value ?? ""));
        fieldChoices.push({
          field: f.field,
          label: f.label,
          kind: f.kind ?? "text",
          values,
          suggestedFromId,
          differs: distinct.size > 1,
        });
      }
    }

    const sideEffects: string[] = [];
    if (entity === "customer") {
      sideEffects.push("İlgili topların ve çuvalların etiketleri 'yeniden bas' olarak işaretlenir.");
    }
    if (entity === "item" || entity === "color") {
      sideEffects.push("Etkilenen iş emirlerinin refakat kartları 'güncel değil' işaretlenir.");
      sideEffects.push("İlgili topların etiketleri 'yeniden bas' olarak işaretlenir.");
    }
    sideEffects.push(
      "Basılmış belgeler (irsaliye, çeki listesi, etiket kopyaları) DEĞİŞMEZ — basıldıkları an " +
        "doğruydular ve geriye dönük değiştirilmezler.",
    );

    return {
      entity,
      survivor: survivor ? { id: survivor.id, code: survivor.code, name: survivor.name } : null,
      sources: sources.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        isActive: s.isActive,
      })),
      suggestedSurvivorId: null,
      canMerge: blockers.length === 0,
      blockers,
      warnings,
      moves,
      conflicts,
      fieldChoices,
      sideEffects,
      totalRowsToMove,
      measuredAll,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * MÜKERRER ADAY LİSTESİ — `scripts/find_fold_duplicates.ts`'in çevrimiçi ikizi,
   * İKİ ZORUNLU FARKLA:
   *
   * 1) `mergedIntoId IS NULL` — tombstone'lar sayılmazsa liste HİÇ BOŞALMAZ:
   *    operatör birleştirir, ekranı yeniler ve aynı çifti tekrar görür.
   *
   * 2) ⚠️ RENK `nameFold` KULLANMAZ. Renk mükerrer karşılaştırması bilinçli
   *    olarak TOKEN SIRASINDAN BAĞIMSIZDIR (`foldColorNameForCompare`) çünkü
   *    sahada aynı renk hem `055-BEYAZ` hem `BEYAZ 055` olarak giriliyor. Düz
   *    `nameFold` bu çifti KAÇIRIR (canlı veride ölçüldü: 2 grup). Katlama SQL'e
   *    çevrilmedi, JS'te KOŞUYOR — aynı fonksiyon, yani sapma imkânsız; renk
   *    tablosu bunu taşıyacak kadar küçük (canlı: 66 satır) ve bu kararın
   *    ölçeklendiği yer değil.
   */
  static async findDuplicates(rawEntity: string): Promise<
    Array<{
      key: string;
      records: Array<{ id: string; code: string | null; name: string; isActive: boolean; refCount: number | null }>;
    }>
  > {
    const entity = assertEntity(rawEntity);
    const meta = META[entity];

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; code: string | null; name: string; isActive: boolean; fold: string }>
    >(
      `SELECT id, "code"::text AS code, "name", COALESCE("isActive", true) AS "isActive",
              ${entity === "color" ? `''` : `"nameFold"`} AS fold
         FROM "${meta.table}"
        WHERE "mergedIntoId" IS NULL`,
    );

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = entity === "color" ? foldColorNameForCompare(r.name) : r.fold;
      if (!key) continue;
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }

    const out: Array<{
      key: string;
      records: Array<{ id: string; code: string | null; name: string; isActive: boolean; refCount: number | null }>;
    }> = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const records = [];
      for (const m of members) {
        records.push({ ...m, fold: undefined, refCount: await countReferences(entity, m.id) });
      }
      out.push({
        key,
        records: records.map(({ id, code, name, isActive, refCount }) => ({
          id,
          code,
          name,
          isActive,
          refCount,
        })),
      });
    }
    // En çok referansı olan grup önce — operatör en pahalı bölünmeyi ilk görsün.
    out.sort(
      (a, b) =>
        b.records.reduce((n, r) => n + (r.refCount ?? 0), 0) -
        a.records.reduce((n, r) => n + (r.refCount ?? 0), 0),
    );
    return out;
  }

  // ———————————————————————————————————————————————————————————————————————————
  // UYGULAMA
  // ———————————————————————————————————————————————————————————————————————————
  //
  // SIRA LOAD-BEARING:
  //   1. advisory kilit — İLK ifade (sonra alınan kilit TOCTOU'yu kapatmaz;
  //      KK1 mükerrer guard'ında birebir yaşandı)
  //   2. TAZE OKU — kilit beklerken kayıtlar değişmiş olabilir (Batch dersi)
  //   3. GUARD'LAR — hiçbir mutasyondan ÖNCE
  //   4. YAN ETKİ İŞARETLERİ — TAŞIMADAN ÖNCE, çünkü hangi topun/kartın
  //      işaretleneceğini ESKİ değere bakan sorgu bulur; taşıdıktan sonra o
  //      satırlar artık survivor'a bakıyor olur ve işaret ya kaçar ya da
  //      survivor'ın kendi satırlarını da gereksizce işaretler
  //   5. ÇAKIŞMA ÇÖZÜMÜ — düz taşımadan ÖNCE (yoksa UNIQUE ihlali)
  //   6. DÜZ TAŞIMALAR
  //   7. ATOMİK CLAIM — `mergedIntoId: null` koşuluyla; count uyuşmazsa 409
  static async merge(
    rawEntity: string,
    params: {
      survivorId: string;
      sourceIds: string[];
      reason: string;
      acknowledgedConflicts: number;
      userId?: string;
      /**
       * ALAN SEÇİMİ (P2): `{ alan: kayıtId }` — o alanın değeri HANGİ KAYITTAN
       * alınacak. Değer değil KAYIT seçilir (bkz. `constants/merge-fields.ts`):
       * uç böylece serbest bir alan düzenleme API'sine dönüşmez. Verilmeyen alan
       * survivor'da neyse öyle kalır (önizlemedeki öneri de budur).
       */
      fieldPicks?: Record<string, string>;
    },
  ): Promise<{
    survivorId: string;
    mergedCount: number;
    movedRows: Array<{ table: string; column: string; count: number }>;
    conflictsResolved: number;
    /** Survivor'a yazılan alanlar (audit + panel özeti). */
    fieldsApplied: Array<{ field: string; from: string; value: string | null }>;
  }> {
    const entity = assertEntity(rawEntity);
    const meta = META[entity];
    const sourceIds = [...new Set(params.sourceIds)].filter((id) => id && id !== params.survivorId);

    if (sourceIds.length === 0) throw AppError.badRequest("Birleştirilecek kayıt seçilmedi.");
    if (sourceIds.length > MAX_MERGE_SOURCES) {
      throw AppError.badRequest(`Tek seferde en fazla ${MAX_MERGE_SOURCES} kayıt birleştirilebilir.`);
    }
    if (!params.reason || params.reason.trim().length < 10) {
      throw AppError.badRequest(
        "Birleştirme gerekçesi en az 10 karakter olmalı — bu kararın başka hiçbir kaydı yok.",
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // 1) Kilit — İLK ifade.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MERGE_LOCK_NS}::int, ${MERGE_LOCK_KEY}::int)`;

        // 2) Taze oku.
        const del = (tx as unknown as Record<string, {
          findMany: (a: unknown) => Promise<Record4[]>;
          updateMany: (a: unknown) => Promise<{ count: number }>;
        }>)[entity]!;
        const fresh = await del.findMany({ where: { id: { in: [params.survivorId, ...sourceIds] } } });
        const survivor = fresh.find((r) => r.id === params.survivorId);
        const sources = fresh.filter((r) => sourceIds.includes(r.id));

        // 3) Guard'lar — hiçbir mutasyondan ÖNCE.
        if (!survivor) throw AppError.notFound("Hedef kayıt bulunamadı.");
        if (survivor.mergedIntoId) {
          throw AppError.conflict("Hedef kayıt bu sırada başka bir kayda birleştirilmiş.");
        }
        if (sources.length !== sourceIds.length) {
          throw AppError.conflict("Kaynak kayıtlardan biri bu sırada silinmiş ya da değişmiş.");
        }
        for (const s of sources) {
          if (s.mergedIntoId) {
            throw AppError.conflict(`'${s.name}' bu sırada başka bir kayda birleştirilmiş.`);
          }
        }
        // Hedef pasif olamaz (dört varlık): pasif karta canlı referans taşımak arşiv kapısını
        // arka kapıdan deler (URUN-YASAM-DONGUSU.md §5.5, §6).
        if (!survivor.isActive && entity !== "item") {
          throw AppError.conflict(
            `Hedef kayıt '${survivor.name}' pasif — birleştirmenin hedefi aktif bir kayıt olmalı.`,
            { code: "MERGE_TARGET_INACTIVE" },
          );
        }
        // Ürün: hedef ACTIVE olmalı — Tükenene kadar/Pasif karta mal ve açık iş taşımak D1'i
        // (pasifte canlı referans olamaz) ya da "karta yeni talep eklenmez" kuralını deler.
        if (entity === "item" && survivor.lifecycleStatus !== ItemLifecycleStatus.ACTIVE) {
          throw AppError.conflict(
            `Hedef kart '${survivor.name}' Aktif değil — birleştirmenin hedefi Aktif bir kart olmalı.`,
            { code: "ITEM_MERGE_TARGET_NOT_ACTIVE" },
          );
        }
        for (const idf of meta.identityFields) {
          const bad = sources.find((s) => s[idf.field] !== survivor[idf.field]);
          if (bad) {
            throw AppError.badRequest(
              `'${bad.name}' kaydının ${idf.label} değeri hedeften farklı — birleştirilemez.`,
            );
          }
        }

        // 3b) Operatör gerçekten gördü mü? Önizlemedeki çakışma sayısı ile
        // gönderilen sayı uyuşmuyorsa arada veri değişmiştir → geri döndür.
        // Per-satır onay yükü olmadan "gördüm" garantisi veren tek mekanizma bu.
        let liveConflicts = 0;
        // ⚠️ Sayımlar BURADA yapılır ve 5. adımda YENİDEN SORULMAZ: iki ayrı
        // sorgu, aradaki hiçbir mutasyon olmasa bile iki farklı cevap verme
        // riski taşır ve "gördüm" garantisi ölçtüğü şeyden ayrışırdı.
        const conflictCounts = new Map<string, number>();
        for (const rule of MERGE_MAP[entity]) {
          if (rule.kind !== "CONFLICT") continue;
          const c = await describeConflictTx(tx, rule, survivor.id, sourceIds);
          conflictCounts.set(`${rule.table}.${rule.column}`, c);
          if (c > 0) liveConflicts++;
          if (c > 0 && rule.policy === "BLOCK") {
            throw AppError.conflict(
              `${c} ${rule.label} kaydı çakışıyor ve otomatik çözülemez: ${rule.why.split(".")[0]}.`,
            );
          }
        }
        if (liveConflicts !== params.acknowledgedConflicts) {
          throw AppError.conflict(
            "Önizlemeden sonra veriler değişti (çakışma sayısı farklı). Lütfen önizlemeyi " +
              "yenileyip tekrar onaylayın.",
          );
        }

        // 3c) BİRLEŞTİRME DEFTERİ — mutasyonlardan ÖNCE doğar (geri almanın tek
        // kaynağı). Kaynakların tombstone ÖNCESİ hâli de burada donar: geri alma
        // adı/aktifliği buradan yazar, audit'ten OKUMAZ (audit 6 ayda arşivlenir).
        const operation = await tx.mergeOperation.create({
          data: {
            entity,
            survivorId: survivor.id,
            reason: params.reason.trim().slice(0, 500),
            createdById: params.userId ?? null,
          },
          select: { id: true },
        });
        await tx.mergeOperationSource.createMany({
          data: sources.map((src) => ({
            operationId: operation.id,
            sourceId: src.id,
            nameBefore: String(src.name).slice(0, 255),
            codeBefore: src.code ? String(src.code).slice(0, 64) : null,
            isActiveBefore: Boolean(src.isActive),
            lifecycleBefore: entity === "item" ? (src.lifecycleStatus as ItemLifecycleStatus) : null,
          })),
        });

        // 4) Yan etki işaretleri — TAŞIMADAN ÖNCE.
        await markSideEffectsTx(tx, entity, sourceIds);

        // 5) Çakışma çözümü + 6) düz taşımalar.
        const movedRows: Array<{ table: string; column: string; count: number }> = [];
        const refRows: Prisma.MergeOperationRefCreateManyInput[] = [];
        const pkCache: PkCache = newPkCache();
        let conflictsResolved = 0;
        for (const rule of MERGE_MAP[entity]) {
          if (rule.kind === "EXEMPT") continue;
          // ⚠️ ÇÖZÜCÜ NE ZAMAN KOŞAR — iki ayrı soru, karıştırma:
          //   • BLOCK / SKIP / UNION / MERGE_FIELDS: YALNIZ gerçek bir çakışma
          //     varsa. Koşulsuz çağırmak, şubesi olmayan iki müşterinin bile
          //     birleştirilememesine yol açıyordu (BLOCK boş kümede de atıyordu).
          //   • EMPTY_MEANS_ALL: ÇAKIŞMA OLMASA DA. Çünkü orada karar çakışmaya
          //     değil survivor'ın BOŞ olup olmadığına bağlı — survivor boşken
          //     çakışacak satır zaten YOKTUR ve tam da o durumda kaynağın
          //     kısıtlarının taşınmaması gerekir (yoksa "hepsi serbest" olan
          //     kumaş sessizce 3 renge daralır).
          const conflictCount = conflictCounts.get(`${rule.table}.${rule.column}`) ?? 0;
          const mustResolve =
            rule.kind === "CONFLICT" &&
            (conflictCount > 0 || rule.policy === "EMPTY_MEANS_ALL");
          if (mustResolve && rule.kind === "CONFLICT") {
            const res = await resolveConflictTx(tx, rule, survivor.id, sourceIds);
            conflictsResolved += res.count;
            // Silinen satır KAYNAĞINA göre gruplanır: fotoğraf satırında taşınan
            // kolonun değeri hâlâ kaynağın id'sidir (silme taşımadan ÖNCE koşar).
            for (const sourceId of sourceIds) {
              const own = res.deletedRows.filter((r) => String(r[rule.column] ?? "") === sourceId);
              if (own.length > 0) {
                refRows.push({
                  operationId: operation.id,
                  sourceId,
                  tableName: rule.table,
                  columnName: rule.column,
                  kind: MergeRefKind.DELETED,
                  count: own.length,
                  // ⚠️ `rowIds` NOT NULL ve DEFAULT'u bilinçli düşürüldü (şema ikizliği):
                  // taşıma dışı kalemlerde AÇIKÇA boş dizi yazılır.
                  rowIds: [],
                  rowData: own as Prisma.InputJsonValue,
                });
              }
            }
            if (res.snapshotRows.length > 0) {
              // FIELD_MERGED satırı SURVIVOR'ın — kaynak yok (`sourceId` NULL).
              refRows.push({
                operationId: operation.id,
                sourceId: null,
                tableName: rule.table,
                columnName: rule.column,
                kind: MergeRefKind.FIELD_MERGED,
                count: res.snapshotRows.length,
                rowIds: [],
                rowData: res.snapshotRows as Prisma.InputJsonValue,
              });
            }
          }
          // ⚠️ TAŞIMA KAYNAK BAŞINA: tek `UPDATE … = ANY(sources)` hangi satırın
          // hangi kaynaktan geldiğini söyleyemez ve geri alma onu tahmin edemez.
          let movedTotal = 0;
          for (const sourceId of sourceIds) {
            const moved = await movePerSourceTx(
              tx,
              { table: rule.table, column: rule.column, survivorId: survivor.id, sourceId },
              pkCache,
            );
            movedTotal += moved.count;
            if (moved.count > 0) {
              refRows.push({
                operationId: operation.id,
                sourceId,
                tableName: rule.table,
                columnName: rule.column,
                kind: MergeRefKind.MOVED,
                count: moved.count,
                rowIds: moved.rowIds,
                ...(moved.rowKeys ? { rowKeys: moved.rowKeys as Prisma.InputJsonValue } : {}),
              });
            }
          }
          movedRows.push({ table: rule.table, column: rule.column, count: movedTotal });
        }
        if (refRows.length > 0) await tx.mergeOperationRef.createMany({ data: refRows });

        // 7) ATOMİK CLAIM — `mergedIntoId: null` koşulu yarışı kapatır.
        const claimed = await del.updateMany({
          where: { id: { in: sourceIds }, mergedIntoId: null },
          data: {
            mergedIntoId: survivor.id,
            mergedAt: new Date(),
            mergedById: params.userId ?? null,
            // Ürünün `isActive`i yaşam döngüsünden türer (CHECK) — mezar taşı ARCHIVED yazılır.
            ...(entity === "item"
              ? itemLifecycleWriteData(ItemLifecycleStatus.ARCHIVED, params.userId, `Birleştirildi → ${String(survivor.name)}`)
              : { isActive: false }),
          },
        });
        if (claimed.count !== sourceIds.length) {
          throw AppError.conflict(
            "Kayıtlar bu sırada değişti — birleştirme geri alındı. Lütfen tekrar deneyin.",
          );
        }
        // Rol modeli: fason profili survivor'a taşındıysa bayrak profil gerçeğinden türetilir (kaynaklar tombstone → false).
        if (entity === "customer") await syncSubcontractorRoleTx(tx, [survivor.id, ...sourceIds]);

        // 8) ALAN SEÇİMİ (P2) — survivor'a kaynaktan seçilen değerleri yaz.
        // ⚠️ SIRA LOAD-BEARING: claim'den SONRA. Kaynaklar artık tombstone
        // (`mergedIntoId` dolu) olduğu için ad seçimi `<tablo>_nameFold_key` partial
        // UNIQUE'iyle kavga etmez (kısıt tombstone'u dışlar). Claim'den ÖNCE yazsaydık
        // "kaynağın adını survivor'a taşı" en sık senaryoda P2002 verirdi.
        const fieldsApplied: Array<{ field: string; from: string; value: string | null }> = [];
        const data: Record<string, unknown> = {};
        for (const [field, fromId] of Object.entries(params.fieldPicks ?? {})) {
          if (!isMergeableField(entity, field)) {
            throw AppError.badRequest(`'${field}' alanı birleştirmede seçilemez.`);
          }
          const donor = fromId === survivor.id ? survivor : sources.find((s) => s.id === fromId);
          if (!donor) {
            throw AppError.badRequest(
              "Alan için seçilen kayıt bu birleştirme grubunda değil (listeyi yenileyin).",
            );
          }
          if (fromId === survivor.id) continue; // Survivor'ın kendi değeri — yazmaya gerek yok.
          const raw = donor[field] ?? null;
          data[field] = raw;
          fieldsApplied.push({ field, from: donor.code ?? donor.id, value: fieldValueOf(donor, field) });
        }
        if (Object.keys(data).length > 0) {
          // Ad seçildiyse: gruptaki kayıtlar DIŞINDA canlı bir eş var mı? DB seddi
          // (yalnız 3 tabloda ve yalnız enforce edilmişse) tek başına yetmez —
          // `assertNameNotDuplicate`in tx içi ikizi. Renk kendi katlamasını kullanır.
          if (Object.prototype.hasOwnProperty.call(data, MERGE_NAME_FIELD)) {
            const newName = String(data[MERGE_NAME_FIELD] ?? "").trim();
            if (!newName) throw AppError.badRequest("Ad boş olamaz.");
            const fold = (v: string): string =>
              entity === "color" ? foldColorNameForCompare(v) : foldNameForCompare(v);
            const target = fold(newName);
            const others = await del.findMany({
              where: { mergedIntoId: null, id: { notIn: [survivor.id, ...sourceIds] } },
              select: { id: true, code: true, name: true },
            });
            const clash = others.find((o) => fold(String(o.name)) === target);
            if (clash) {
              throw AppError.conflict(
                `'${newName}' adı başka bir kayıtta kullanılıyor (kod: ${String(clash.code ?? "—")}). ` +
                  "Ad seçimini değiştirin ya da önce o kaydı da birleştirin.",
              );
            }
          }
          await del.updateMany({ where: { id: survivor.id }, data });
        }

        // Alan seçimleri ve çakışma sayısı deftere: geri alma survivor'ın ESKİ
        // değerini buradan yazar (audit'ten değil).
        await tx.mergeOperation.update({
          where: { id: operation.id },
          data: {
            conflictsResolved,
            fieldPicks:
              fieldsApplied.length > 0
                ? (fieldsApplied.map((f) => ({
                    field: f.field,
                    before: fieldValueOf(survivor, f.field),
                    after: f.value,
                    fromId: f.from,
                  })) as Prisma.InputJsonValue)
                : undefined,
          },
        });

        return {
          operationId: operation.id,
          movedRows,
          conflictsResolved,
          survivorName: survivor.name,
          sources,
          fieldsApplied,
          // Audit'in "önce" tarafı — tx içindeki TAZE hâl (pre-tx okuma bayat olabilir).
          survivorBefore: { ...survivor },
        };
      },
      { timeout: MERGE_TX_TIMEOUT_MS, maxWait: 10_000 },
    );

    // Audit tx DIŞINDA (tx geri sararsa audit de olmamalı).
    for (const s of result.sources) {
      await AuditService.log({
        userId: params.userId,
        action: "UPDATE",
        tableName: meta.auditTable,
        recordId: s.id,
        oldData: { name: s.name, code: s.code, isActive: s.isActive, mergedIntoId: null },
        newData: {
          mergedIntoId: params.survivorId,
          mergedInto: result.survivorName,
          isActive: false,
          reason: params.reason.trim(),
          event: "MASTER_DATA_MERGE",
          movedRows: result.movedRows.filter((m) => m.count > 0),
        },
      });
    }

    // Survivor'a yazılan alanlar AYRI bir audit satırıdır: kaynağın "birleşti" izi
    // ile hedefin "alanı değişti" izi farklı sorulardır ("bu kaydın adı neden değişti?"
    // sorusunun cevabı survivor'ın kaydında aranır).
    if (result.fieldsApplied.length > 0) {
      await AuditService.log({
        userId: params.userId,
        action: "UPDATE",
        tableName: meta.auditTable,
        recordId: params.survivorId,
        oldData: Object.fromEntries(
          result.fieldsApplied.map((f) => [f.field, fieldValueOf(result.survivorBefore, f.field)]),
        ),
        newData: {
          event: "MASTER_DATA_MERGE_FIELDS",
          reason: params.reason.trim(),
          ...Object.fromEntries(result.fieldsApplied.map((f) => [f.field, f.value])),
          fieldsFrom: Object.fromEntries(result.fieldsApplied.map((f) => [f.field, f.from])),
        },
      });
    }

    // Mükerrer inceleme kuyruğuna KARAR izi (2026-08-22): survivor × her kaynak çifti
    // MERGED. Best-effort ve tx DIŞINDA — kuyruk kaydı birleştirmeyi geri sarmaz.
    await DuplicateReviewService.markMerged(
      entity,
      params.survivorId,
      result.sources.map((s) => s.id),
      params.userId,
      params.reason.trim(),
    );

    return {
      survivorId: params.survivorId,
      mergedCount: result.sources.length,
      movedRows: result.movedRows,
      conflictsResolved: result.conflictsResolved,
      fieldsApplied: result.fieldsApplied,
    };
  }
}


/**
 * Tx içi çakışma SAYIMI (önizlemedekinin işlem içi ikizi).
 *
 * ⚠️ Karşılaştırma DÜZ `=`, `IS NOT DISTINCT FROM` DEĞİL — ve fark load-bearing.
 * PostgreSQL'de bir UNIQUE kısıtı iki NULL'ı EŞİT SAYMAZ (varsayılan
 * `NULLS DISTINCT`), yani kodu NULL olan iki şube pekâlâ yan yana durabilir.
 * `IS NOT DISTINCT FROM` NULL=NULL'ı doğru sayar ve o yüzden burada YANLIŞTIR:
 * ölçüldü (2026-08-19) — ihracat kodu olmayan iki müşteriyi "şube kodu
 * çakışıyor" diye BİRLEŞTİRİLEMEZ ilan ediyordu. Predicate'in tek görevi
 * kısıtın davranışını AYNEN taklit etmek; kısıt neyi çakışma saymıyorsa
 * burası da saymamalı.
 */
async function describeConflictTx(
  tx: Prisma.TransactionClient,
  rule: Extract<MoveRule, { kind: "CONFLICT" }>,
  survivorId: string,
  sourceIds: string[],
): Promise<number> {
  const other = rule.uniqueOn.filter((c) => c !== rule.column);
  // Kısıt KOLONUN KENDİSİNDE ise (`CariAccount.customerId @unique`) "diğer
  // anahtar kolonu" yoktur: çakışma, İKİ tarafın da satırı olduğunda doğar.
  // Bu dalın önizleme ikizi (`describeConflict`) ile AYNI yüklemi kurması
  // load-bearing — ayrışırsa önizleme bloklar, işlem sessizce geçerdi.
  const matchOther = other.length > 0 ? ` AND (${other.map((c) => `t."${c}" = s."${c}"`).join(" AND ")})` : "";
  const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "${rule.table}" s
      WHERE s."${rule.column}" = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM "${rule.table}" t
                     WHERE t."${rule.column}" = $2::uuid${matchOther})`,
    sourceIds,
    survivorId,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Çakışan satırları politikaya göre çözer ve KAÇ satıra dokunulduğunu döner.
 * Bu adımdan sonra düz `UPDATE` çakışmasız koşabilir.
 */
interface ConflictResolution {
  /** Dokunulan satır sayısı (eski dönüş değeri — çağıranın sayacı bozulmaz). */
  count: number;
  /** Silinen satırların TAM fotoğrafı — geri alma bunlardan yeniden yazar. */
  deletedRows: Array<Record<string, unknown>>;
  /** `MERGE_FIELDS`te ZENGİNLEŞTİRİLMEDEN ÖNCEKİ survivor satırları. */
  snapshotRows: Array<Record<string, unknown>>;
}

async function resolveConflictTx(
  tx: Prisma.TransactionClient,
  rule: Extract<MoveRule, { kind: "CONFLICT" }>,
  survivorId: string,
  sourceIds: string[],
): Promise<ConflictResolution> {
  const other = rule.uniqueOn.filter((c) => c !== rule.column);
  const matchOther = other.map((c) => `t."${c}" = s."${c}"`).join(" AND ");
  // Sayım ikiziyle aynı yüklem — tek kolonlu kısıtta "diğer kolon" yoktur.
  const conflictWhere =
    `s."${rule.column}" = ANY($1::uuid[])
       AND EXISTS (SELECT 1 FROM "${rule.table}" t
                    WHERE t."${rule.column}" = $2::uuid${other.length > 0 ? ` AND (${matchOther})` : ""})`;

  switch (rule.policy) {
    case "BLOCK":
      // Buraya gelinmez — çağıran zaten 409 attı. Yine de sessiz geçme.
      throw AppError.conflict(`'${rule.label}' çakışması otomatik çözülemez.`);

    case "EMPTY_MEANS_ALL": {
      // (fotoğraflı silme — gerekçe aşağıda)
      // ⚠️ "BOŞ = HEPSİ": survivor'ın HİÇ satırı yoksa kısıt "hepsi serbest"
      // demektir; kaynağın satırlarını taşımak onu SESSİZCE DARALTIR. O yüzden
      // survivor boşken kaynağınkiler tamamen atılır, doluyken yalnız çakışanlar.
      const survivorRows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${rule.table}" WHERE "${rule.column}" = $1::uuid`,
        survivorId,
      );
      const survivorHasRows = Number(survivorRows[0]?.n ?? 0) > 0;
      if (!survivorHasRows) {
        const rows = await deleteCapturingTx(tx, {
          table: rule.table,
          where: `s."${rule.column}" = ANY($1::uuid[])`,
          args: [sourceIds],
        });
        return { count: rows.length, deletedRows: rows, snapshotRows: [] };
      }
      const rows = await deleteCapturingTx(tx, {
        table: rule.table,
        where: conflictWhere,
        args: [sourceIds, survivorId],
      });
      return { count: rows.length, deletedRows: rows, snapshotRows: [] };
    }

    case "SKIP":
    case "UNION":
    case "UNION_COMPOSITE_PK": {
      // Üçü de aynı SQL'e iner (çakışanı sil, gerisi taşınsın) ama AYRI
      // isimlendirildi çünkü GEREKÇELERİ farklı ve haritayı okuyan kişi
      // "neden survivor kazanıyor?" sorusunun cevabını orada bulmalı.
      // ⚠️ UNION_COMPOSITE_PK'da alternatif yol (updateMany) MÜMKÜN DEĞİL:
      // PK'nın yarısını değiştiren UPDATE çakışan satırda P2002 verir ve
      // `skipDuplicates` bir UPDATE'te yoktur.
      const rows = await deleteCapturingTx(tx, {
        table: rule.table,
        where: conflictWhere,
        args: [sourceIds, survivorId],
      });
      return { count: rows.length, deletedRows: rows, snapshotRows: [] };
    }

    case "MERGE_FIELDS": {
      // Alan alan birleşme (customer_color_aliases): önce survivor satırını
      // kaynağın değerleriyle ZENGİNLEŞTİR, sonra kaynağınkini sil.
      // `assigned` = OR (atanmışlık KAYBOLMAMALI — yoksa renk survivor'ın
      // "Müşteri Renkleri" listesinden düşer ve picker'da görünmez olur),
      // `alias` = COALESCE (survivor'ınki doluysa o kazanır; etikete basılan
      // değeri değiştirmiyoruz).
      // Zenginleşecek survivor satırlarının fotoğrafı — yazımdan ÖNCE.
      const before = await snapshotRowsTx(tx, {
        table: rule.table,
        where: `t."${rule.column}" = $2::uuid
            AND EXISTS (SELECT 1 FROM "${rule.table}" s
                         WHERE s."${rule.column}" = ANY($1::uuid[])${other.length > 0 ? ` AND (${other.map((c) => `t."${c}" = s."${c}"`).join(" AND ")})` : ""})`,
        args: [sourceIds, survivorId],
      });
      await tx.$executeRawUnsafe(
        `UPDATE "${rule.table}" t
            SET "assigned" = t."assigned" OR s."assigned",
                "alias"    = COALESCE(NULLIF(t."alias", ''), s."alias")
           FROM "${rule.table}" s
          WHERE t."${rule.column}" = $2::uuid
            AND s."${rule.column}" = ANY($1::uuid[])
            AND (${matchOther})`,
        sourceIds,
        survivorId,
      );
      const rows = await deleteCapturingTx(tx, {
        table: rule.table,
        where: conflictWhere,
        args: [sourceIds, survivorId],
      });
      return { count: rows.length, deletedRows: rows, snapshotRows: before };
    }
  }
}

/**
 * YAN ETKİ İŞARETLERİ — taşımadan ÖNCE koşar.
 *
 * Yön kuralı `markTravelerCardDirtyTx` ile aynı: FAZLA işaretlemek güvenli,
 * EKSİK işaretlemek hata. Fazla rozet gereksiz bir baskı yaptırır; eksik rozet
 * sahaya yanlış ad taşıyan kâğıt gönderir.
 *
 * ⚠️ Ölü toplar kapsam dışı (`K18_DEAD_STATUSES`): iptal/fire/sevk edilmiş topun
 * etiketini "yeniden bas" diye işaretlemek, basılacak kâğıdı olmayan bir iş
 * üretir ve gerçek işaretleri gürültüye boğar.
 */
async function markSideEffectsTx(
  tx: Prisma.TransactionClient,
  entity: MergeEntity,
  sourceIds: string[],
): Promise<void> {
  const DEAD = ["CANCELLED", "SCRAP", "SHIPPED", "SUBCONTRACTOR_CONSUMED", "KARTELA_CONSUMED"];

  if (entity === "customer") {
    await tx.$executeRawUnsafe(
      `UPDATE "rolls" SET "labelDirty" = true
        WHERE "labelCustomerId" = ANY($1::uuid[]) AND "labelDirty" = false
          AND "status" <> ALL($2::text[]::"RollStatus"[])`,
      sourceIds,
      DEAD,
    );
    await tx.$executeRawUnsafe(
      `UPDATE "sacks" SET "labelDirty" = true
        WHERE "customerId" = ANY($1::uuid[]) AND "labelDirty" = false`,
      sourceIds,
    );
    return;
  }

  const rollColumn = entity === "item" ? "itemId" : entity === "color" ? "colorId" : null;
  if (rollColumn) {
    await tx.$executeRawUnsafe(
      `UPDATE "rolls" SET "labelDirty" = true
        WHERE "${rollColumn}" = ANY($1::uuid[]) AND "labelDirty" = false
          AND "status" <> ALL($2::text[]::"RollStatus"[])`,
      sourceIds,
      DEAD,
    );
    const woCol = entity === "item" ? "targetItemId" : "targetColorId";
    const wos = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "work_orders" WHERE "${woCol}" = ANY($1::uuid[])`,
      sourceIds,
    );
    await markTravelerCardsDirtyTx(tx, wos.map((w) => w.id));
  }
}


/**
 * Kaydın kaç satır tarafından referans alındığı — survivor seçimine yardım eder
 * ("belgelerde hangi kod yazıyor?" sorusunun sayısal ipucu). Ölçülemezse `null`;
 * 0 DEĞİL (`backup-impact` disiplini — "sayamadım" ile "hiç yok" farklı cümleler).
 */
/** Bir kaydın merge-map'teki tüm referans sayısı (ölçülemezse `null`). Tespit servisi de kullanır. */
export async function countReferences(entity: MergeEntity, id: string): Promise<number | null> {
  let total = 0;
  for (const rule of MERGE_MAP[entity]) {
    if (rule.kind === "EXEMPT") continue;
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${rule.table}" WHERE "${rule.column}" = $1::uuid`,
        id,
      );
      total += Number(rows[0]?.n ?? 0);
    } catch {
      return null;
    }
  }
  return total;
}

/**
 * TOPLU referans sayımı — `countReferences`in liste hâli (2026-08-22).
 *
 * `countReferences` kayıt BAŞINA bir sorgu koşar; müşteride 12 kural var, yani
 * 50 satırlık bir listede 600 sorgu eder. Bu sürüm kural BAŞINA tek sorgu koşar
 * (`GROUP BY`), yani satır sayısından bağımsız olarak 12'de kalır.
 *
 * ⚠️ Dönen haritada bir id YOKSA bu "0" demektir, "ölçülemedi" değil. Ölçüm
 * düşerse (tablo/kolon yok) fonksiyon `null` döner — kısmi sonuç DÖNMEZ, çünkü
 * eksik sayım operatöre "bu kayda dokunulmayacak" diye okunur (`countRows`
 * yorumundaki aynı gerekçe).
 */
export async function countReferencesBatch(
  entity: MergeEntity,
  ids: string[],
): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  for (const rule of MERGE_MAP[entity]) {
    if (rule.kind === "EXEMPT") continue;
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ k: string; n: bigint }>>(
        `SELECT "${rule.column}"::text AS k, count(*)::bigint AS n
           FROM "${rule.table}" WHERE "${rule.column}" = ANY($1::uuid[])
          GROUP BY 1`,
        ids,
      );
      for (const r of rows) out.set(r.k, (out.get(r.k) ?? 0) + Number(r.n));
    } catch {
      return null;
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, 0);
  return out;
}

/** `updateMany` hedefi olacak satır sayısı — ölçülemezse `null`. */
async function countRows(rule: MoveRule, sourceIds: string[]): Promise<number | null> {
  if (rule.kind === "EXEMPT") return null;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "${rule.table}" WHERE "${rule.column}" = ANY($1::uuid[])`,
      sourceIds,
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    // ⚠️ 0 DÖNDÜRME. "Sayamadım" ile "hiç yok" farklı cümlelerdir ve operatör
    // ikincisini "dokunulmayacak" diye okur.
    return null;
  }
}

/** Çakışan satırları say + birkaç örnek göster. */
async function describeConflict(
  rule: Extract<MoveRule, { kind: "CONFLICT" }>,
  survivorId: string,
  sourceIds: string[],
): Promise<MergeConflictRow> {
  const other = rule.uniqueOn.filter((c) => c !== rule.column);
  const otherCols = other.map((c) => `"${c}"`).join(", ");
  const sample = 5;
  let count = 0;
  let rows: Array<Record<string, unknown>> = [];
  try {
    // Çakışma = kaynak satırın (diğer anahtar kolonları) survivor'da ZATEN var.
    // ⚠️ Tek kolonlu kısıt (`CariAccount.customerId @unique`) da survivor'da
    // satır ARAR — koşulsuz "kaynağın her satırı çakışma" saymak, hedefin hiç
    // cari hesabı yokken bile birleştirmeyi bloklardı (işlem ikiziyle ayrışma).
    const sql =
      other.length > 0
        ? `SELECT s.* FROM "${rule.table}" s
           WHERE s."${rule.column}" = ANY($1::uuid[])
             AND EXISTS (SELECT 1 FROM "${rule.table}" t
                          WHERE t."${rule.column}" = $2::uuid
                            AND (${other.map((c) => `t."${c}" = s."${c}"`).join(" AND ")}))
           ORDER BY ${otherCols}`
        : `SELECT s.* FROM "${rule.table}" s
           WHERE s."${rule.column}" = ANY($1::uuid[])
             AND EXISTS (SELECT 1 FROM "${rule.table}" t WHERE t."${rule.column}" = $2::uuid)`;
    const all = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, sourceIds, survivorId);
    count = all.length;
    rows = all.slice(0, sample);
  } catch {
    count = 0;
  }
  return {
    table: rule.table,
    label: rule.label,
    policy: rule.policy,
    why: rule.why,
    count,
    rows,
    truncated: count > rows.length,
  };
}

export { MERGE_LOCK_NS, MERGE_LOCK_KEY, MERGE_TX_TIMEOUT_MS, MAX_ROWS_TO_MOVE };
