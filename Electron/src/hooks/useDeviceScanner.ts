import { useEffect } from "react";
import { useScannerStore } from "@/store/scanner";
import { useMachineConfig } from "@/hooks/useMachineConfig";

/**
 * Faz-2 — seri/HID barkod tabancası köprüsü. Tercih (`scanner.device`) açıksa
 * Electron ana-sürecindeki cihazı açar ve gelen kodu klavye-wedge ile AYNI
 * `pushScan(code, "device")` boru hattına verir (overlay/yönlendirme moda
 * bağımsız). Tercih tek kaynak — Ayarlar yalnız tercihi düzenler, açma/kapama
 * burada olur (çift-sahiplik yok). Donanım okuyucu olmayan ortamda (vitest)
 * `window.api?.scanner` tanımsız → no-op.
 */
export function useDeviceScanner(): void {
  const { config } = useMachineConfig();
  const dev = config.scanner?.device;
  const pushScan = useScannerStore((s) => s.pushScan);

  const enabled = dev?.enabled ?? false;
  const transport = dev?.transport;
  const path = dev?.path;
  const baudRate = dev?.baudRate;
  const vendorId = dev?.vendorId;
  const productId = dev?.productId;
  const frameTerminator = dev?.frameTerminator;

  useEffect(() => {
    const scanner = window.api?.scanner;
    if (!enabled || !scanner || !transport) return;

    const off = scanner.onData((code) => pushScan(code, "device"));
    void scanner.open({
      transport,
      path: path ?? "",
      baudRate,
      vendorId,
      productId,
      terminator: frameTerminator,
    });

    return () => {
      off();
      void scanner.close();
    };
  }, [enabled, transport, path, baudRate, vendorId, productId, frameTerminator, pushScan]);
}
