// Tek İE formu: "her parti ayrı" kipinde parti kartının gramaj + makine bağlamı; rota/adım değişince geçersiz kalan parti
// makinesini karar-yok'a döndürür (eski istasyonun makinesi sunucuda 400 olurdu).
import { useEffect, useMemo } from 'react';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { routeDefaultMachineId } from '../desk/deskPlan';
import { dropStalePartyMachines, partyPlanCtx, type PartyPlanCtx } from './partyPlan';
import type { DocRow, WoRowsState } from './useWoRows';

const NONE: readonly never[] = [];

export function usePartyPlan(a: { row: DocRow | null; wo: WoRowsState; route: ProductionRoute | null; allMachines: readonly DeskKursunMachine[]; stepsEdited: boolean }): PartyPlanCtx | null {
  const { row, wo, route, allMachines, stepsEdited } = a;
  const f = row?.form;
  const perParty = f?.multi?.mode === 'PER_PARTY';
  const gramaj = wo.showGramaj ? wo.catalog.options : NONE;
  const commonGramajId = f?.gramajValueId ?? null;
  const ctx = useMemo(
    () => partyPlanCtx({ perParty, route, allMachines, stepsEdited, gramaj, commonGramajId, defaultMachineId: routeDefaultMachineId(route, allMachines) }),
    [perParty, route, allMachines, stepsEdited, gramaj, commonGramajId],
  );
  const multi = f?.multi ?? null;
  const machines = ctx?.machines;
  const noteId = row?.noteId;
  const { setMulti } = wo;
  useEffect(() => {
    if (!multi || !noteId) return;
    const fixed = dropStalePartyMachines(multi, machines ?? NONE);
    if (fixed) setMulti(noteId, fixed);
  }, [multi, machines, noteId, setMulti]);
  return ctx;
}
