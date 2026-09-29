// Modül anahtarları (Faz 2d): kasaya alma (CLI) ve kira basımında kurulumun X25519'una sarma.
// Kural: HAK'ta olmayan, dondurulmuş (K2) ya da X25519'u bilinmeyen kuruluma anahtar SARILMAZ —
// şifreli modül kodu o kurulumda açılamaz (güvenlik-kritik sonuç boolean değil ANAHTARDIR).
import type { Hak, Kurulum } from "@prisma/client";
import { moduleKeyId, wrapModuleKey, ModuleKeySchema, type ModuleKeyGrant } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { prisma, type Db } from "../lib/prisma";
import type { VendorContext } from "./context";

export interface ModuleKeyImport {
  readonly modul: string;
  readonly surum: number;
  readonly anahtar: Buffer;
  readonly yapan: string;
}

/** Kasaya alır; aynı kid zaten varsa dokunmaz (tekrar güvenli). Aynı modül×sürüm başka anahtarla 409. */
export async function importModuleKey(ctx: VendorContext, g: ModuleKeyImport): Promise<{ kid: string; yeni: boolean }> {
  if (!ModuleKeySchema.safeParse(g.modul).success || !Number.isInteger(g.surum) || g.surum < 1 || g.anahtar.length !== 32) {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Modül anahtarı: modül adı geçerli, sürüm ≥ 1, anahtar 32 bayt olmalı");
  }
  const kid = moduleKeyId(g.anahtar);
  const existing = await prisma.modulAnahtari.findFirst({ where: { OR: [{ kid }, { modul: g.modul, surum: g.surum }] } });
  if (existing) {
    if (existing.kid === kid && existing.modul === g.modul && existing.surum === g.surum) return { kid, yeni: false };
    throw new VendorError(409, "DURUM_CAKISMASI", `Kasada ${existing.modul} ${existing.surum}. sürüm başka bir anahtarla kayıtlı`);
  }
  await prisma.modulAnahtari.create({
    data: { modul: g.modul, surum: g.surum, kid, sarili: ctx.moduleVault.seal(g.anahtar, kid), yapan: g.yapan },
  });
  await recordAudit({ event: "MODUL_ANAHTARI_EKLENDI", entity: "ModulAnahtari", entityId: kid, actor: g.yapan, summary: { modul: g.modul, surum: g.surum, kid } });
  return { kid, yeni: true };
}

/**
 * Kiraya girecek hak listesi: HAK modülleri − dondurulmuşlar, kasadaki AKTİF sürümler, kurulumun X25519'una
 * sarılı. Kasa satırı açılamazsa o anahtar ATLANIR (modül kilitli kalır — fail-closed) ve günlüğe yazılır.
 */
export async function moduleKeyGrants(db: Db, ctx: VendorContext, g: { installation: Kurulum; entitlement: Hak; frozen: readonly string[] }): Promise<ModuleKeyGrant[]> {
  const recipient = g.installation.sifrelemeAnahtari;
  if (!recipient) return [];
  const modules = g.entitlement.moduller.filter((m) => !g.frozen.includes(m));
  if (modules.length === 0) return [];
  const rows = await db.modulAnahtari.findMany({ where: { modul: { in: modules }, aktif: true }, orderBy: [{ modul: "asc" }, { surum: "asc" }] });
  const grants: ModuleKeyGrant[] = [];
  for (const row of rows) {
    const key = ctx.moduleVault.open(row.sarili, row.kid);
    if (!key || moduleKeyId(key) !== row.kid) {
      console.error(`[satici] modül kasası satırı açılamadı (${row.modul} ${row.surum}. sürüm, ${row.kid}) — sarılmadı`);
      continue;
    }
    grants.push({ modul: row.modul, surum: row.surum, kid: row.kid, sarma: wrapModuleKey({ moduleKey: key, recipientPublicX: recipient, modul: row.modul }) });
    key.fill(0);
  }
  return grants;
}
