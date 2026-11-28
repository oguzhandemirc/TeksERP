// Desen sınıflaması (2026-11-25): mekanizma (tezgâh ağızlığı nasıl açar) + ayrı örgü (iplikler nasıl
// kesişir). Backend `src/constants/weave-classification.ts` aynası; eski backend yeni eksenleri göndermez
// → `kind`tan aynı eşlemeyle türetilir. Sunucu kapıdır, panel yalnız ilgili alanları gösterir.
export const SHED_MECHANISMS = ["CAM", "DOBBY", "JACQUARD"] as const;
export type ShedMechanism = (typeof SHED_MECHANISMS)[number];

export const WEAVE_STRUCTURES = ["PLAIN", "TWILL", "SATIN", "LENO", "OTHER"] as const;
export type WeaveStructure = (typeof WEAVE_STRUCTURES)[number];

export const SHED_MECHANISM_LABEL: Record<ShedMechanism, string> = { CAM: "Eksantrik", DOBBY: "Armür", JACQUARD: "Jakar" };
export const WEAVE_STRUCTURE_LABEL: Record<WeaveStructure, string> = {
  PLAIN: "Bezayağı", TWILL: "Dimi", SATIN: "Saten", LENO: "Döner", OTHER: "Diğer",
};

/** ⓘ açıklamaları — sade Türkçe, tezgâh başındaki kişinin dilinde. */
export const SHED_MECHANISM_HINT: Record<ShedMechanism, string> = {
  CAM: "Basit örgüler (bezayağı, dimi) için. Çerçeveleri tezgâhın kamları kaldırır; program ya da ızgara gerekmez.",
  DOBBY: "Çerçeveleri armür programı kaldırır. Hangi atkıda hangi çerçevenin kalktığı Desen örgüsü sekmesindeki ızgarada çizilir (armür planı).",
  JACQUARD: "Her çözgü teli ayrı bir kancayla kalkar; çerçeve yoktur. Desen tezgâhın desen dosyasından gelir; burada dosya adı, kanca sayısı ve desen rapor ölçüsü tutulur.",
};
export const MECHANISM_INFO = "Tezgâhın çözgü tellerini nasıl kaldırdığı: Eksantrik (kamla, basit örgüler), Armür (programlı çerçeveler), Jakar (her tel ayrı kanca). Hangi alanların geçerli olduğunu belirler (desen örgüsü, kanca sayısı, tahar uygun mekanizmada okunur); maliyete girmez.";
export const STRUCTURE_INFO = "İpliklerin birbirinin altından üstünden nasıl geçtiği. Döner (leno) iki çözgü telinin atkı etrafında dönmesidir; Armür ya da Jakarla dokunur. Bilinmiyorsa boş bırakılabilir. Döner seçilince döner kurulumu alanı açılır; maliyete girmez.";

export interface WeaveClass { shedMechanism: ShedMechanism; weaveStructure: WeaveStructure | null }

const KIND_TO_CLASS: Record<string, WeaveClass> = {
  PLAIN: { shedMechanism: "CAM", weaveStructure: "PLAIN" },
  DOBBY: { shedMechanism: "DOBBY", weaveStructure: null },
  JACQUARD: { shedMechanism: "JACQUARD", weaveStructure: null },
  LENO: { shedMechanism: "DOBBY", weaveStructure: "LENO" },
};

/** Satırın sınıfı — yeni eksen varsa o, yoksa eski `kind`tan türetilir. */
export function resolveWeaveClass(d: { kind?: string | null; shedMechanism?: string | null; weaveStructure?: string | null }): WeaveClass {
  if (d.shedMechanism && (SHED_MECHANISMS as readonly string[]).includes(d.shedMechanism)) {
    const s = d.weaveStructure && (WEAVE_STRUCTURES as readonly string[]).includes(d.weaveStructure) ? (d.weaveStructure as WeaveStructure) : null;
    return { shedMechanism: d.shedMechanism as ShedMechanism, weaveStructure: s };
  }
  return KIND_TO_CLASS[d.kind ?? ""] ?? { shedMechanism: "DOBBY", weaveStructure: null };
}

/** Kısa görünür ad: "Armür · Döner", "Jakar", "Eksantrik · Bezayağı". */
export function weaveClassLabel(d: Parameters<typeof resolveWeaveClass>[0]): string {
  const c = resolveWeaveClass(d);
  const m = SHED_MECHANISM_LABEL[c.shedMechanism];
  return c.weaveStructure ? `${m} · ${WEAVE_STRUCTURE_LABEL[c.weaveStructure]}` : m;
}

export const isLeno = (d: Parameters<typeof resolveWeaveClass>[0]) => resolveWeaveClass(d).weaveStructure === "LENO";
