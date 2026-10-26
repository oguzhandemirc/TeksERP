// =============================================================================
// TEZGAH ALARMI — ses + titreşim (uygulama AÇIKKEN; kademe başına ayrı ton)
// =============================================================================
// Okutma geri bildiriminden (`scanFeedback`) AYRI kapı: alarm okutmanın sonucu değildir ve cihazın
// `scanSoundEnabled` ayarı alarmı susturmamalı. Ses/titreşim hatası yutulur — alarm görüntüsü sürer.
// =============================================================================
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

type Tier = 1 | 2;

const SOURCES: Record<Tier, number> = {
  1: require('../../assets/sounds/loom-alarm-k1.wav'),
  2: require('../../assets/sounds/loom-alarm-k2.wav'),
};

const players: Partial<Record<Tier, AudioPlayer>> = {};
let audioModeSet = false;

function play(tier: Tier): void {
  try {
    if (!audioModeSet) {
      audioModeSet = true;
      void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    let p = players[tier];
    if (!p) {
      p = createAudioPlayer(SOURCES[tier]);
      players[tier] = p;
    }
    void p.seekTo(0).catch(() => {});
    p.play();
  } catch {
    // ses bir kolaylık; görüntü ve titreşim sürer
  }
}

function vibrate(tier: Tier): void {
  const pulse = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  pulse();
  setTimeout(pulse, 350);
  if (tier === 2) setTimeout(pulse, 700);
}

/** Yeni alarm/kademe/tekrar çalma: ses + titreşim (üst kademe daha uzun). */
export function signalLoomAlarm(tier: Tier): void {
  vibrate(tier);
  play(tier);
}

/** Bildirim (ALARM değil) tonu: tek titreşim + 1. kademe sesi. Karar (`sesli`) sunucudan gelir. */
export function signalNotification(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  play(1);
}
