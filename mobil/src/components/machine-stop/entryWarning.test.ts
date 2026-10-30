// D4-A2b: açık duruş giriş uyarısı — UYARIR, gönderimi kesmez (K2); koşul kapalıyken Toast yok.
import { readFileSync } from 'fs';
import { join } from 'path';
import Toast from 'react-native-toast-message';
import { showStopOpenEntryWarning, stopOpenEntryWarning } from './entryWarning';
import { stopOpenTapWarning } from '../../screens/Modules/KursunQc/gramajTap';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

describe('açık duruş giriş uyarısı (D4-A2b)', () => {
  it('koşul kapalı → metin yok, Toast yok', () => {
    expect(stopOpenEntryWarning(false)).toBeNull();
    showStopOpenEntryWarning(false);
    expect(Toast.show).not.toHaveBeenCalled();
  });

  it('koşul açık → bilgi Toast\'u (ret değil)', () => {
    showStopOpenEntryWarning(true);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'Makine duruşta görünüyor — dokunuş engellenmedi' }));
  });

  it('Kurşun gramaj uyarısı aynı tek kaynaktan', () => {
    expect(stopOpenTapWarning).toBe(stopOpenEntryWarning);
  });
});

// Ekran bağlantısı bekçisi: ekranlar uyarıya ham `stopOpen`'ı değil, ayarla birleşik
// `entryWarning`'i geçmeli (aksi hâlde ayar kapalıyken de uyarı çıkar, hook testleri yeşil kalır).
describe('açık duruş uyarısı ekran bağlantısı (D4-A2b)', () => {
  const screens = join(__dirname, '../../screens/Modules');
  const read = (rel: string) => readFileSync(join(screens, rel), 'utf8');

  it('Kurşun: useGramajTap stopOpen ← machineStop.entryWarning', () => {
    const src = read('KursunQc/KursunQcScreen.tsx');
    expect(src).toMatch(/stopOpen:\s*machineStop\.entryWarning\b/);
    expect(src).not.toMatch(/stopOpen:\s*machineStop\.stopOpen\b/);
  });

  it('Tambur: her uyarı çağrısı machineStop.entryWarning ile (iki kesim yolu)', () => {
    const src = read('Tambur/TamburScreen.tsx');
    const calls = [...src.matchAll(/showStopOpenEntryWarning\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(calls).toEqual(['machineStop.entryWarning', 'machineStop.entryWarning']);
  });
});
