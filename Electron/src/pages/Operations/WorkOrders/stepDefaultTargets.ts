// =============================================================================
// İE rota adımı ön seçimi (K22) — eski `useKursunGramajBinding`in genellemesi
// =============================================================================
// İstasyon adımı ROTAYA GİRİNCE sunucu çözücüsünün cevabı forma tohumlanır (hedef bayraklar, kurşun gramajı, kat);
// kullanıcının seçimi EZİLMEZ (yalnız boş alan / seçili olmayan bayrak doldurulur); adım ÇIKINCA yalnız o adımın
// tohumladığı ve hâlâ aynı duran değer temizlenir. Kurşun gramajı bunun bir örneğidir (çeşit değeri, müşteri > istasyon).
// =============================================================================
import { useEffect, useRef } from "react";
import type { DefaultTarget, DefaultTargetsByStation } from "@/lib/station-default-targets";

/** Kat kolon-projeksiyonu: değer `foldType`a kod olarak yazılır (backend `FOLD_PROPERTY_CODE`). */
export const FOLD_PROPERTY_CODE = "KAT";

export interface SeedFormState {
  propertyIds: readonly string[];
  gramaj: string | null;
  /** Boş = seçilmedi. */
  fold: string;
}

/** Adımın tohumladıkları — yalnız GERÇEKTEN eklenen/dolduran değerler (kullanıcının önceden seçtiği değil). */
export interface StepSeed {
  stationId: string;
  propertyIds: string[];
  gramaj: string | null;
  fold: string | null;
}

export interface ReconcileInput {
  steps: ReadonlyArray<{ clientId: string; stationId: string }>;
  /** null = okunuyor; `failed` iken boş sayılır. */
  byStation: DefaultTargetsByStation | null;
  failed: boolean;
  /** Kurşun çeşit özelliği (gramaj); yoksa gramaj tohumlanmaz. */
  gramajPropertyId: string | null;
  /** Rotada kurşun adımı yoksa gramaj anlamsız → temizlenir (bugünkü kural). */
  gramajAllowed: boolean;
}

function targetsFor(input: ReconcileInput, stationId: string): readonly DefaultTarget[] | undefined {
  if (input.failed) return [];
  return input.byStation?.[stationId];
}

function seedOf(targets: readonly DefaultTarget[], gramajPropertyId: string | null) {
  return {
    flags: targets.filter((t) => t.valueType === "FLAG").map((t) => t.propertyId),
    gramaj: gramajPropertyId ? (targets.find((t) => t.propertyId === gramajPropertyId)?.valueId ?? null) : null,
    fold: targets.find((t) => t.propertyCode === FOLD_PROPERTY_CODE)?.valueCode ?? null,
  };
}

/**
 * Saf uzlaştırma: (form, kayıtlar, adımlar + cevap) → yeni form + kayıtlar. Sıra: çıkan adımı geri al → yeni adımı
 * tohumla → müşteri değişince kurşun gramajı hâlâ son tohumsa yenile.
 */
export function reconcileStepDefaults(
  state: SeedFormState,
  records: Readonly<Record<string, StepSeed>>,
  input: ReconcileInput,
): { state: SeedFormState; records: Record<string, StepSeed> } {
  let propertyIds = [...state.propertyIds];
  let { gramaj, fold } = state;
  const next: Record<string, StepSeed> = {};
  const live = new Map(input.steps.filter((s) => s.stationId).map((s) => [s.clientId, s.stationId]));

  const gone = Object.entries(records).filter(([id, r]) => live.get(id) !== r.stationId);
  const kept = Object.entries(records).filter(([id, r]) => live.get(id) === r.stationId);
  for (const [id, r] of kept) next[id] = r;
  const heldElsewhere = (pick: (r: StepSeed) => boolean) => Object.values(next).some(pick);
  for (const [, r] of gone) {
    propertyIds = propertyIds.filter((p) => !r.propertyIds.includes(p) || heldElsewhere((o) => o.propertyIds.includes(p)));
    if (r.gramaj && gramaj === r.gramaj && !heldElsewhere((o) => o.gramaj === r.gramaj)) gramaj = null;
    if (r.fold && fold === r.fold && !heldElsewhere((o) => o.fold === r.fold)) fold = "";
  }

  for (const [clientId, stationId] of live) {
    const targets = targetsFor(input, stationId);
    const rec = next[clientId];
    if (!targets) continue;
    const s = seedOf(targets, input.gramajPropertyId);
    if (rec) {
      // Müşteri değişti (cevap yenilendi): gramaj hâlâ bu adımın son tohumuysa yenisine geçer; elle seçim kalır.
      if (rec.gramaj && gramaj === rec.gramaj && s.gramaj && s.gramaj !== rec.gramaj) {
        gramaj = s.gramaj;
        next[clientId] = { ...rec, gramaj: s.gramaj };
      }
      continue;
    }
    const added = s.flags.filter((p) => !propertyIds.includes(p));
    propertyIds = [...propertyIds, ...added];
    const seedGramaj = input.gramajAllowed && s.gramaj && gramaj === null ? s.gramaj : null;
    if (seedGramaj) gramaj = seedGramaj;
    const seedFold = s.fold && !fold ? s.fold : null;
    if (seedFold) fold = seedFold;
    next[clientId] = { stationId, propertyIds: added, gramaj: seedGramaj, fold: seedFold };
  }

  if (!input.gramajAllowed) gramaj = null;
  return { state: { propertyIds, gramaj, fold }, records: next };
}

/** Hazır mı: her adım istasyonunun cevabı geldi (ya da uç düştü) — "ilk değer" gibi yedekler bundan sonra koşar. */
export function defaultsSettled(input: Pick<ReconcileInput, "steps" | "byStation" | "failed">): boolean {
  if (input.failed) return true;
  return input.steps.every((s) => !s.stationId || Boolean(input.byStation?.[s.stationId]));
}

/** Formu bağlar; `enabled=false` (düzenleme kipi) iken hiçbir şeye dokunmaz. */
export function useStepDefaultsBinding(params: ReconcileInput & {
  enabled: boolean;
  state: SeedFormState;
  setPropertyIds: (ids: string[]) => void;
  setGramaj: (id: string | null) => void;
  setFold: (code: string) => void;
}): void {
  const { enabled, state, setPropertyIds, setGramaj, setFold, ...input } = params;
  const records = useRef<Record<string, StepSeed>>({});
  const key = JSON.stringify([input.steps.map((s) => [s.clientId, s.stationId]), input.byStation, input.failed, input.gramajPropertyId, input.gramajAllowed, state]);
  useEffect(() => {
    if (!enabled) return;
    const out = reconcileStepDefaults(state, records.current, input);
    records.current = out.records;
    if (out.state.propertyIds.join() !== state.propertyIds.join()) setPropertyIds([...out.state.propertyIds]);
    if (out.state.gramaj !== state.gramaj) setGramaj(out.state.gramaj);
    if (out.state.fold !== state.fold) setFold(out.state.fold);
    // `key` tüm girdileri taşır (dizi/nesne kimliği her render'da yenilenir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
}
