import { useCallback, useRef } from 'react';

// =============================================================================
// useDrawerActionQueue — compact ekranlarda RightPanelDrawer + RNModal stack
// çakışmasını çözmek için.
//
// SORUN: react-native-modal'da bir modal (drawer) açıkken hemen başka bir modal
// (scanner, picker vb.) açılırsa ikincisi invisible overlay ile tıklamaları
// yutar — kullanıcı için ekran kilitlenmiş gibi görünür.
//
// ÇÖZÜM: Drawer açıkken yeni modal açmak istendiğinde:
//   1. Hedef action'ı ref'e yaz (pending)
//   2. Drawer'ı kapat
//   3. Drawer kapanma animasyonu bittiğinde (onClosed / onModalHide) drain()
//      çağrılır → pending handler execute olur
//
// Kullanım:
//   const drawer = useDrawerActionQueue({
//     drawerOpen: rightDrawerOpen,
//     closeDrawer: () => setRightDrawerOpen(false),
//     compact,
//   });
//
//   <Button onPress={() => drawer.run(() => setScannerOpen(true))} />
//   <RightPanelDrawer onClosed={drawer.drain} />
//
// Tablet (compact=false) modunda drawer yok → handler direkt çağrılır,
// queue bypass edilir.
// =============================================================================

interface Options {
  /** Drawer şu an açık mı. */
  drawerOpen: boolean;
  /** Drawer'ı kapatma trigger'ı (animasyonu başlatır). */
  closeDrawer: () => void;
  /** Compact mod (telefon) — false ise queue mantığı bypass edilir, handler
   *  doğrudan çağrılır. */
  compact: boolean;
}

interface QueueApi {
  /** Drawer açıksa handler'ı ref'e koy + drawer'ı kapat; değilse anında çağır. */
  run: (handler: () => void) => void;
  /** Drawer animasyonu bittikten sonra çağır (RightPanelDrawer onClosed).
   *  Pending handler varsa execute eder + temizler. */
  drain: () => void;
}

export function useDrawerActionQueue(options: Options): QueueApi {
  const { drawerOpen, closeDrawer, compact } = options;
  const pendingRef = useRef<(() => void) | null>(null);

  const run = useCallback(
    (handler: () => void) => {
      if (compact && drawerOpen) {
        pendingRef.current = handler;
        closeDrawer();
        return;
      }
      handler();
    },
    [compact, drawerOpen, closeDrawer],
  );

  const drain = useCallback(() => {
    const handler = pendingRef.current;
    if (!handler) return;
    pendingRef.current = null;
    handler();
  }, []);

  return { run, drain };
}
