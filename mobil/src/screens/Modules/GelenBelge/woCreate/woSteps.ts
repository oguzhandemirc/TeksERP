// K30-D tablet İE formu — rota adımlarını düzenleme (saf): şablondan liste, ekle/çıkar/sırala, fason firma + not, etkin
// rota ve form ucu `steps` gövdesi. Kullanıcı hiç değiştirmediyse (ya da şablona geri döndüyse) `steps` GİTMEZ: sunucu
// şablonu klonlar (bugünkü yol). Kural sunucudadır (klasik İE doğrulaması); burası yalnız listeyi kurar.
import type { CreateWorkOrderFromNoteBody } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';

type RouteStep = NonNullable<ProductionRoute['steps']>[number];
export type StepStation = NonNullable<RouteStep['station']>;

export interface EditStep {
  /** İstemci kimliği (şablon adımında `t<id>`, eklenende `n<sayaç>`). */
  key: string;
  stationId: string;
  station: StepStation | null;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  notes: string;
  plannedMachineId: string | null;
  dispatchWithoutColor: boolean;
}

export type StepsBody = NonNullable<CreateWorkOrderFromNoteBody['steps']>;

/** Kurşun adımı (sunucu `isKursunStation`; eski sunucuda kurşun+KK2 istasyon türü — deskPlan ile aynı). */
export const isKursunStation = (s: StepStation | null | undefined): boolean => !!s && (s.isKursunStation ?? s.kind === 'PROCESS_QC');

/** Adımın fason kategorisi (firma seçimi bunun firmalarından); fason değilse null. */
export const stepCategoryId = (s: Pick<EditStep, 'requiredCategoryId' | 'station'>): string | null => s.requiredCategoryId ?? s.station?.defaultCategory?.id ?? null;

/** Şablonun adımları (sıra düzeninde) düzenlenebilir listeye. */
export function stepsFromRoute(route: ProductionRoute | null | undefined): EditStep[] {
  return [...(route?.steps ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({
      key: `t${s.id}`,
      stationId: s.stationId,
      station: s.station ?? null,
      requiredCategoryId: s.requiredCategoryId ?? null,
      plannedSubcontractorId: s.plannedSubcontractorId ?? null,
      notes: s.defaultNotes ?? '',
      plannedMachineId: s.plannedMachineId ?? null,
      dispatchWithoutColor: s.dispatchWithoutColor === true,
    }));
}

/** Adım ekle (sona). Fason istasyonun varsayılan kategorisi adımın kategorisi olur (panelle aynı). */
export function addStep(steps: readonly EditStep[], station: StepStation & { id: string }, key: string): EditStep[] {
  return [
    ...steps,
    {
      key,
      stationId: station.id,
      station,
      requiredCategoryId: station.defaultCategory?.id ?? null,
      plannedSubcontractorId: null,
      notes: '',
      plannedMachineId: null,
      dispatchWithoutColor: false,
    },
  ];
}

export const removeStep = (steps: readonly EditStep[], key: string): EditStep[] => steps.filter((s) => s.key !== key);

/** Adımı bir yukarı (-1) / aşağı (+1) taşı; uçtaysa liste aynen. */
export function moveStep(steps: readonly EditStep[], key: string, dir: -1 | 1): EditStep[] {
  const i = steps.findIndex((s) => s.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= steps.length) return [...steps];
  const out = [...steps];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const patchStep = (steps: readonly EditStep[], key: string, patch: Partial<Pick<EditStep, 'notes' | 'plannedSubcontractorId'>>): EditStep[] =>
  steps.map((s) => (s.key === key ? { ...s, ...patch } : s));

/** Adım eklemenin istasyon kaynağı: tablet `station:read` taşımaz → rota şablonlarındaki istasyonlar (tekil, ada göre). */
export function stationsFromRoutes(routes: readonly ProductionRoute[]): (StepStation & { id: string })[] {
  const byId = new Map<string, StepStation & { id: string }>();
  for (const r of routes) for (const s of r.steps ?? []) if (s.station && !byId.has(s.stationId)) byId.set(s.stationId, { ...s.station, id: s.stationId });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Etkin rota: kimlik şablonunki, adımlar düzenlenmiş liste (gramaj / varsayılan hedef / makine / tambur buna göre çözülür). */
export function effectiveRoute(route: ProductionRoute, steps: readonly EditStep[] | null): ProductionRoute {
  if (!steps) return route;
  return {
    ...route,
    steps: steps.map((s, i) => ({
      id: s.key,
      stationId: s.stationId,
      sequence: i + 1,
      defaultNotes: s.notes || null,
      requiredCategoryId: s.requiredCategoryId,
      plannedSubcontractorId: s.plannedSubcontractorId,
      plannedMachineId: s.plannedMachineId,
      dispatchWithoutColor: s.dispatchWithoutColor,
      ...(s.station ? { station: s.station } : {}),
    })),
  };
}

/**
 * `steps` gövdesi (sequence = sıra + 1). `machineId`: undefined = karar yok (adımın şablon makinesi kalır) · null =
 * "Sonra seçilsin" · id = ilk kurşun adımının plan makinesi. Boş alan anahtarı gitmez.
 */
export function buildStepsBody(steps: readonly EditStep[], machineId?: string | null): StepsBody {
  const kursun = steps.findIndex((s) => isKursunStation(s.station));
  return steps.map((s, i) => {
    const machine = i === kursun && machineId !== undefined ? machineId : s.plannedMachineId;
    const notes = s.notes.trim();
    return {
      stationId: s.stationId,
      sequence: i + 1,
      ...(notes ? { notes } : {}),
      ...(s.requiredCategoryId ? { requiredCategoryId: s.requiredCategoryId } : {}),
      ...(s.plannedSubcontractorId ? { plannedSubcontractorId: s.plannedSubcontractorId } : {}),
      ...(machine ? { plannedMachineId: machine } : {}),
      ...(s.dispatchWithoutColor ? { dispatchWithoutColor: true } : {}),
    };
  });
}

/** Düzenlenmiş liste şablonla aynı mı (kullanıcı değiştirip geri aldıysa `steps` yine gitmez). */
export function sameAsRoute(steps: readonly EditStep[], route: ProductionRoute | null | undefined): boolean {
  return JSON.stringify(buildStepsBody(steps)) === JSON.stringify(buildStepsBody(stepsFromRoute(route)));
}

/**
 * Satır gövdesi + formun ek alanları. `steps` varsa üst ve parti `stepPlanning` düşer: sunucu ikisi birlikte 400 verir
 * (`GELEN_BELGE_FORM_STEPS_WITH_PLANNING`); makine o durumda `steps` içindedir.
 */
export function mergeExtra(body: CreateWorkOrderFromNoteBody, extra: Partial<CreateWorkOrderFromNoteBody> | undefined): CreateWorkOrderFromNoteBody {
  if (!extra) return body;
  const out: CreateWorkOrderFromNoteBody = { ...body, ...extra };
  if (!extra.steps) return out;
  delete out.stepPlanning;
  if (out.parties) out.parties = out.parties.map(({ stepPlanning: _drop, ...p }) => p);
  return out;
}
