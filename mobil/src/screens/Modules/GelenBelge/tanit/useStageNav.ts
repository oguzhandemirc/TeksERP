// Aşamalı tanıtma gezintisi: aktif aşama + belgeye dokunuşun hedefi. Her açılış ①'den başlar (düzenlemede ① temizse ②'den).
import { useEffect, useState } from 'react';
import { firstTodo, type Stage, type TapTarget } from './stages';
import type { TeachState } from './teachDraft';

export function useStageNav(visible: boolean) {
  const [advanced, setAdvanced] = useState(false);
  const [stage, setStage] = useState<Stage>('TANIMA');
  const [target, setTarget] = useState<TapTarget>(null);
  useEffect(() => {
    if (!visible) return;
    setAdvanced(false);
    setStage('TANIMA');
    setTarget(null);
  }, [visible]);
  return {
    advanced,
    stage,
    target,
    setTarget,
    toggleAdvanced: () => setAdvanced((a) => !a),
    /** Aşamaya geç; ②'de görünür ilk atanmamış alan seçili gelir. */
    goTo: (next: Stage, s: TeachState | null) => {
      setStage(next);
      setTarget(next === 'ESLEME' && s ? { kind: 'field', key: firstTodo(s) } : null);
    },
  };
}
export type StageNav = ReturnType<typeof useStageNav>;
