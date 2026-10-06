// TESİS DB YÖNLENDİRİCİSİ — rol başına bir tane (uygulama · eşitleme · göç). Servisler DB'ye yalnız `lib/tenant.ts`
// üzerinden ve bu yönlendiriciyle ulaşır; düz PrismaClient almazlar. Tesis DB adı satırdan OKUNMAZ, kimlikten
// TÜRETİLİR (dizin bozulsa bile A'nın kimliği B'nin DB'sine çıkmaz); satır yalnız durum ve şema sürümü verir.
// Çözülemeyen tesis merkeze DÜŞMEZ: satır yok/imha → 404 `BULUNAMADI`, hazırlanıyor ya da şeması geride → 503.
import type { PrismaClient } from "@prisma/client";
import type { FacilityDbKey } from "../auth/facility-db-key";
import { closeDatabase, createDatabase, type Database } from "./db";
import { CloudError, notFound } from "./errors";
import { databaseOf, facilityDbName, facilityRoles, withDatabase } from "./tesis-db-ad";

export type RouterRole = "uygulama" | "esitleme" | "goc";

/** Dizin önbelleği (yalnız HAZIR satır): imha CONNECT'i geri aldığından bayat kayıt veri açmaz. */
export const FACILITY_DIRECTORY_CACHE_SECONDS = 30;
export const FACILITY_POOL_MAX = 3;
export const FACILITY_CLIENTS_MAX = 24;
export const CENTRAL_POOL_MAX = 4;
const FACILITY_IDLE_MS = 30_000;

export interface RouterOptions {
  readonly role: RouterRole;
  /** Bu rolün MERKEZ URL'i. Uygulama/eşitleme rolünün tesis kimliği türetilir; göç rolü kendi kimliğiyle bağlanır. */
  readonly centralUrl: string;
  readonly key: FacilityDbKey;
  /** Sunucunun beklediği son göç; tesisin şeması bunun gerisindeyse 503. */
  readonly schemaVersion: string;
  readonly centralPoolMax?: number;
  readonly facilityPoolMax?: number;
  readonly clientsMax?: number;
  readonly cacheSeconds?: number;
  readonly now?: () => number;
}

export const facilityUnavailable = (): CloudError => new CloudError(503, "TEKRAR_DENEYIN", "Tesis veritabanı hazırlanıyor ya da bakımda; biraz sonra tekrar deneyin");

interface Entry {
  readonly db: Database;
  inUse: number;
}

interface DirectoryRow {
  readonly status: string;
  readonly databaseName: string | null;
  readonly schemaVersion: string | null;
}

/** Bağlantı sınıfı hata (Prisma P10xx; DB yok / rol kimliği reddedildi): iş kuralı değil, hedef DB'nin kendisi. */
function isConnectionClass(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^P10\d\d$/.test(code)) return true;
  const message = err instanceof Error ? err.message : "";
  return /3D000|28P01|database "[^"]+" does not exist|password authentication failed/.test(message);
}

export class TesisDbRouter {
  readonly role: RouterRole;
  readonly central: Database;
  readonly centralName: string;
  readonly key: FacilityDbKey;
  private readonly cache = new Map<string, number>();
  private readonly clients = new Map<string, Entry>();
  private closed = false;

  constructor(private readonly o: RouterOptions) {
    this.role = o.role;
    this.key = o.key;
    this.centralName = databaseOf(o.centralUrl);
    this.central = createDatabase(o.centralUrl, `${o.role}:merkez`, o.centralPoolMax ?? CENTRAL_POOL_MAX);
  }

