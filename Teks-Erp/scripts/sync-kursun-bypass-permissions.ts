// Kurşun bypass — kullanıcı ATAMALARI + ön koşul teşhisi.
//
// Çalıştırma:  npx tsx scripts/sync-kursun-bypass-permissions.ts
//
// ⚠️ KAPSAM DEĞİŞTİ (2026-08-01): izin KATALOĞU artık bu script'e BAĞLI DEĞİL —
// `20260801020000_kursun_bypass_permission_catalog` migration'ı iki izni ve
// "Mobil — Kurşun Dağıtım" şablonunu idempotent olarak getiriyor. Yani
// `prisma migrate deploy` koştuysa katalog ZATEN yerindedir.
//
// Bu script'in kalan işi ORTAMA ÖZGÜ olan kısım: izinleri `admin` kullanıcısına
// bağlamak (diğer kullanıcılara panelden verilir) ve dağıtımın çalışması için
// gereken VERİ ön koşullarını (istasyon yeteneği + makineler + bayrak) teşhis
// etmek. Katalog upsert'leri emniyet ağı olarak DURUYOR — migration'dan önce
// koşulursa da script anlamlı çalışsın diye; ikisi de idempotent.
//
// Emsal: sync-quick-wo-permission.ts. Tekrar tekrar koşulabilir — hepsi upsert.
//
// Script yalnız İZİN tarafını kurar. Bypass'ın ikinci ön koşulu olan FİZİKSEL
// kurşun MAKİNELERİ fabrikaya özgü veridir (kaç makine, hangi ad) → burada
// YARATILMAZ, yalnız TEŞHİS edilir.
//
// ⚠️ ATAMA MAKİNE BAZINDADIR (`KursunBypassAssignment.machineId`). Fabrikada
// PROCESS_QC türünde TEK istasyon vardır (KURSUN_KK2) ve altında N adet fiziksel
// kurşun MAKİNESİ (`Machine`) durur — dağıtımcının seçtiği şey o makinelerden
// biridir. Bu yüzden teşhis iki katmanı BİRLİKTE basar:
//   • İSTASYON: `KURSUN` yeteneği burada durur (`StationProperty`) — makinede
//     yetenek alanı YOKTUR. Yetenek eksikse `assign` "seçilen makinenin
//     istasyonu kurşun uygulayamıyor" 400'ü döner ve sebebi ekranda anlaşılmaz.
//   • MAKİNE: dağıtım ekranının seçim listesi tam olarak
//     `Machine WHERE isActive AND station.kind = PROCESS_QC` sorgusudur.
//     Makine yoksa liste BOŞ gelir ve hiçbir iş dağıtılamaz.
import prisma, { pool } from "../src/lib/prisma";
import { StationKind } from "@prisma/client";

