// K20: iş emri adının (TERIM.terbiyeIsEmri) tablet tarafı rejim bağlayıcısı. Kaynak bayrak ucu
// (`featureFlagService.get` + kalıcı önbellekten geri yüklenen bayraklar, `useFeatureFlags`). Bilinmiyorsa bugünkü ad.
import { terimDokumaAyarla } from './terim';

/** Bayraklardan etkin dokuma rejimini (`production ∧ dokuma`) uygular; alan yoksa dokunmaz. Değiştiyse true. */
export function applyTermRegime(flags: { productionEnabled?: boolean; dokumaEnabled?: boolean } | null | undefined): boolean {
  if (!flags || typeof flags.dokumaEnabled !== 'boolean') return false;
  return terimDokumaAyarla((flags.productionEnabled ?? true) && flags.dokumaEnabled);
}
