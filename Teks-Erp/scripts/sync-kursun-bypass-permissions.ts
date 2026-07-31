// Idempotent: kurşun bypass düzeninin İKİ iznini + "Mobil — Kurşun Dağıtım"
// template'ini canlı DB'ye ekler ve admin kullanıcısına bağlar (re-seed
// gerektirmeden — seed YALNIZ ilk kurulumda koşar, canlıda asla).
//
// Çalıştırma:  npx tsx scripts/sync-kursun-bypass-permissions.ts
//
// Emsal: sync-quick-wo-permission.ts. Tekrar tekrar koşulabilir — hepsi upsert.
//
// Script yalnız İZİN tarafını kurar. Bypass'ın ikinci ön koşulu olan FİZİKSEL
// kurşun istasyonları (kind=PROCESS_QC + KURSUN yeteneği) fabrikaya özgü veridir
// (kaç makine, hangi ad) → burada YARATILMAZ, yalnız TEŞHİS edilir. Yetenek
// eksikse `assign` "istasyon KURSUN özelliğini uygulayamıyor" 400'ü döner ve
// sebebi ekranda anlaşılmaz; aşağıdaki rapor onu önden söyler.
import prisma, { pool } from "../src/lib/prisma";
import { StationKind } from "@prisma/client";

const PERMISSIONS = [
  {
    code: "workorder:distribute",
    module: "PRODUCTION",
    category: "web",
    description:
      "Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun istasyonuna atama + son-adım tamamlama",
  },
  {
    code: "mobile:kursun-dagitim",
    module: "MOBILE",
    category: "mobile",
    description: "Mobil — Kurşun Dağıtım ekranı",
  },
] as const;

const TEMPLATE_NAME = "Mobil — Kurşun Dağıtım";
const TEMPLATE_DESC =
  "Kurşun dağıtım ekranı (iş emrini fiziksel kurşun istasyonuna ata + son adımsa işi bitir)";
// seed.ts'teki template ile AYNI küme tutulmalı — web ikizi `workorder:distribute`
// bilinçli olarak YOK (mobil şablon saha kullanıcısına masaüstü yetkisi taşımasın).
const TEMPLATE_CODES = [
  "mobile:kursun-dagitim",
  "workorder:read",
  "roll:read",
  "station:read",
];

