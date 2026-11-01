// Desen kartı (WeaveDesign) + etkin yapı tel tipleri — backend `weave-design.service` /
// `effective-construction.helper` yanıtlarının aynası (Seyitoğlu SY-A3). Decimal alanlar metin gelir.

export const WEAVE_DESIGN_KINDS = ["PLAIN", "DOBBY", "JACQUARD", "LENO"] as const;
export type WeaveDesignKind = (typeof WEAVE_DESIGN_KINDS)[number];

export const WEAVE_KIND_LABEL: Record<WeaveDesignKind, string> = {
  PLAIN: "Bez ayağı",
  DOBBY: "Armür",
  JACQUARD: "Jakar",
  LENO: "Döner (leno)",
};

export const WARP_BEAM_MODES = ["SEPARATE_BEAM", "SHARED_BEAM", "CREEL"] as const;
export type WarpBeamMode = (typeof WARP_BEAM_MODES)[number];

/** Sarım biçimi seçenekleri (kullanıcı kararı 2026-10-31) — açıklamalı tek seçim. */
export const BEAM_MODE_OPTIONS: Array<{ value: WarpBeamMode; label: string; hint: string }> = [
  { value: "SEPARATE_BEAM", label: "Ayrı levent", hint: "Katman kendi leventine sarılır (varsayılan)." },
  { value: "SHARED_BEAM", label: "Zeminle aynı levent", hint: "Zemin leventinde ayrı tel grubu; kendi çekmesiyle tüketir." },
  { value: "CREEL", label: "Cağlık / bobin", hint: "Levent yok; tüketim iplik stoğundan düşer." },
];

export const WARP_LAYER_ROLE_LABEL: Record<string, string> = { LENO: "Döner çözgü", SECONDARY: "İkinci çözgü" };

/** Armür ızgarası: satır = atkı, sütun = çerçeve, hücre 0/1. */
export type LiftPlan = number[][];

export interface WeaveDesign {
  id: string;
  code: string;
  name: string;
  kind: WeaveDesignKind;
  familyLabel: string | null;
  frameCount: number | null;
  repeatCm: string | number | null;
  liftPlan?: LiftPlan | null;
  loomFileName: string | null;
  lenoSetup: string | null;
  notes: string | null;
  isActive: boolean;
}

export type WeaveDesignInput = Partial<Omit<WeaveDesign, "id" | "isActive">>;

export interface YarnRef { id: string; code: string; name: string; linearDensityDen: string | null }
export interface WarpRef {
  id: string; code: string; name: string; endsCount: number; takeUpPct: string | null; wastePct: string | null; yarnItem: YarnRef | null;
}

export interface EffectiveWeftYarn {
  sortOrder: number;
  letter: string;
  picksInRepeat: number;
  yarnItem: YarnRef;
  /** Varyant bu satırın ipliğini değiştirdiyse kartın özgün ipliği. */
  cardYarnItem: YarnRef | null;
}

export interface EffectiveConstruction {
  itemId: string;
  recipeId: string | null;
  variantCode: string | null;
  widthCm: string | null;
  groundWarp: WarpRef | null;
  warpLayers: Array<{ role: string; beamMode: WarpBeamMode; sortOrder: number; warpSpec: WarpRef }>;
  weft: {
    weftSpecId: string; code: string; name: string; picksPerCm: string | null;
    sequenceCode: string | null; weftProgramNo: string | null; picksInRepeatTotal: number; yarns: EffectiveWeftYarn[];
  } | null;
  warnings: Array<{ code: string; message: string }>;
}

/** Desene bağlı kumaş (ürün listesi satırının okunan alt kümesi). */
export interface DesignFabric { id: string; code: string; name: string; weftSpecId: string | null; weaveDesignId: string | null }

/** Varyant = iş emri şablonu (`ProductRecipe`) satırının okunan alt kümesi. */
export interface DesignVariant {
  id: string;
  code: string;
  name: string;
  variantCode: string | null;
  finishingRateCode: string | null;
  isActive: boolean;
  color?: { id: string; code: string; name: string } | null;
}

export interface WeftSpecYarnRow { yarnItemId: string; picksInRepeat: number; sortOrder: number; yarnItem?: YarnRef }
export interface WeftSpecDetail {
  id: string; code: string; name: string; picksPerCm: string | number | null; sequenceCode: string | null; weftProgramNo: string | null;
  yarns: WeftSpecYarnRow[];
}

/** `POST /api/weft-specs/:id/fork` yanıtı — `replayed` = aynı kodlu kopya bu kumaşa zaten bağlıydı. */
export interface WeftSpecForkResult { weftSpec: WeftSpecDetail; itemId: string; previousWeftSpecId: string; replayed: boolean }
