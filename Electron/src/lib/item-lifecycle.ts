// =============================================================================
// ÜRÜN KARTI YAŞAM DÖNGÜSÜ — panel aynası (backend `helpers/item-lifecycle-data.helper.ts`)
// =============================================================================
// Üç durum (URUN-YASAM-DONGUSU.md §3): Aktif · Tükenene kadar · Pasif. Ekran adları kullanıcı
// kararı (§14/8), ayara bağlanmaz. Seçici kapsamı §8: sunucu yine karar verir; burası yalnız
// kullanıcının seçemeyeceği kartı listede göstermemek içindir.
// =============================================================================
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { PhaseOutNewOrder } from "./item-lifecycle-flags";

export type ItemLifecycleStatus = "ACTIVE" | "PHASE_OUT" | "ARCHIVED";

export const ITEM_LIFECYCLE_LABEL: Record<ItemLifecycleStatus, string> = {
  ACTIVE: "Aktif",
  PHASE_OUT: "Tükenene kadar",
  ARCHIVED: "Pasif",
};

/** Kartın durumu — `lifecycleStatus` taşımayan eski sunucuda `isActive`ten türetilir. */
export function itemLifecycleOf(it: { lifecycleStatus?: ItemLifecycleStatus | null; isActive?: boolean }): ItemLifecycleStatus {
  return it.lifecycleStatus ?? (it.isActive === false ? "ARCHIVED" : "ACTIVE");
}

/** Seçicinin kullanım sınıfı: sipariş kalemi (A1) · alış (A4) · belgesiz stok girişi (C) · üretim planı (A3). */
export type ItemPickUse = "order" | "purchase" | "stock" | "plan";

/** Seçicide listelenecek durumlar (sunucu `filter[lifecycleStatus]` CSV). Ayar yüklenmemişse backend varsayılanı. */
export function pickableLifecycle(
  use: ItemPickUse,
  flags?: { itemPhaseOutNewOrder?: PhaseOutNewOrder; itemPhaseOutNewPlan?: boolean } | null,
): string {
  const phaseOut =
    use === "order" ? flags?.itemPhaseOutNewOrder === "SERBEST" : use === "plan" ? flags?.itemPhaseOutNewPlan !== false : false;
  return phaseOut ? "ACTIVE,PHASE_OUT" : "ACTIVE";
}

export interface LiveRefRecord {
  id: string;
  title: string;
  detail: string;
}
export interface LiveRefGroup {
  kind: string;
  label: string;
  count: number;
  records: LiveRefRecord[];
}

export interface ItemLifecyclePreview {
  item: { id: string; code: string; name: string; lifecycleStatus: ItemLifecycleStatus; mergedIntoId: string | null };
  to: ItemLifecycleStatus;
  canTransition: boolean;
  liveTotal: number;
  references: LiveRefGroup[];
  similarActive: Array<{ id: string; code: string; name: string }>;
}

export interface LifecycleChoice {
  to: ItemLifecycleStatus;
  label: string;
  /** Onay düğmesinin fiili. */
  action: string;
  hint: string;
  /** Seçilemezse sebebi (kayıtlar diyalogda tek tek listelenir). */
  blockedBy: string | null;
}

const PHASE_OUT_CHOICE: LifecycleChoice = {
  to: "PHASE_OUT",
  label: "Tükenene kadar",
  action: "Tükenene kadar'a al",
  hint: "Eldeki mal iş emri, fason ve sevkte akmaya devam eder; yeni stok girişi ve alım açılmaz.",
  blockedBy: null,
};
const ACTIVE_CHOICE: LifecycleChoice = {
  to: "ACTIVE",
  label: "Aktif'e döndür",
  action: "Aktif'e döndür",
  hint: "Kart yeniden her işlemde seçilebilir.",
  blockedBy: null,
};

/** Durum diyaloğunun seçenekleri — kartın bugünkü durumu ve kalan canlı kayıt sayısından. */
export function lifecycleChoices(current: ItemLifecycleStatus, liveTotal: number): LifecycleChoice[] {
  const archive: LifecycleChoice = {
    to: "ARCHIVED",
    label: "Pasif",
    action: "Pasife al",
    hint: "Kart hiçbir yeni işlemde seçilemez; geçmiş kayıtlar olduğu gibi kalır.",
    blockedBy: liveTotal > 0 ? `Kartta ${liveTotal} canlı kayıt var — önce kapanmalı.` : null,
  };
  if (current === "ACTIVE") return [PHASE_OUT_CHOICE, archive];
  if (current === "PHASE_OUT") return [archive, ACTIVE_CHOICE];
  // Pasif kart: geri alma mesajının söylediği çıkış yolu ("önce Tükenene kadar'a alın") tek adımda.
  return [PHASE_OUT_CHOICE, ACTIVE_CHOICE];
}

/** Diyalog başlığının fiili — Pasif kartta kullanıma geri alınır, diğerlerinde kullanımdan kaldırılır. */
export const lifecycleDialogVerb = (current: ItemLifecycleStatus): string =>
  current === "ARCHIVED" ? "Yeniden kullanıma al" : "Kullanımdan kaldır";

/** Varsayılan seçim: seçilebilen ilk seçenek (Aktif ve Pasif kartta "Tükenene kadar", Tükenene kadar kartta hazırsa "Pasif"). */
export function defaultLifecycleChoice(choices: LifecycleChoice[]): ItemLifecycleStatus | null {
  return choices.find((c) => c.blockedBy === null)?.to ?? null;
}

const ROLL_STATUS_LABEL = rollStatusLabels as Record<string, string>;

/** Top kayıtları duruma göre katlanır (§8): başlık "Depoda · 12", altında tek tek. Detayın ilk parçası statüdür. */
export function foldRollsByStatus(records: LiveRefRecord[]): Array<{ status: string; label: string; records: LiveRefRecord[] }> {
  const groups = new Map<string, LiveRefRecord[]>();
  for (const r of records) {
    const status = r.detail.split(" · ")[0] ?? "";
    groups.set(status, [...(groups.get(status) ?? []), r]);
  }
  return [...groups.entries()].map(([status, recs]) => ({
    status,
    label: ROLL_STATUS_LABEL[status as RollStatus] ?? status,
    records: recs,
  }));
}
