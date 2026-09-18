// =============================================================================
// TABLET ÖN-DOLGU (Z5, kullanıcı ilkesi 2026-09-18 "hedef daima daha kolay yol") — yalnız ÖNERİ, davranış değişmez
// =============================================================================
// Üç kaynak, üçü de mevcut veriden türer, hiçbiri zorunlu alan açmaz ve hiçbiri stok/defter yazmaz:
//   E2 `doffPrefill`      — bağlanmamış indirme satırı, KK1'in elle seçtiği deseni/rengi zaten BİLİYOR:
//                           doff → koşum (deseni operatör koşum açarken onayladı) → dokuma işi (kumaş/renk).
//   E3 `runOpenSuggestions` — koşum açılışında atkı sıklığı ve hedef devir: "kumaş teknik kartı" MODELİ YOK
//                           (`kumasTeknik.enabled` yalnız bayrak) ⇒ aynı desenin SON KAPANMIŞ koşumu (önce bu tezgah)
//                           ve `MachineSpec.nominalUnitsPerMin`. Kaynak alanı hangi tezgahtan geldiğini söyler ki
//                           operatör başka tezgahın değerini BİLEREK kabul etsin.
//   E6 `lastWindDefaults`  — AYRI DOSYA (`warp-beam-wind-defaults.helper.ts`): iplik defterine dokunur; buradan import
//                           edilseydi doff/koşum/duruş route'ları iplik rejim kapısı olmadan `yarnMovement`e uzanmış
//                           sayılırdı (`test_iplik_regime_gate` §2 import grafiğini izler).
// Sektör (5e URETIM-BELGE-ZINCIRI §1.2/§6): kimlikler elle yeniden girilmeden akar; kabul ölçütü +0 dokunuş.
// Eski istemci: alanlar eklemedir, okumayan kırılmaz (`test_tablet_context_prefill`).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// ── E2 ─────────────────────────────────────────────────────────────────────────
/** İndirme satırının koşum → iş zinciri (tek `select`, N+1 yok). `DOFF_SELECT`e yayılır. */
export const DOFF_PREFILL_SELECT = {
  machineRun: {
    select: {
      itemId: true,
      colorId: true,
      item: { select: { id: true, code: true, name: true } },
      color: { select: { id: true, name: true } },
      weavingOrder: {
        select: {
          id: true,
          weavingOrderNumber: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.DoffEventSelect;

export interface DoffPrefill {
  weavingOrder: { id: string; weavingOrderNumber: string } | null;
  /** Koşumun deseni (operatör koşumda onayladı) > işin kumaşı; ikisi de yoksa null. */
  item: { id: string; code: string; name: string } | null;
  color: { id: string; name: string } | null;
}

type DoffPrefillRow = Prisma.DoffEventGetPayload<{ select: typeof DOFF_PREFILL_SELECT }>;

/** Zinciri düz alanlara indirger; `machineRun` iç nesnesi yanıta SIZMAZ (allowlist). */
export function doffPrefill(row: DoffPrefillRow): DoffPrefill {
  const run = row.machineRun;
  const wo = run?.weavingOrder ?? null;
  return {
    weavingOrder: wo ? { id: wo.id, weavingOrderNumber: wo.weavingOrderNumber } : null,
    item: run?.item ?? wo?.item ?? null,
    color: run?.color ?? wo?.color ?? null,
  };
}

// ── E3 ─────────────────────────────────────────────────────────────────────────
export interface RunOpenSuggestions {
  suggestedUnitsPerCm: number | null;
  unitsPerCmSource: "LAST_RUN" | null;
  suggestedTargetUnitsPerMin: number | null;
  targetSource: "LAST_RUN" | "MACHINE_SPEC" | null;
  /** Kaynak LAST_RUN ise o koşumun tezgahı — başka tezgahsa operatör bilerek kabul eder (1e). */
  sourceMachineId: string | null;
}

const NONE: RunOpenSuggestions = { suggestedUnitsPerCm: null, unitsPerCmSource: null, suggestedTargetUnitsPerMin: null, targetSource: null, sourceMachineId: null };

/** Koşum açılış önerileri — hepsi null-güvenli; `itemId` yoksa yalnız devir (makine kartı). */
export async function runOpenSuggestions(db: Db, args: { machineId: string; itemId?: string | null }): Promise<RunOpenSuggestions> {
  const out: RunOpenSuggestions = { ...NONE };
  if (args.itemId) {
    // Önce bu tezgah, sonra herhangi tezgah — tek sorgu, sıralama makine eşleşmesine göre JS'te.
    const runs = await db.machineRun.findMany({
      where: { itemId: args.itemId, revokedAt: null, endedAt: { not: null }, OR: [{ unitsPerCm: { not: null } }, { targetUnitsPerMin: { not: null } }] },
      orderBy: { endedAt: "desc" },
      select: { machineId: true, unitsPerCm: true, targetUnitsPerMin: true },
      take: 20,
    });
    const pick = (pred: (r: (typeof runs)[number]) => boolean) => runs.find((r) => r.machineId === args.machineId && pred(r)) ?? runs.find(pred) ?? null;
    const dens = pick((r) => r.unitsPerCm != null);
    if (dens) {
      out.suggestedUnitsPerCm = Number(dens.unitsPerCm);
      out.unitsPerCmSource = "LAST_RUN";
      out.sourceMachineId = dens.machineId;
    }
    const rpm = pick((r) => r.targetUnitsPerMin != null);
    if (rpm) {
      out.suggestedTargetUnitsPerMin = rpm.targetUnitsPerMin;
      out.targetSource = "LAST_RUN";
      out.sourceMachineId = out.sourceMachineId ?? rpm.machineId;
    }
  }
  if (out.suggestedTargetUnitsPerMin == null) {
    const spec = await db.machineSpec.findFirst({ where: { machineId: args.machineId, nominalUnitsPerMin: { not: null } }, select: { nominalUnitsPerMin: true } });
    if (spec?.nominalUnitsPerMin != null) {
      out.suggestedTargetUnitsPerMin = spec.nominalUnitsPerMin;
      out.targetSource = "MACHINE_SPEC";
    }
  }
  return out;
}

// ── E4 ─────────────────────────────────────────────────────────────────────────
/** Kumaş kartının varsayılan çözgü kartı — yalnız AKTİF kart önerilir (pasifleşmişse null, uydurulmaz). */
export async function itemDefaultWarpSpecId(db: Db, itemId: string): Promise<string | null> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { warpSpec: { select: { id: true, isActive: true } } } });
  return item?.warpSpec?.isActive ? item.warpSpec.id : null;
}
