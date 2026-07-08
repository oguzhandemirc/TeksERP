// =============================================================================
// test_session_purge — ölü oturum temizliği (GERÇEK DB, TEST- verisi)
// =============================================================================
// Koşum: npx tsx scripts/test_session_purge.ts
// KRİTİK SÖZLEŞME: aktif oturum (revokedAt null + expiresAt gelecekte) ASLA
// silinemez; yalnız eşikten eski revoked/expired satırlar gider.
// NOT: purge çağrısı tablo-genelidir — dev DB'deki GERÇEK ölü satırlar da
// silinir (bu bir bakım işlemidir, veri kaybı değil; assert'ler buna toleranslı).

import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { SessionRegistryService } from "../src/services/session-registry.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

const DAY_MS = 86_400_000;
const createdJtis: string[] = [];

async function main(): Promise<void> {
  try {
    // Fixture: seed kullanıcısı business-key ile (hardcoded UUID yok).
    const admin = await prisma.user.findUnique({ where: { username: "admin" } });
    if (!admin) throw new Error("seed admin kullanıcısı yok — önce npm run seed");

    const mk = (data: { revokedAt: Date | null; expiresAt: Date }) => {
      const jti = randomUUID();
      createdJtis.push(jti);
      return prisma.session.create({
        data: {
          userId: admin.id,
          deviceType: "MOBILE",
          jti,
          deviceId: "TEST-purge",
          expiresAt: data.expiresAt,
          revokedAt: data.revokedAt,
          revokeReason: data.revokedAt ? "TEST" : null,
        },
      });
    };

    // (a) 100 gün önce iptal edilmiş, (b) 100 gün önce süresi dolmuş (iptalsiz),
    // (c) AKTİF: iptal yok + süresi yarın doluyor, (d) YENİ iptal (dün) — eşik
    // 90 gün olduğundan korunmalı (yalnız ESKİ ölüler gider).
    const past100 = new Date(Date.now() - 100 * DAY_MS);
    await mk({ revokedAt: past100, expiresAt: past100 });
    await mk({ revokedAt: null, expiresAt: past100 });
    const active = await mk({ revokedAt: null, expiresAt: new Date(Date.now() + DAY_MS) });
    const freshRevoked = await mk({
      revokedAt: new Date(Date.now() - DAY_MS),
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    const { deleted } = await SessionRegistryService.purgeDeadSessions(90);
    check("en az 2 ölü satır silindi", deleted >= 2);

    const remaining = await prisma.session.findMany({
      where: { jti: { in: createdJtis } },
      select: { jti: true },
    });
    const remainingSet = new Set(remaining.map((r) => r.jti));
    check("AKTİF oturum SİLİNMEDİ", remainingSet.has(active.jti));
    check("yeni iptal (eşikten genç) korunuyor", remainingSet.has(freshRevoked.jti));
    check("eski ölüler gitti (2 kaldı)", remaining.length === 2);

    // Eşik genç seçilirse dünkü iptal de gider; aktif yine dokunulmaz.
    // (min 7 gün — dünkü iptal 7 günlük eşikte korunur; matematik kontrolü
    // için doğrudan servis koşulunu 0 eşikle sınayamayız, Zod min'i bilinçli.)
  } finally {
    await prisma.session.deleteMany({ where: { jti: { in: createdJtis } } });
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void main();
