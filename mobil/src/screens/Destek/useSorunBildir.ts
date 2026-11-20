// "Sorun bildir" — ÖNCE o anki ekranın görüntüsü alınır (form açılmadan),
// sonra talep formu açılır. Yakalama view-shot `captureScreen` ile kök
// görünümdendir; menü (AppMenu = ayrı Modal penceresi) görüntüye girmez.
// Yakalama düşerse talep yine açılır, yalnız görüntüsüz (fail-open: destek
// yolu saha işini de kendini de kilitlemez).
import { useCallback, useRef } from 'react';
import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen } from 'react-native-view-shot';

import { rootNavigationRef } from '../../navigation/navigationRef';
import { useDestekTaslakStore, type YakalananEkran } from '../../store/destekTaslakStore';
import { SCREEN_BY_KEY } from '../../types/permissions';
import { uzunKenaraSigdir } from './cizim';
import { ekranAdiBul } from './destekBaglam';

/** Menü kapanışı + dokunma dalgasının görüntüden çekilmesi için kısa bekleme. */
const YAKALAMA_GECIKMESI_MS = 250;

async function ekraniYakala(): Promise<YakalananEkran | null> {
  try {
    await new Promise((r) => setTimeout(r, YAKALAMA_GECIKMESI_MS));
    const { width, height } = Dimensions.get('screen');
    const px = uzunKenaraSigdir(width * PixelRatio.get(), height * PixelRatio.get());
    const uri = await captureScreen({
      format: 'jpg',
      quality: 0.8,
      result: 'data-uri',
      width: px.width,
      height: px.height,
    });
    return { uri, width: px.width, height: px.height };
  } catch {
    return null;
  }
}

export function useSorunBildir(): () => void {
  const yeniTaslak = useDestekTaslakStore((s) => s.yeniTaslak);
  const mesgul = useRef(false);

  return useCallback(() => {
    if (mesgul.current || !rootNavigationRef.isReady()) return;
    mesgul.current = true;
    const anahtar = rootNavigationRef.getCurrentRoute()?.name ?? null;
    void ekraniYakala()
      .then((ekran) => {
        yeniTaslak({ ekran, ekranAdi: ekranAdiBul(anahtar, SCREEN_BY_KEY), ekranAnahtari: anahtar });
        if (rootNavigationRef.isReady()) rootNavigationRef.navigate('DestekYeni');
      })
      .finally(() => {
        mesgul.current = false;
      });
  }, [yeniTaslak]);
}

/** Görüntüsüz yeni talep (Taleplerim → "Yeni talep"). */
export function useYeniTalepBaslat(): (kaynakEkran: string | null) => void {
  const yeniTaslak = useDestekTaslakStore((s) => s.yeniTaslak);
  return useCallback(
    (kaynakEkran) => {
      yeniTaslak({ ekran: null, ekranAdi: kaynakEkran, ekranAnahtari: null });
      if (rootNavigationRef.isReady()) rootNavigationRef.navigate('DestekYeni');
    },
    [yeniTaslak],
  );
}
