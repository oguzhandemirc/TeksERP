// SEÇİM (CHOICE) istasyon özelliğinde iş emri hedefi = varsayılan seçim (2026-11-10). Özelliğe/hedefe bakar, kurşuna
// özgü değildir. Operatörün elle dokunduğu özellik ("touched") aynı top içinde ezilmez; hedef yoksa seçimsiz kalır.

export interface ChoiceTargetProp {
  propertyId: string;
  mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED';
  valueType?: 'FLAG' | 'CHOICE';
  values?: { code: string }[];
}

export type PropAnswers = Record<string, true | string>;

/** propertyId → hedef değer kodu; yalnız tuşlu SEÇİM özelliği ve değeri katalogda bulunan GERÇEK İE hedefi. */
export function choiceTargetDefaults(
  props: readonly ChoiceTargetProp[],
  targets: readonly { propertyId: string; valueCode: string }[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of props) {
    if (p.mode === 'AUTO' || p.valueType !== 'CHOICE') continue;
    const t = (targets ?? []).find((x) => x.propertyId === p.propertyId);
    if (t && (p.values ?? []).some((v) => v.code === t.valueCode)) out[p.propertyId] = t.valueCode;
  }
  return out;
}

/** Dokunulmuş cevaplar korunur; dokunulmamış özellikler hedefe eşitlenir (hedefi kalkan dokunulmamış seçim düşer). */
export function applyChoiceTargetDefaults(
  prev: PropAnswers,
  defaults: Record<string, string>,
  touched: ReadonlySet<string>,
): PropAnswers {
  const next: PropAnswers = {};
  for (const [id, v] of Object.entries(prev)) if (touched.has(id)) next[id] = v;
  for (const [id, code] of Object.entries(defaults)) if (!touched.has(id)) next[id] = code;
  const same =
    Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => prev[k] === v);
  return same ? prev : next;
}
