// Yapı alanı boş bırakılırsa hesaba giren değer (kart / parametre / tarife) — girdi anlık görüntüsünden okunur.
// Kart bağlı değilse (girdide çözgü/atkı yok) fireler sunucu zincirinin son halkasından, AKTİF PARAMETRE SETİNDEN
// gösterilir; gerçekten bilinmiyorsa yer tutucu "bilinmiyor" der ve neden bilinmediği ⓘ'de söylenir (B18/9).
import type { CostInputSnap, Sourced } from "../shared/cost-types";
import { fmtDecFull } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";
import type { CostParameterSet } from "../Parameters/service";
import type { StructureKey } from "./service";

export function structureDefault(g: CostInputSnap | undefined, k: StructureKey): Sourced | null {
  if (!g) return null;
  switch (k) {
    case "loomRpm": return g.loom?.rpm ?? null;
    case "efficiencyPct": return g.loom?.efficiencyPct ?? null;
    case "warpWastePct": return g.warp?.wastePct ?? null;
    case "weftWastePct": return g.weft?.wastePct ?? null;
    case "fabricWastePct": return g.fabricWastePct ?? null;
    case "weftLengthCm": return g.weft?.lengthCm ?? null;
    case "beamLengthM": return g.beam?.lengthM ?? null;
    case "lengthShrinkPct": return g.lengthShrinkPct ?? null;
    case "extraCostPerMTry": return null;
  }
}

/** Yer tutucu: "3 · Parametre"; değer yoksa "boş = varsayılan". */
export function defaultPlaceholder(s: Sourced | null): string {
  if (!s || s.source === "YAPI" || s.value === null || s.value === "") return "boş = varsayılan";
  return `${fmtDecFull(s.value)} · ${SOURCE_LABEL[s.source] ?? s.source}`;
}

export interface StructureHint { placeholder: string; info?: string }

type Params = Pick<CostParameterSet, "defaultWarpWastePct" | "defaultWeftWastePct"> | null | undefined;

const paramValue = (v: string | number | null | undefined): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Kart bağlı değilken fire: sunucu zinciri YAPI > KART > PARAMETRE — kart yoksa parametre setinin değeri. */
function wasteFromParams(v: string | number | null | undefined, cardLabel: string): StructureHint {
  const p = paramValue(v);
  if (p !== null) return { placeholder: `${fmtDecFull(p)} · Parametre`, info: `${cardLabel} bağlı değil; boş bırakılırsa parametre setindeki varsayılan kullanılır.` };
  return { placeholder: "bilinmiyor", info: `${cardLabel} bağlı değil ve yürürlükteki parametre setinde varsayılan yok — değeri buraya yazın.` };
}

export interface HintContext {
  params?: Params;
  /** Formda SEÇİLİ fason tarifesi (kaydedilmemiş seçim dahil): undefined = bilinmiyor → girdiye bakılır. */
  rate?: { typicalShrinkPct: string | null } | null;
}

/** Boş alanın yer tutucusu + gerekirse nedenini söyleyen ⓘ metni. */
export function structureHint(g: CostInputSnap | undefined, k: StructureKey, ctx: HintContext = {}): StructureHint {
  if (k === "extraCostPerMTry") return { placeholder: "yok" };
  if (k === "lengthShrinkPct" && ctx.rate !== undefined) return shrinkHint(ctx.rate);
  const s = structureDefault(g, k);
  if (s && s.source !== "YAPI" && s.value !== null && s.value !== "") {
    const label = k === "lengthShrinkPct" ? "Tarife" : (SOURCE_LABEL[s.source] ?? s.source);
    return { placeholder: `${fmtDecFull(s.value)} · ${label}` };
  }
  if (!g) return { placeholder: "boş = varsayılan" };
  switch (k) {
    case "warpWastePct":
      return g.warp ? { placeholder: "boş = varsayılan" } : wasteFromParams(ctx.params?.defaultWarpWastePct, "Çözgü kartı");
    case "weftWastePct":
      return g.weft ? { placeholder: "boş = varsayılan" } : wasteFromParams(ctx.params?.defaultWeftWastePct, "Atkı kartı");
    case "weftLengthCm":
      return g.weft
        ? { placeholder: "bilinmiyor", info: "Atkı kartında tarak eni, üründe ham en yok — atkı boyunu buraya yazın." }
        : { placeholder: "bilinmiyor", info: "Atkı boyu atkı kartının tarak eninden (yoksa ürünün ham eni + kenar payı) gelir; atkı kartı bağlı olmadığı için henüz bilinmiyor." };
    case "lengthShrinkPct":
      return shrinkHint(g.finishing ? { typicalShrinkPct: null } : null);
    default:
      return { placeholder: defaultPlaceholder(s) };
  }
}

/** Boy çekmesi: YAPI boşsa seçili tarifenin tipik çekmesi (sunucu `resolveLengthShrinkPct` ile aynı sıra). */
function shrinkHint(rate: { typicalShrinkPct: string | null } | null): StructureHint {
  if (!rate) return { placeholder: "0 · ham satış", info: "Fason tarifesi seçili değil (ham satış); boş bırakılırsa boy çekmesi uygulanmaz." };
  const v = paramValue(rate.typicalShrinkPct);
  if (v !== null) return { placeholder: `${fmtDecFull(v)} · Tarife` };
  return { placeholder: "0 · tarifede yok", info: "Seçili fason tarifesinde tipik boy çekmesi yazılı değil; boş bırakılırsa çekme uygulanmaz." };
}
