// =============================================================================
// printHtml — tek expo-print kapısı (kilit bastırmalı)
// =============================================================================
// Print.printAsync Android SİSTEM YAZDIRMA activity'sini açar → host activity
// pause olur → AppState 'background' → idle kilidi ANINDA kilitlerdi (her
// basımda operatör kilit ekranına düşerdi). withSystemDialog sarması, yazdırma
// ekranı açıkken AppState-kilidini bastırır; iptal/hata aynen rethrow edilir.
// KURAL: Print.printAsync'i DOĞRUDAN çağırma — her HTML yazdırma buradan geçer.
// =============================================================================

import * as Print from 'expo-print';
import { withSystemDialog } from '../store/lockStore';

export async function printHtml(options: Print.PrintOptions): Promise<void> {
  await withSystemDialog(() => Print.printAsync(options));
}
