// G12 merdivenlerinin ÇALIŞMA SÜRESİ sayaçları (belirsizlik · parmak izi uyuşmazlığı). Değer = kayıtlardaki birikim
// (durum kaydı ile DB izinin büyüğü) + koşul sürerken bu süreçte geçen hrtime. hrtime geri gidemez, duvar saatini
// çevirmek sayacı etkilemez; makine kapalıyken birikmez (alt sınır). Koşulu motor her anlık görüntüde bildirir.
import { bumpLicenseSnapshotVersion } from "./license-signals";

interface Counter {
  /** Hangi kaydın birikimi (yeni kira = yeni dönem: kayıttaki değer esas alınır). */
  epoch: string | null;
  baseMs: number;
  /** Koşul sürüyorsa başladığı hrtime; durunca birikim dondurulur. */
  sinceNs: bigint | null;
}

export type LadderKind = "belirsizlik" | "parmakIzi";

let hrNow: () => bigint = () => process.hrtime.bigint();
const counters: Record<LadderKind, Counter> = {
  belirsizlik: { epoch: null, baseMs: 0, sinceNs: null },
  parmakIzi: { epoch: null, baseMs: 0, sinceNs: null },
};

function valueOf(c: Counter, nowNs: bigint): number {
  const running = c.sinceNs !== null && nowNs > c.sinceNs ? Number((nowNs - c.sinceNs) / 1_000_000n) : 0;
  return c.baseMs + running;
}

export function ladderValue(kind: LadderKind): number {
  return valueOf(counters[kind], hrNow());
}

/**
 * Kayıtlardaki birikimle hizalar: dönem değiştiyse (yeni kira) kayıttaki değer esastır; aynı dönemde sayaç YALNIZ
 * büyür (geç okunan DB izi daha büyük birikim getirebilir — küçük olan yok sayılır, silmek sayacı geriletmez).
 */
export function syncLadder(kind: LadderKind, epoch: string | null, storedMs: number): number {
  const c = counters[kind];
  const nowNs = hrNow();
  const stored = Math.max(0, storedMs);
  if (c.epoch !== epoch) {
    counters[kind] = { epoch, baseMs: stored, sinceNs: c.sinceNs === null ? null : nowNs };
    return stored;
  }
  const current = valueOf(c, nowNs);
  if (stored > current) counters[kind] = { epoch, baseMs: stored, sinceNs: c.sinceNs === null ? null : nowNs };
  return Math.max(stored, current);
}

/** Koşul sürüyor mu (motor her değerlendirmede bildirir); başlarken sayaç akar, durunca donar. */
export function setLadderRunning(kind: LadderKind, running: boolean): void {
  const c = counters[kind];
  const nowNs = hrNow();
  if (running && c.sinceNs === null) counters[kind] = { ...c, sinceNs: nowNs };
  else if (!running && c.sinceNs !== null) counters[kind] = { ...c, baseMs: valueOf(c, nowNs), sinceNs: null };
}

/** Sayaç en az bu değerde (K7: üç iz yoksa birikim 14 günden başlar). */
export function raiseLadder(kind: LadderKind, minMs: number): void {
  const c = counters[kind];
  const nowNs = hrNow();
  if (valueOf(c, nowNs) >= minMs) return;
  counters[kind] = { ...c, baseMs: minMs, sinceNs: c.sinceNs === null ? null : nowNs };
  bumpLicenseSnapshotVersion();
}

/** Merdiven kapandı (parmak izi eşiği yeniden tuttu): birikim sıfır. */
export function resetLadder(kind: LadderKind): void {
  const c = counters[kind];
  if (c.baseMs === 0 && c.sinceNs === null) return;
  counters[kind] = { epoch: c.epoch, baseMs: 0, sinceNs: null };
}

/** Test-only: hrtime kaynağını değiştirir (ileri sarılabilir saat). */
export function __setLadderClockForTests(fn: (() => bigint) | null): void {
  hrNow = fn ?? (() => process.hrtime.bigint());
}

/** Test-only. */
export function __resetLadderCountersForTests(): void {
  counters.belirsizlik = { epoch: null, baseMs: 0, sinceNs: null };
  counters.parmakIzi = { epoch: null, baseMs: 0, sinceNs: null };
}
