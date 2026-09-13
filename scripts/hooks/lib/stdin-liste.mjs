// =============================================================================
// STDIN LİSTESİ — commit kapısının staged listesini ZAMAN AŞIMLI okur (zero-dep)
// =============================================================================
// ⭐ NEDEN VAR (2026-09-13, d5 ölçtü): üç kapı betiği (`lint-gate` · `check-lint-
//    baseline --commit-kapisi` · `check-migrations --commit-kapisi`) listeyi
//    `readFileSync(0)` ile okuyordu. Hook besliyor, TTY'de "elle koşum" dalı var —
//    ama stdin AÇIK BİR BORU ve EOF gelmiyorsa SONSUZA KADAR asılı: bir ölçüm
//    harness'ı iki kez 480 sn'de öldü, bir lint-gate 20 dk askıda bulundu.
//    "Asılı" ≠ "kırmızı": kapı ne geçti ne düştü der, kimse görmez.
//
// KURAL (1e hükmü): isatty DEĞİLSE ve 5 sn'de EOF yoksa "staged liste gelmedi"
//    ile KIRMIZI (ARIZA, ihlal değil). Mekanizma: `cat` çocuk süreci stdin'i devralır,
//    `execFileSync … timeout` onu 5 sn'de öldürür — senkron kalır, tavan gerçek.
// =============================================================================
import { execFileSync } from "node:child_process";

export const STDIN_ZAMAN_ASIMI_MS = 5_000;

/**
 * @returns {{ kip: "tty" | "kapali" | "boru" | "zaman-asimi", liste: string[] | null }}
 *   tty/kapali → çağıran kendi listesini türetir (elle koşum) · boru → liste (boş olabilir)
 *   zaman-asimi → çağıran ARIZA ile düşer.
 */
export function stdinListesi(zamanAsimiMs = STDIN_ZAMAN_ASIMI_MS) {
  if (process.stdin.isTTY) return { kip: "tty", liste: null };
  try {
    const ham = execFileSync("cat", [], { stdio: [0, "pipe", "ignore"], encoding: "utf8", timeout: zamanAsimiMs });
    return { kip: "boru", liste: ham.split("\n").map((s) => s.trim()).filter(Boolean) };
  } catch (e) {
    if (e && (e.code === "ETIMEDOUT" || e.signal === "SIGTERM")) return { kip: "zaman-asimi", liste: null };
    return { kip: "kapali", liste: null }; // fd 0 yok/kapalı — elle koşum
  }
}

export const STDIN_ARIZA_MESAJI = `staged liste gelmedi — stdin TTY değil ve ${STDIN_ZAMAN_ASIMI_MS / 1000} sn'de EOF yok (ARIZA, ihlal değil: çağıran listeyi borudan vermeli ya da stdin'i kapatmalı)`;
