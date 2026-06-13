// =============================================================================
// Test: AuditService + SystemLogService — audit yazımı / best-effort / liste / arşiv
// Çalıştır: npx tsx scripts/test_system_log.ts
// Doğrulananlar:
//   1. AuditService.log() bir SystemLog (category=DOMAIN) satırı yazar
//   2. AuditService.logEvent() AUTH/SYSTEM event satırı yazar
//   3. best-effort: hatalı alanla (geçersiz UUID userId) log isteği DÜŞMEZ
//      (throw etmez) + getHealth().failureCount artar (auditWriteFailures)
//   4. SystemLogService.list() cursor pagination + tableName/category filtresi
//   5. SystemLogService.findById() detay (oldData/newData) döner
//   6. SystemLogService.archiveOlderThan() yalnız TEST- kaydı eski tarihe çekip
//      arşivler (yıkıcı; sadece kendi yarattığımız kayıtta)
// =============================================================================
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { SystemLogService } from "../src/services/system-log.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  // Kendi izole tablo-adımız: liste/filtre testleri yalnız bu prefix'i görsün.
  const tableName = `TEST-LOG-${ts}`;
  const recordId = `TEST-LOG-REC-${ts}`;

  // Audit FK'sı opsiyonel (userId nullable); gerçek bir kullanıcıya bağlamaya
  // gerek yok — userId=null DOMAIN log'u geçerlidir. Yine de seed'den bir
  // kullanıcı çözüp bağlayalım ki user join'i de gerçekçi olsun.
  const seedUser = await prisma.user.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  const createdLogIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // 1) AuditService.log() → SystemLog (DOMAIN) yazar
    // -------------------------------------------------------------------------
    await AuditService.log({
      userId: seedUser?.id,
      action: "CREATE",
      tableName,
      recordId,
      newData: { marker: `TEST-LOG-${ts}`, qty: 42 },
    });
    const domainRow = await prisma.systemLog.findFirst({
      where: { tableName, recordId, action: "CREATE" },
      orderBy: { createdAt: "desc" },
    });
    if (domainRow) createdLogIds.push(domainRow.id);
    check(
      "AuditService.log() DOMAIN satırı yazdı",
      !!domainRow && domainRow.category === "DOMAIN" && domainRow.action === "CREATE",
      domainRow ? `id=${domainRow.id} cat=${domainRow.category}` : "satır yok",
    );
    check(
      "log() newData payload'ı SystemLog'a yazıldı",
      !!domainRow &&
        typeof domainRow.newData === "object" &&
        domainRow.newData !== null &&
        (domainRow.newData as Record<string, unknown>).marker === `TEST-LOG-${ts}`,
    );

    // -------------------------------------------------------------------------
    // 2) AuditService.logEvent() → AUTH event satırı
    // -------------------------------------------------------------------------
    await AuditService.logEvent({
      category: "AUTH",
      action: "LOGIN_SUCCESS",
      tableName,
      recordId,
      payload: { username: `test-${ts}`, source: "TEST-LOG" },
    });
    const authRow = await prisma.systemLog.findFirst({
      where: { tableName, recordId, category: "AUTH" },
      orderBy: { createdAt: "desc" },
    });
    if (authRow) createdLogIds.push(authRow.id);
    check(
      "logEvent() AUTH event satırı yazdı",
      !!authRow && authRow.category === "AUTH" && authRow.action === "LOGIN_SUCCESS",
    );

    // -------------------------------------------------------------------------
    // 3) best-effort: hatalı alanla log isteği DÜŞMEZ + failureCount artar
    //    userId @db.Uuid kolonu — geçersiz format DB-side patlar; catch yutmalı,
    //    ana akış (await) throw ETMEMELİ ve getHealth().failureCount artmalı.
    // -------------------------------------------------------------------------
    const healthBefore = AuditService.getHealth();
    check(
      "getHealth() şekli (failureCount number)",
      typeof healthBefore.failureCount === "number" && healthBefore.failureCount >= 0,
      `failureCount=${healthBefore.failureCount}`,
    );

    let threw = false;
    try {
      await AuditService.log({
        userId: "not-a-valid-uuid", // geçersiz UUID → Prisma DB-side hata
        action: "CREATE",
        tableName: `TEST-LOG-BAD-${ts}`,
        recordId,
        newData: { bad: true },
      });
    } catch {
      threw = true;
    }
    check("best-effort: hatalı log isteği throw ETMEDİ", !threw);

    const healthAfter = AuditService.getHealth();
    check(
      "best-effort: failureCount arttı (auditWriteFailures)",
      healthAfter.failureCount === healthBefore.failureCount + 1,
      `${healthBefore.failureCount}→${healthAfter.failureCount}`,
    );
    check(
      "best-effort: hatalı satır DB'ye YAZILMADI",
      (await prisma.systemLog.count({ where: { tableName: `TEST-LOG-BAD-${ts}` } })) === 0,
    );

    // -------------------------------------------------------------------------
    // 4) SystemLogService.list() — cursor pagination + filtre
    //    Bu tableName'e iki ekstra DOMAIN satırı daha yaz → sayfalama test et.
    // -------------------------------------------------------------------------
    await AuditService.log({ userId: seedUser?.id, action: "UPDATE", tableName, recordId, newData: { seq: 2 } });
    await AuditService.log({ userId: seedUser?.id, action: "DELETE", tableName, recordId, newData: { seq: 3 } });
    for (const r of await prisma.systemLog.findMany({
      where: { tableName, id: { notIn: createdLogIds } },
      select: { id: true },
    })) {
      createdLogIds.push(r.id);
    }

    const page1 = await SystemLogService.list({ tableName, limit: 2 });
    check("list() success + dizi döner", page1.success === true && Array.isArray(page1.data));
    check("list() limit'e uydu (2)", page1.data.length === 2, `len=${page1.data.length}`);
    check(
      "list() yalnız filtrelenen tableName'i döndü",
      page1.data.every((d) => d.tableName === tableName),
    );
    check("list() liste view JSON payload SEÇMEZ (newData yok)", !("newData" in page1.data[0]));
    check(
      "list() hasMore=true (toplam>2) + nextCursor üretti",
      page1.pagination.hasMore === true && typeof page1.pagination.nextCursor === "string",
    );

    const page2 = await SystemLogService.list({
      tableName,
      limit: 2,
      cursor: page1.pagination.nextCursor ?? undefined,
    });
    const page1Ids = new Set(page1.data.map((d) => d.id));
    check(
      "list() 2. sayfa 1. sayfayla çakışmıyor (cursor ilerledi)",
      page2.data.length > 0 && page2.data.every((d) => !page1Ids.has(d.id)),
      `p2 len=${page2.data.length}`,
    );

    const authOnly = await SystemLogService.list({ tableName, category: "AUTH" });
    check(
      "list() category filtresi (yalnız AUTH)",
      authOnly.data.length >= 1 && authOnly.data.every((d) => d.category === "AUTH"),
    );

    // -------------------------------------------------------------------------
    // 5) SystemLogService.findById() — detay (oldData/newData) döner
    // -------------------------------------------------------------------------
    const detail = await SystemLogService.findById(domainRow!.id);
    check(
      "findById() detay döner (newData dahil)",
      detail.success === true &&
        !!detail.data &&
        (detail.data.newData as Record<string, unknown>).marker === `TEST-LOG-${ts}`,
    );
    const missing = await SystemLogService.findById("00000000-0000-0000-0000-000000000000");
    check("findById() yok → success:false", missing.success === false && missing.data === null);

    // -------------------------------------------------------------------------
    // 6) archiveOlderThan() — yıkıcı; SADECE kendi TEST- kaydımızda dene.
    //    Bir TEST satırını cutoff'tan eskiye it (createdAt geriye); arşivleme
    //    onu system_logs'tan system_log_archives'a taşımalı (aynı id).
    // -------------------------------------------------------------------------
    const archiveTarget = await prisma.systemLog.create({
      data: {
        userId: seedUser?.id ?? null,
        category: "DOMAIN",
        action: "CREATE",
        tableName: `TEST-LOG-ARCH-${ts}`,
        recordId,
        newData: { archive: true },
        // 13 ay önce → monthsToKeep=6 cutoff'unun gerisinde kalsın
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 13),
      },
      select: { id: true },
    });
    let archivedId = archiveTarget.id;

    const result = await AuditService.archiveOlderThan(6);
    const inArchive = await prisma.systemLogArchive.findUnique({ where: { id: archivedId } });
    const stillActive = await prisma.systemLog.findUnique({ where: { id: archivedId } });
    check(
      "archiveOlderThan() eski kaydı arşive taşıdı (aynı id)",
      !!inArchive && stillActive === null,
      `archived=${result.archived}`,
    );
    // arşive geçtiyse cleanup arşivden yapılacak
    if (inArchive) {
      await prisma.systemLogArchive.delete({ where: { id: archivedId } }).catch(() => {});
      archivedId = "";
    }
    // taşınmadıysa (başka eski kayıt batch'i doldurduysa) aktif tablodan temizle
    if (archivedId) createdLogIds.push(archivedId);
  } finally {
    // Kendi yarattığımız her DOMAIN/AUTH satırını temizle (tableName prefix bazlı)
    await prisma.systemLog
      .deleteMany({ where: { tableName: { startsWith: `TEST-LOG-${ts}` } } })
      .catch(() => {});
    await prisma.systemLog
      .deleteMany({ where: { tableName: `TEST-LOG-ARCH-${ts}` } })
      .catch(() => {});
    await prisma.systemLog
      .deleteMany({ where: { tableName: `TEST-LOG-BAD-${ts}` } })
      .catch(() => {});
    if (createdLogIds.length) {
      await prisma.systemLog
        .deleteMany({ where: { id: { in: createdLogIds } } })
        .catch(() => {});
    }
    // Arşive sızmış olabilecek TEST kaydı (arşivleme alt akışı başka batch aldıysa)
    await prisma.systemLogArchive
      .deleteMany({ where: { tableName: { startsWith: `TEST-LOG` }, recordId } })
      .catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
