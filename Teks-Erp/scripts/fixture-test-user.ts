// =============================================================================
// Paylaşılan test fixture'ı — TAM YETKİLİ TEST KULLANICISI (HTTP testleri için).
// `test_` öneki YOK → run-all-tests koşucusu bunu bir test dosyası saymaz.
// =============================================================================
//
// NEDEN VAR (2026-08-02):
// Üç HTTP testi (`test_http_api`, `test_direct_ship_api`,
// `test_quickstart_dispatch_api`) kimliği `admin` / `123123` ile gömüyordu. Bu,
// `fixture-subcontractor.ts`'in kapattığı kırılganlığın BİREBİR aynısı: seed
// kaydının yerinde VE kullanılabilir olduğu varsayımı. Varsayım çöktü — dev
// veritabanı fabrikanın canlı yedeğiyle değiştirildi, `admin` kullanıcısı orada
// FABRİKANIN şifresiyle duruyor. Üç dosya / 35 `check()` topluca sustu; gerçek
// bir RBAC regresyonu çıksa aynı kırmızıya karışır, kimse ayırt edemezdi.
// `Teks-Erp/CLAUDE.md` bu kalemi zaten "hâlâ AÇIK" diye işaretlemişti.
//
// ÇÖZÜM: test ihtiyaç duyduğu kullanıcıyı KENDİ üretir. Fabrikanın `admin`
// hesabının şifresi ne olursa olsun testler konuşmaya devam eder.
//
// ⚠️ GERÇEK `admin` HESABINA DOKUNULMAZ. Ne şifresi sıfırlanır ne yetkisi
// değişir — fabrikanın canlı hesabıdır. Fixture AYRI bir kullanıcıdır.
//
// -----------------------------------------------------------------------------
// KALICI FIXTURE — "test kendi yarattığını siler" kuralından bilinçli sapma,
// `fixture-subcontractor.ts` ile aynı üç gerekçe:
//   1) PAYLAŞILAN: üç dosya çağırıyor; her birinde yarat/sil yapmak paralel
//      koşumda birbirinin kullanıcısını silmek demek.
//   2) UCUZ: tek satır + izin pivotu; envanter/üretim verisi doğurmaz.
//   3) İZLENEBİLİR: sabit `TEST-ADMIN` adı, panelde ne olduğu açık.
// Silmek gerekirse: panelden pasife al ya da elle sil — fixture bir sonraki
// koşumda yeniden üretir.
// -----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";

/** Sabit kimlik — üç HTTP testi de bunu kullanır. */
export const TEST_ADMIN_USERNAME = "TEST-ADMIN";
export const TEST_ADMIN_PASSWORD = "TestAdmin2026!";

/**
 * Koşuma özgü parola üretir. Sabit parola HER veritabanında aynı olduğu için
 * "giriş 200" sorusunu AYNI DB'ye bağlamaz; rastgele parola yalnız bizim
 * yazdığımız DB'de geçerlidir (bkz. `lib/http-bekci-kapisi.ts`).
 */
export function kosumaOzguParola(): string {
  return `TestAdmin-${randomUUID()}!`;
}

