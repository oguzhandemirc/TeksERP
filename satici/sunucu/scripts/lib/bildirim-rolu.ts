// Bildirim bekçilerinin GÖNDERİCİ ROLÜ — küme düzeyindeki `satici_bildirim` rolüne dokunulmaz (başka oturumların
// `_test` DB'leri aynı kümeyi paylaşır): koşum başına `sat_bld_<rastgele>` rolü onun ÜYESİ olarak doğar (yetkileri
// yalnız üyelikten gelir), girişi ürünün kendi yolu (`enableSenderLogin`: yetki kümesi ölçülür, SCRAM istemcide)
// açar; bekçi sonunda rol DÜŞER. `test_` öneki yok → koşucu bekçi saymaz.
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { enableSenderLogin, SENDER_ROLE } from "../../src/notifications/sender-role";

export interface GondericiRolu {
  readonly rol: string;
  readonly parola: string;
  /** Rolün bağlantı adresi (sahip URL'inin kullanıcı/parolası değiştirilmiş hâli). */
  readonly url: string;
  kaldir(): Promise<void>;
}

export async function sahipIstemci(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

/** Üye rol doğar (NOLOGIN), girişi `enableSenderLogin` açar. */
export async function gondericiRoluKur(): Promise<GondericiRolu> {
  const rol = `sat_bld_${randomBytes(5).toString("hex")}`;
  const parola = randomBytes(24).toString("hex");
  const c = await sahipIstemci();
  try {
    await c.query(`CREATE ROLE "${rol}" NOLOGIN IN ROLE "${SENDER_ROLE}"`);
    try {
      await enableSenderLogin(c, { role: rol, password: parola });
    } catch (err) {
      await c.query(`DROP ROLE IF EXISTS "${rol}"`);
      throw err;
    }
  } finally {
    await c.end();
  }
  const u = new URL(process.env.DATABASE_URL ?? "");
  u.username = rol;
  u.password = parola;
  return {
    rol,
    parola,
    url: u.toString(),
    kaldir: async () => {
      const k = await sahipIstemci();
      try {
        await k.query(`DROP ROLE IF EXISTS "${rol}"`);
      } finally {
        await k.end();
      }
    },
  };
}
