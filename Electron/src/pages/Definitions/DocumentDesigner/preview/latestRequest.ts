// Canlı önizlemenin zamanlayıcısı: 400 ms susma sonrası TEK istek; yeni istek eskisini
// iptal eder (AbortController) ve yalnız EN SON isteğin cevabı çizilir (sıra sayacı) —
// yavaş eski cevap hızlı yeni cevabın üstüne yazılamaz.

export const PREVIEW_DEBOUNCE_MS = 400;

export type RequestOutcome<R> = { kind: "ok"; value: R } | { kind: "error"; error: unknown };

export class LatestRequestRunner<I, R> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private seq = 0;

  constructor(
    private readonly fetcher: (input: I, signal: AbortSignal) => Promise<R>,
    private readonly onOutcome: (o: RequestOutcome<R>) => void,
    private readonly onStart: () => void = () => undefined,
    private readonly delayMs = PREVIEW_DEBOUNCE_MS,
  ) {}

  schedule(input: I): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(input);
    }, this.delayMs);
  }

  private async run(input: I): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const mine = ++this.seq;
    this.onStart();
    try {
      const value = await this.fetcher(input, controller.signal);
      if (mine === this.seq) this.onOutcome({ kind: "ok", value });
    } catch (error) {
      if (mine === this.seq && !controller.signal.aborted) this.onOutcome({ kind: "error", error });
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.controller?.abort();
    this.seq++;
  }
}
