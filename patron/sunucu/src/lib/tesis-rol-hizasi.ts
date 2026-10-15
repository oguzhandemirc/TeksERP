// TESİS ROL PAROLASI HİZASI — anahtar değişiminden sonra HAZIR tesislerin çalışma rollerinin (`_uyg`, `_esit`)
// parolasını geçerli anahtardan türetilene çeker (PATRON-TESIS-DB §3). YALNIZ göç rolüyle (küme yöneticisi: pg_authid
// okur, ALTER ROLE yazar) — CLI `tesis-db rol-hizala`; sunucu bu modülü İMPORT ETMEZ (bekçi ölçer).
// Ölçüm DB'deki parola doğrulayıcısıyla (SCRAM-SHA-256 / md5) yapılır: giriş denemesi yok, pg_hba kipinden bağımsız.
// Yalnız uyumsuz rol yazılır ⇒ ikinci koşum hiçbir şey yazmaz. Parola/doğrulayıcı hiçbir çıktıya girmez.
import crypto from "node:crypto";
import { Client } from "pg";
import type { FacilityDbKey } from "../auth/facility-db-key";
import { ensureLoginRole } from "./db-roles";
import { PG_SESSION_OPTIONS } from "./pg-session";
import { assertCentralName, databaseOf, facilityDbName, facilityRoles } from "./tesis-db-ad";

export type RoleState = "uyumlu" | "uyumsuz" | "yok";

export interface RoleCheck {
  readonly role: string;
  readonly state: RoleState;
}

export type FacilityRoleItem =
  | { readonly tesisId: string; readonly database: string; readonly kind: "hazir"; readonly roles: readonly RoleCheck[] }
  | { readonly tesisId: string; readonly database: string; readonly kind: "atlandi"; readonly status: string };

export interface RoleAlignPlan {
  readonly items: readonly FacilityRoleItem[];
  readonly counts: { readonly tesis: number; readonly uyumlu: number; readonly uyumsuz: number; readonly yok: number; readonly atlanan: number };
}

export interface RoleAlignResult {
  readonly changed: readonly string[];
  readonly failed: readonly { readonly role: string; readonly code: string }[];
  /** Yazımdan sonra yeniden ölçüm (doğrulama). */
  readonly after: RoleAlignPlan;
}

const SCRAM = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/;

/** Doğrulayıcı bu parolayı mı taşıyor (SCRAM-SHA-256 ya da md5; boş/tanınmayan biçim = uyumsuz). */
export function verifierMatches(verifier: string | null, role: string, password: string): boolean {
  if (!verifier) return false;
  const s = SCRAM.exec(verifier);
  if (s) {
    const salted = crypto.pbkdf2Sync(password, Buffer.from(s[2]!, "base64"), Number(s[1]), 32, "sha256");
    const stored = crypto.createHash("sha256").update(crypto.createHmac("sha256", salted).update("Client Key").digest()).digest();
    const want = Buffer.from(s[3]!, "base64");
    return want.length === stored.length && crypto.timingSafeEqual(want, stored);
  }
  if (/^md5[0-9a-f]{32}$/.test(verifier)) {
    const got = Buffer.from(`md5${crypto.createHash("md5").update(`${password}${role}`).digest("hex")}`);
    return got.length === verifier.length && crypto.timingSafeEqual(got, Buffer.from(verifier));
  }
  return false;
}

async function measure(central: Client, centralName: string, key: FacilityDbKey): Promise<RoleAlignPlan> {
  // İmha edilmiş tesisin rolleri yoktur; ölçüme girmez. HAZIR olmayan her öteki satır atlanır ve raporlanır.
  const rows = await central.query<{ tesis_id: string; status: string }>(`SELECT tesis_id, status::text AS status FROM facility_databases WHERE status <> 'IMHA_EDILDI' ORDER BY created_at, tesis_id`);
  const items: FacilityRoleItem[] = [];
  const counts = { tesis: 0, uyumlu: 0, uyumsuz: 0, yok: 0, atlanan: 0 };
  for (const row of rows.rows) {
    const database = facilityDbName(centralName, row.tesis_id);
    counts.tesis++;
    if (row.status !== "HAZIR") {
      counts.atlanan++;
      items.push({ tesisId: row.tesis_id, database, kind: "atlandi", status: row.status });
      continue;
    }
    const r = facilityRoles(database);
    const names = [r.app, r.sync];
    let auth;
    try {
      auth = await central.query<{ rolname: string; rolpassword: string | null }>(`SELECT rolname, rolpassword FROM pg_authid WHERE rolname = ANY($1::text[])`, [names]);
    } catch (err) {
      // 42501: göç rolü küme yöneticisi değil ⇒ ölçülemez; körlemesine yazmak yerine dur.
      throw new Error(`Rol parolaları ölçülemedi (${(err as { code?: string }).code ?? "?"}) — göç rolü pg_authid okuyabilmeli`);
    }
    const byName = new Map(auth.rows.map((x) => [x.rolname, x.rolpassword]));
    const roles = names.map((role): RoleCheck => {
      const state: RoleState = !byName.has(role) ? "yok" : verifierMatches(byName.get(role) ?? null, role, key.rolePassword(role)) ? "uyumlu" : "uyumsuz";
      counts[state]++;
      return { role, state };
    });
    items.push({ tesisId: row.tesis_id, database, kind: "hazir", roles });
  }
  return { items, counts };
}

async function withCentral<T>(gocUrl: string, fn: (c: Client, centralName: string) => Promise<T>): Promise<T> {
  const centralName = assertCentralName(databaseOf(gocUrl));
  const c = new Client({ connectionString: gocUrl, options: PG_SESSION_OPTIONS });
  await c.connect();
  try {
    return await fn(c, centralName);
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Kuru ölçüm: hiçbir şey yazmaz. */
export function planRoleAlignment(gocUrl: string, key: FacilityDbKey): Promise<RoleAlignPlan> {
  return withCentral(gocUrl, (c, name) => measure(c, name, key));
}

/**
 * Uyumsuz rolleri yazar (ALTER ROLE … PASSWORD; özellikler de hizalanır), sonra yeniden ölçer. Eşzamanlı hazırlayıcı
 * ya da ikinci koşum AYNI anahtardan AYNI parolayı yazar ⇒ kilit gerekmez. Yarışta düşen rol `failed`e girer.
 */
export function applyRoleAlignment(gocUrl: string, key: FacilityDbKey): Promise<RoleAlignResult> {
  return withCentral(gocUrl, async (c, name) => {
    const plan = await measure(c, name, key);
    const changed: string[] = [];
    const failed: { role: string; code: string }[] = [];
    for (const item of plan.items) {
      if (item.kind !== "hazir") continue;
      for (const r of item.roles) {
        if (r.state !== "uyumsuz") continue;
        try {
          await ensureLoginRole(c, r.role, key.rolePassword(r.role));
          changed.push(r.role);
        } catch (err) {
          failed.push({ role: r.role, code: (err as { code?: string }).code ?? "YAZILAMADI" });
        }
      }
    }
    return { changed, failed, after: await measure(c, name, key) };
  });
}
