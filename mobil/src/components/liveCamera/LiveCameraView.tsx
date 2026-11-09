// Canlı okuma (L2) — native `LiveCameraView` sarmalayıcısı. Yalnız `isLiveCameraAvailable()` true iken çizilir; değilse
// `null` (eski APK çökmez). Olaylar `services/liveCamera` ayrıştırıcılarından geçer; bozuk kare sessizce atlanır.
// Kamera izni JS'te istenir (expo-camera `useCameraPermissions`); izin yoksa native `onError({ code: 'NO_PERMISSION' })`.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ComponentType, Ref } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import {
  isLiveCameraAvailable,
  parseLiveError,
  parseLiveStability,
  parseLiveStill,
  parseLiveText,
  type LiveCameraError,
  type LiveStability,
  type LiveStill,
  type LiveTextFrame,
} from '../../services/liveCamera';

export interface LiveCameraHandle {
  /** Önbelleğe JPEG çeker (`file://`, dik boyutlar); bugünkü yükleme yolu bu dosyayı kullanır. */
  captureStill: () => Promise<LiveStill>;
  /** `false`: kamera + analiz bırakılır (ekran arkada); `true`: yeniden açılır. */
  setActive: (active: boolean) => Promise<void>;
}

export interface LiveCameraViewProps {
  style?: StyleProp<ViewStyle>;
  /** Fener isteği; flaşı olmayan cihazda native sessizce yok sayar. */
  torch?: boolean;
  onText?: (frame: LiveTextFrame) => void;
  onStability?: (s: LiveStability) => void;
  onError?: (e: LiveCameraError) => void;
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  torch?: boolean;
  onText?: (e: NativeSyntheticEvent<unknown>) => void;
  onStability?: (e: NativeSyntheticEvent<unknown>) => void;
  onError?: (e: NativeSyntheticEvent<unknown>) => void;
  ref?: Ref<NativeHandle>;
}

interface NativeHandle {
  captureStill: () => Promise<unknown>;
  setActive: (active: boolean) => Promise<void>;
}

let nativeView: ComponentType<NativeProps> | null | undefined;

/** Native görünüm yöneticisi tembel çözülür; modül yoksa bir kez null'a sabitlenir. */
function resolveNativeView(): ComponentType<NativeProps> | null {
  if (nativeView !== undefined) return nativeView;
  try {
    nativeView = isLiveCameraAvailable() ? requireNativeViewManager<NativeProps>('TeksErpBelgeTarayici') : null;
  } catch {
    nativeView = null;
  }
  return nativeView;
}

const LiveCameraView = forwardRef<LiveCameraHandle, LiveCameraViewProps>(function LiveCameraView(props, ref) {
  const nativeRef = useRef<NativeHandle>(null);
  const Native = resolveNativeView();

  useImperativeHandle(
    ref,
    () => ({
      captureStill: async () => {
        const n = nativeRef.current;
        if (!n) throw new Error('Kamera hazır değil');
        return parseLiveStill(await n.captureStill());
      },
      setActive: async (active: boolean) => {
        await nativeRef.current?.setActive(active);
      },
    }),
    [],
  );

  if (!Native) return null;
  const { onText, onStability, onError } = props;
  return (
    <Native
      ref={nativeRef}
      style={props.style}
      torch={props.torch === true}
      onText={(e) => {
        const f = parseLiveText(e.nativeEvent);
        if (f) onText?.(f);
      }}
      onStability={(e) => {
        const s = parseLiveStability(e.nativeEvent);
        if (s) onStability?.(s);
      }}
      onError={(e) => onError?.(parseLiveError(e.nativeEvent))}
    />
  );
});

export default LiveCameraView;
