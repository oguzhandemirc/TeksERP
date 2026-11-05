// Makine çiplerinin seçenekleri — ortak önek şerit/başlıkta, çipte yalnız ayırt edici kısım (1e kararı).
import type { ChoiceOption } from '../../../../components/form/ChoiceChips';
import { splitCommonPrefix } from '../../../../components/form/commonPrefix';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';

export const MACHINE_LATER_LABEL = 'Sonra seçilsin';

export function machineChoice(list: readonly DeskKursunMachine[], testID: string): {
  prefix: string | null;
  square: boolean;
  options: ChoiceOption[];
  shortName: (id: string | null) => string | null;
} {
  const full = list.map((mc) => mc.name || mc.code);
  const { prefix, labels } = splitCommonPrefix(full);
  const square = prefix != null && labels.length > 0 && labels.every((l) => l.length <= 3);
  const options: ChoiceOption[] = [
    { value: null, label: MACHINE_LATER_LABEL, dashed: true, testID: `${testID}-yok` },
    ...list.map((mc, i) => ({ value: mc.id, label: labels[i], a11y: full[i], testID: `${testID}-${mc.code}` })),
  ];
  const shortName = (id: string | null) => {
    const i = id == null ? -1 : list.findIndex((mc) => mc.id === id);
    return i < 0 ? null : labels[i];
  };
  return { prefix, square, options, shortName };
}
