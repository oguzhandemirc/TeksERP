// İstasyon özelliği cevapları (propertyId → BAYRAK `true` / SEÇİM kodu), top başına sıfırlanır; sıfırlanınca SEÇİM
// özelliklerinde İE hedefi ön seçilir. Operatörün dokunduğu özellik aynı topta hedef tazelense de ezilmez.
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyChoiceTargetDefaults, choiceTargetDefaults, type ChoiceTargetProp, type PropAnswers } from './choiceTargetDefaults';

export function usePropAnswers(
  pickableProps: readonly ChoiceTargetProp[],
  targets: readonly { propertyId: string; valueCode: string }[] | undefined,
  /** Kart + seçili top kimliği: değişince cevaplar sıfırlanır (önceki topun işareti sıradakine taşınmaz). */
  rollKey: string,
) {
  const [answers, setAnswers] = useState<PropAnswers>({});
  const touched = useRef<{ key: string; ids: Set<string> }>({ key: rollKey, ids: new Set() });
  const defaults = useMemo(() => choiceTargetDefaults(pickableProps, targets), [pickableProps, targets]);
  // Her refetch yeni nesne getirir; içerik değişmedikçe etki koşmasın.
  const defaultsKey = JSON.stringify(defaults);
  useEffect(() => {
    const rollChanged = touched.current.key !== rollKey;
    if (rollChanged) touched.current = { key: rollKey, ids: new Set() };
    setAnswers((prev) => applyChoiceTargetDefaults(rollChanged ? {} : prev, defaults, touched.current.ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey, defaultsKey]);

  /** BAYRAK çipi: aç/kapa. */
  const toggleFlag = (id: string) => {
    touched.current.ids.add(id);
    setAnswers((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  /** SEÇİM çipi: aynı değere tekrar basmak seçimi KALDIRIR, farklı değer DEĞİŞTİRİR (tek seçim). */
  const pickValue = (id: string, code: string) => {
    touched.current.ids.add(id);
    setAnswers((prev) => {
      const next = { ...prev };
      if (next[id] === code) delete next[id];
      else next[id] = code;
      return next;
    });
  };

  return { answers, toggleFlag, pickValue };
}
