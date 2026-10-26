// =============================================================================
// ZİL İSTEMCİSİ (tablet) — panel `Electron/src/lib/bildirim/zil-istemcisi.ts` ikizi (plan §3.9, §3.10, §6.8)
// =============================================================================
// Merdiven: SSE (`/zil`, `expo/fetch`) → 3 hata/2 dk ya da 403/404 → uzun yoklama (`/bekle`) → `/bekle`
// 404 (eski backend) → 30 sn `/ozet`. Bağlantı YALNIZ uygulama ön plandayken açıktır (`setActive`);
// arka planda kapanır (hatırlatma `alarmNotify.ts`te, aynen). Öne dönüşte özet okunur: `rev` farkı
// kaçanları "changed" ile tamamlatır, `epoch` farkı "full" (her şey baştan). Akış içeriksizdir.
// =============================================================================
import type { NotificationSummary, NotificationWaitResult } from './types';


export type BellMode = 'off' | 'sse' | 'wait' | 'summary';
export type BellEvent = 'changed' | 'full' | 'alarm';

export interface BellState {
  ready: boolean;
  /** false = eski backend (`/ozet` 404) → zil hiç çizilmez. */
  supported: boolean;
  enabled: boolean;
  unread: number;
  openAlarms: number;
  epoch: number | null;
  rev: number;
  alarmRev: number;
  mode: BellMode;
  /** SSE açık ve `merhaba` gelmiş: alarm yoklaması seyrekleşir (60 sn). */
  connected: boolean;
}

/** Zil gerçek zamanlı mı (SSE bağlı ya da uzun yoklama döngüsü): alarm yoklaması yedeğe iner. */
export function bellHealthy(s: Pick<BellState, 'enabled' | 'mode' | 'connected'>): boolean {
  return s.enabled && ((s.mode === 'sse' && s.connected) || s.mode === 'wait');
}

export interface StreamResponse {
  status: number;
  ok: boolean;
  body: ReadableStream<Uint8Array> | null;
}

export interface BellDeps {
  summary(): Promise<NotificationSummary>;
  wait(p: { rev: number; alarmRev: number; epoch: number }, signal: AbortSignal): Promise<NotificationWaitResult>;
  openStream(signal: AbortSignal): Promise<StreamResponse>;
  httpStatus(e: unknown): number | null;
  /** false → SSE hiç denenmez, uzun yoklamayla başlanır (LAN TLS ölçümü olumsuzsa). */
  sseEnabled: boolean;
  now?(): number;
}

export const BELL_ERROR_THRESHOLD = 3;
export const BELL_ERROR_WINDOW_MS = 2 * 60_000;
export const BELL_SUMMARY_POLL_MS = 30_000;
export const BELL_RECONNECT_MS = [1_000, 3_000, 10_000] as const;

const EMPTY: BellState = {
  ready: false, supported: true, enabled: false, unread: 0, openAlarms: 0, epoch: null, rev: 0, alarmRev: 0, mode: 'off', connected: false,
};

export class BellEngine {
  protected s: BellState = { ...EMPTY };
  protected gen = 0;
  protected abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  protected errors: number[] = [];
  private alarmChanged = false;
  protected forcedFallback = false;
  private active = false;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: BellEvent) => void>();
  protected readonly now: () => number;

  constructor(protected readonly dep: BellDeps) {
    this.now = dep.now ?? (() => Date.now());
  }

  state = (): BellState => this.s;

  subscribe = (fn: () => void): (() => void) => {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  };

  onEvent = (fn: (e: BellEvent) => void): (() => void) => {
    this.eventListeners.add(fn);
    return () => void this.eventListeners.delete(fn);
  };

  /** AppState köprüsü: ön plan → kur (kaçanları tamamla); arka plan → bağlantıyı kapat. */
  setActive = (active: boolean): Promise<void> => {
    if (active === this.active) return Promise.resolve();
    this.active = active;
    if (!active) {
      this.stopTransport();
      this.publish({ mode: 'off', connected: false });
      return Promise.resolve();
    }
    return this.setup();
  };

  refresh = (): Promise<void> => this.setup();

  protected publish(next: Partial<BellState>) {
    this.s = { ...this.s, ...next };
    this.stateListeners.forEach((f) => f());
  }

  protected emit(e: BellEvent) {
    this.eventListeners.forEach((f) => f(e));
    if (!this.alarmChanged) return;
    this.alarmChanged = false;
    this.eventListeners.forEach((f) => f('alarm'));
  }

  protected sleep(ms: number, g: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.timer = setTimeout(() => {
        this.timer = null;
        resolve(g === this.gen);
      }, ms);
    });
  }

  protected stopTransport() {
    this.gen++;
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** epoch değiştiyse "full", rev/alarmRev değiştiyse "changed". */
  protected compareVersion(epoch: number | null, rev: number | null, alarmRev: number | null): BellEvent | null {
    const d = this.s;
    let result: BellEvent | null = null;
    if (epoch !== null && d.epoch !== null && epoch !== d.epoch) result = 'full';
    else if ((rev !== null && rev !== d.rev) || (alarmRev !== null && alarmRev !== d.alarmRev)) result = 'changed';
    if (alarmRev !== null && alarmRev !== d.alarmRev && d.epoch !== null) this.alarmChanged = true;
    this.publish({ ...(epoch !== null ? { epoch } : {}), ...(rev !== null ? { rev } : {}), ...(alarmRev !== null ? { alarmRev } : {}) });
    return result;
  }

  protected async readSummary(): Promise<void> {
    let o: NotificationSummary;
    try {
      o = await this.dep.summary();
    } catch (e) {
      if (this.dep.httpStatus(e) === 404) {
        this.stopTransport();
        this.publish({ ready: true, supported: false, enabled: false, mode: 'off' });
      }
      return; // ağ hatası: son bilinen durum kalır
    }
    if (!o.enabled) {
      this.stopTransport();
      this.publish({ ready: true, supported: true, enabled: false, mode: 'off' });
      return;
    }
    const first = this.s.epoch === null;
    const v = this.compareVersion(o.epoch, o.rev, o.alarmRev);
    this.publish({ ready: true, supported: true, enabled: true, unread: o.okunmamis, openAlarms: o.alarmAcik });
    if (v && !first) this.emit(v);
  }

  protected async change(v: BellEvent | null) {
    if (!v) return;
    await this.readSummary();
    this.emit(v);
  }

  protected recordError(): boolean {
    const t = this.now();
    this.errors = [...this.errors.filter((x) => t - x < BELL_ERROR_WINDOW_MS), t];
    return this.errors.length >= BELL_ERROR_THRESHOLD;
  }

  protected async setup(): Promise<void> {
    await this.readSummary();
    const d = this.s;
    if (!this.active || !d.supported || !d.enabled || d.mode !== 'off') return;
    this.startTransport();
  }

  /** Alt sınıf (taşıma döngüleri) doldurur. */
  protected startTransport(): void {}
}
