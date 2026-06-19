// =============================================================================
// Seri/HID tabanca veri çerçeveleme (pure — main + test ortak)
// =============================================================================
// Tabancalar kodu byte akışı olarak gönderir; sonunda bir terminator (CR/LF)
// olur. Bu helper gelen parçaları biriktirir ve terminator'a göre tam kodlara
// böler. Electron'a bağımlı DEĞİL → vitest ile test edilebilir (main importlar).
// =============================================================================

export type ScanTerminator = "lf" | "cr" | "crlf" | "none";

export interface ScanFramer {
  /** Bir veri parçası (ascii string) işle; tamamlanan kodları döndürür. */
  push(chunk: string): string[];
  /** Kalan tamponu (terminator gelmeden) zorla boşalt. */
  flush(): string[];
  reset(): void;
}

export function createScanFramer(terminator: ScanTerminator): ScanFramer {
  let buf = "";

  const splitChar = terminator === "cr" ? "\r" : "\n"; // crlf de "\n" sınırıyla biter, \r trim'lenir

  const clean = (s: string): string => s.replace(/[\r\n]+/g, "").trim();

  return {
    push(chunk) {
      buf += chunk;
      if (terminator === "none") {
        // Sınır yok → satır sonlarıyla böl, kalanı da kod say (idle framing yok).
        const out = buf.split(/[\r\n]+/).map(clean).filter(Boolean);
        buf = "";
        return out;
      }
      const parts = buf.split(splitChar);
      buf = parts.pop() ?? ""; // son parça tamamlanmamış → tamponda kalır
      return parts.map(clean).filter(Boolean);
    },
    flush() {
      const out = clean(buf);
      buf = "";
      return out ? [out] : [];
    },
    reset() {
      buf = "";
    },
  };
}

/**
 * HID raw rapor byte'larından yazdırılabilir ASCII'yi süzer. Raw-HID POS
 * tabancaları genelde ASCII byte gönderir; report-id / sıfır dolgu / kontrol
 * byte'ları (CR/LF hariç) atılır. (HID-usage-kodu gönderen tabancalar keymap
 * ister — saha ayarı; bu temel ASCII yolunu bozmaz.)
 */
export function sanitizeHidChunk(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0) continue;
    if (b === 13 || b === 10 || (b >= 32 && b <= 126)) out += String.fromCharCode(b);
  }
  return out;
}
