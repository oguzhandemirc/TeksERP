// =============================================================================
// BEKÇİ — Audit hash zinciri + yetkili arşiv/budama yolu (G4, 2026-10-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts audit_hash_zinciri
// =============================================================================
// KORUNAN: her `system_logs` satırı bir öncekinin özetini taşır (DB trigger'ı);
// araya satır silme/değiştirme, kesitsiz baş silme, kuyruk silme ve trigger'ı
// atlatma doğrulamada KIRMIZIDIR. Arşiv/budama yalnız SECURITY DEFINER fonksiyondan
// ve taban kuralıyla yürür; yalnız SELECT+INSERT yetkili bir rol audit'i silemez
// ama arşivleyebilir.
// YÖNTEM: işlevsel bölümler TEK interactive tx içinde, zincir kilidi (8039) tutularak
// koşar ve sonunda ROLLBACK edilir — eşzamanlı bekçiler zinciri bozamaz, DB'de iz kalmaz.
// §1 statik (kilit sayısı ↔ sabit · arşiv/budama DB fn'den) · §2 zincir sağlam ·
// §3 negatif sondalar · §4 arşiv ∪ budama + kesit çapası · §5 kuyruk + zincirsiz ·
// §6 taban kuralı · §7 yalnız-ekleme rolü (DELETE/UPDATE/TRUNCATE 42501, arşiv geçer).
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const ROOT = join(__dirname, "..");
const MIG = readFileSync(join(ROOT, "prisma/migrations/20261013120000_audit_hash_zinciri/migration.sql"), "utf8");

class Geri extends Error {}

