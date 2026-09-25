// =============================================================================
// ÜRÜN KARTI KULLANIM KURALI — tek kaynak (`assertItemUsable`)
// =============================================================================
// Tasarım: docs/design/URUN-YASAM-DONGUSU.md §4. Ölçüt tek cümle: işlem kartın üstünde
// ZATEN VAR OLAN bir malı ya da açık bir belgeyi mi yürütüyor, yoksa karta YENİ bir
// talep, stok ya da tanım mı ekliyor?
//
//   A1 NEW_ORDER       yeni sipariş satırı · toplardan hızlı sipariş      PHASE_OUT → ayar
//   A2 LINE_QTY        açık sipariş satırında miktar                      PHASE_OUT → ayar
//   A3 NEW_PLAN        topsuz+siparişsiz iş emri · hedef ürün değişimi ·  PHASE_OUT → ayar
//                      yeni dokuma işi · işsiz tezgah koşumu
//   A4 NEW_PURCHASE    alış siparişi satırı                               PHASE_OUT ✖
//   B  DEFINITION      reçete · fiyat · müşteri adı · izinli renk/özellik · çözgü kartı  ✖
//   C  NEW_STOCK       belgesiz KK1/elle giriş · iplik girişi/lotu        PHASE_OUT ✖
//   C′ DOC_COMPLETION  açık belgeyi tamamlayan giriş (PO satırlı kabul ·  PHASE_OUT ✔
//                      dokuma/doff kabulü · fason dokuma kabulü)
//   E  EXISTING_GOODS  mevcut malı yürüten her iş                         PHASE_OUT ✔
//
// ARCHIVED her sınıfta ✖ (D1 gereği canlı referans zaten olamaz; fail-closed). Bu
// dosyanın DIŞINDA Item üzerinde çıplak `isActive` kontrolü yazılmaz — cırcır:
// `scripts/test_item_usage_single_source.ts`.
//
// KİLİT: `assertItemUsableTx` referans yazan tx'te 8030 SHARED → kart FOR SHARE alır
// (yaşam döngüsü yazıcısıyla aynı sıra). Tx dışı `assertItemUsable` yalnız ön kontrol
// ya da D1'e sayılmayan (B sınıfı) yazımlar içindir.
// =============================================================================
import { ItemLifecycleStatus, ItemType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lockAgainstMergeTx } from "./master-data-live.helper";
import { PHASE_OUT_LINE_QTY_WARNING } from "./item-lifecycle-settings.helper";
import {
  readItemPhaseOutLineQty,
  readItemPhaseOutNewOrder,
  readItemPhaseOutNewPlan,
} from "../system-setting.service";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Referans doğuran yolun kart kilidi: FOR SHARE (8030 SHARED'dan SONRA). Yaşam döngüsü
 * yazıcısının FOR UPDATE'i bu tx bitene dek bekler ve yeni referansı sayar. Burada yaşar
 * (yazıcıda değil): kullanım kontrolü canlı referans SAYIMINA bağımlı değildir.
 */
async function lockItemRowForShareTx(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "items" WHERE id = ${itemId}::uuid FOR SHARE`;
}

export type ItemUsage =
  | "NEW_ORDER"
  | "LINE_QTY"
  | "NEW_PLAN"
  | "NEW_PURCHASE"
  | "DEFINITION"
  | "NEW_STOCK"
  | "DOC_COMPLETION"
  | "EXISTING_GOODS";

export interface ItemUsageOpts {
  /** A1: satır okutulan toplardan mı doğuyor (hızlı sipariş). */
  fromScannedRolls?: boolean;
  /** A2: satırın eski ve yeni miktarı (değişmiyorsa kontrol koşmaz). */
  oldQty?: Prisma.Decimal | number | string;
  newQty?: Prisma.Decimal | number | string;
}

export interface ItemUsageResult {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  lifecycleStatus: ItemLifecycleStatus;
  /** Engel olmayan not (A2 `SERBEST_UYARILI`) — çağıran `ApiResponse.warnings`e ekler. */
  warnings: string[];
}

const TYPE_NOUN: Record<ItemType, string> = { FABRIC: "kumaşı", YARN: "ipliği", CONSUMABLE: "sarf kalemi" };

const PHASE_OUT_REASON: Record<Exclude<ItemUsage, "DOC_COMPLETION" | "EXISTING_GOODS">, string> = {
  NEW_ORDER: "yeni sipariş açılamaz; mevcut topları okutarak hızlı sipariş açabilir ya da stoktan sevk edebilirsiniz",
  LINE_QTY: "açık satırın miktarı değiştirilemez; mevcut stoktan sevk edebilirsiniz",
  NEW_PLAN: "yeni üretim planı açılamaz; mevcut topları okutarak iş emri açabilirsiniz",
  NEW_PURCHASE: "yeni alış siparişi açılamaz",
  DEFINITION: "karta yeni tanım (fiyat, reçete, izinli renk/özellik, müşteri adı, çözgü) eklenemez",
  NEW_STOCK: "karta yeni stok girişi yapılamaz; kartı yeniden doldurmak için Aktif'e döndürün",
};

function phaseOutBlocked(name: string, type: ItemType, reason: string): AppError {
  return AppError.conflict(`"${name}" ${TYPE_NOUN[type]} 'Tükenene kadar' modunda — ${reason}.`, {
    code: "ITEM_PHASE_OUT",
  });
}

type Row = {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  lifecycleStatus: ItemLifecycleStatus;
  mergedIntoId: string | null;
  survivorName: string | null;
};

async function readRow(db: Db, itemId: string, lock: boolean): Promise<Row | null> {
  if (lock) await lockItemRowForShareTx(db as Prisma.TransactionClient, itemId);
  const r = await db.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      code: true,
      name: true,
      itemType: true,
      lifecycleStatus: true,
      mergedIntoId: true,
      mergedInto: { select: { name: true } },
    },
  });
  return r ? { ...r, survivorName: r.mergedInto?.name ?? null } : null;
}

const toNum = (v: Prisma.Decimal | number | string | undefined): number | null =>
  v === undefined ? null : Number(v.toString());

/** Kural motoru — satır okunduktan sonra (kilitli ya da değil) aynı karar. */
async function decide(row: Row | null, usage: ItemUsage, opts: ItemUsageOpts, db: Db): Promise<ItemUsageResult> {
  // Gövdedeki referans (URL değil) — taşınan kontrollerin çoğunluğu gibi 400 (FK 500'ü yerine operatör dili).
  if (!row) throw AppError.badRequest("Kalem bulunamadı.", { code: "ITEM_NOT_FOUND" });
  if (row.mergedIntoId) {
    throw AppError.conflict(
      `"${row.name}" kartı "${row.survivorName ?? "başka bir kayıt"}" ile birleştirildi. Kaydı o kartla yeniden girin.`,
      { code: "ITEM_MERGED", survivorName: row.survivorName },
    );
  }
  const base = { id: row.id, code: row.code, name: row.name, itemType: row.itemType, lifecycleStatus: row.lifecycleStatus };
  if (row.lifecycleStatus === ItemLifecycleStatus.ARCHIVED) {
    throw AppError.conflict(
      `"${row.name}" ${TYPE_NOUN[row.itemType]} pasif durumda — bu kartla yeni kayıt açılamaz. Kartı Aktif'e döndürün ya da doğru kartı seçin.`,
      { code: "ITEM_INACTIVE" },
    );
  }
  if (row.lifecycleStatus === ItemLifecycleStatus.ACTIVE) return { ...base, warnings: [] };

  // ── PHASE_OUT ─────────────────────────────────────────────────────────────
  const client = db as Pick<typeof prisma, "systemSetting">;
  switch (usage) {
    case "DOC_COMPLETION":
    case "EXISTING_GOODS":
      return { ...base, warnings: [] };
    case "NEW_ORDER": {
      const mode = await readItemPhaseOutNewOrder(client);
      if (mode === "SERBEST" || (mode === "OKUTULAN_TOPLAR" && opts.fromScannedRolls)) return { ...base, warnings: [] };
      const reason =
        mode === "KAPALI" ? "yeni sipariş açılamaz; mevcut stoktan sevk edebilirsiniz" : PHASE_OUT_REASON.NEW_ORDER;
      throw phaseOutBlocked(row.name, row.itemType, reason);
    }
    case "LINE_QTY": {
      const oldQ = toNum(opts.oldQty);
      const newQ = toNum(opts.newQty);
      if (oldQ === null || newQ === null || oldQ === newQ) return { ...base, warnings: [] };
      const mode = await readItemPhaseOutLineQty(client);
      if (mode === "SERBEST_UYARILI") return { ...base, warnings: [PHASE_OUT_LINE_QTY_WARNING] };
      if (mode === "AZALTMA_SERBEST" && newQ < oldQ) return { ...base, warnings: [] };
      const reason =
        mode === "AZALTMA_SERBEST"
          ? "açık satırın miktarı yalnız azaltılabilir"
          : PHASE_OUT_REASON.LINE_QTY;
      throw phaseOutBlocked(row.name, row.itemType, reason);
    }
    case "NEW_PLAN":
      if (await readItemPhaseOutNewPlan(client)) return { ...base, warnings: [] };
      throw phaseOutBlocked(row.name, row.itemType, PHASE_OUT_REASON.NEW_PLAN);
    default:
      throw phaseOutBlocked(row.name, row.itemType, PHASE_OUT_REASON[usage]);
  }
}

