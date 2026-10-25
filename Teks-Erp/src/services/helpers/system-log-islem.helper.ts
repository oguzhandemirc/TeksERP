// =============================================================================
// İŞLEM GÖRÜNÜMÜ YARDIMCILARI — gruplama koşulları, imleç, birleştirme (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// `system_logs` OKUMASI BURADA YOK (o `SystemLogService.listIslemler/findIslem/listByRecordQuery`
// içinde, `audit-okuma-beyan.ts`te beyanlı). Burada yalnız SQL koşul parçası, fabrika günü
// aralığı, grup imleci ve satır→işlem birleştirmesi (saf) durur.
// =============================================================================

import { Prisma, SystemLogCategory } from "@prisma/client";
import { factoryDayStart } from "../../constants/time";
import type { RequestTraceDto } from "../request-trace.service";
import { type Anlati, type NarrativeRow } from "../audit-narrative";
import { islemBasligi } from "../audit-narrative/islem";

export type Gun = "bugun" | "dun" | "hafta";

/** Fabrika günü aralığı (`constants/time.ts`): bugün · dün · son 7 gün. */
export function gunAraligi(gun: Gun, now: Date = new Date()): { from: Date; to: Date } {
  const bugun = factoryDayStart(now);
  if (gun === "bugun") return { from: bugun, to: now };
  if (gun === "dun") return { from: factoryDayStart(new Date(bugun.getTime() - 1)), to: new Date(bugun.getTime() - 1) };
  return { from: factoryDayStart(new Date(now.getTime() - 6 * 86_400_000)), to: now };
}

export interface IslemFiltresi {
  userId?: string;
  tableName?: string;
  action?: string;
  categories?: SystemLogCategory[];
  from?: Date;
  to?: Date;
}

/** `sl` takma adlı `system_logs` için WHERE parçaları (tablo adı içermez). */
export function islemKosullari(f: IslemFiltresi): Prisma.Sql {
  const k: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.userId) k.push(Prisma.sql`sl."userId" = ${f.userId}::uuid`);
  if (f.tableName) k.push(Prisma.sql`sl."tableName" = ${f.tableName}`);
  if (f.action) k.push(Prisma.sql`sl."action" = ${f.action}`);
  if (f.categories?.length) k.push(Prisma.sql`sl."category"::text = ANY(${f.categories as string[]}::text[])`);
  if (f.from) k.push(Prisma.sql`sl."createdAt" >= ${f.from}`);
  if (f.to) k.push(Prisma.sql`sl."createdAt" <= ${f.to}`);
  return Prisma.join(k, " AND ");
}

export interface GrupImleci {
  at: Date;
  key: string;
}

export function imlecYaz(c: GrupImleci): string {
  return Buffer.from(JSON.stringify({ a: c.at.toISOString(), k: c.key })).toString("base64url");
}

export function imlecOku(raw: string | undefined): GrupImleci | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { a?: string; k?: string };
    const at = new Date(String(o.a));
    return Number.isNaN(at.getTime()) || typeof o.k !== "string" ? null : { at, key: o.k };
  } catch {
    return null;
  }
}

/** (at, key) azalan sıra karşılaştırıcısı — SQL `ORDER BY at DESC, key DESC` ile aynı. */
export function grupSirasi(a: GrupImleci, b: GrupImleci): number {
  const t = b.at.getTime() - a.at.getTime();
  return t !== 0 ? t : a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

export type OperationRow = NarrativeRow & {
  requestId: string | null;
  createdAt: Date;
  userId: string | null;
  anlati: Anlati;
};

export interface Kullanici {
  id: string;
  username: string;
  fullName: string;
  isSystemAccount: boolean;
}

export interface IslemOgesi {
  id: string;
  requestId: string | null;
  createdAt: Date;
  user: Kullanici | null;
  kayitSayisi: number;
  reddedildi: boolean;
  iz: Omit<RequestTraceDto, "userId" | "deviceRefId" | "ip"> | null;
  anlati: Anlati;
  satirlar: Array<Pick<OperationRow, "id" | "tableName" | "recordId" | "action" | "createdAt" | "anlati">>;
}

/** Bir grup (aynı requestId ya da tek satır) → işlem öğesi. Satır listesi 20 ile sınırlı. */
export function islemOgesi(
  g: GrupImleci,
  satirlar: readonly OperationRow[],
  iz: RequestTraceDto | null,
  user: Kullanici | null,
): IslemOgesi {
  const reqId = iz?.id ?? satirlar[0]?.requestId ?? null;
  const kisi = user ? { fullName: user.fullName, username: user.username } : null;
  return {
    id: g.key,
    requestId: reqId,
    createdAt: g.at,
    user,
    kayitSayisi: satirlar.length,
    reddedildi: (iz?.status ?? 0) >= 400,
    iz: iz ? { id: iz.id, deviceLocalId: iz.deviceLocalId, clientType: iz.clientType, appVersion: iz.appVersion, method: iz.method, routeKey: iz.routeKey, status: iz.status, durationMs: iz.durationMs, errorCode: iz.errorCode, auditCount: iz.auditCount, createdAt: iz.createdAt } : null,
    anlati: islemBasligi(kisi, iz, satirlar),
    satirlar: satirlar.slice(0, 20).map((s) => ({ id: s.id, tableName: s.tableName, recordId: s.recordId, action: s.action, createdAt: s.createdAt, anlati: s.anlati })),
  };
}