/**
 * Tam yetkili test kullanıcısını garanti eder (idempotent).
 *
 * Her koşumda şifre HASH'İ yeniden yazılır: birisi panelden değiştirmiş olsa da
 * test sabit şifreyle girebilsin. Yetkiler `permissions` tablosunun TAMAMINDAN
 * beslenir (katalog değil DB — boot uzlaştırması katalogu zaten DB'ye yazar), bu
 * yüzden yeni bir izin eklendiğinde fixture kendiliğinden kapsar.
 *
 * `canEnterApp` şartı otomatik sağlanır: tüm izinler verildiği için en az bir
 * masaüstü (mobil-olmayan) izni vardır — yalnız `mobile:*` izinli hesap Electron
 * login'inde 403 alırdı.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NEDEN TAM KÜME, NEDEN "testin gerçekten ihtiyaç duyduğu N izin" DEĞİL?
 * (Bilinçli karar — dar liste ilk bakışta daha "dürüst" görünür, değil.)
 *
 *  1. DEĞİŞTİRDİĞİMİZ KİMLİK ZATEN TAM YETKİLİYDİ. Bu DB'de gerçek `admin`
 *     58 iznin 57'sini taşıyor (eksik olan tek kod `mobile:kk1-desen`, üç
 *     testin de uğramadığı bir mobil yetenek). Fixture'ı dar bir listeye
 *     indirmek testlerin NEYİ egzersiz ettiğini sessizce değiştirirdi — yani
 *     fixture kılığında bir kapsam daralması olurdu. Fixture göçü
 *     davranış-korumalı olmak zorunda.
 *  2. YÜZEY ZATEN GENİŞ. Üç dosya 8 modülde 12+ uç ailesine dokunuyor
 *     (items, customers, orders, quality-grades, rolls, stations,
 *     subcontractors, subcontractor-categories, work-orders, quick-start,
 *     admin/users, fason doğrudan-sevk). Elle liste ~58'in yarısı olurdu;
 *     "dar" değil, sadece bakımı zor.
 *  3. RBAC'İ ASIL DOĞRULAYAN NEGATİF YOL. Yetki kontrolü bu testlerde
 *     yetkisiz/az-yetkili kullanıcılarla ölçülür — ikisini de testler KENDİ
 *     üretir (`test_http_api` → düşük yetkili kullanıcı, `test_direct_ship_api`
 *     → `NOPERM_USERNAME`). Buradaki ayrıcalıklı token taşıyıcıdır, ölçülen
 *     özne değildir; onu daraltmak RBAC kapsamına hiçbir şey katmaz.
 *  4. ELLE LİSTE ÇÜRÜR. Teste yeni bir uç eklendiğinde kafa karıştırıcı bir
 *     403 doğar ve "düzeltme" (listeye bir kod eklemek) incelemede görünmez.
 *
 * Not: izinler somut 58 satır olarak bağlanır; `admin:*` wildcard'ının
 * genişletilmesine GÜVENİLMEZ (wildcard satırı da kümede olduğu için kullanıcı
 * her iki yolla da yetkilidir).
 * ───────────────────────────────────────────────────────────────────────────
 */
export async function ensureTestAdmin(opts?: {
  /** Verilirse bu koşumun parolası olur; verilmezse sabit `TEST_ADMIN_PASSWORD`. */
  password?: string;
}): Promise<{ id: string; username: string; password: string }> {
  const password = opts?.password ?? TEST_ADMIN_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { username: TEST_ADMIN_USERNAME },
    // Var olan kaydı KULLANILABİLİR hâle getir: pasife alınmış ya da kalıcı-silme
    // işaretli olabilir (fixture-subcontractor'ın öğrettiği ders — "kayıt var"
    // ile "kayıt kullanılabilir" aynı şey değil).
    update: { passwordHash, isActive: true, deletedAt: null },
    create: {
      username: TEST_ADMIN_USERNAME,
      passwordHash,
      fullName: "Test Yöneticisi (fixture)",
      isActive: true,
    },
    select: { id: true },
  });

  const permissions = await prisma.permission.findMany({ select: { id: true } });
  if (permissions.length === 0) {
    throw new Error(
      "fixture-test-user: `permissions` tablosu BOŞ — izin kataloğu uzlaştırması bu DB'de hiç koşmamış. " +
        "Backend'i bir kez ayağa kaldır (server.ts boot'ta katalogu yazar) ya da seed'i koş.",
    );
  }

  await prisma.userPermission.createMany({
    data: permissions.map((p) => ({
      userId: user.id,
      permissionId: p.id,
      grantedById: user.id,
    })),
    skipDuplicates: true,
  });

  // Yetki kümesi değişmiş olabilir → eski JWT'ler düşsün (verifyToken sürüm
  // karşılaştırması). Test her koşumda taze token aldığı için zararsız.
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });

  // `id` de döner: bazı testler/smoke'lar bu kullanıcıyı yalnız login için değil
  // "işlemi yapan kişi" FK'sı olarak da kullanır (ör. `Roll.createdById`).
  // Döndürmezsek çağıran taraf `admin` satırını aramaya geri döner — kurtulmaya
  // çalıştığımız seed bağımlılığının ta kendisi.
  return { id: user.id, username: TEST_ADMIN_USERNAME, password };
}
