// =============================================================================
// G5 — yalnız-okuma DB erişimi (müşterinin BI aracı): durum + parola yenile-ve-göster
// =============================================================================
// Rolü ve parola fonksiyonunu rol göçü kurar (`lib/db-rol-gocu.ts` + `lib/okuma-rolu.ts`); burada
// yalnız OKUNUR ve parola döndürülür. Parola SAKLANMAZ: PG'ye SCRAM doğrulayıcısı gider, düz parola
// yalnız yenileme yanıtında BİR KEZ döner — "göster" = yenile-ve-göster. Audit yükünde parola yok.
// =============================================================================

import { randomBytes } from "node:crypto";
import prisma from "../lib/prisma";
import { scramVerifier } from "../lib/db-rol-gocu";
import { runningInContainer } from "../lib/license/updater-ipc";
import {
  READ_ONLY_CONNECTION_LIMIT,
  READ_ONLY_STAMP_PREFIX,
  READ_ONLY_HIDDEN_COLUMNS,
  READ_ONLY_HIDDEN_TABLES,
  READ_ONLY_PASSWORD_FUNCTION,
} from "../lib/okuma-rolu";
import { SYSTEM_EVENT } from "../constants/system-events";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";

/** HAZIR · KAPALI (rol göçü doğrulayamadı, giriş kapalı) · KURULUMDA_YOK (rol göçü bu kurulumda yok). */
export type ReadOnlyDbState = "HAZIR" | "KAPALI" | "KURULUMDA_YOK";

export interface ReadOnlyDbStatus {
  state: ReadOnlyDbState;
  role: string | null;
  database: string;
  /** Backend'in bağlandığı adres (Docker'da iç ağ adı — dışarıdan erişim ayrıca açılmalı). */
  host: string | null;
  port: number | null;
  container: boolean;
  passwordRotatedAt: string | null;
  activeConnections: number;
  connectionLimit: number;
  hiddenTables: readonly string[];
  hiddenColumns: Readonly<Record<string, readonly string[]>>;
}

function backendAddress(): { host: string | null; port: number | null } {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return { host: u.hostname || null, port: u.port ? Number(u.port) : 5432 };
  } catch {
    return { host: null, port: null };
  }
}

export async function getReadOnlyDbStatus(): Promise<ReadOnlyDbStatus> {
  const [fn] = await prisma.$queryRaw<Array<{ rol: string | null; cagir: boolean; db: string }>>`
    SELECT obj_description(p.oid, 'pg_proc') AS rol, has_function_privilege(p.oid, 'EXECUTE') AS cagir,
           current_database() AS db
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ${READ_ONLY_PASSWORD_FUNCTION} AND p.prosecdef`;
  const [db] = fn ? [fn.db] : (await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`).map((r) => r.db);
  const base = {
    database: db ?? "",
    ...backendAddress(),
    container: runningInContainer(),
    connectionLimit: READ_ONLY_CONNECTION_LIMIT,
    hiddenTables: READ_ONLY_HIDDEN_TABLES,
    hiddenColumns: READ_ONLY_HIDDEN_COLUMNS,
  };
  if (!fn || !fn.rol || !fn.cagir) {
    return { ...base, state: "KURULUMDA_YOK", role: null, passwordRotatedAt: null, activeConnections: 0 };
  }
  const [r] = await prisma.$queryRaw<Array<{ giris: boolean; yorum: string | null; aktif: number }>>`
    SELECT r.rolcanlogin AS giris, shobj_description(r.oid, 'pg_authid') AS yorum,
           (SELECT count(*)::int FROM pg_stat_activity a WHERE a.usename = r.rolname) AS aktif
    FROM pg_roles r WHERE r.rolname = ${fn.rol}`;
  const stamp = r?.yorum?.startsWith(READ_ONLY_STAMP_PREFIX) ? Number(r.yorum.slice(READ_ONLY_STAMP_PREFIX.length)) : NaN;
  return {
    ...base,
    state: r?.giris ? "HAZIR" : "KAPALI",
    role: fn.rol,
    passwordRotatedAt: Number.isFinite(stamp) ? new Date(stamp * 1000).toISOString() : null,
    activeConnections: r?.aktif ?? 0,
  };
}

/**
 * Yeni rastgele parola üretir, PG'ye yalnız SCRAM doğrulayıcısını verir ve parolayı BİR KEZ döner.
 * Eski parola anında geçersiz olur (açık oturumlar sürer, yeni giriş yeni parolayı ister).
 */
export async function rotateReadOnlyDbPassword(
  userId: string | undefined,
  ipAddress: string | null,
): Promise<{ status: ReadOnlyDbStatus; password: string }> {
  const before = await getReadOnlyDbStatus();
  if (before.state !== "HAZIR" || !before.role) {
    throw AppError.conflict(
      before.state === "KAPALI"
        ? "Okuma rolü doğrulanamadığı için girişe kapalı; sunucu yeniden başlatılınca rol göçü onarır."
        : "Bu kurulumda yalnız-okuma veritabanı rolü yok.",
      { code: "READ_ONLY_DB_UNAVAILABLE", state: before.state },
    );
  }
  const password = randomBytes(24).toString("base64url");
  const verifier = scramVerifier(password);
  await prisma.$queryRaw`SELECT public.okuma_rolu_parola(${verifier}) AS rol`;
  // ⚠️ YÜK YALNIZ AKTÖR + ROL: parola da doğrulayıcı da audit'e GİRMEZ.
  await AuditService.logEvent({
    category: "SYSTEM",
    action: SYSTEM_EVENT.READ_ONLY_DB_PASSWORD_ROTATED,
    userId: userId ?? null,
    recordId: before.role,
    ipAddress,
    payload: { by: userId ?? null, role: before.role },
  });
  return { status: await getReadOnlyDbStatus(), password };
}
