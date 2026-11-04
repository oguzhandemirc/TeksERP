// Form şeridi/hap ton sözlüğü — renk kararı tek yerde, bileşenler yalnız tonu taşır.
import { colors } from '../../theme';

export type BandTone = 'idle' | 'ok' | 'warn' | 'missing';
export type PillTone = BandTone | 'info' | 'busy';

export function pillColors(tone: PillTone): { bg: string; fg: string } {
  switch (tone) {
    case 'ok': return { bg: colors.successContainer, fg: colors.successText };
    case 'warn': return { bg: colors.warningContainer, fg: colors.warningText };
    case 'missing': return { bg: colors.dangerContainer, fg: colors.dangerText };
    case 'info': return { bg: colors.infoContainer, fg: colors.infoText };
    case 'busy': return { bg: colors.brandSoft, fg: colors.brand };
    default: return { bg: colors.surfaceMuted, fg: colors.textSecondary };
  }
}
