// =============================================================================
// AUDIT REPRO — E-2-00-probe: DB erişimi + sınır değer sondaları (SALT OKUMA)
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen: bağlantı kurulur, sorgular okunur; hiçbir yazma yapılmaz.
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-2-00-probe.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "",
    db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();
import prisma, { pool as paylasilanHavuz } from "../src/lib/prisma";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";

async function main(): Promise<void> {
  const v = await prisma.$queryRawUnsafe<Array<{ v: string }>>("SELECT version() AS v");
  console.log("DB:", v[0]?.v?.slice(0, 40));

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT 'dev_roll_initial_zero' AS k, count(*)::int AS n FROM rolls WHERE "initialQty" = 0
    UNION ALL SELECT 'dev_roll_qty_neg', count(*)::int FROM rolls WHERE "initialQty" < 0 OR "currentQty" < 0
    UNION ALL SELECT 'dev_roll_width_zero', count(*)::int FROM rolls WHERE width = 0
    UNION ALL SELECT 'dev_orderline_qty_zero', count(*)::int FROM order_lines WHERE quantity <= 0
  `);
  console.log(JSON.stringify(rows));

  // Saha kopyası aynı sunucuda — salt okuma için ayrı bağlantı.
  const { Pool } = await import("pg");
  const base = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
  const sahaUrl = base.replace(/\/[^/]*$/, "/tekserp_saha_0825");
  // ⚠️ `PG_SESSION_OPTIONS` TEK KAYNAKTAN gelir (`src/lib/pg-session.ts`): adapter
  // oturumun UTC olduğunu VARSAYAR ve bekçi (`test_timestamptz_contract` §3) her
  // `new Pool(` çağrısının bu sabiti taşıdığını mekanik olarak arar. Buradaki
  // sonda script'i satırı elle yazmıştı (aynı anlam, farklı metin) ve bekçiyi
  // kırmızıya düşürüyordu — denetimin kendi artefaktı, denetimin bekçisini bozdu.
  const pool = new Pool({ connectionString: sahaUrl, options: PG_SESSION_OPTIONS });
  try {
    // Salt-okunurluk oturum ayarıyla kurulur — `options` alanı bekçinin aradığı
    // TEK KAYNAK sabitini taşımak zorunda (`test_timestamptz_contract` §3), o
    // yüzden ikinci bir `-c` bayrağı oraya yazılmaz.
    await pool.query("SET default_transaction_read_only = on");
    const r = await pool.query(`
      SELECT 'saha_roll_initial_zero' AS k, count(*)::int AS n FROM rolls WHERE "initialQty" = 0
      UNION ALL SELECT 'saha_roll_qty_neg', count(*)::int FROM rolls WHERE "initialQty" < 0 OR "currentQty" < 0
      UNION ALL SELECT 'saha_roll_width_zero', count(*)::int FROM rolls WHERE width = 0
      UNION ALL SELECT 'saha_roll_sub_milli', count(*)::int FROM rolls WHERE "initialQty" > 0 AND "initialQty" < 1
      UNION ALL SELECT 'saha_orderline_qty_zero', count(*)::int FROM order_lines WHERE quantity <= 0
      UNION ALL SELECT 'saha_roll_max_qty', max("initialQty")::int FROM rolls
    `);
    console.log(JSON.stringify(r.rows));
  } finally {
    await pool.end();
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    // ⚠️ `$disconnect()` TEK BAŞINA YETMEZ: paylaşılan havuz `idleTimeoutMillis:
    // 600_000` ile kurulu → idle client handle'ı event loop'u 10 dk açık tutar ve
    // script "bitti ama çıkmadı" durumunda kalır (CLAUDE.md "ÇIKIŞ" kuralı; test
    // koşucusu bunu 180 sn'de ZAMAN AŞIMI sayar). Ölçüldü: bu sonda tam olarak
    // öyle takılıyordu.
    await prisma.$disconnect();
    await paylasilanHavuz.end();
  });
