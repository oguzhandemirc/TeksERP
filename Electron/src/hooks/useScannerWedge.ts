import { useEffect, useRef } from "react";
import {
  createWedgeDetector,
  DEFAULT_WEDGE_CONFIG,
  type WedgeConfig,
  type WedgeResult,
} from "@/lib/scanner/wedge-detector";
import { isTyping } from "@/lib/scanner/is-typing";

interface UseScannerWedgeOptions {
  /** Nitelikli bir scan burst'ü tamamlanınca çağrılır. */
  onScan: (result: WedgeResult) => void;
  /** Kapalıyken hiçbir dinleyici kurulmaz (opt-in "her yerde okut"). */
  enabled?: boolean;
  config?: Partial<WedgeConfig>;
}

/**
 * Global klavye-wedge yakalayıcı — AppShell'de bir kez mount edilir. `window`'a
 * CAPTURE fazında tek `keydown` dinleyici takar (kısayol hook'larından önce
 * tuşları görür → scan sırasında onları bastırabilir). Öncelik kuralları:
 *   1. Odaklı metin girişi (input/textarea/select) varsa global wedge devreye
 *      girmez — alanın kendi Enter handler'ı (ScanField) işler.
 *   2. Modifier'lı tuşlar (Cmd/Ctrl/Alt) burst'ü iptal eder (insan kısayolu).
 *   3. Enter göndermeyen tabancalar için graceTail idle-watchdog ile flush.
 * `isCapturing()` ref-tabanlı okunur → `useGlobalShortcuts` scan ortasında
 * `g`/`/`/`?` gibi tek-tuş kısayollarını bastırmak için kullanır.
 */
export function useScannerWedge({
  onScan,
  enabled = true,
  config,
}: UseScannerWedgeOptions): { isCapturing: () => boolean } {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const capturingRef = useRef(false);
  // Kararlı referans — useGlobalShortcuts deps'inde churn yaratmasın.
  const isCapturing = useRef(() => capturingRef.current).current;

  const maxInterKeyMs = config?.maxInterKeyMs ?? DEFAULT_WEDGE_CONFIG.maxInterKeyMs;
  const minLength = config?.minLength ?? DEFAULT_WEDGE_CONFIG.minLength;
  const terminator = config?.terminator ?? DEFAULT_WEDGE_CONFIG.terminator;
  const graceTailMs = config?.graceTailMs ?? DEFAULT_WEDGE_CONFIG.graceTailMs;

  useEffect(() => {
    if (!enabled) {
      capturingRef.current = false;
      return;
    }
    const det = createWedgeDetector({ maxInterKeyMs, minLength, terminator, graceTailMs });
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const fire = (r: WedgeResult) => {
      capturingRef.current = false;
      clearIdle();
      onScanRef.current(r);
    };

    const handler = (e: KeyboardEvent) => {
      // Odaklı metin girişi kazanır — global wedge karışmaz.
      if (isTyping(e.target)) {
        det.reset();
        capturingRef.current = false;
        clearIdle();
        return;
      }
      const now = performance.now();
      const result = det.feed(e, now);
      capturingRef.current = det.isCapturing();
      if (result) {
        e.preventDefault();
        fire(result);
        return;
      }
      // Enter göndermeyen tabanca: son tuştan sonra sessizlik dolunca flush.
      clearIdle();
      if (det.isCapturing()) {
        idleTimer = setTimeout(() => {
          const flushed = det.flushIdle(performance.now());
          capturingRef.current = det.isCapturing();
          if (flushed) fire(flushed);
        }, graceTailMs + 20);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      clearIdle();
      det.reset();
      capturingRef.current = false;
    };
  }, [enabled, maxInterKeyMs, minLength, terminator, graceTailMs]);

  return { isCapturing };
}
