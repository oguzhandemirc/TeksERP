// Çizim ekranı hook'u: çizim durumu (saf reducer), araç/renk, tuval boyutu ve
// "Bitti" → view-shot ile JPEG (uzun kenar ≤ 1920 px) → taslağa yaz.
import { useCallback, useReducer, useRef, useState } from 'react';
import type { LayoutChangeEvent, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { captureRef } from 'react-native-view-shot';

import { useDestekTaslakStore } from '../../store/destekTaslakStore';
import { cizimReducer, sigdir, uzunKenaraSigdir, type CizimAraci, type CizimRengi } from './cizim';

/** JPEG kalitesi: ekran görüntüsünde metin okunur kalır, boyut ~150–400 KB. */
const JPEG_KALITE = 0.8;

export function useDestekCizim(onBitti: () => void) {
  const ekran = useDestekTaslakStore((s) => s.ekran);
  const [durum, dispatch] = useReducer(cizimReducer, useDestekTaslakStore.getState().cizim);
  const [arac, setArac] = useState<CizimAraci>('kalem');
  const [renk, setRenk] = useState<CizimRengi>('kirmizi');
  const [alan, setAlan] = useState({ width: 0, height: 0 });
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const tuvalRef = useRef<View | null>(null);

  const onAlan = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setAlan({ width, height });
  }, []);

  const boyut = ekran ? sigdir(ekran.width, ekran.height, alan.width, alan.height) : { width: 0, height: 0 };

  const bitti = useCallback(async () => {
    if (!ekran || kaydediliyor) return;
    const kaydet = useDestekTaslakStore.getState().cizimiKaydet;
    if (durum.sekiller.length === 0) {
      kaydet(durum, null);
      onBitti();
      return;
    }
    setKaydediliyor(true);
    try {
      const output = uzunKenaraSigdir(ekran.width, ekran.height);
      const base64 = await captureRef(tuvalRef, {
        format: 'jpg',
        quality: JPEG_KALITE,
        result: 'base64',
        width: output.width,
        height: output.height,
      });
      kaydet(durum, { base64, onizlemeUri: `data:image/jpeg;base64,${base64}` });
      onBitti();
    } catch {
      Toast.show({ type: 'error', text1: 'Çizim kaydedilemedi', text2: 'Tekrar deneyin ya da çizimsiz devam edin.' });
    } finally {
      setKaydediliyor(false);
    }
  }, [ekran, kaydediliyor, durum, onBitti]);

  return { ekran, durum, dispatch, arac, setArac, renk, setRenk, onAlan, boyut, tuvalRef, bitti, kaydediliyor };
}