/** Ön kontrol / D1'e sayılmayan yazım (B) — kilit YOK. */
export async function assertItemUsable(
  db: Db,
  itemId: string,
  usage: ItemUsage,
  opts: ItemUsageOpts = {},
): Promise<ItemUsageResult> {
  return decide(await readRow(db, itemId, false), usage, opts, db);
}

/**
 * Referans YAZAN tx'te: 8030 SHARED → kart FOR SHARE → karar. Kilit tx sonuna dek
 * durur; eşzamanlı "Pasif'e geç" (FOR UPDATE) bu yazım bitene dek bekler ve sonra
 * yeni referansı sayar (D1 hiç çiğnenmez).
 */
export async function assertItemUsableTx(
  tx: Prisma.TransactionClient,
  itemId: string,
  usage: ItemUsage,
  opts: ItemUsageOpts = {},
): Promise<ItemUsageResult> {
  await lockAgainstMergeTx(tx);
  return decide(await readRow(tx, itemId, true), usage, opts, tx);
}

/** Tek bir kart kullanımı — çok satırlı belgelerde (sipariş) ön kontrol ile tx tekrarını eşler. */
export interface ItemUsageCheck {
  itemId: string;
  usage: ItemUsage;
  opts?: ItemUsageOpts;
}

/** Ön kontrol — her kontrol sırayla; uyarılar tekilleşir. */
export async function runItemUsageChecks(db: Db, checks: ItemUsageCheck[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const c of checks) {
    const r = await assertItemUsable(db, c.itemId, c.usage, c.opts);
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  return warnings;
}

/** Tx tekrarı — kart kilitleri DETERMİNİSTİK sırada (itemId artan); tx'in ilk ifadeleri olmalı. */
export async function runItemUsageChecksTx(tx: Prisma.TransactionClient, checks: ItemUsageCheck[]): Promise<void> {
  const sorted = [...checks].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  for (const c of sorted) await assertItemUsableTx(tx, c.itemId, c.usage, c.opts);
}
