// =============================================================================
// TOP AŞAMASI GERİ DOLDURMA — planlayıcı + uygulayıcı (2026-11-10, plan "Top aşaması")
// =============================================================================
// Migration `20261110120000_roll_stage` kolonu TOHUMLA doldurdu (renkli → FINISHED, renksiz → RAW).
// Bu modül migration ÖNCESİ doğmuş toplara geçmişten çıkarsanabilen aşamayı yazar; CLI
// `scripts/backfill_roll_stage.ts`, bekçi `test_roll_asama_geri_doldurma.ts` aynı fonksiyonu çağırır.
//
// Kapsam: `createdAt < kesim` (kesim = migration'ın `finished_at`i). Kesimden SONRA güncellenmiş top
// ATLANIR (kodun doğuş/iniş yazımı ya da elle düzeltme olabilir) — listede ayrı kova.
// Claim: `updateMany WHERE {id, stage: <okunan tohum>, updatedAt < kesim}`; atalar önce hesaplanır.
// Ölü top (TAMBUR_CONSUMED, SCRAP…) kuralları ÖLÜM ÖNCESİ statüsüyle (`RollStatusEvent`) alır — depo
// kesimi çocuğu atadan miras aldığı için; defterde yoksa tohum korunur (K7).
// =============================================================================
import { RollEntrySource, RollStage, RollStatus } from "@prisma/client";
import type defaultPrisma from "../../src/lib/prisma";

type PrismaClient = typeof defaultPrisma;

export const STAGE_MIGRATION = "20261110120000_roll_stage";

export type Kural =
  | "K1_KESIM_ATA"            // TAMBUR_SPLIT + üretim adımı yok → atanın aşaması (depo kesimi)
  | "K2_TAMBUR_URETIM"        // TAMBUR_SPLIT + üretim adımı dolu, üretimde değil → FINISHED
  | "K3_BITMIS_STATU"         // WAREHOUSE/A1_STOCK/SHIPPED/AT_KARTELA/KARTELA_CONSUMED → FINISHED
  | "K4_YARI_MAMUL_STOK"      // STOCK + yarı mamul girişi → SEMI_FINISHED
  | "K5_STOK_RENKSIZ"         // STOCK renksiz → RAW
  | "K5_STOK_RENKLI_BELIRSIZ" // STOCK renkli → KORU (ya da --renkli-stok değeri)
  | "K6_URETIM_YARI_MAMUL"    // üretimde/ölü + yarı mamul girişi → SEMI_FINISHED
  | "K6_URETIM_KAYNAK"        // üretimde/ölü + fason dönüşü/tambur kesimi → kaynağın aşaması
  | "K6_URETIM_HAM"           // üretimde/ölü, diğer → RAW
  | "K7_OLU_TOHUM";           // ölü + ölüm öncesi statü defterde yok → tohum KORUNUR

const BITMIS_STATU: ReadonlySet<RollStatus> = new Set([
  RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.SHIPPED, RollStatus.AT_KARTELA, RollStatus.KARTELA_CONSUMED,
]);
/** Ölü statüler: kurallar ÖLÜM ÖNCESİ statüyle (`RollStatusEvent.fromStatus`) uygulanır (atası olarak miras için). */
const OLU_STATU: ReadonlySet<RollStatus> = new Set([
  RollStatus.TAMBUR_CONSUMED, RollStatus.SUBCONTRACTOR_CONSUMED, RollStatus.RETURNED_FROM_SUBCONTRACTOR,
  RollStatus.SCRAP, RollStatus.CANCELLED,
]);
const ORDER: Record<RollStage, number> = { RAW: 0, SEMI_FINISHED: 1, FINISHED: 2 };

export interface PlanSatiri {
  id: string;
  barcode: string | null;
  status: RollStatus;
  eski: RollStage;
  yeni: RollStage;
  kural: Kural;
}

export interface Plan {
  kesim: Date;
  /** Yazılacak (eski ≠ yeni, kesimden sonra dokunulmamış). */
  yazilacak: PlanSatiri[];
  /** Hesaplanan değer farklı ama kesimden sonra güncellenmiş → atlandı. */
  atlananKesimSonrasi: PlanSatiri[];
  /** Renkli STOCK — tohum (FINISHED) korunur; `--renkli-stok` verilmedikçe yazılmaz. */
  belirsiz: PlanSatiri[];
  /** Kural başına hesaplanan (değişmeyen dahil) adet. */
  kuralSayisi: Record<string, number>;
  /** Aday (kesim öncesi doğmuş) top sayısı. */
  aday: number;
}

