import { create } from "zustand";
import { classifyBarcode, type BarcodeKind } from "@/lib/scanner/barcode-kind";

export type ScanSource = "wedge" | "device" | "manual";

export interface PendingScan {
  /** Normalize edilmiş kod (trim + uppercase). */
  code: string;
  kind: BarcodeKind;
  source: ScanSource;
  /** Aynı kod art arda okutulsa da overlay'i yeniden tetiklemek için. */
  nonce: number;
}

interface ScannerState {
  pending: PendingScan | null;
  /**
   * Tek giriş noktası — wedge (Faz-1) ve ileride cihaz katmanı (Faz-2) aynı
   * fonksiyonu besler; altındaki yönlendirme/overlay taşımayı bilmez.
   */
  pushScan: (raw: string, source?: ScanSource) => void;
  clear: () => void;
}

let nonceSeq = 0;

export const useScannerStore = create<ScannerState>((set) => ({
  pending: null,
  pushScan: (raw, source = "wedge") => {
    const { kind, code } = classifyBarcode(raw);
    if (!code) return;
    set({ pending: { code, kind, source, nonce: ++nonceSeq } });
  },
  clear: () => set({ pending: null }),
}));
