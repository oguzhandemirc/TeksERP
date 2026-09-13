// =============================================================================
// HAYALET TOP TESPİTİ — mükerrer ham giriş (mükerrer paneli v2 P3c, 2026-08-22)
// =============================================================================
// SAHA VAKASI (2026-08-03): sunucu restart edildi; ham giriş personeli etiket
// çıkmayınca "Kaydet ve Etiket Bas"a defalarca bastı. Mobil KK1 her basışta YENİ
// bir `clientToken` ürettiği için backend'in idempotency koruması devreye giremedi
// → tek fiziksel top için N ayrı stok kaydı doğdu.
//
// ⚠️ BU BİR KANIT DEĞİL, ŞÜPHE LİSTESİDİR. KK1 zaten SERİ GİRİŞ için tasarlanmıştır
// (form ürün/en'i korur, yalnız metraj temizlenir) — aynı balyadan arka arkaya
// girilen eşit metrajlı toplar veriye BİREBİR aynı desende görünür. Karar fiziksel
// sayım + operatör teyidiyle verilir; bu servis YAZMAZ (iptal ayrı bir uçtan,
// `InventoryService.softDelete`in tüm guard'larıyla yapılır).
//
// ⚠️ ANA VERİ BİRLEŞTİRMESİNDEN FARKLI: top bir İŞLEM KAYDIDIR, ana veri değil.
// İki topu "birleştirmek" diye bir şey yoktur (metraj toplanmaz — fiziksel olarak
// tek top vardı); fazlalık İPTAL edilir (`MUKERRER` sebep koduyla). Sektör karşılığı
// da budur: işlem kaydı düzeltmesi = storno, master data düzeltmesi = merge.
//
// TEK KAYNAK: `scripts/find_duplicate_rolls.ts` de buradan besleniyor — script ile
// panelin ayrışması (aynı soruya iki farklı cevap) böylece yapısal olarak imkânsız.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";

/** Kopya olamayacak statüler — iptal/fire edilmiş top yeniden girilebilir. */
const IGNORED_STATUSES: RollStatus[] = [RollStatus.CANCELLED, RollStatus.SCRAP];

export const DUPLICATE_ROLLS_DEFAULT_DAYS = 30;
export const DUPLICATE_ROLLS_DEFAULT_WINDOW_SEC = 120;
export const DUPLICATE_ROLLS_MAX_DAYS = 730;

export interface DuplicateRollRow {
  id: string;
  barcode: string | null;
  createdAt: Date;
  status: RollStatus;
  clientToken: string | null;
  /** Fiziksel etiket basılmış mı — "asıl" seçiminin birinci ölçütü. */
  labelPrinted: boolean;
  /** Çuval/sevkiyat bağı: varsa bu top İPTAL EDİLEMEZ (paketlenmiş mal). */
  blockedReason: string | null;
}

export interface DuplicateRollCluster {
  key: string;
  /** 0-6 arası şüphe skoru. */
  score: number;
  level: "STRONG" | "SUSPECT" | "WEAK";
  reasons: string[];
  itemId: string;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  operatorName: string | null;
  rolls: DuplicateRollRow[];
  /**
   * ÖNERİLEN "asıl" kayıt (kullanıcı kararı 2026-08-22): fiziksel ETİKETİ BASILAN
   * top asıldır — sahadaki kâğıt onu gösteriyor; birden fazlaysa en eskisi; hiçbirinde
   * etiket yoksa en eski kayıt. (Hareket görmüş top bu listeye zaten hiç girmez.)
   */
  suggestedKeepId: string;
}

export interface DuplicateRollScan {
  scannedAt: string;
  days: number;
  windowSec: number;
  totals: {
    scanned: number;
    /** Hareket görmüş → elendi (üretime girmiş top kopya olamaz). */
    touched: number;
    evaluated: number;
    clusters: number;
    /** Her kümede biri gerçek kabul edilirse fazladan kayıt sayısı. */
    extras: number;
  };
  clusters: DuplicateRollCluster[];
}

interface RawRow {
  id: string;
  barcode: string | null;
  createdAt: Date;
  itemId: string;
  itemName: string | null;
  colorId: string | null;
  colorName: string | null;
  initialQty: unknown;
  width: unknown;
  status: RollStatus;
  clientToken: string | null;
  createdById: string | null;
  operatorName: string | null;
  createdMachineId: string | null;
  labelPrintedAt: Date | null;
  sackId: string | null;
  shipmentId: string | null;
  moves: number;
  ops: number;
}

/**
 * Kümenin şüphe skoru (0-6). "Hiç hareket görmemiş" burada YOK — o sert eleme
 * koşulu (kümedeki her top zaten dokunulmamış).
 */