async function main(): Promise<void> {
  console.log("=== Audit hash zinciri ===\n");
  // ── §1 statik ─────────────────────────────────────────────────────────────
  const { AUDIT_CHAIN_LOCK_NS, verifyAuditChain } = await import("../src/services/audit-chain.service");
  const m = /pg_advisory_xact_lock\((\d+), 0\)/.exec(MIG);
  check("§1a trigger kilidi = AUDIT_CHAIN_LOCK_NS (envanter sabiti)", m !== null && Number(m[1]) === AUDIT_CHAIN_LOCK_NS, m?.[1] ?? "yok");
  const auditSrc = readFileSync(join(ROOT, "src/services/audit.service.ts"), "utf8");
  check("§1b arşiv/budama DB fonksiyonundan (audit_arsivle · audit_arsiv_buda)",
    /audit_arsivle\(/.test(auditSrc) && /audit_arsiv_buda\(/.test(auditSrc));
  check("§1c AuditService audit tablosunda doğrudan silme yapmıyor",
    !/systemLog(Archive)?\.delete(Many)?\(/.test(auditSrc));
  // Tanımdaki `SET "teks.audit_purge"` süper olmayan sahipte 42501 (onarım 2026-10-13): kapı gövdede.
  check("§1d iki definer fn purge ayarını gövdede tx-yerel açıp sonda geri yazıyor, tanımda SET yok",
    (MIG.match(/SECURITY DEFINER[\s\S]{0,400}?set_config\('teks\.audit_purge', 'on', true\)/g) ?? []).length === 2 &&
      (MIG.match(/set_config\('teks\.audit_purge', coalesce\(v_onceki, ''\), true\)/g) ?? []).length === 2 &&
      !/^SET "teks\./m.test(MIG));

  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB kapısı", false, engel); return; }
  const prisma = (await import("../src/lib/prisma")).default;
  const rolAdi = "tekserp_g4uyg_test";
  try {
    await prisma.$transaction(async (tx) => {
      const ex = (sql: string) => tx.$executeRawUnsafe(sql);
      const q = <T>(sql: string) => tx.$queryRawUnsafe<T>(sql);
      const sp = async (ad: string, fn: () => Promise<void>) => {
        await ex(`SAVEPOINT ${ad}`);
        try { await fn(); } finally { await ex(`ROLLBACK TO SAVEPOINT ${ad}`); }
      };
      const ver = (o: { fromSeq?: number; toSeq?: number } = {}) => verifyAuditChain(o, tx);
      const kinds = (r: { bulgular: Array<{ kind: string }> }) => r.bulgular.map((b) => b.kind).join(",");
      await ex("SELECT pg_advisory_xact_lock(8039, 0)");
      await ex("SET LOCAL teks.audit_purge = 'on'");

      // ── §2 zincir sağlam ──────────────────────────────────────────────────
      const a = await tx.systemLog.create({ data: { action: "UPDATE", tableName: "BEKCI_ZINCIR", recordId: "a", newData: { x: 1 } }, select: { chainSeq: true } });
      await tx.systemLog.createMany({ data: ["b", "c", "d"].map((r) => ({ action: "UPDATE", tableName: "BEKCI_ZINCIR", recordId: r, changes: [{ field: "f", old: 1, new: 2 }] })) });
      const seqs = (await tx.systemLog.findMany({ where: { tableName: "BEKCI_ZINCIR" }, select: { chainSeq: true, recordId: true }, orderBy: { chainSeq: "asc" } }));
      const s1 = a.chainSeq!;
      check("§2a trigger sıra veriyor, toplu yazım ardışık", seqs.map((x) => x.chainSeq).join() === [s1, s1 + 1, s1 + 2, s1 + 3].join(), seqs.map((x) => `${x.recordId}:${x.chainSeq}`).join(" "));
      const ok = await ver({ fromSeq: s1, toSeq: s1 + 3 });
      check("§2b dört satırlık aralık SAĞLAM", ok.durum === "saglam" && ok.kontrolEdilen === 4, `${ok.durum} ${kinds(ok)} n=${ok.kontrolEdilen}`);
      const sahte = await tx.systemLog.create({ data: { action: "UPDATE", tableName: "BEKCI_ZINCIR", recordId: "e", chainSeq: 999999, chainHash: "f".repeat(64) }, select: { chainSeq: true, chainHash: true } });
      check("§2c istemcinin verdiği sıra/özet yok sayılır (trigger ezer)", sahte.chainSeq === s1 + 4 && sahte.chainHash !== "f".repeat(64), String(sahte.chainSeq));

      // ── §3 negatif sondalar ───────────────────────────────────────────────
      await sp("n1", async () => {
        await ex(`UPDATE system_logs SET "newData" = '{"x":2}' WHERE "chainSeq" = ${s1}`);
        const r = await ver({ fromSeq: s1, toSeq: s1 + 4 });
        check("§3a ⭐ içerik değişti → OZET_UYUSMAZ", r.durum === "kurcalanmis" && r.bulgular[0]?.kind === "OZET_UYUSMAZ" && r.bulgular[0]?.seq === s1, kinds(r));
      });
      await sp("n2", async () => {
        await ex(`DELETE FROM system_logs WHERE "chainSeq" = ${s1 + 2}`);
        const r = await ver({ fromSeq: s1, toSeq: s1 + 4 });
        check("§3b ⭐ ara satır silindi → SIRA_BOSLUGU", r.bulgular.some((b) => b.kind === "SIRA_BOSLUGU" && b.seq === s1 + 3), kinds(r));
      });
      await sp("n3", async () => {
        await ex(`UPDATE system_logs SET "chainHash" = repeat('a', 64) WHERE "chainSeq" = ${s1 + 1}`);
        const r = await ver({ fromSeq: s1, toSeq: s1 + 4 });
        check("§3c ⭐ özet değişti → kendisi ve ardılı OZET_UYUSMAZ", r.bulgular.filter((b) => b.kind === "OZET_UYUSMAZ").map((b) => b.seq).join() === `${s1 + 1},${s1 + 2}`, kinds(r));
      });
      await sp("n4", async () => {
        await ex(`DELETE FROM system_logs WHERE "chainSeq" = ${s1 + 2}`);
        await ex(`INSERT INTO system_logs (id, action, "tableName", "recordId") VALUES (gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'sahte')`);
        await ex(`UPDATE system_logs SET "chainSeq" = ${s1 + 2} WHERE "recordId" = 'sahte' AND "tableName" = 'BEKCI_ZINCIR'`);
        const r = await ver({ fromSeq: s1, toSeq: s1 + 4 });
        check("§3d ⭐ silinen yerine satır uyduruldu → OZET_UYUSMAZ", r.bulgular.some((b) => b.kind === "OZET_UYUSMAZ"), kinds(r));
      });

      // ── §4 tam zincir: arşiv ∪ budama + kesit çapası ──────────────────────
      await sp("t", async () => {
        await ex("DELETE FROM system_logs");
        await ex("DELETE FROM system_log_archives");
        await ex(`DELETE FROM system_settings WHERE key = 'audit.chainVerifiedHead'`);
        await ex(`INSERT INTO system_logs (id, action, "tableName", "recordId", "createdAt")
          SELECT gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'eski' || g, now() - interval '2 years' + g * interval '1 second' FROM generate_series(1, 3) g`); // tz-ok: bekçi fikstürü
        await ex(`INSERT INTO system_logs (id, action, "tableName", "recordId") VALUES (gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'genc1'), (gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'genc2')`);
        const t0 = await ver();
        check("§4a sıfırdan zincir 1..5 SAĞLAM (genesis)", t0.durum === "saglam" && t0.ilkSira === 1 && t0.sonSira === 5, `${t0.durum} ${kinds(t0)} ${t0.ilkSira}..${t0.sonSira}`);
        const [arc] = await q<Array<{ n: number }>>(`SELECT audit_arsivle(now() - interval '6 months', 100) AS n`); // tz-ok: bekçi
        const t1 = await ver();
        check("§4b arşivleme 3 satır taşıdı, zincir canlı ∪ arşivde SAĞLAM", Number(arc?.n) === 3 && t1.durum === "saglam" && t1.kontrolEdilen === 5, `${arc?.n} ${t1.durum} ${kinds(t1)}`);
        const [bud] = await q<Array<{ n: bigint }>>(`SELECT audit_arsiv_buda(now() - interval '1 year') AS n`); // tz-ok: bekçi
        const [cut] = await q<Array<{ seq: number; through: string }>>(`SELECT "chainSeq" AS seq, "newData"->>'throughSeq' AS through FROM system_logs WHERE action = 'AUDIT_CHAIN_CUT'`);
        const t2 = await ver();
        check("§4c budama sıra-önekini sildi + kesit çapası (throughSeq=3) yazdı", Number(bud?.n) === 3 && cut?.through === "3" && cut?.seq === 6, `silinen=${bud?.n} kesit=${JSON.stringify(cut)}`);
        check("§4d budama sonrası zincir kesitten bağlanıyor → SAĞLAM", t2.durum === "saglam" && t2.ilkSira === 4, `${t2.durum} ${kinds(t2)} ilk=${t2.ilkSira}`);
        await sp("t4", async () => {
          await ex(`DELETE FROM system_logs WHERE action = 'AUDIT_CHAIN_CUT'`);
          const r = await ver();
          check("§4e ⭐ kesit çapası silindi → BAS_KESIK", r.bulgular.some((b) => b.kind === "BAS_KESIK"), kinds(r));
        });
        await sp("t5", async () => {
          await ex(`DELETE FROM system_logs WHERE "chainSeq" = 4`);
          const r = await ver();
          check("§4f ⭐ kesitsiz baş silindi → BAS_KESIK", r.bulgular.some((b) => b.kind === "BAS_KESIK"), kinds(r));
        });

        // ── §5 kuyruk çapası + zincirsiz satır ─────────────────────────────
        await ex(`INSERT INTO system_settings (key, value, "updatedAt") SELECT 'audit.chainVerifiedHead', jsonb_build_object('seq', "chainSeq", 'hash', "chainHash"), now() FROM system_logs WHERE "chainSeq" = 6`);
        const t3 = await ver();
        check("§5a çapa yerindeyken SAĞLAM", t3.durum === "saglam", kinds(t3));
        await sp("t6", async () => {
          await ex(`DELETE FROM system_logs WHERE "chainSeq" = 6`);
          const r = await ver();
          check("§5b ⭐ kuyruk silindi → KUYRUK_KAYIP", r.bulgular.some((b) => b.kind === "KUYRUK_KAYIP"), kinds(r));
        });
        await sp("t7", async () => {
          let atlandi = false;
          try { await ex("SET LOCAL session_replication_role = replica"); } catch { atlandi = true; }
          if (atlandi) { console.log("⏭ §5c session_replication_role kurulamadı (süper değil) — beyanla atlandı"); return; }
          await ex(`INSERT INTO system_logs (id, action, "tableName", "recordId", "createdAt") VALUES (gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'atlatan', clock_timestamp())`);
          await ex("SET LOCAL session_replication_role = origin");
          const r = await ver();
          check("§5c ⭐ trigger atlatılarak yazılan satır → ZINCIRSIZ_SATIR", r.bulgular.some((b) => b.kind === "ZINCIRSIZ_SATIR"), kinds(r));
        });
      });

      // ── §6 taban kuralı ───────────────────────────────────────────────────
      for (const [ad, sql] of [
        ["arşiv kesimi < 1 ay", "SELECT audit_arsivle(now() - interval '1 day', 10)"], // tz-ok: bekçi
        ["budama kesimi < 1 yıl", "SELECT audit_arsiv_buda(now() - interval '30 days')"], // tz-ok: bekçi
      ] as const) {
        let kod = "";
        await ex("SAVEPOINT f");
        try { await q(sql); } catch (e) { kod = String((e as { meta?: { code?: string } }).meta?.code ?? (e as Error).message); }
        await ex("ROLLBACK TO SAVEPOINT f");
        check(`§6 ⭐ ${ad} → reddedildi (22023)`, kod.includes("22023"), kod.slice(0, 80));
      }

      // ── §7 yalnız-ekleme rolü (G4/A'nın DB çekirdeği) ─────────────────────
      let rolVar = true;
      await ex("SAVEPOINT r0");
      try { await ex(`CREATE ROLE ${rolAdi} NOLOGIN`); } catch { rolVar = false; await ex("ROLLBACK TO SAVEPOINT r0"); }
      if (!rolVar) { console.log("⏭ §7 CREATE ROLE yetkisi yok — beyanla atlandı"); }
      else {
        await ex(`GRANT USAGE ON SCHEMA public TO ${rolAdi}`);
        await ex(`GRANT SELECT, INSERT ON system_logs, system_log_archives TO ${rolAdi}`);
        // G5: rol göçü definer fonksiyonları PUBLIC'ten kapatır; uygulama rolü EXECUTE'u açık GRANT'la alır.
        await ex(`GRANT EXECUTE ON FUNCTION audit_arsivle(timestamptz, integer) TO ${rolAdi}`);
        await ex(`SET LOCAL ROLE ${rolAdi}`);
        await ex(`INSERT INTO system_logs (id, action, "tableName", "recordId") VALUES (gen_random_uuid(), 'UPDATE', 'BEKCI_ZINCIR', 'rol')`);
        const [rr] = await q<Array<{ seq: number | null }>>(`SELECT "chainSeq" AS seq FROM system_logs WHERE "recordId" = 'rol' AND "tableName" = 'BEKCI_ZINCIR'`);
        check("§7a yalnız-ekleme rolü yazabiliyor, zincir bağlanıyor (definer trigger)", typeof rr?.seq === "number", String(rr?.seq));
        for (const [ad, sql] of [
          ["DELETE", `DELETE FROM system_logs WHERE "tableName" = 'BEKCI_ZINCIR'`],
          ["UPDATE", `UPDATE system_logs SET "recordId" = 'x' WHERE "tableName" = 'BEKCI_ZINCIR'`],
          ["TRUNCATE", "TRUNCATE system_log_archives"],
        ] as const) {
          let kod = "";
          await ex("SAVEPOINT r1");
          try { await ex(sql); } catch (e) { kod = String((e as { meta?: { code?: string } }).meta?.code ?? (e as Error).message); }
          await ex("ROLLBACK TO SAVEPOINT r1");
          check(`§7b ⭐ uygulama rolüyle ${ad} → reddedildi (42501)`, kod.includes("42501"), kod.slice(0, 80));
        }
        const [wo] = await q<Array<{ t: boolean }>>(`SELECT has_table_privilege('public.system_logs', 'UPDATE, DELETE, TRUNCATE') AS t`);
        check("§7c koruma ölçümü bu rolde 'yalnız ekleme' görür", wo?.t === false);
        let arsivKod = "ok";
        await ex("SAVEPOINT r2");
        try { await q(`SELECT audit_arsivle(now() - interval '100 years', 10)`); } catch (e) { arsivKod = (e as Error).message; } // tz-ok: bekçi
        await ex("ROLLBACK TO SAVEPOINT r2");
        check("§7d yalnız-ekleme rolü arşivleyiciyi definer fn ile çağırabiliyor", arsivKod === "ok", arsivKod.slice(0, 80));
        await ex("RESET ROLE");
      }
      throw new Geri();
    }, { timeout: 120000, maxWait: 20000 });
  } catch (e) {
    if (!(e instanceof Geri)) throw e;
  } finally {
    const kalan = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = '${rolAdi}'`);
    check("temizlik: test rolü yok, tx geri alındı", kalan[0]?.n === 0);
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
