// Tek İE formunun okuma uyarıları belge satırında (DocHeadBand) hesaplanır, ikon ise ekranın başlık çubuğundadır
// (ScreenChrome); bu küçük depo ikisini bağlar. `held`: tanınmamış belge sorusu (TeachPrompt) ya da tanıtma açık —
// uyarı modalı onun üstüne açılmaz, o kapanınca açılır.
import { create } from 'zustand';
import type { WarningLine } from './warningLines';

export interface ReadWarningsState {
  /** Okuma kimliği (not id + runKey); uyarı yoksa null. */
  readKey: string | null;
  lines: WarningLine[];
  held: boolean;
  publish: (readKey: string | null, lines: WarningLine[], held: boolean) => void;
  clear: () => void;
}

export const useReadWarningStore = create<ReadWarningsState>((set) => ({
  readKey: null,
  lines: [],
  held: false,
  publish: (readKey, lines, held) => set({ readKey, lines, held }),
  clear: () => set({ readKey: null, lines: [], held: false }),
}));