function scoreCluster(rows: RawRow[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const spanSec = (rows[rows.length - 1].createdAt.getTime() - rows[0].createdAt.getTime()) / 1000;
  reasons.push(`${Math.round(spanSec)} sn içinde`);
  // Refleks basış saniyeler içindedir; gerçek topu ölçüp girmek daha uzun sürer.
  if (spanSec <= 15) score += 3;
  else if (spanSec <= 45) score += 2;
  else score += 1;

  const tokens = new Set(rows.map((r) => r.clientToken ?? `null:${r.id}`));
  if (tokens.size === rows.length) {
    score += 2;
    reasons.push("clientToken'lar FARKLI");
  }

  if (rows.every((r) => r.status === RollStatus.STOCK || r.status === RollStatus.WAREHOUSE)) {
    score += 1;
    reasons.push("hepsi hâlâ giriş statüsünde");
  }

  return { score, reasons };
}

function blockedReasonOf(r: RawRow): string | null {
  if (r.sackId) return "Çuvalda — önce çuvaldan çıkarılmalı";
  if (r.shipmentId) return "Sevkiyata bağlı — iptal edilemez";
  return null;
}

export const DuplicateRollsService = {
  /**
   * Şüpheli küme taraması. SALT OKUNUR. `days` kapsam, `windowSec` ardışık iki
   * kayıt arasındaki azami boşluk (zincir kurma penceresi).
   */
  async scan(opts: { days?: number; windowSec?: number } = {}): Promise<DuplicateRollScan> {
    const days = Math.min(
      Math.max(1, Math.floor(opts.days ?? DUPLICATE_ROLLS_DEFAULT_DAYS)),
      DUPLICATE_ROLLS_MAX_DAYS,
    );
    const windowSec = Math.min(
      Math.max(5, Math.floor(opts.windowSec ?? DUPLICATE_ROLLS_DEFAULT_WINDOW_SEC)),
      3600,
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rolls = (await prisma.$queryRaw`
      SELECT r.id, r.barcode, r."createdAt", r."itemId", i.name AS "itemName",
             r."colorId", c.name AS "colorName", r."initialQty", r.width, r.status,
             r."clientToken", r."createdById", u."fullName" AS "operatorName",
             r."createdMachineId", r."labelPrintedAt", r."sackId", r."shipmentId",
             (SELECT COUNT(*)::int FROM roll_movements m WHERE m."rollId" = r.id AND m."revokedAt" IS NULL) AS moves,
             -- ⚠️ inheritedFromParentRollId süzgeci BİLEREK YOK ve gerekmez: aşağıdaki
             -- r."parentRollId" IS NULL bu sorguyu çocuk OLMAYAN toplara kapatıyor,
             -- miras op ise yalnız parent→çocuk kopyasında doğar ⇒ burada yapısal olarak
             -- hiç bulunamaz. (OWN_OPERATION sabitinin uygulanmadığı yerlerden biri.)
             (SELECT COUNT(*)::int FROM roll_operations o WHERE o."rollId" = r.id AND o."revokedAt" IS NULL) AS ops
      FROM rolls r
      LEFT JOIN items i ON i.id = r."itemId"
      LEFT JOIN colors c ON c.id = r."colorId"
      LEFT JOIN users u ON u.id = r."createdById"
      WHERE r."createdAt" >= ${since}
        AND r."parentRollId" IS NULL
        AND r."parentReceiptId" IS NULL
        AND r.status NOT IN (${IGNORED_STATUSES[0]}::"RollStatus", ${IGNORED_STATUSES[1]}::"RollStatus")
      ORDER BY r."itemId", r."initialQty", r."createdById", r."createdAt"
    `) as RawRow[];

    // SERT ELEME: hareket görmüş top = mal fiziksel olarak vardı = kopya değil.
    const untouched = rolls.filter((r) => r.moves === 0 && r.ops === 0);

    // Kimlik = ürün + renk + metraj + en + operatör + makine.
    const buckets = new Map<string, RawRow[]>();
    for (const r of untouched) {
      const key = [
        r.itemId,
        r.colorId ?? "-",
        String(r.initialQty),
        String(r.width ?? "-"),
        r.createdById ?? "-",
        r.createdMachineId ?? "-",
      ].join("|");
      const list = buckets.get(key);
      if (list) list.push(r);
      else buckets.set(key, [r]);
    }

    // Her kimlik kümesini zaman penceresine göre zincirlere böl.
    const chains: RawRow[][] = [];
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      let chain: RawRow[] = [list[0]];
      for (let i = 1; i < list.length; i++) {
        const gapSec =
          (list[i].createdAt.getTime() - chain[chain.length - 1].createdAt.getTime()) / 1000;
        if (gapSec <= windowSec) chain.push(list[i]);
        else {
          if (chain.length > 1) chains.push(chain);
          chain = [list[i]];
        }
      }
      if (chain.length > 1) chains.push(chain);
    }

    const clusters: DuplicateRollCluster[] = chains.map((rows) => {
      const { score, reasons } = scoreCluster(rows);
      // "Asıl" önerisi: etiketi basılan (en eskisi) → yoksa en eski kayıt.
      const printed = rows.filter((r) => r.labelPrintedAt !== null);
      const keep = (printed.length > 0 ? printed : rows)[0];
      return {
        key: rows.map((r) => r.id).join("|"),
        score,
        level: score >= 6 ? "STRONG" : score >= 4 ? "SUSPECT" : "WEAK",
        reasons,
        itemId: rows[0].itemId,
        itemName: rows[0].itemName,
        colorName: rows[0].colorName,
        initialQty: Number(rows[0].initialQty),
        width: rows[0].width === null ? null : Number(rows[0].width),
        operatorName: rows[0].operatorName,
        rolls: rows.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          createdAt: r.createdAt,
          status: r.status,
          clientToken: r.clientToken,
          labelPrinted: r.labelPrintedAt !== null,
          blockedReason: blockedReasonOf(r),
        })),
        suggestedKeepId: keep.id,
      };
    });

    clusters.sort((a, b) => b.score - a.score || b.rolls.length - a.rolls.length);

    return {
      scannedAt: new Date().toISOString(),
      days,
      windowSec,
      totals: {
        scanned: rolls.length,
        touched: rolls.length - untouched.length,
        evaluated: untouched.length,
        clusters: clusters.length,
        extras: clusters.reduce((n, c) => n + c.rolls.length - 1, 0),
      },
      clusters,
    };
  },
};
