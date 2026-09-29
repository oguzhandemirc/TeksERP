// KAPI ZİLİ — kurulum başına SSE akışları (bellek içi harita) + PG LISTEN/NOTIFY köprüsü.
// Zil içerik TAŞIMAZ, yalnız "şimdi yokla" der (güvenlik imzalı yoklamada). Portal eylemi
// kendi tx'i içinde `pg_notify` çağırır: zil yalnız eylem COMMIT olunca çalar ve eylemi
// yapan süreç (portal, CLI, zamanlayıcı) sunucu sürecinden bağımsız olabilir.
import type { Response } from "express";
import { Client } from "pg";
import { DOORBELL_EVENT_NAME, DOORBELL_TOPICS } from "../lisans-protokol";
import type { Db } from "../lib/prisma";
import { PG_SESSION_OPTIONS } from "../lib/pg-session";

export type DoorbellTopic = (typeof DOORBELL_TOPICS)[number];
export const DOORBELL_CHANNEL = "satici_zil";

/** Zil çal: tx içindeyse COMMIT'te teslim edilir (rollback'te hiç çalmaz). */
export async function notifyDoorbell(db: Db, installationDbId: string, topic: DoorbellTopic): Promise<void> {
  const payload = JSON.stringify({ k: installationDbId, konu: topic });
  await db.$executeRaw`SELECT pg_notify(${DOORBELL_CHANNEL}, ${payload})`;
}

export class DoorbellHub {
  private readonly streams = new Map<string, Set<Response>>();
  private client: Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private stopped = false;
  private deliveredCount = 0;

  constructor(
    private readonly databaseUrl: string,
    private readonly heartbeatSeconds: number,
    /** Kurulum başına eşzamanlı abonelik tavanı (D9): aşan yeni abonelik EN ESKİSİNİ kapatır — yarı açık kalmış
     *  eski bağlantı meşru yeniden bağlanmayı kilitlemesin, kopya yine de sınırsız akış açamasın. */
    private readonly maxPerInstallation: number = 3,
  ) {}

  async start(): Promise<void> {
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatSeconds * 1000);
    this.heartbeat.unref();
    await this.listen();
  }

  private async listen(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.databaseUrl, options: PG_SESSION_OPTIONS });
    client.on("notification", (msg) => this.onNotification(msg.payload));
    client.on("error", (err) => this.scheduleReconnect(client, err));
    client.on("end", () => this.scheduleReconnect(client, null));
    try {
      await client.connect();
      await client.query(`LISTEN ${DOORBELL_CHANNEL}`);
      this.client = client;
    } catch (err) {
      this.scheduleReconnect(client, err as Error);
    }
  }

  private scheduleReconnect(client: Client, err: Error | null): void {
    if (this.stopped || this.reconnect) return;
    if (this.client === client) this.client = null;
    if (err) console.error(`[satici] zil dinleyicisi koptu: ${err.message} — yeniden bağlanacak`);
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      void this.listen();
    }, 2_000);
    this.reconnect.unref();
  }

  private onNotification(payload: string | undefined): void {
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload) as { k?: unknown; konu?: unknown };
      if (typeof parsed.k === "string" && DOORBELL_TOPICS.includes(parsed.konu as DoorbellTopic)) {
        this.ring(parsed.k, parsed.konu as DoorbellTopic);
      }
    } catch {
      // Tanınmayan yük yok sayılır: zil yalnız fazladan yoklama yaptırır, içerik taşımaz.
    }
  }

  subscribe(installationDbId: string, res: Response): void {
    let set = this.streams.get(installationDbId);
    if (!set) {
      set = new Set();
      this.streams.set(installationDbId, set);
    }
    while (set.size >= this.maxPerInstallation) {
      const oldest = set.values().next().value as Response;
      set.delete(oldest);
      oldest.end();
    }
    set.add(res);
    res.on("close", () => this.unsubscribe(installationDbId, res));
  }

  /** Bu kurulumun bu süreçteki açık abonelik sayısı. */
  subscriberCountOf(installationDbId: string): number {
    return this.streams.get(installationDbId)?.size ?? 0;
  }

  private unsubscribe(installationDbId: string, res: Response): void {
    const set = this.streams.get(installationDbId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.streams.delete(installationDbId);
  }

  /** Bu süreçteki abonelere teslim (PG bildirimi ya da doğrudan çağrı). */
  ring(installationDbId: string, topic: DoorbellTopic): number {
    const set = this.streams.get(installationDbId);
    if (!set) return 0;
    const frame = `event: ${DOORBELL_EVENT_NAME}\ndata: ${JSON.stringify({ konu: topic })}\n\n`;
    for (const res of set) res.write(frame);
    this.deliveredCount += set.size;
    return set.size;
  }

  private beat(): void {
    for (const set of this.streams.values()) for (const res of set) res.write(": kalp\n\n");
  }

  subscriberCount(): number {
    let n = 0;
    for (const set of this.streams.values()) n += set.size;
    return n;
  }

  delivered(): number {
    return this.deliveredCount;
  }

  listening(): boolean {
    return this.client !== null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    for (const set of this.streams.values()) for (const res of set) res.end();
    this.streams.clear();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }
  }
}
