// =============================================================================
// PAROLA ÖZETİ HAVUZU — semafor + worker_threads (VDS denetimi K1, 2026-11-01)
// =============================================================================
// bcryptjs saf JS'tir; ana iş parçacığında maliyet 12 ≈ 0,46 sn CPU (VDS ölçümü). Kimliksiz yanlış
// parola istekleri tek çekirdeği doyurup bütün fabrikayı yavaşlatıyordu. Burada:
//   • aynı anda en çok N iş (PASSWORD_HASH_CONCURRENCY, varsayılan 2) — worker havuzu boyu da N;
//   • doğrulama kuyruğu sınırlı (PASSWORD_VERIFY_QUEUE, varsayılan 8); dolunca `PasswordHashBusyError`
//     (çağıran 503 AUTH_BUSY'ye çevirir). Özet ÜRETİMİ (kimlikli uçlar) kuyruk tavanına takılmaz.
// Worker DURUMSUZ hesaplamadır (server.ts TEK-PROCESS notu bellek-içi durum içindir); kodu `eval`
// ile kurulur ki esbuild/bytenode derleme yolunda ayrı giriş dosyası gerekmesin. bcryptjs paketin
// prod node_modules'ünden çözülür; worker kurulamazsa aynı semaforla ana iş parçacığına düşer.
// =============================================================================
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { uyari } from "../../lib/logger";

export type HashOp = { op: "compare"; plain: string; hash: string } | { op: "hash"; plain: string; cost: number };
type Inline = (job: HashOp) => Promise<string | boolean>;

/** Kuyruk dolu — çağıran 503 + Retry-After döner. */
export class PasswordHashBusyError extends Error {
  constructor() {
    super("password hash queue full");
    this.name = "PasswordHashBusyError";
  }
}

function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export type PoolConfig = { concurrency: number; verifyQueue: number; mode: "worker" | "inline" };

export function readPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    concurrency: readPositiveInt(env.PASSWORD_HASH_CONCURRENCY, 2, 16),
    verifyQueue: readPositiveInt(env.PASSWORD_VERIFY_QUEUE, 8, 256),
    mode: (env.PASSWORD_HASH_MODE ?? "").trim().toLowerCase() === "inline" ? "inline" : "worker",
  };
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const m = require(workerData.bcryptPath);
const b = m && m.default ? m.default : m;
parentPort.on("message", (j) => {
  try {
    const r = j.op === "compare" ? b.compareSync(j.plain, j.hash) : b.hashSync(j.plain, j.cost);
    parentPort.postMessage({ id: j.id, ok: true, r });
  } catch (e) {
    parentPort.postMessage({ id: j.id, ok: false, e: String(e && e.message || e) });
  }
});
parentPort.postMessage({ ready: true });
`;

type Pending = { resolve: (v: string | boolean) => void; reject: (e: Error) => void };
type Slot = { worker: Worker; pending: Map<number, Pending> };

/** Ana modülün yanındaki node_modules'ten bcryptjs'in mutlak yolu (tsx, esbuild .cjs ve bytenode .jsc'de aynı). */
function resolveBcryptPath(): string | null {
  try {
    return createRequire(__filename).resolve("bcryptjs");
  } catch {
    return null;
  }
}

export class PasswordHashPool {
  private active = 0;
  private readonly waiting: Array<{ job: HashOp; capped: boolean; run: () => void }> = [];
  private slots: Slot[] = [];
  private nextSlot = 0;
  private nextId = 1;
  private workerFailed = false;
  /** Bekçi ölçümü: aynı anda koşan en yüksek iş sayısı ve başlatılan iş sayısı. */
  peakActive = 0;
  started = 0;

  constructor(private readonly config: PoolConfig, private readonly inline: Inline) {}

  get mode(): "worker" | "inline" {
    return this.config.mode === "worker" && !this.workerFailed ? "worker" : "inline";
  }

  run(job: HashOp): Promise<string | boolean> {
    const capped = job.op === "compare";
    return new Promise((resolve, reject) => {
      const start = (): void => {
        this.active += 1;
        this.started += 1;
        this.peakActive = Math.max(this.peakActive, this.active);
        this.execute(job).then(resolve, reject).finally(() => {
          this.active -= 1;
          this.waiting.shift()?.run();
        });
      };
      if (this.active < this.config.concurrency) return start();
      const queuedVerifies = this.waiting.filter((w) => w.capped).length;
      if (capped && queuedVerifies >= this.config.verifyQueue) return reject(new PasswordHashBusyError());
      this.waiting.push({ job, capped, run: start });
    });
  }

  private execute(job: HashOp): Promise<string | boolean> {
    const slot = this.mode === "worker" ? this.pickSlot() : null;
    if (!slot) return this.inline(job);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      slot.worker.ref(); // iş sürerken süreç ayakta kalsın (betik/bekçi); boşta unref
      slot.worker.postMessage({ ...job, id });
    });
  }

  private pickSlot(): Slot | null {
    if (this.slots.length === 0) this.spawnAll();
    if (this.workerFailed || this.slots.length === 0) return null;
    const slot = this.slots[this.nextSlot % this.slots.length]!;
    this.nextSlot += 1;
    return slot;
  }

  private spawnAll(): void {
    const bcryptPath = resolveBcryptPath();
    if (!bcryptPath) return this.fallBack("bcryptjs çözülemedi");
    try {
      for (let i = 0; i < this.config.concurrency; i++) this.slots.push(this.spawn(bcryptPath));
    } catch (err) {
      this.fallBack(err instanceof Error ? err.message : String(err));
    }
  }

  private spawn(bcryptPath: string): Slot {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath } });
    const slot: Slot = { worker, pending: new Map() };
    worker.on("message", (msg: { id?: number; ok?: boolean; r?: string | boolean; e?: string }) => {
      if (msg.id === undefined) return;
      const p = slot.pending.get(msg.id);
      slot.pending.delete(msg.id);
      if (slot.pending.size === 0) worker.unref();
      if (!p) return;
      if (msg.ok) p.resolve(msg.r as string | boolean);
      else p.reject(new Error(msg.e ?? "password hash worker error"));
    });
    worker.on("error", (err: unknown) => this.dropSlot(slot, err instanceof Error ? err : new Error(String(err))));
    worker.on("exit", () => this.dropSlot(slot, new Error("password hash worker exited")));
    worker.unref(); // dinleyiciler port'u yeniden ref'ler — unref EN SONDA
    return slot;
  }

  /** Ölen worker'ın bekleyen işleri hata alır; havuz bir sonraki işte yeniden kurulur. */
  private dropSlot(slot: Slot, err: Error): void {
    if (!this.slots.includes(slot)) return;
    this.slots = this.slots.filter((s) => s !== slot);
    for (const p of slot.pending.values()) p.reject(err);
    slot.pending.clear();
    if (this.slots.length === 0 && !this.workerFailed) uyari("parola-havuzu", `worker düştü, yeniden kurulacak: ${err.message}`);
  }

  private fallBack(reason: string): void {
    this.workerFailed = true;
    uyari("parola-havuzu", `worker kurulamadı, parola özeti ana iş parçacığında (semafor geçerli): ${reason}`);
  }

  /** Yalnız bekçi: worker'ları kapat (süreç çıkışını tutmaz; unref'li). */
  async close(): Promise<void> {
    const slots = this.slots;
    this.slots = [];
    await Promise.all(slots.map((s) => s.worker.terminate()));
  }
}
