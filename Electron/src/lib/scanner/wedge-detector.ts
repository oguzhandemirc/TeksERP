// =============================================================================
// Klavye-wedge tespit çekirdeği (saf, React'siz, timer'sız)
// =============================================================================
// Barkod tabancaları (USB + Bluetooth, HID keyboard modunda) okutulan kodu çok
// hızlı tuş vuruşları olarak yazıp sonuna bir terminator (Enter) basar. Bu
// modül tek `KeyboardEvent` besleyerek bir "burst"ü insan yazımından ayırır:
//   - tuşlar arası süre `maxInterKeyMs`'den küçük (makine-hızlı)
//   - en az `minLength` karakter
//   - terminator (Enter/Tab) ile biter VEYA `graceTailMs` kadar sessizlik
// Timer YOK — `feed` her olayda, `flushIdle` ise hook'un kurduğu zamanlayıcıdan
// çağrılır (Enter göndermeyen tabancalar için). Böylelikle jsdom'da fake-timer
// derdi olmadan birim test edilebilir.
// =============================================================================

export interface WedgeConfig {
  /** İki tuş arası bu süreden (ms) küçükse "makine-hızlı" sayılır. */
  maxInterKeyMs: number;
  /** Daha kısa burst'ler insan girişi kabul edilir, scan sayılmaz. */
  minLength: number;
  /** Hangi tuş burst'ü bitirir. */
  terminator: "Enter" | "Tab" | "both";
  /** Terminator gelmezse, son tuştan bu kadar sessizlik sonrası flush. */
  graceTailMs: number;
}

export const DEFAULT_WEDGE_CONFIG: WedgeConfig = {
  maxInterKeyMs: 35,
  minLength: 4,
  terminator: "Enter",
  graceTailMs: 80,
};

export interface WedgeResult {
  code: string;
  durationMs: number;
  charCount: number;
}

/** `KeyboardEvent`'in detector'ın okuduğu alt kümesi — testlerde sahtelemek için. */
export type WedgeKeyEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing"
>;

export interface WedgeDetector {
  /** Bir tuş olayı işle. Nitelikli burst terminator'la bittiyse sonucu döndürür. */
  feed(e: WedgeKeyEvent, nowMs: number): WedgeResult | null;
  /** Zamanlayıcıdan çağrılır: son tuştan beri yeterince sessizlik olduysa flush. */
  flushIdle(nowMs: number): WedgeResult | null;
  /** Şu an bir burst birikiyor mu? (kısayolları bastırmak için.) */
  isCapturing(): boolean;
  reset(): void;
}

export function createWedgeDetector(cfg: WedgeConfig = DEFAULT_WEDGE_CONFIG): WedgeDetector {
  let buffer = "";
  let startTs = 0;
  let lastTs = 0;
  let fastCount = 0; // makine-hızlı geçiş (gap <= maxInterKeyMs) sayısı

  const reset = (): void => {
    buffer = "";
    startTs = 0;
    lastTs = 0;
    fastCount = 0;
  };

  const isTerminator = (key: string): boolean => {
    if (cfg.terminator === "both") return key === "Enter" || key === "Tab";
    return key === cfg.terminator;
  };

  /** Mevcut buffer'ı değerlendir, sıfırla ve nitelikliyse sonucu döndür. */
  const flush = (now: number): WedgeResult | null => {
    const code = buffer;
    const count = code.length;
    const fast = fastCount;
    const dur = startTs ? now - startTs : 0;
    reset();
    // Nitelik: yeterli uzunluk + neredeyse her boşluk makine-hızlı (n-1 geçişin
    // tamamı). Tek bir yavaş gap bile insan girişine işaret eder → eler.
    if (count >= cfg.minLength && fast >= count - 1) {
      return { code, durationMs: dur, charCount: count };
    }
    return null;
  };

  return {
    feed(e, now) {
      // Modifier => insan kısayolu (Cmd+K, Ctrl+T...). Tabancalar göndermez.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        reset();
        return null;
      }
      // IME besteleme (Türkçe ölü tuş vb.) — buffer'a karışmasın, bozmasın.
      if (e.isComposing) return null;

      const key = e.key;
      if (isTerminator(key)) {
        return flush(now);
      }
      // Yalnız tek-karakter basılabilir tuşlar buffer'a girer. Shift/Dead/Arrow
      // gibi çok-karakterli key'ler zamanlamayı bozmadan yok sayılır.
      if (key.length !== 1) return null;

      if (startTs === 0) {
        // Yeni burst başlangıcı.
        startTs = now;
        lastTs = now;
        buffer = key;
        fastCount = 0;
        return null;
      }

      const dt = now - lastTs;
      if (dt <= cfg.maxInterKeyMs) {
        fastCount += 1;
        buffer += key;
      } else {
        // Yavaş tuş — önceki burst'ü iptal et, bu tuştan yeni burst başlat.
        startTs = now;
        buffer = key;
        fastCount = 0;
      }
      lastTs = now;
      return null;
    },

    flushIdle(now) {
      if (buffer.length === 0) return null;
      if (now - lastTs < cfg.graceTailMs) return null;
      return flush(now);
    },

    isCapturing() {
      return buffer.length > 0;
    },

    reset,
  };
}