const PERMISSIONS = [
  {
    code: "workorder:distribute",
    module: "PRODUCTION",
    category: "web",
    description:
      "Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama",
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
  "Kurşun dağıtım ekranı (iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)";
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

  // İstasyon + yetenek + O İSTASYONA BAĞLI AKTİF MAKİNELER tek sorguda. Makine
  // listesi `listDistribution`'ın seçim listesiyle BİREBİR aynı filtreyi kullanır
  // (isActive + station.kind=PROCESS_QC) — rapor ile ekran ayrışmasın.
  const stations = await prisma.station.findMany({
    where: { kind: StationKind.PROCESS_QC, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      propertyCapabilities: { select: { property: { select: { code: true } } } },
      machines: {
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });

  // Rapor satırlarını önce çöz — özet uyarılar aynı kümeden okunur.
  const rows = stations.map((s) => ({
    ...s,
    hasKursun: s.propertyCapabilities.some((c) => c.property.code === "KURSUN"),
  }));
  const withoutKursun = rows.filter((s) => !s.hasKursun);
  const withoutMachine = rows.filter((s) => s.machines.length === 0);
  // Dağıtım ekranında GERÇEKTEN seçilebilir (seçilince 400 almayan) makine sayısı.
  const usableMachineCount = rows
    .filter((s) => s.hasKursun)
    .reduce((n, s) => n + s.machines.length, 0);
  const listedMachineCount = rows.reduce((n, s) => n + s.machines.length, 0);

  if (rows.length === 0) {
    console.warn(
      "⚠️  AKTİF PROCESS_QC (Kurşun + KK2) istasyonu YOK. Dağıtım ekranının makine\n" +
        "    listesi boş gelir ve hiçbir iş emri dağıtılamaz. Panel → Tanımlar →\n" +
        "    İstasyonlar'dan TEK bir Kurşun + KK2 istasyonu açın (fiziksel makine\n" +
        "    başına ayrı istasyon AÇMAYIN — makineler bu istasyonun ALTINA tanımlanır).",
    );
  } else {
    console.log(`ℹ️  ${rows.length} aktif Kurşun + KK2 (PROCESS_QC) istasyonu bulundu:`);
    for (const s of rows) {
      console.log(
        `\n   ${s.hasKursun ? "✅" : "❌"} ${s.code} — ${s.name}` +
          `   [KURSUN yeteneği: ${s.hasKursun ? "VAR" : "YOK"}]`,
      );
      if (s.machines.length === 0) {
        console.warn(
          "      ⚠️  Bu istasyona AKTİF MAKİNE tanımlı DEĞİL → dağıtım ekranında\n" +
            "          seçilecek makine çıkmaz. Panel → Tanımlar → Makineler'den her\n" +
            "          fiziksel kurşun makinesi için bir kayıt açın (kod otomatik üretilir,\n" +
            "          ad sahadaki makine etiketiyle aynı olsun: \"Kurşun 1\", \"Kurşun 2\"…).",
        );
      } else {
        console.log(`      makineler (${s.machines.length} aktif):`);
        for (const m of s.machines) {
          console.log(`        • ${m.code} — ${m.name}`);
        }
      }
    }
  }

  // Fabrika gerçeği TEK PROCESS_QC istasyonudur. Birden fazlası, bu notun ESKİ
  // (yanlış) nüshasındaki "her fiziksel makine için bir İSTASYON aç" talimatının
  // izlenmiş olabileceğine işarettir → operatörü doğru düzeltmeye yönlendir.
  if (rows.length > 1) {
    console.warn(
      `\n⚠️  ${rows.length} adet aktif PROCESS_QC istasyonu var — beklenen TEK istasyon.\n` +
        "    Deploy notunun eski nüshası \"her fiziksel kurşun makinesi için ayrı\n" +
        "    İSTASYON açın\" diyordu; yanlıştı. Doğrusu: tek Kurşun + KK2 istasyonu +\n" +
        "    altında makine başına bir MAKİNE kaydı. Fazlalık istasyonlar rota adım\n" +
        "    seçicisini kirletir (planlamacı rotaya makine gömer) ve KURSUN yeteneği\n" +
        "    N kez tanımlanmak zorunda kalır. Fazlalıkları SİLMEYİN (rota/geçmiş FK'ları\n" +
        "    RESTRICT) — panelden isActive = false yapın, makineleri kalan tek\n" +
        "    istasyonun altına taşıyın.",
    );
  }

  if (withoutKursun.length) {
    console.warn(
      `\n⚠️  ${withoutKursun.length} istasyonda KURSUN yeteneği eksik: ` +
        `${withoutKursun.map((s) => s.code).join(", ")}\n` +
        "    Yetenek İSTASYONDA durur (makinede böyle bir alan yoktur) ve bypass\n" +
        "    kapanışında topa KURŞUN özelliğini o yetenek yazar. Eksikken bu\n" +
        "    istasyonun makineleri listede GÖRÜNÜR ama seçilince 400 döner\n" +
        "    (\"seçilen makinenin istasyonu kurşun uygulayamıyor\"). Panel →\n" +
        "    İstasyonlar → ilgili istasyon → Özellikler'den KURSUN'u işaretleyin.",
    );
  }
  if (rows.length > 0 && withoutMachine.length === rows.length) {
    console.warn(
      "\n⚠️  HİÇBİR Kurşun + KK2 istasyonunda aktif makine yok → dağıtım ekranı\n" +
        "    makine listesi BOŞ gelir. Makineler fabrikaya özgü veridir (kaç adet,\n" +
        "    hangi ad) — bu script onları YARATMAZ, panelden tanımlanır.",
    );
  }
  console.log(
    `\nℹ️  Dağıtım listesine düşecek makine: ${listedMachineCount} · ` +
      `bunlardan atama YAPILABİLİR olan: ${usableMachineCount}`,
  );

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
