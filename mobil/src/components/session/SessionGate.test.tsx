import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { withWorkSession } from './SessionGate';
import { useSessionStore } from '../../store/sessionStore';
import type { ActiveWorkSession } from '../../services/workSession.service';

// SessionGate'in odak-invariant'ı: PlaceConfirmView (autoOpen) YALNIZ odaktaki
// ekranda mount edilir. Arka planda mount kalan bir gate otomatik oturum açarsa
// odaktaki gate'le dönüşümlü "oturum kapma savaşı" doğar (ekran ↔ yer-onayı
// ~1sn ping-pong; PlaceConfirmView'deki tek-slot 6sn guard'ı dönüşümlü key'leri
// yakalayamaz). Buradaki testler o savaşın ön koşulunu kilitler.

// PlaceConfirmView'in gerçek gövdesi react-query + navigation + haptics çeker —
// gate testinde yalnız "mount edildi mi" önemli; marker'a indirgenir.
jest.mock('./PlaceConfirmView', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    default: ({ expectedKind, autoOpen }: { expectedKind: string; autoOpen?: boolean }) => (
      <T>{`PCV:${expectedKind}:${autoOpen ? 'auto' : 'manual'}`}</T>
    ),
  };
});

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => true),
}));
const mockUseIsFocused = useIsFocused as jest.Mock;

const rawQcSession = {
  id: 'ws-1',
  station: { id: 'st-1', code: 'KK1_1', name: 'Ham Giriş', kind: 'RAW_QC' },
  machine: null,
} as unknown as ActiveWorkSession;

const ScreenStub = () => <Text>EKRAN</Text>;
// KK1 → RAW_QC bekler (stationScreens registry'si).
const Gated = withWorkSession('KK1', () => ScreenStub);

beforeEach(() => {
  mockUseIsFocused.mockReturnValue(true);
  useSessionStore.setState({ active: null, lastPlace: null, isLoaded: true });
});

describe('SessionGate — yer-onayı kapısının odak invariantı', () => {
  it('oturum türü eşleşiyorsa ekranı render eder', () => {
    useSessionStore.setState({ active: rawQcSession });
    const { getByText, queryByText } = render(<Gated />);
    expect(getByText('EKRAN')).toBeTruthy();
    expect(queryByText(/PCV:/)).toBeNull();
  });

  it('eşleşme varken odak kaybolsa da ekran mount kalır (alt sayfa push senaryosu)', () => {
    useSessionStore.setState({ active: rawQcSession });
    mockUseIsFocused.mockReturnValue(false);
    const { getByText } = render(<Gated />);
    expect(getByText('EKRAN')).toBeTruthy();
  });

  it('tür uyuşmazlığı + ODAKTA → PlaceConfirmView autoOpen ile mount edilir', () => {
    const { getByText, queryByText } = render(<Gated />);
    expect(getByText('PCV:RAW_QC:auto')).toBeTruthy();
    expect(queryByText('EKRAN')).toBeNull();
  });

  it('tür uyuşmazlığı + ODAKTA DEĞİL → PlaceConfirmView HİÇ mount edilmez (ping-pong regresyonu)', () => {
    mockUseIsFocused.mockReturnValue(false);
    const { queryByText } = render(<Gated />);
    expect(queryByText(/PCV:/)).toBeNull();
    expect(queryByText('EKRAN')).toBeNull();
  });

  it('oturum durumu daha yüklenmediyse (isLoaded=false) yer onayı gösterilmez', () => {
    useSessionStore.setState({ isLoaded: false });
    const { queryByText } = render(<Gated />);
    expect(queryByText(/PCV:/)).toBeNull();
  });

  it('arka plandaki gate, oturum başka türe geçince yer onayı AÇMAZ; odağa dönünce açar', () => {
    // Savaş senaryosunun birebir akışı: KK1 gate'i arka planda, oturum TAMBUR'a geçti.
    mockUseIsFocused.mockReturnValue(false);
    useSessionStore.setState({
      active: {
        ...rawQcSession,
        station: { id: 'st-2', code: 'TAMBUR_1', name: 'Tambur', kind: 'TAMBUR' },
      } as unknown as ActiveWorkSession,
    });
    const { queryByText, getByText, rerender } = render(<Gated />);
    expect(queryByText(/PCV:/)).toBeNull(); // arka planda sessiz — oturum talep edemez

    mockUseIsFocused.mockReturnValue(true); // kullanıcı ekrana döndü
    rerender(<Gated />);
    expect(getByText('PCV:RAW_QC:auto')).toBeTruthy(); // taze onay/oto-açılış hakkı
  });
});