export interface PlanOpts {
  /** Renkli STOCK kovasının hedefi; verilmezse KORU. */
  renkliStok?: RollStage | null;
  /** Bekçi kapsamı: yalnız bu id'ler yazılabilir (atalar yine okunur). */
  idler?: readonly string[];
  /** Bekçi için kesim ezmesi; verilmezse `_prisma_migrations`. */
  kesim?: Date;
}

export async function stageKesimi(prisma: PrismaClient): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null }>>`
    SELECT finished_at FROM "_prisma_migrations"
    WHERE migration_name = ${STAGE_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at ASC LIMIT 1`;
  return rows[0]?.finished_at ?? null;
}

interface Satir {
  id: string; barcode: string | null; status: RollStatus; entrySource: RollEntrySource; colorId: string | null;
  producedInStepId: string | null; parentRollId: string | null; parentReceiptId: string | null; stage: RollStage;
  createdAt: Date; updatedAt: Date;
}

export async function planla(prisma: PrismaClient, opts: PlanOpts = {}): Promise<Plan> {
  const kesim = opts.kesim ?? (await stageKesimi(prisma));
  if (!kesim) throw new Error(`Migration ${STAGE_MIGRATION} uygulanmamış — önce migrate deploy.`);

  const rows: Satir[] = await prisma.roll.findMany({
    where: { createdAt: { lt: kesim } },
    select: {
      id: true, barcode: true, status: true, entrySource: true, colorId: true, producedInStepId: true,
      parentRollId: true, parentReceiptId: true, stage: true, createdAt: true, updatedAt: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Fason dönüşü kaynağı: kabul kalemi → sevk kalemi → top; açık kumaş: makbuzun yeni topları.
  const receiptSource = new Map<string, string>();
  const items = await prisma.subcontractorReceiptItem.findMany({
    where: { newRoll: { createdAt: { lt: kesim } } },
    select: { receiptId: true, newRollId: true, sourceDispatchItem: { select: { rollId: true } } },
  });
  const receiptRolls = new Map<string, string[]>();
  for (const it of items) {
    if (it.sourceDispatchItem?.rollId) receiptSource.set(it.newRollId, it.sourceDispatchItem.rollId);
    const arr = receiptRolls.get(it.receiptId) ?? [];
    arr.push(it.newRollId);
    receiptRolls.set(it.receiptId, arr);
  }
  // Kesim sonrası doğmuş kaynak toplar `byId`de yok — aşamaları ayrıca okunur.
  const disKaynakIds = new Set<string>();
  for (const r of rows) if (r.parentRollId && !byId.has(r.parentRollId)) disKaynakIds.add(r.parentRollId);
  for (const s of receiptSource.values()) if (!byId.has(s)) disKaynakIds.add(s);
  const disStage = new Map<string, RollStage>();
  if (disKaynakIds.size > 0) {
    for (const d of await prisma.roll.findMany({ where: { id: { in: [...disKaynakIds] } }, select: { id: true, stage: true } })) disStage.set(d.id, d.stage);
  }

  // Ölü topun ölüm öncesi statüsü: mevcut statüye giren SON defter satırının `fromStatus`u.
  const olumOncesi = new Map<string, RollStatus>();
  const oluIds = rows.filter((r) => OLU_STATU.has(r.status)).map((r) => r.id);
  for (let i = 0; i < oluIds.length; i += 5000) {
    const ev = await prisma.rollStatusEvent.findMany({
      where: { rollId: { in: oluIds.slice(i, i + 5000) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { rollId: true, fromStatus: true, toStatus: true },
    });
    for (const e of ev) {
      if (e.toStatus === byId.get(e.rollId)?.status && e.fromStatus && !OLU_STATU.has(e.fromStatus)) olumOncesi.set(e.rollId, e.fromStatus);
    }
  }

  const izinli = opts.idler ? new Set(opts.idler) : null;
  const hesap = new Map<string, { yeni: RollStage; kural: Kural }>();
  const yazilirMi = (r: Satir): boolean => r.updatedAt < kesim && (!izinli || izinli.has(r.id));

  /** Topun ETKİN aşaması (çocuklar miras alır): yazılacaksa hesaplanan, değilse DB'deki. */
  const etkin = (id: string, yigin: Set<string>): RollStage => {
    const r = byId.get(id);
    if (!r) return disStage.get(id) ?? RollStage.RAW;
    const h = hesapla(r, yigin);
    return yazilirMi(r) && !(h.kural === "K5_STOK_RENKLI_BELIRSIZ" && !opts.renkliStok) ? h.yeni : r.stage;
  };

  const kaynakAsamasi = (r: Satir, yigin: Set<string>): RollStage => {
    if (r.parentRollId) return etkin(r.parentRollId, yigin);
    const src = receiptSource.get(r.id);
    if (src) return etkin(src, yigin);
    if (r.parentReceiptId) {
      const kardes = (receiptRolls.get(r.parentReceiptId) ?? []).filter((x) => x !== r.id);
      if (kardes.length > 0) return kardes.map((k) => etkin(k, yigin)).reduce((a, b) => (ORDER[b] < ORDER[a] ? b : a));
    }
    return RollStage.RAW;
  };

  function hesapla(r: Satir, yigin: Set<string>): { yeni: RollStage; kural: Kural } {
    const c = hesap.get(r.id);
    if (c) return c;
    if (yigin.has(r.id)) return { yeni: r.stage, kural: "K6_URETIM_HAM" }; // döngü koruması (bozuk soy)
    yigin.add(r.id);
    let out: { yeni: RollStage; kural: Kural };
    const olu = OLU_STATU.has(r.status);
    const status = olu ? olumOncesi.get(r.id) ?? null : r.status;
    if (status == null) {
      out = { yeni: r.stage, kural: "K7_OLU_TOHUM" };
    } else if (r.entrySource === RollEntrySource.TAMBUR_SPLIT && r.producedInStepId == null) {
      out = { yeni: r.parentRollId ? etkin(r.parentRollId, yigin) : r.stage, kural: "K1_KESIM_ATA" };
    } else if (r.entrySource === RollEntrySource.TAMBUR_SPLIT && status !== RollStatus.IN_PRODUCTION) {
      out = { yeni: RollStage.FINISHED, kural: "K2_TAMBUR_URETIM" };
    } else if (BITMIS_STATU.has(status)) {
      out = { yeni: RollStage.FINISHED, kural: "K3_BITMIS_STATU" };
    } else if (status === RollStatus.STOCK && r.entrySource === RollEntrySource.SEMI_FINISHED) {
      out = { yeni: RollStage.SEMI_FINISHED, kural: "K4_YARI_MAMUL_STOK" };
    } else if (status === RollStatus.STOCK && r.colorId == null) {
      out = { yeni: RollStage.RAW, kural: "K5_STOK_RENKSIZ" };
    } else if (status === RollStatus.STOCK) {
      out = { yeni: opts.renkliStok ?? r.stage, kural: "K5_STOK_RENKLI_BELIRSIZ" };
    } else if (r.entrySource === RollEntrySource.SEMI_FINISHED) {
      out = { yeni: RollStage.SEMI_FINISHED, kural: "K6_URETIM_YARI_MAMUL" };
    } else if (r.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN || r.entrySource === RollEntrySource.TAMBUR_SPLIT) {
      out = { yeni: kaynakAsamasi(r, yigin), kural: "K6_URETIM_KAYNAK" };
    } else {
      out = { yeni: RollStage.RAW, kural: "K6_URETIM_HAM" };
    }
    yigin.delete(r.id);
    hesap.set(r.id, out);
    return out;
  }

  const plan: Plan = { kesim, yazilacak: [], atlananKesimSonrasi: [], belirsiz: [], kuralSayisi: {}, aday: 0 };
  for (const r of rows) {
    if (izinli && !izinli.has(r.id)) continue;
    plan.aday++;
    const h = hesapla(r, new Set());
    plan.kuralSayisi[h.kural] = (plan.kuralSayisi[h.kural] ?? 0) + 1;
    const satir: PlanSatiri = { id: r.id, barcode: r.barcode, status: r.status, eski: r.stage, yeni: h.yeni, kural: h.kural };
    if (h.kural === "K5_STOK_RENKLI_BELIRSIZ" && !opts.renkliStok) {
      plan.belirsiz.push(satir);
      continue;
    }
    if (h.yeni === r.stage) continue;
    if (r.updatedAt >= kesim) plan.atlananKesimSonrasi.push(satir);
    else plan.yazilacak.push(satir);
  }
  return plan;
}

/** Planı yazar; her satır kendi okunan aşamasıyla claim edilir. Döner: yazılan adet. */
export async function uygula(prisma: PrismaClient, plan: Plan, batch = 500): Promise<number> {
  const gruplar = new Map<string, string[]>();
  for (const s of plan.yazilacak) {
    const k = `${s.eski}>${s.yeni}`;
    const arr = gruplar.get(k) ?? [];
    arr.push(s.id);
    gruplar.set(k, arr);
  }
  let yazilan = 0;
  for (const [k, ids] of gruplar) {
    const [eski, yeni] = k.split(">") as [RollStage, RollStage];
    for (let i = 0; i < ids.length; i += batch) {
      const res = await prisma.roll.updateMany({
        where: { id: { in: ids.slice(i, i + batch) }, stage: eski, updatedAt: { lt: plan.kesim } },
        data: { stage: yeni },
      });
      yazilan += res.count;
    }
  }
  return yazilan;
}
