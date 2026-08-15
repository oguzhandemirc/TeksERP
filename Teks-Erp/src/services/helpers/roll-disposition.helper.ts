// =============================================================================
// DİSPOZİSYON MOTORU — "istasyonda kalan topa karar uygula", TEK KAYNAK
// =============================================================================
// Üç çağıran aynı kararı verir ve aynı yan etkileri istemek ZORUNDADIR:
//   • `completeWorkOrder`  → kapanış dispozisyonu (6 aksiyon)
//   • `softDelete`         → iş emri iptali (3 aksiyon)
//   • `dropBatch`          → parti düşürme (3 aksiyon)
// Kopyalansaydı üç yol aynı kelimeye (örn. "Hatalı kayıt") üç farklı hareket satırı
// yazardı: aynı karar, farklı ekrandan verildi diye farklı metraj. Sessiz, kalıcı ve
// raporlanamaz — bu dosyanın var olma sebebi tam olarak budur.
//
// ⚠️ TRANSFER burada YOK. O bir statü kararı değil WO-graf işlemidir (klon + repoint);
//    `completeWorkOrder` onu kendi içinde çözer.
//
// Servis import etmez (yalnız @prisma/client + AppError + iki saf helper) → döngü yok;
// `traveler-card-dirty.helper` ile aynı disiplin.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { finalBarcodeType } from "./roll-finalize.helper";
import { reserveRollBarcodes } from "./roll-barcode.helper";

export type TxClient = Prisma.TransactionClient;

/** Statü kararı olan dispozisyonlar (TRANSFER hariç — bkz. dosya başlığı). */
export type RollDispositionAction =
  | "STOCK"
  | "WAREHOUSE"
  | "A1_STOCK"
  | "SCRAP"
  | "CANCELLED";

/**
 * Kararın hangi yüzeyden geldiği — hareket notu önekini belirler.
 *
 * ⚠️ `STOCK_COUNT` (J2 #19) yalnız `closeOpenMovementsTx`i kullanır, tam
 * `applyRollDispositionsTx` motorunu DEĞİL: sayımda statü claim'i çağıranda
 * yaşar, çünkü kaybeden satır hata FIRLATMAZ — "kapsam dışı" olarak işaretlenip
 * belgeye yazılır (motor ise haklı olarak 409 atar ve tüm kararı geri sarar).
 */
export type DispositionOrigin = "WO_CLOSE" | "WO_CANCEL" | "BATCH_DROP" | "STOCK_COUNT";

/** Dispozisyonun hedef `RollStatus`'u. */
export const DISPOSITION_TARGET_STATUS: Record<RollDispositionAction, RollStatus> = {
  STOCK: RollStatus.STOCK,
  WAREHOUSE: RollStatus.WAREHOUSE,
  A1_STOCK: RollStatus.A1_STOCK,
  SCRAP: RollStatus.SCRAP,
  CANCELLED: RollStatus.CANCELLED,
};

/** Satılabilir final statüler — barkod ("her kumaşa etiket") + kalite yalnız bunlarda. */
export const SELLABLE_DISPOSITION_STATUSES: RollStatus[] = [
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
];

/**
 * Bu motorun ürettiği hareket notu ÖNEKLERİ — TEK KAYNAK.
 *
 * `scripts/test_consistency.ts` §12 ("kapanmış hareketde qtyOut <> qtyIn") muaf
 * listesini BUNDAN türetir. Elle LIKE deseni yazılsaydı dördüncü bir origin eklenince
 * muaf sessizce eksik kalır ve canlı veri üzerinde koşan bekçi, bu özellikle hiç
 * ilgisi yokmuş gibi görünen bir hatayla kırmızıya dönerdi.
 */
export const DISPOSITION_NOTE_PREFIXES: readonly DispositionOrigin[] = [
  "WO_CLOSE",
  "WO_CANCEL",
  "BATCH_DROP",
  // J2 #19 — sayım fark fişi de bu motorun hareket kapanışını kullanır
  // (`qtyOut = 0`, storno). Muaf listesine girmeseydi `test_consistency` §12
  // sayım yapılmış her kurulumda kırmızıya dönerdi.
  "STOCK_COUNT",
] as const;

/**
 * Tek işlemde karar verilebilecek en fazla top. UX capi (perf değil — motor küme
 * bazlı çalışır): bu bir istisna prosedürüdür, yüz toplu WIP'in yeri değil.
 */
