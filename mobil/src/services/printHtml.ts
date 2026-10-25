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
import {
  DIALOG_TARGET,
  isPrintCancel,
  printJobAttachment,
  reportPrintOutcome,
  type PrintJobAttachment,
  type PrintSubject,
} from './printJob.service';

export async function printHtml(options: Print.PrintOptions): Promise<void> {
  await withSystemDialog(() => Print.printAsync(options));
}

/**
 * Sistem penceresi basımı + sonucun Yazdırma geçmişine raporu (izlenebilirlik A4).
 * Pencere "tamamlandı" demesi kâğıdın çıktığını kanıtlamaz → `BELIRSIZ`; "did not complete"
 * → `IPTAL`; diğer hata → `HATA`. Hata aynen yeniden fırlatılır (çağıranın akışı değişmez).
 * `reportSuccess:false` → başarı iş ucunun `printJob` ekiyle yazılır, burada RAPORLANMAZ
 * (aynı basıma iki satır doğmasın); dönen ek o çağrıya verilir.
 */
export async function printHtmlReported(
  options: Print.PrintOptions,
  subject: PrintSubject,
  opts: { reportSuccess?: boolean } = {},
): Promise<PrintJobAttachment> {
  const startedAt = Date.now();
  try {
    await printHtml(options);
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    const cancelled = isPrintCancel(msg);
    reportPrintOutcome({ subject, target: DIALOG_TARGET, startedAt, status: cancelled ? 'IPTAL' : 'HATA', step: 'dialog', error: err });
    throw err;
  }
  if (opts.reportSuccess !== false) {
    reportPrintOutcome({ subject, target: DIALOG_TARGET, startedAt, status: 'BELIRSIZ' });
  }
  return printJobAttachment(DIALOG_TARGET, startedAt, subject.copies);
}
