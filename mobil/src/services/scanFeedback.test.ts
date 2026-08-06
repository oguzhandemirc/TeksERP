// =============================================================================
// Okutma geri bildirimi — üç sonucun sinyali AYRI olmak ZORUNDA.
// =============================================================================
// Saha gerekçesi: mükerrer okuma eskiden tamamen sessizdi, operatör "okumadı"
// sanıp tekrar tekrar okutuyordu. Kabulle AYNI sinyali vermek de yanlıştır —
// bu kez topu iki kez saydığını sanır. Yani `duplicate` hem sessizlikten hem
// `accept`ten ayrışmalı; bu test tam olarak o ayrışmayı ölçer.
//
// Negatif sonda: `vibrate` içindeki duplicate dalı silinip accept'e düşürülünce
// §2 ve §4 kırmızı verdi — doğrulandı.
// =============================================================================

const mockNotificationAsync = jest.fn(async () => undefined);
const mockImpactAsync = jest.fn(async () => undefined);

jest.mock('expo-haptics', () => ({
  notificationAsync: (...a: unknown[]) => mockNotificationAsync(...(a as [])),
  impactAsync: (...a: unknown[]) => mockImpactAsync(...(a as [])),
  NotificationFeedbackType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
  ImpactFeedbackStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

// Her çalıcı KENDİ play/seekTo'sunu taşır: "hangi sonuç hangi çalıcıyı çaldı"
// sorusu ancak böyle sorulabilir (ortak jest.fn ile sayı toplanır, kimlik kaybolur).
const mockPlayers: { source: unknown; play: jest.Mock; seekTo: jest.Mock }[] = [];
const mockCreateAudioPlayer = jest.fn((source: unknown) => {
  const p = { source, play: jest.fn(), seekTo: jest.fn() };
  mockPlayers.push(p);
  return p;
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: (s: unknown) => mockCreateAudioPlayer(s),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

/**
 * Her test TAZE modül kaydıyla koşar. Sebep: `scanFeedback` çalıcıları modül
 * ömrü boyunca önbellekler (§5'in ölçtüğü şey tam da bu) — paylaşılan kayıtla
 * testler birbirinin önbelleğini miras alır ve sıraya bağımlı hale gelir.
 */
function load() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = (require('../store/deviceSettingsStore') as typeof import('../store/deviceSettingsStore'))
    .useDeviceSettingsStore;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signalScan } = require('./scanFeedback') as typeof import('./scanFeedback');
  return { signalScan, store };
}

describe('signalScan — kabul / mükerrer / ret ayrışması', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockNotificationAsync.mockClear();
    mockImpactAsync.mockClear();
    mockCreateAudioPlayer.mockClear();
    mockPlayers.length = 0;
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('§1 kabul — tek "başarı" titreşimi', () => {
    const { signalScan } = load();
    signalScan('accept');
    expect(mockNotificationAsync).toHaveBeenCalledWith('SUCCESS');
    expect(mockImpactAsync).not.toHaveBeenCalled();
  });

  it('§2 mükerrer — SESSİZ DEĞİL ve kabulden FARKLI', () => {
    const { signalScan } = load();
    signalScan('duplicate');
    // Asıl kural: bir şey oldu (sessiz değil)…
    expect(mockImpactAsync).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(mockImpactAsync).toHaveBeenCalledTimes(2); // çift dokunuş deseni
    // …ve o şey kabulün sinyali DEĞİL.
    expect(mockNotificationAsync).not.toHaveBeenCalledWith('SUCCESS');
  });

  it('§3 ret — "hata" titreşimi', () => {
    const { signalScan } = load();
    signalScan('reject');
    expect(mockNotificationAsync).toHaveBeenCalledWith('ERROR');
  });

  it('§4 üç sonucun ÜÇ AYRI çalıcısı var — hiçbiri paylaşılmaz', () => {
    // NOT: dosya kimliği burada iddia EDİLEMEZ — jest tüm `.wav` require'larını
    // tek stub değere indirger. Ölçülebilen ve asıl önemli olan şey: her sonuç
    // kendi çalıcısını çalar, yani ikisi aynı sese bağlanmış olamaz.
    const { signalScan } = load();
    signalScan('accept');
    signalScan('duplicate');
    signalScan('reject');
    expect(mockPlayers).toHaveLength(3);
    for (const p of mockPlayers) expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('§5 çalıcı sonuç başına BİR kez kurulur (seri okutmada birikmesin)', () => {
    const { signalScan } = load();
    signalScan('accept');
    signalScan('accept');
    signalScan('accept');
    expect(mockPlayers).toHaveLength(1);
    expect(mockPlayers[0].play).toHaveBeenCalledTimes(3);
    expect(mockPlayers[0].seekTo).toHaveBeenCalledWith(0); // çalma bitmediyse başa sar
  });

  it('§6 ses kapalıyken TİTREŞİM çalışmaya devam eder', () => {
    // Ayar yalnız sesi kapatır; titreşim son geri bildirim hattıdır ve
    // sessiz kalmak "hiçbir şey olmadı" demektir.
    const { signalScan, store } = load();
    store.setState({ scanSoundEnabled: false });
    signalScan('accept');
    expect(mockPlayers).toHaveLength(0);
    expect(mockNotificationAsync).toHaveBeenCalledWith('SUCCESS');
  });
});