export const DISPOSITION_MAX_ROLLS = 200;

/** İstemciden gelen tek karar satırı. */
export interface RollDispositionRow {
  rollId: string;
  action: RollDispositionAction;
  /** Yalnız WAREHOUSE/A1_STOCK'ta anlamlı; çağıran doğrular. */
  qualityGradeId?: string | null;
}

/** tx İÇİNDE taze okunmuş top — çağıran guard'larını bununla yapmış olmalı. */
export interface DispositionRollSnapshot {
  id: string;
  barcode: string | null;
  status: RollStatus;
  currentQty: Prisma.Decimal;
  weightKg: Prisma.Decimal | null;
}

/** Uygulanan kararın izi — çağıran audit'i tx DIŞINDA yazar. */
export interface AppliedRollDisposition {
  rollId: string;
  barcode: string | null;
  from: RollStatus;
  to: RollStatus;
  action: RollDispositionAction;
  batchIdCleared: boolean;
  barcodeGenerated: boolean;
}

export interface ApplyRollDispositionsArgs {
  origin: DispositionOrigin;
  /** ≥3 karakter (çağıran doğrular). CANCELLED'da `Roll.cancelReason`'a YAZILIR. */
  reason: string;
  userId?: string;
  /** tx içinde taze okunmuş toplar (karar verilen her top burada olmalı). */
  rolls: DispositionRollSnapshot[];
  /** Karar satırları — `rolls` kümesinin alt kümesi. */
  dispositions: RollDispositionRow[];
  /**
   * Hareket kapanışı bu adımlarla SINIRLI. Verilmezse topun TÜM açık hareketleri
   * kapanır — yabancı bir iş emrinin hareketini kapatmamak için çağıran daraltır.
   */
  stepIds?: string[];
  /**
   * Aksiyon bazlı parti koparma. Verilmezse `batchId`'ye HİÇ dokunulmaz (kapanış ve
   * iptal böyle davranır — parti üyeliği attach'te doğar, karar onu bozmaz).
   */
  clearBatchId?: (action: RollDispositionAction) => boolean;
  /** Çağıranın aktif katalogdan doğruladığı kalite haritası. */
  qualityById?: Map<string, { id: string; code: string }>;
  /** Satılabilir hedefte barkodsuz topa barkod üret (çağıran `withBarcodeRetry` sarar). */
  generateBarcodes?: boolean;
}

/** Aynı hedefe giden topların tek `updateMany`'de toplanması için grup anahtarı. */
function groupKey(row: RollDispositionRow): string {
  return `${row.action}|${row.qualityGradeId ?? ""}`;
}

/**
 * Kararları uygular: hareket kapat → statü claim → (gerekirse) barkod.
 *
 * GRUPLU çalışır (aksiyon + kalite başına tek `updateMany`), per-top döngü DEĞİL:
 * iptal yolunun bugün satır sınırı yok ve 800 toplu bir iş emrini per-top döngüden
 * geçirmek tek tx'te ~2400 ifade demekti (perf kuralı 10 + `statement_timeout=50s`).
 * Emsal `detachRolls`'un `idsByTarget` haritası.
 */
