// Armür editörü kancası: durum makinesi + klavye kısayolları + kirli sekme beyanı. Kısayollar sekmenin her
// yerinde (yazı alanı hariç) çalışır; ok/Boşluk/Delete yalnız ızgara odaktayken (araç çubuğu düğmeleri bozulmasın).
import { useMemo, useReducer, type KeyboardEvent } from "react";
import { useDirtyTab } from "@/components/layout/tabs/dirty-tabs";
import type { WeaveDirection } from "@/components/weave/weave-direction";
import { lenoWithin, liftPlanSize } from "../lift-plan";
import type { LiftPlan } from "../types";
import { editorReducer, initEditor, keyToAction } from "./lift-editor-reducer";

const TYPING = "input,textarea,select,[role=combobox],[contenteditable=true]";

export function useLiftPlanEditor(initial: LiftPlan, initialLeno: number[], direction: WeaveDirection) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditor(initial, initialLeno));
  const { plan, leno } = state.hist.present;
  const size = liftPlanSize(plan);
  const lenoList = useMemo(() => lenoWithin(leno, size.frames), [leno, size.frames]);
  const lenoSet = useMemo(() => new Set(lenoList), [lenoList]);
  const savedKey = useMemo(() => JSON.stringify([initial, initialLeno]), [initial, initialLeno]);
  const currentKey = useMemo(() => JSON.stringify([plan, lenoList]), [plan, lenoList]);
  const dirty = savedKey !== currentKey;
  useDirtyTab(dirty);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(TYPING)) return;
    const a = keyToAction(e, direction, state.cursor);
    if (!a) return;
    const mod = e.ctrlKey || e.metaKey;
    const onGrid = target.getAttribute("role") === "grid";
    if (!mod && !onGrid) return;
    // Seçimsiz Delete bütün ızgarayı silmesin; seçimsiz Esc üst katmana (pencere/sekme) gitsin.
    if ((a.type === "block" || a.type === "clearSel") && !state.sel) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(a);
  };
  return { state, dispatch, plan, size, lenoList, lenoSet, dirty, onKeyDown };
}
