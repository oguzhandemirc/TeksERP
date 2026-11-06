// Tek İE formunda "her parti ayrı" kipi — parti kartının kurşun gramajı + makinesi (saf parçalar). Gövde belge masasıyla
// AYNI yoldan gider (`withDeskPlan`: parti başına `targetValues` / `stepPlanning`); burada yalnız ne sorulacağı ve ne
// görüneceği çözülür. Kural sunucudadır (plan makinesi istasyon kapısı quickStart'ta).
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { machinesForRoute } from '../desk/deskPlan';
import type { MultiPartyDraft, PartyRow } from './partyDraft';

export interface PartyGramajOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface PartyPlanCtx {
  /** Boş = gramaj sorulmaz (rotada kurşun yok / katalog boş). */
  gramaj: readonly PartyGramajOption[];
  /** Belgenin ortak gramajı: partide seçim yoksa o gider (gövdenin `targetValues`ı). */
  commonGramajId: string | null;
  /** Boş = makine sorulmaz. */
  machines: readonly DeskKursunMachine[];
  /** Rota şablonunun kurşun makinesi: dokunulmamış parti bunu görür (sunucu da şablonu klonlar). */
  defaultMachineId: string | undefined;
  /** Makine parti başına seçilemiyorsa nedeni. */
  machineNote: string | null;
}

export const STEPS_EDITED_MACHINE_NOTE = 'Rota adımları değiştirildi: makine parti başına seçilemez, sonra seçilir.';

export interface PartyPlanInput {
  perParty: boolean;
  /** Etkin rota (düzenlenmiş adımlar dahil). */
  route: ProductionRoute | null;
  allMachines: readonly DeskKursunMachine[];
  /** Adımlar şablondan farklı: sunucu `steps` + parti `stepPlanning`'i birlikte 400'ler → parti makinesi sorulmaz. */
  stepsEdited: boolean;
  gramaj: readonly PartyGramajOption[];
  commonGramajId: string | null;
  defaultMachineId: string | undefined;
}

/** Çok partide "her parti ayrı" değilse ya da sorulacak bir şey yoksa null (kart bugünkü gibi). */
export function partyPlanCtx(a: PartyPlanInput): PartyPlanCtx | null {
  if (!a.perParty) return null;
  const list = machinesForRoute(a.route, a.allMachines);
  const machines = a.stepsEdited ? [] : list;
  const machineNote = a.stepsEdited && list.length > 0 ? STEPS_EDITED_MACHINE_NOTE : null;
  if (machines.length === 0 && a.gramaj.length === 0 && !machineNote) return null;
  return { gramaj: a.gramaj, commonGramajId: a.commonGramajId, machines, defaultMachineId: machines.length ? a.defaultMachineId : undefined, machineNote };
}

/** Görünen makine: parti kararı (null = "Sonra seçilsin") > şablon makinesi > yok. */
export const partyMachineValue = (r: PartyRow, ctx: PartyPlanCtx): string | null => (r.machineId !== undefined ? r.machineId : ctx.defaultMachineId ?? null);

/** Görünen gramaj: parti seçimi > belgenin ortak gramajı. */
export const partyGramajValue = (r: PartyRow, ctx: PartyPlanCtx): string | null => r.gramajValueId ?? ctx.commonGramajId;

export const machineLabel = (m: DeskKursunMachine): string => m.name || m.code;

/**
 * Rota / adım değişince önceki istasyonun makinesi geçersizdir (sunucu 400): listede olmayan parti makinesi karar-yok'a
 * (undefined) döner. "Sonra seçilsin" (null) her rotada geçerlidir. Değişiklik yoksa null.
 */
export function dropStalePartyMachines(m: MultiPartyDraft, valid: readonly DeskKursunMachine[]): MultiPartyDraft | null {
  let changed = false;
  const rows = m.rows.map((r) => {
    if (typeof r.machineId !== 'string' || valid.some((x) => x.id === r.machineId)) return r;
    changed = true;
    return { ...r, machineId: undefined };
  });
  return changed ? { ...m, rows } : null;
}