export async function applyRollDispositionsTx(
  tx: TxClient,
  args: ApplyRollDispositionsArgs,
): Promise<AppliedRollDisposition[]> {
  const { origin, reason, userId, rolls, dispositions } = args;
  if (dispositions.length === 0) return [];

  const byId = new Map(rolls.map((r) => [r.id, r]));
  for (const d of dispositions) {
    if (!byId.has(d.rollId)) {
      // Çağıranın kapsam guard'ı bunu zaten yakalamalı; buraya düşmek programlama
      // hatasıdır ve sessizce atlamak topu istasyonda bırakırdı.
      throw AppError.badRequest("Karar verilen top listede yok — sayfayı yenileyin");
    }
  }

  const applied: AppliedRollDisposition[] = [];

  // Grupla — SIRALI await (tx client'ında Promise.all YASAK, perf kuralı 11).
  const groups = new Map<string, RollDispositionRow[]>();
  for (const d of dispositions) {
    const key = groupKey(d);
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  for (const rows of groups.values()) {
    const action = rows[0].action;
    const target = DISPOSITION_TARGET_STATUS[action];
    const quality = rows[0].qualityGradeId
      ? args.qualityById?.get(rows[0].qualityGradeId)
      : undefined;
    const ids = rows.map((r) => r.rollId);
    const clearBatch = args.clearBatchId?.(action) ?? false;

    // 1) AÇIK HAREKETLERİ KAPAT — statü değişmeden ÖNCE, çünkü aşağıdaki claim
    //    `currentStepId`'yi null'lar ve adım kapsamı o an kaybolur.
    await closeOpenMovementsTx(tx, {
      rollIds: ids,
      action,
      origin,
      reason,
      stepIds: args.stepIds,
    });

    // 2) STATÜ — ATOMİK CLAIM. Beklenen durum `IN_PRODUCTION` + serbest (çuval/sevk
    //    yok). Eşzamanlı bir işlem araya girdiyse count uyuşmaz → 409 + rollback.
    const cancelTrail =
      action === "CANCELLED"
        ? {
            cancelledAt: new Date(),
            cancelledById: userId ?? null,
            cancelReason: reason.slice(0, 500),
          }
        : {};
    const claim = await tx.roll.updateMany({
      where: { id: { in: ids }, status: RollStatus.IN_PRODUCTION, shipmentId: null, sackId: null },
      data: {
        status: target,
        currentStepId: null,
        ...(clearBatch ? { batchId: null } : {}),
        ...(quality ? { qualityGradeId: quality.id, qualityGrade: quality.code } : {}),
        ...cancelTrail,
      },
    });
    if (claim.count !== ids.length) {
      // Mesaj kalitesi için tek ek sorgu — YALNIZ hata yolunda. Ham UUID yerine
      // barkod söylemek, operatörün ekranda bulabileceği tek kimliktir.
      const moved = await tx.roll.findMany({
        where: { id: { in: ids }, NOT: { status: RollStatus.IN_PRODUCTION } },
        select: { barcode: true },
        take: 3,
      });
      const names = moved.map((m) => m.barcode ?? "açık kumaş").join(", ");
      throw AppError.conflict(
        `${names || "Bir top"} bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.`,
      );
    }

    // 2b) `preCancelStatus` — geri almanın döneceği raf. Gözlenen statüden yazılır,
    //     `IN_PRODUCTION` SABİTLENMEZ: ileride başka statüyü kabul eden bir çağıran
    //     eklenirse sabit değer yalan söylerdi (`preShipStatus` dersinin aynısı).
    if (action === "CANCELLED") {
      const byPrev = new Map<RollStatus, string[]>();
      for (const id of ids) {
        const prev = byId.get(id)!.status;
        const list = byPrev.get(prev);
        if (list) list.push(id);
        else byPrev.set(prev, [id]);
      }
      for (const [prev, prevIds] of byPrev) {
        await tx.roll.updateMany({
          where: { id: { in: prevIds } },
          data: { preCancelStatus: prev },
        });
      }
    }

    // 3) BARKOD — satılabilir hedefte barkodsuz top kalmaz ("her kumaşa etiket").
    //    Tek per-top adım; çağıran tx'i `withBarcodeRetry` ile sarmalı (P2002).
    const needsBarcode =
      args.generateBarcodes === true && SELLABLE_DISPOSITION_STATUSES.includes(target);
    const generated = new Map<string, string>();
    if (needsBarcode) {
      const unbarcoded = ids.filter((id) => byId.get(id)!.barcode == null);
      // TEK rezervasyon (F-CORE-VER-001): tüm toplar aynı `target`e gittiği için
      // tip de tektir. Eskiden döngü her top için ayrı sayaç turu atıyordu ve
      // sayaç satırının kilidi ilk turdan itibaren zaten tutulduğu için araya
      // giren her tur kilidi o kadar uzatıyordu.
      // ⚠️ Tx'in İÇİNDE kaldı, dışarı taşınmadı: `unbarcoded` kümesi claim'den
      // SONRA okunan `byId`den çözülüyor — tx öncesi okuma bayat olurdu. Tx içi
      // kalmanın kazancı: geri sarmada sayaç da geri sarılır, boşluk doğmaz.
      const reserved = await reserveRollBarcodes(tx, finalBarcodeType(target), unbarcoded.length);
      for (const [i, id] of unbarcoded.entries()) {
        const barcode = reserved[i]!;
        await tx.roll.update({ where: { id }, data: { barcode } });
        generated.set(id, barcode);
      }
    }

    for (const id of ids) {
      const snap = byId.get(id)!;
      applied.push({
        rollId: id,
        // ÜRETİLEN barkod döner (eskisi değil): audit izi topun ekranda görünen
        // kimliğini taşımalı, aksi halde barkodsuz doğmuş top "null" olarak loglanır.
        barcode: generated.get(id) ?? snap.barcode,
        from: snap.status,
        to: target,
        action,
        batchIdCleared: clearBatch,
        barcodeGenerated: generated.has(id),
      });
    }
  }

  return applied;
}

/**
 * Açık hareketleri kapatır — AKSİYONA GÖRE İKİ FARKLI SEMANTİK.
 *
 * | aksiyon | qtyOut | anlamı |
 * |---|---|---|
 * | STOCK / WAREHOUSE / A1_STOCK / SCRAP | `qtyIn` (yoksa `currentQty`) | mal bu istasyondan GEÇTİ |
 * | CANCELLED | **0** | mal bu istasyondan HİÇ geçmedi (storno) |
 *
 * ⚠️ `qtyIn`, `currentQty` DEĞİL: Tambur'da kesilmiş topta `currentQty < qtyIn` olur ve
 * `currentQty` ile kapatmak istasyon iş-hacmi raporunda HAYALET KAYIP üretir
 * (800 girdi / 700 çıktı). `completeWorkOrder`'ın mevcut ve doğru tercihi.
 *
 * ⚠️ CANCELLED'ın sıfırı load-bearing: `inventory.softDelete`'in storno semantiği.
 * Karıştırılırsa hiç var olmamış metraj istasyon iş hacmine yazılır.
 *
 * ⚠️ Eski not PARANTEZ İÇİNDE korunur — 2026-08-04'te `softDelete` notu körlemesine
 * ezip `TAMBUR_MANUAL_ROLL: <sebep>` izini siliyordu. Gerekçe nota da yazılır çünkü
 * `SystemLog` 6 ayda bir arşivlenir, `RollMovement.notes` arşivlenmez.
 *
 * ⚠️ EXPORT EDİLDİ (J2 #19): tam stok sayımı kendi statü claim'ini yapar ama
 * hareket kapanışını KOPYALAMAZ. Kopyalansaydı sayım yolu bir gün `qtyOut`u
 * `currentQty` ile kapatır ve HİÇ VAR OLMAMIŞ metraj istasyon iş hacmine
 * yazılırdı — bu dosyanın var oluş sebebinin ta kendisi.
 */
export async function closeOpenMovementsTx(
  tx: TxClient,
  params: {
    rollIds: string[];
    action: RollDispositionAction;
    origin: DispositionOrigin;
    reason: string;
    stepIds?: string[];
  },
): Promise<void> {
  const { rollIds, action, origin, reason, stepIds } = params;
  const note = `${origin}_${action}: ${reason}`.slice(0, 400);
  const storno = action === "CANCELLED";

  const stepFilter =
    stepIds && stepIds.length > 0
      ? Prisma.sql`AND m."workOrderStepId" = ANY(${stepIds}::uuid[])`
      : Prisma.empty;

  // Çıkış metrajı: storno'da sabit 0, diğerlerinde hareketin KENDİ girişi
  // (ölçülmemişse — KK1 kenarı — topun kalan metrajı).
  const qtyOut = storno
    ? Prisma.sql`0`
    : Prisma.sql`COALESCE(m."qtyOut", NULLIF(m."qtyIn", 0), r."currentQty")`;
  const weightOut = storno
    ? Prisma.sql`0`
    : Prisma.sql`COALESCE(m."weightOut", m."weightIn", r."weightKg")`;

  await tx.$executeRaw`
    UPDATE roll_movements m
    SET "exitedAt" = now(), -- tz-ok: kolon timestamptz, oturum UTC
        "qtyOut" = ${qtyOut},
        "weightOut" = ${weightOut},
        notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN ${note}
                     ELSE ${note} || ' (' || m.notes || ')' END
    FROM rolls r
    WHERE m."rollId" = r.id
      AND m."rollId" = ANY(${rollIds}::uuid[])
      AND m."exitedAt" IS NULL
      ${stepFilter}
  `;
}
