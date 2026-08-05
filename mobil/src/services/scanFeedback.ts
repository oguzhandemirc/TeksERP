import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { useDeviceSettingsStore } from '../store/deviceSettingsStore';

/**
 * Okutmanın ÜÇ sonucu ve üçünün de kendi sinyali.
 *
 * WMS/el terminali geleneğinde okutma iki değil ÜÇ şey döndürür ve operatör
 * hangisi olduğunu ekrana bakmadan ayırt edebilmelidir:
 *  • `accept`    — kayda girdi.
 *  • `duplicate` — okundu ama zaten listedeydi. Kabulden AYRI olmak zorunda:
 *                  aynı sinyali verirsen operatör topu iki kez saydığını sanır,
 *                  hiç sinyal vermezsen (eski davranış) "okumadı" sanıp tekrar
 *                  okutur. İkisi de yanlış.
 *  • `reject`    — kabul edilmedi (stokta değil / farklı ürün / bulunamadı).
 */
export type ScanOutcome = 'accept' | 'duplicate' | 'reject';

// Ses dosyaları `scripts/generate-scan-sounds.mjs` ile üretilir (tonlar orada
// sayı olarak durur ve yeniden üretilebilir).
const SOURCES: Record<ScanOutcome, number> = {
  accept: require('../../assets/sounds/scan-accept.wav'),
  duplicate: require('../../assets/sounds/scan-duplicate.wav'),
  reject: require('../../assets/sounds/scan-reject.wav'),
};

const players: Partial<Record<ScanOutcome, AudioPlayer>> = {};
let audioModeSet = false;

/**
 * Çalıcılar TEMBEL kurulur ve her hata YUTULUR.
 *
 * Ses bir kolaylıktır, akışın koşulu değil: hoparlörü olmayan / ses yolu
 * meşgul bir cihazda okutmanın kendisi durmamalı. Aynı gerekçeyle çalıcı bir
 * kez kurulup tekrar kullanılır — her okutmada yeni çalıcı yaratmak seri
 * girişte onlarca native nesne biriktirirdi.
 */
function play(outcome: ScanOutcome): void {
  try {
    if (!audioModeSet) {
      audioModeSet = true;
      // Sessiz moddaki telefonda da duyulsun + arkadaki müziği/anonsu kesmesin.
      void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(
        () => {},
      );
    }
    let p = players[outcome];
    if (!p) {
      p = createAudioPlayer(SOURCES[outcome]);
      players[outcome] = p;
    }
    // Önceki çalma bitmediyse başa sar — seri okutmada ikinci bip yutulmasın.
    p.seekTo(0);
    p.play();
  } catch {
    // yut
  }
}

/** Üç sonucun titreşim deseni — sesten BAĞIMSIZ, ses kapalıyken de çalışır. */
function vibrate(outcome: ScanOutcome): void {
  if (outcome === 'accept') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return;
  }
  if (outcome === 'reject') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    return;
  }
  // Mükerrer: iki kısa hafif dokunuş — kabulün tek darbesinden ve retin uzun
  // uyarısından elde bile ayırt edilebilir.
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  setTimeout(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, 110);
}

/**
 * Okutma geri bildirimi — TEK kapı. Ekranlar `Haptics`i doğrudan çağırmasın;
 * çağırırsa üç sonucun ayrımı ekran ekran kayar ve "kabul mü mükerrer mi"
 * sorusunun cevabı cihaza göre değişir.
 *
 * Ses cihaz ayarıyla kapatılabilir (`scanSoundEnabled`); titreşim KAPATILAMAZ —
 * o son geri bildirim hattıdır ve sessiz kalmak "hiçbir şey olmadı" demektir.
 */
export function signalScan(outcome: ScanOutcome): void {
  vibrate(outcome);
  if (useDeviceSettingsStore.getState().scanSoundEnabled) play(outcome);
}
