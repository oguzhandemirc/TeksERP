// TruncatedText testleri için ortak yardımcılar: jest'te yerleşim olmadığından
// ölçü kopyasının satır sayısı elle verilir; basılı tutma RNGH jest-utils ile.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

/** 60+ karakterlik ad — tabletin dar sütununa sığmaz. */
export const UZUN_AD = 'ÇOK UZUN TEZGAH ADI — Dokuma Salonu B Kuzey Hat 14 Jakarlı Pikaj Makinesi Numara 7';

/** RNGH jest yapılandırmasını ertelenmiş günceller (enabled) — bir tur beklenir. */
export async function measureLines(testID: string, lineCount: number): Promise<void> {
  fireEvent(screen.getByTestId(`${testID}-olcu`, { includeHiddenElements: true }), 'textLayout', {
    nativeEvent: { lines: Array.from({ length: lineCount }, () => ({})) },
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

export function longPress(testID: string, at = { absoluteX: 400, absoluteY: 500 }): void {
  act(() => {
    fireGestureHandler(getByGestureTestId(`${testID}-basili`), [
      { state: State.BEGAN, ...at },
      { state: State.ACTIVE, ...at },
      { state: State.END, ...at },
    ]);
  });
}

/** Ad düğümü tek satır + sondan kısaltma + tam ad etiketi taşıyor mu. */
export function expectSingleLineName(testID: string, full: string): void {
  const t = screen.getByTestId(testID);
  expect(t.props.numberOfLines).toBe(1);
  expect(t.props.ellipsizeMode).toBe('tail');
  expect(t.props.accessibilityLabel).toBe(full);
}
