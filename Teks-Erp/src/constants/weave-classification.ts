// =============================================================================
// DESEN SINIFLAMASI — TEK KAYNAK (2026-11-25, kullanıcı kararı: üç eksen)
// =============================================================================
// Eski `WeaveDesign.kind` iki ekseni karıştırıyordu (PLAIN/LENO örgü, DOBBY/JACQUARD mekanizma). Yeni eksenler:
// ağızlık mekanizması (`shedMechanism`) + örgü (`weaveStructure`). Eski istemci uyumu için `kind` çift yazılır;
// okuyucu HER ZAMAN `resolveWeaveClass` ile okur (yeni alan boşsa — geri dönüş/eski satır — `kind`dan türetir).
// Migration `20261125120000_desen_siniflama_eksen` backfill'i `KIND_TO_CLASS`ın SQL ikizidir (bekçi karşılaştırır).
// =============================================================================

export const WEAVE_SHED_MECHANISMS = ["CAM", "DOBBY", "JACQUARD"] as const;
export type WeaveShedMechanismValue = (typeof WEAVE_SHED_MECHANISMS)[number];

export const WEAVE_STRUCTURES = ["PLAIN", "TWILL", "SATIN", "LENO", "OTHER"] as const;
export type WeaveStructureValue = (typeof WEAVE_STRUCTURES)[number];

export type WeaveKindValue = "PLAIN" | "DOBBY" | "JACQUARD" | "LENO";

export const FABRIC_TECHNIQUES = ["WOVEN", "KNITTED"] as const;
export type FabricTechniqueValue = (typeof FABRIC_TECHNIQUES)[number];
/** Bugün seçilebilen teknikler — Örme "yakında" (servis 400 `FABRIC_TECHNIQUE_NOT_AVAILABLE`). */
export const FABRIC_TECHNIQUES_AVAILABLE: readonly FabricTechniqueValue[] = ["WOVEN"];

export interface WeaveClass {
  shedMechanism: WeaveShedMechanismValue;
  weaveStructure: WeaveStructureValue | null;
}

/** Eski tür → yeni eksenler (migration backfill'inin ikizi). DOBBY/JACQUARD'ın örgüsü bilinmez → null. */
export const KIND_TO_CLASS: Readonly<Record<WeaveKindValue, WeaveClass>> = {
  PLAIN: { shedMechanism: "CAM", weaveStructure: "PLAIN" },
  DOBBY: { shedMechanism: "DOBBY", weaveStructure: null },
  JACQUARD: { shedMechanism: "JACQUARD", weaveStructure: null },
  LENO: { shedMechanism: "DOBBY", weaveStructure: "LENO" },
};

/** Yeni eksenler → eski tür (çift yazım; eski istemci bunu okur). Döner örgü her mekanizmada LENO görünür. */
export function kindFromClass(c: WeaveClass): WeaveKindValue {
  if (c.shedMechanism === "JACQUARD") return "JACQUARD";
  if (c.weaveStructure === "LENO") return "LENO";
  if (c.shedMechanism === "CAM") return "PLAIN";
  return "DOBBY";
}

/** Okuyucunun TEK çözücüsü: yeni alan doluysa o, değilse `kind`dan türetilir. */
export function resolveWeaveClass(row: { kind: string; shedMechanism?: string | null; weaveStructure?: string | null }): WeaveClass {
  if (row.shedMechanism) {
    return { shedMechanism: row.shedMechanism as WeaveShedMechanismValue, weaveStructure: (row.weaveStructure ?? null) as WeaveStructureValue | null };
  }
  return KIND_TO_CLASS[row.kind as WeaveKindValue] ?? { shedMechanism: "DOBBY", weaveStructure: null };
}

/** Armür ızgarası (liftPlan) yalnız Armür mekanizmasında yazılır ve okunur; Eksantrik/Jakar'da gizli. */
export function mechanismUsesLiftPlan(m: WeaveShedMechanismValue): boolean {
  return m === "DOBBY";
}

/** Kanca sayısı yalnız Jakar'da. */
export function mechanismUsesHooks(m: WeaveShedMechanismValue): boolean {
  return m === "JACQUARD";
}

export const SHED_MECHANISM_LABEL: Readonly<Record<WeaveShedMechanismValue, string>> = { CAM: "Eksantrik", DOBBY: "Armür", JACQUARD: "Jakar" };
export const WEAVE_STRUCTURE_LABEL: Readonly<Record<WeaveStructureValue, string>> = {
  PLAIN: "Bezayağı", TWILL: "Dimi", SATIN: "Saten", LENO: "Döner", OTHER: "Diğer",
};

/** Kısa görünür ad: "Armür · Döner", "Jakar", "Eksantrik · Bezayağı". */
export function weaveClassLabel(c: WeaveClass): string {
  const m = SHED_MECHANISM_LABEL[c.shedMechanism];
  return c.weaveStructure ? `${m} · ${WEAVE_STRUCTURE_LABEL[c.weaveStructure]}` : m;
}