async function main() {
  // ── 1) İzinler ────────────────────────────────────────────────────────────
  const permIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: p.code },
      update: {}, // mevcut açıklamayı EZME (elle düzeltilmiş olabilir)
      create: { ...p },
    });
    permIds.set(p.code, row.id);
    console.log(`✅ izin: ${p.code}`);
  }

  // ── 2) Template ───────────────────────────────────────────────────────────
  const codeToId = new Map(
    (
      await prisma.permission.findMany({
        where: { code: { in: TEMPLATE_CODES } },
        select: { id: true, code: true },
      })
    ).map((p) => [p.code, p.id]),
  );
  const missing = TEMPLATE_CODES.filter((c) => !codeToId.has(c));
  if (missing.length) {
    console.warn(`⚠️  template'te eksik kodlar (DB'de yok): ${missing.join(", ")}`);
  }

  const existing = await prisma.permissionTemplate.findFirst({
    where: { name: TEMPLATE_NAME },
    select: { id: true },
  });
  if (!existing) {
    await prisma.permissionTemplate.create({
      data: {
        name: TEMPLATE_NAME,
        description: TEMPLATE_DESC,
        permissions: {
          create: [...codeToId.values()].map((permissionId) => ({ permissionId })),
        },
      },
    });
    console.log(`✅ template oluşturuldu: ${TEMPLATE_NAME}`);
  } else {
    // Template varsa EKSİK item'ları tamamla (mevcut atamalara dokunma).
    const have = new Set(
      (
        await prisma.permissionTemplateItem.findMany({
          where: { templateId: existing.id },
          select: { permissionId: true },
        })
      ).map((i) => i.permissionId),
    );
    const toAdd = [...codeToId.values()].filter((id) => !have.has(id));
    if (toAdd.length) {
      await prisma.permissionTemplateItem.createMany({
        data: toAdd.map((permissionId) => ({ templateId: existing.id, permissionId })),
        skipDuplicates: true,
      });
      console.log(`✅ template güncellendi: ${toAdd.length} eksik izin eklendi`);
    } else {
      console.log(`ℹ️  template zaten güncel: ${TEMPLATE_NAME}`);
    }
  }

  // ── 3) Admin'e bağla (panelden diğer kullanıcılara dağıtılır) ─────────────
  const admin = await prisma.user.findFirst({
    where: { username: "admin" },
    select: { id: true },
  });
  if (admin) {
    for (const [code, permissionId] of permIds) {
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: admin.id, permissionId } },
        update: {},
        create: { userId: admin.id, permissionId, grantedById: admin.id },
      });
      console.log(`✅ admin ← ${code}`);
    }
  } else {
    console.warn("⚠️  admin kullanıcısı bulunamadı — izinleri panelden atayın");
  }

  // ── 4) TEŞHİS: ön koşullar hazır mı? ──────────────────────────────────────
  console.log("\n── Ön koşul teşhisi ──────────────────────────────────────");

  const stations = await prisma.station.findMany({
    where: { kind: StationKind.PROCESS_QC, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      propertyCapabilities: { select: { property: { select: { code: true } } } },
    },
    orderBy: { code: "asc" },
  });

  if (stations.length === 0) {
    console.warn(
      "⚠️  AKTİF PROCESS_QC istasyonu YOK. Dağıtım ekranı istasyon listesi boş gelir\n" +
        "    ve hiçbir iş emri atanamaz. Panel → İstasyonlar'dan her fiziksel kurşun\n" +
        "    makinesi için bir istasyon açın (tür: Kurşun + Kalite Kontrol 2).",
    );
  } else {
    const withoutKursun = stations.filter(
      (s) => !s.propertyCapabilities.some((c) => c.property.code === "KURSUN"),
    );
    console.log(`ℹ️  ${stations.length} aktif kurşun istasyonu bulundu:`);
    for (const s of stations) {
      const ok = s.propertyCapabilities.some((c) => c.property.code === "KURSUN");
      console.log(`   ${ok ? "✅" : "❌"} ${s.code} — ${s.name}${ok ? "" : "  (KURSUN yeteneği YOK)"}`);
    }
    if (withoutKursun.length) {
      console.warn(
        `\n⚠️  ${withoutKursun.length} istasyonda KURSUN yeteneği eksik. Bu istasyona atama\n` +
          "    denendiğinde 400 döner ve sebebi ekranda anlaşılmaz. Panel → İstasyon\n" +
          "    Yetenekleri'nden KURSUN özelliğini işaretleyin.",
      );
    }
  }

  const flag = await prisma.systemSetting.findUnique({
    where: { key: "production.kursunBypassEnabled" },
    select: { value: true },
  });
  const flagOn = flag?.value === true;
  console.log(
    `\nℹ️  Bayrak (production.kursunBypassEnabled): ${flagOn ? "AÇIK" : "KAPALI"}` +
      (flagOn ? "" : " — Panel → Genel Ayarlar'dan açılacak"),
  );

  console.log(
    "\nSON ADIM: yetkili kullanıcı YENİDEN GİRİŞ yapmalı — JWT içindeki izin\n" +
      "listesi giriş anında donuyor, mevcut oturum yeni izni GÖRMEZ.",
  );
}

main()
  .catch((e) => {
    console.error("SYNC HATASI:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // `$disconnect()` TEK BAŞINA YETMEZ: lib/prisma havuzu idleTimeoutMillis
    // 600_000 ile kuruluyor → idle client handle'ı event loop'u 10 dk açık
    // tutar ve script "bitti ama çıkmadı" hâlinde asılı kalır (CLAUDE.md).
    // Uzun rapor bastığımız için process.exit DEĞİL (boruya yazarken stdout'u
    // kırpar) — havuzu açıkça kapatıyoruz.
    await prisma.$disconnect();
    await pool.end();
  });