  private nowMs(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  /** Merkez istemcisi — yalnız `lib/tenant.ts` (`withCentral`) ve bu dosya kullanır. */
  get centralClient(): PrismaClient {
    return this.central.prisma;
  }

  /** Göç rolünün tesis DB URL'i (imha ve bakım CLI'si; dizin durumuna BAKMAZ). Yalnız göç rolü yönlendiricisinde. */
  adminUrlFor(tesisId: string): string {
    if (this.role !== "goc") throw new Error("Tesis DB yönetim URL'i yalnız göç rolünde");
    return withDatabase(this.o.centralUrl, this.databaseFor(tesisId));
  }

  /** Tesis DB'sinin adı (kimlikten türetilir). */
  databaseFor(tesisId: string): string {
    return facilityDbName(this.centralName, tesisId);
  }

  private async directoryRow(tesisId: string): Promise<DirectoryRow | null> {
    const r = await this.central.prisma.facilityDatabase.findUnique({ where: { tesisId }, select: { status: true, databaseName: true, schemaVersion: true } });
    return r ? { status: r.status, databaseName: r.databaseName, schemaVersion: r.schemaVersion } : null;
  }

  /** Yönlendirilebilir mi: HAZIR + adı türetilenle aynı + şema sürümü beklenenin gerisinde değil. */
  private async assertRoutable(tesisId: string): Promise<string> {
    const database = this.databaseFor(tesisId);
    const cachedAt = this.cache.get(tesisId);
    const ttl = (this.o.cacheSeconds ?? FACILITY_DIRECTORY_CACHE_SECONDS) * 1000;
    if (cachedAt !== undefined && this.nowMs() - cachedAt < ttl) return database;
    const row = await this.directoryRow(tesisId);
    if (!row || row.status === "IMHA_SURUYOR" || row.status === "IMHA_EDILDI") {
      this.invalidate(tesisId);
      throw notFound("Tesis");
    }
    if (row.status !== "HAZIR" || !row.schemaVersion || row.schemaVersion < this.o.schemaVersion) {
      this.invalidate(tesisId);
      throw facilityUnavailable();
    }
    if (row.databaseName !== database) throw new Error(`Tesis dizini tutarsız: ${tesisId} beklenen DB adını göstermiyor`);
    this.cache.set(tesisId, this.nowMs());
    return database;
  }

  private credentials(database: string): { user: string; password: string } | undefined {
    if (this.role === "goc") return undefined;
    const roles = facilityRoles(database);
    const user = this.role === "uygulama" ? roles.app : roles.sync;
    return { user, password: this.key.rolePassword(user) };
  }

  private entryFor(database: string): Entry {
    const hit = this.clients.get(database);
    if (hit) {
      this.clients.delete(database);
      this.clients.set(database, hit);
      return hit;
    }
    const url = withDatabase(this.o.centralUrl, database, this.credentials(database));
    const entry: Entry = { db: createDatabase(url, `${this.role}:${database}`, this.o.facilityPoolMax ?? FACILITY_POOL_MAX, FACILITY_IDLE_MS), inUse: 0 };
    this.clients.set(database, entry);
    this.evict();
    return entry;
  }

  /** LRU: kullanımda olmayan en eski istemci kapanır (kullanımdaki istemciye dokunulmaz). */
  private evict(): void {
    const max = this.o.clientsMax ?? FACILITY_CLIENTS_MAX;
    for (const [name, e] of this.clients) {
      if (this.clients.size <= max) break;
      if (e.inUse > 0) continue;
      this.clients.delete(name);
      void closeDatabase(e.db);
    }
  }

  /** Tesis DB istemcisiyle iş (yalnız `lib/tenant.ts`). */
  async withFacilityClient<T>(tesisId: string, fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("Yönlendirici kapalı");
    const database = await this.assertRoutable(tesisId);
    const entry = this.entryFor(database);
    entry.inUse++;
    try {
      return await fn(entry.db.prisma);
    } catch (err) {
      // Dizin önbelleği bayatken (≤ önbellek süresi) imha edilen DB'ye bağlanılamaz: dizin taze okunur, 500 değil 404.
      if (!isConnectionClass(err)) throw err;
      this.invalidate(tesisId);
      const row = await this.directoryRow(tesisId);
      if (row && row.status !== "IMHA_SURUYOR" && row.status !== "IMHA_EDILDI") throw err;
    } finally {
      entry.inUse--;
    }
    await this.forget(tesisId);
    throw notFound("Tesis");
  }

  invalidate(tesisId: string): void {
    this.cache.delete(tesisId);
  }

  /** İmha/temizlik sonrası: dizin önbelleği ve (kullanımda değilse) tesis istemcisi bırakılır. */
  async forget(tesisId: string): Promise<void> {
    this.invalidate(tesisId);
    const database = this.databaseFor(tesisId);
    const e = this.clients.get(database);
    if (!e || e.inUse > 0) return;
    this.clients.delete(database);
    await closeDatabase(e.db);
  }

  /** Kurulum → tesis (merkez `installation_routes`); bilinmiyorsa null. */
  async tesisOfInstallation(installationId: string): Promise<string | null> {
    const r = await this.central.prisma.installationRoute.findUnique({ where: { installationId }, select: { tesisId: true } });
    return r?.tesisId ?? null;
  }

  /** Giriş dizini: normalleşmiş e-posta → (tesis, hesap); yoksa null. */
  async routeOfEmail(normalizedEmail: string): Promise<{ tesisId: string; accountId: string } | null> {
    const r = await this.central.prisma.loginRoute.findUnique({ where: { emailDigest: this.key.emailDigest(normalizedEmail) }, select: { tesisId: true, accountId: true } });
    return r ?? null;
  }

  /** Satıcı kipi: bilinmeyen tesisin hazırlık isteği (eşitleme rolü yalnız `tesis_id` yazar; idempotent). */
  async requestFacility(tesisId: string): Promise<void> {
    await this.central.prisma.$executeRaw`INSERT INTO facility_databases (tesis_id) VALUES (${tesisId}::uuid) ON CONFLICT (tesis_id) DO NOTHING`;
  }

  /** Bakım/bildirim döngüsünün tesis listesi: HAZIR tesis DB'leri. */
  async readyFacilities(): Promise<string[]> {
    const r = await this.central.prisma.facilityDatabase.findMany({ where: { status: "HAZIR" }, select: { tesisId: true }, orderBy: { tesisId: "asc" } });
    return r.map((x) => x.tesisId);
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.clients.values()];
    this.clients.clear();
    for (const e of all) await closeDatabase(e.db);
    await closeDatabase(this.central);
  }

  /** Tanı: açık tesis istemcisi sayısı (bekçi LRU'yu ölçer). */
  get openClients(): number {
    return this.clients.size;
  }
}
