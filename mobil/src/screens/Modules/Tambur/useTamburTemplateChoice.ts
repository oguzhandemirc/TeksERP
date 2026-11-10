// Tambur etiket şablonu seçiminin ekran bağı (çoklu etiket seti, 2026-11-11) — kararlar `labelTemplateChoice.ts`te.
import { useCallback, useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  dropChoice, initialTemplateChoice, reconcileChoice, withChoice, withChoiceScope, withChoiceSeed,
  type TemplateChoiceState, type TemplateOffer,
} from './labelTemplateChoice';

export const LABEL_TEMPLATE_NOT_OFFERED = 'LABEL_TEMPLATE_NOT_OFFERED';

const warnDropped = (text2 = 'Seçilen şablon bu top için tanımlı değil — varsayılana dönüldü') =>
  Toast.show({ type: 'info', text1: 'Etiket şablonu', text2 });

export interface TamburTemplateChoice {
  state: TemplateChoiceState;
  pick: (templateId: string, offer: TemplateOffer) => void;
  /** Sunucu kesimde seçimi reddetti (400 LABEL_TEMPLATE_NOT_OFFERED). */
  drop: (message?: string) => void;
  /** Eşitleme sonucunu yaz (yalnız `useTemplateChoiceSync`). */
  replace: (next: TemplateChoiceState) => void;
}

/** Seçim İE (`scopeKey`) boyunca yapışkan; İE değişince sıfırlanır ve `last.templateId`ten bir kez tohumlanır. */
export function useTamburTemplateChoice(
  scopeKey: string | null,
  last: { loaded: boolean; templateId: string | null | undefined },
): TamburTemplateChoice {
  const [state, setState] = useState<TemplateChoiceState>(() => initialTemplateChoice(scopeKey));
  useEffect(() => {
    setState((s) => {
      const scoped = withChoiceScope(s, scopeKey);
      return last.loaded ? withChoiceSeed(scoped, last.templateId) : scoped;
    });
  }, [scopeKey, last.loaded, last.templateId]);
  const pick = useCallback((templateId: string, offer: TemplateOffer) => setState((s) => withChoice(s, templateId, offer)), []);
  const drop = useCallback((message?: string) => {
    setState((s) => dropChoice(s).state);
    warnDropped(message);
  }, []);
  return { state, pick, drop, replace: setState };
}

/**
 * Önizleme yanıtıyla eşitleme: teklif değişti (hedef/müşteri/aşama) ya da sunucu seçimi reddetti → varsayılana dön.
 * Ret yalnız reddedilen isteğin taşıdığı seçime uygulanır (debounce penceresinde yeni seçim düşmesin).
 */
export function useTemplateChoiceSync(
  choice: TamburTemplateChoice,
  offer: TemplateOffer | null,
  preview: { errorCode: string | null; requestTemplateId: string | null },
): void {
  const { state, replace } = choice;
  useEffect(() => {
    const rejected =
      preview.errorCode === LABEL_TEMPLATE_NOT_OFFERED && state.selectedId != null && preview.requestTemplateId === state.selectedId;
    const r = rejected ? dropChoice(state) : reconcileChoice(state, offer);
    if (r.state === state) return;
    replace(r.state);
    if (r.warn) warnDropped();
  }, [state, offer, preview.errorCode, preview.requestTemplateId, replace]);
}
