// Zil taşıma döngüleri (SSE → uzun yoklama → özet yoklaması). Durum/sürüm mantığı `bellClient.ts`te.
import { BellEngine, BELL_RECONNECT_MS, BELL_SUMMARY_POLL_MS, type BellDeps } from './bellClient';
import { asNumber, parseJsonObject, readSseEvents } from './sseReader';

const WAIT_ERROR_BACKOFF_MS = 5_000;

type RoundResult = 'fallback' | 'done' | { hello: boolean };

export class BellClient extends BellEngine {
  protected startTransport(): void {
    this.stopTransport();
    this.errors = [];
    // 403/404 ile düşüldüyse ya da SSE kapalıysa öne dönüşte de SSE yeniden denenmez.
    if (!this.dep.sseEnabled || this.forcedFallback) return this.enterWait(this.gen);
    this.publish({ mode: 'sse' });
    void this.sseLoop(this.gen);
  }

  private async handleEvent(event: string, data: string): Promise<void> {
    const v = parseJsonObject(data);
    if (event === 'merhaba') {
      this.errors = [];
      this.publish({ connected: true });
      await this.change(this.compareVersion(asNumber(v.epoch), asNumber(v.rev), asNumber(v.alarmRev)));
    } else if (event === 'kapat') {
      await this.change('full'); // izin değişti olabilir → görünür türler yeniden
    } else if (event === 'zil') {
      await this.change(this.compareVersion(null, asNumber(v.rev), asNumber(v.alarmRev)) ?? 'changed');
    }
  }

  private async sseRound(g: number, ac: AbortController): Promise<RoundResult> {
    let hello = false;
    try {
      const res = await this.dep.openStream(ac.signal);
      if (g !== this.gen) return 'done';
      if (res.status === 403 || res.status === 404) {
        this.forcedFallback = true;
        return 'fallback';
      }
      if (res.status === 409) {
        void this.readSummary();
        return 'done';
      }
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      for await (const e of readSseEvents(res.body)) {
        if (g !== this.gen) return 'done';
        if (e.event === 'merhaba') hello = true;
        await this.handleEvent(e.event, e.data);
      }
    } catch {
      if (g !== this.gen || ac.signal.aborted) return 'done';
    } finally {
      if (this.s.connected) this.publish({ connected: false });
    }
    return { hello };
  }

  private async sseLoop(g: number) {
    while (g === this.gen && this.s.mode === 'sse') {
      const ac = new AbortController();
      this.abort = ac;
      const r = await this.sseRound(g, ac);
      if (r === 'done' || g !== this.gen) return;
      if (r === 'fallback') return this.enterWait(g);
      // Sunucunun ömürle kapattığı sağlıklı akış hata değildir; merhabasız kopuş hatadır.
      if (!r.hello && this.recordError()) return this.enterWait(g);
      const idx = r.hello ? 0 : Math.min(this.errors.length, BELL_RECONNECT_MS.length) - 1;
      if (!(await this.sleep(BELL_RECONNECT_MS[idx] ?? 1_000, g))) return;
    }
  }

  private enterWait(g: number) {
    if (g !== this.gen) return;
    this.publish({ mode: 'wait' });
    void this.waitLoop(g);
  }

  private async waitLoop(g: number) {
    while (g === this.gen && this.s.mode === 'wait') {
      const ac = new AbortController();
      this.abort = ac;
      try {
        const d = this.s;
        const r = await this.dep.wait({ rev: d.rev, alarmRev: d.alarmRev, epoch: d.epoch ?? 0 }, ac.signal);
        if (g !== this.gen) return;
        const v = this.compareVersion(r.epoch, r.rev, r.alarmRev);
        await this.change(v ?? (r.degisti ? 'changed' : null));
      } catch (e) {
        if (g !== this.gen || ac.signal.aborted) return;
        const st = this.dep.httpStatus(e);
        if (st === 404 || st === 403) return this.enterSummary(g);
        if (st === 409) return void this.readSummary();
        if (!(await this.sleep(WAIT_ERROR_BACKOFF_MS, g))) return;
      }
    }
  }

  private enterSummary(g: number) {
    if (g !== this.gen) return;
    this.publish({ mode: 'summary' });
    void (async () => {
      while (g === this.gen && this.s.mode === 'summary') {
        if (!(await this.sleep(BELL_SUMMARY_POLL_MS, g))) return;
        await this.readSummary();
      }
    })();
  }
}

export function createBellClient(dep: BellDeps): BellClient {
  return new BellClient(dep);
}
