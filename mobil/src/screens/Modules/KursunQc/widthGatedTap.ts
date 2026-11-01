// D4-KUC3d: gramaj dokunuşunun ölçülen en bağlantısı TEK yerde — ekran (KursunQcScreen) ve
// bekçisi (widthPrecheck.test) aynı fonksiyonu kullanır; bağlantı ekranda kopyalanıp kaybolmaz.
import type { GramajTapInput } from './useGramajTap';
import type { MeasuredWidthState } from './useMeasuredWidth';

/** complete: gövdeye eni ekler (geçersizse istek gitmez) · precheck: sınır dışı en dokunuşu baştan durdurur. */
export function widthGatedTap(
  width: Pick<MeasuredWidthState, 'attach'>,
  send: GramajTapInput['complete'],
): Pick<GramajTapInput, 'complete' | 'precheck'> {
  return {
    complete: (vars, opts) => {
      const withWidth = width.attach(vars);
      if (withWidth) send(withWidth, opts);
      else opts.onSettled?.();
    },
    precheck: (rollId) => width.attach({ rollId }) !== null,
  };
}
