// =============================================================================
// BEKÇİ — PIN/kart okuma ucu: İKİ İZİN + İZ (BULGU-T1-013)
// Çalıştır: npx tsx scripts/test_user_credentials_guard.ts
// =============================================================================
// `GET /api/admin/users/:id/credentials` bir kullanıcının 6 haneli hızlı PIN'ini
// ve QR kart kodunu DÜZ döner. `login-quick-pin` PIN'i TEK BAŞINA kimlik saydığı
// için (kullanıcı adı sorulmaz) bu uç, okuyan kişiye hedefin kimliğine bürünme
// yolu açar: sonraki her sevk stornosu / fire / izin değişikliği `system_logs`a
// HEDEFİN adıyla yazılır.
//
// İki kusur vardı, ikisi de kapatıldı:
//   ① EŞİK: tek `admin:users` yetiyordu. Aynı sırları taşıyan yedek indirme ucu
//      zaten `admin:settings` + `admin:users` zinciri istiyordu — eşik burada da
//      aynı olmalı. (Ölçüldü: sahada `admin:users` taşıyan DÖRT aktif hesabın
//      dördünde de `admin:settings` var → kimse dışarıda kalmıyor.)
//   ② İZ: okuma hiçbir yere yazılmıyordu. "Kim kimin PIN'ini gördü" sorusu
//      sistemde CEVAPSIZDI — asıl kusur budur.
//
// ⚠️ BU BEKÇİ "PIN'i hiç gösterme" DEMİYOR. Panelin PIN'i ve kart QR'ını sürekli
// göstermesi bir SAHA KARARIDIR (ucun kendi açıklaması bunu yazıyor); denetimin
// "yalnız üretildiği anda göster" önerisi o kararı daraltır ve ayrı bir karardır.
// Burada ölçülen şey yalnız EŞİK ve İZ.
// =============================================================================
import { AddressInfo } from "net";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAMGA = `TST-CRED-${Date.now().toString().slice(-8)}`;
const SIFRE = "test123456";
const olusan: string[] = [];

async function kullaniciYap(ad: string, izinKodlari: string[]): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: ad,
      fullName: `${DAMGA} ${ad}`,
      passwordHash: await AuthService.hashPassword(SIFRE),
      isActive: true,
    },
    select: { id: true },
  });
  olusan.push(u.id);
  const izinler = await prisma.permission.findMany({
    where: { code: { in: izinKodlari } },
    select: { id: true, code: true },
  });
  if (izinler.length !== izinKodlari.length) {
    throw new Error(`izin bulunamadı: ${izinKodlari.filter((c) => !izinler.some((p) => p.code === c)).join(",")}`);
  }
  await prisma.userPermission.createMany({
    data: izinler.map((p) => ({ userId: u.id, permissionId: p.id })),
  });
  return u.id;
}

async function main(): Promise<void> {
  // ⭐ DAR izinli aktör: `admin:users` VAR, `admin:settings` YOK → eskiden geçerdi.
  const darId = await kullaniciYap(`${DAMGA}-dar`, ["admin:users"]);
  const genisId = await kullaniciYap(`${DAMGA}-genis`, ["admin:users", "admin:settings"]);
  // Hedef: PIN'i olan bir kullanıcı (okunacak sır gerçekten var olsun).
  const hedefId = await kullaniciYap(`${DAMGA}-hedef`, ["mobile:kk1"]);
  await AuthService.setQuickPin(hedefId, {}, genisId);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const login = async (ad: string): Promise<string | null> => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: ad, password: SIFRE, clientType: "electron" }),
      });
      const j = (await r.json()) as { data?: { token?: string } };
      return j.data?.token ?? null;
    };
    const oku = async (token: string): Promise<{ status: number; body: string }> => {
      const r = await fetch(`${base}/api/admin/users/${hedefId}/credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.text() };
    };

    const darTok = await login(`${DAMGA}-dar`);
    const genisTok = await login(`${DAMGA}-genis`);
    // KÖRLÜK ZEMİNİ: giriş yapılamadıysa aşağıdaki 403 "koruma çalıştı" DEĞİL
    // "istek hiç kurulamadı" demektir ve kontrol yanlış sebeple yeşile döner.
    check("§0: dar izinli kullanıcı giriş yapabildi (körlük zemini)", darTok != null);
    check("§0: geniş izinli kullanıcı giriş yapabildi (körlük zemini)", genisTok != null);
    if (!darTok || !genisTok) throw new Error("login başarısız — testler koşamaz");

    // ═══ §1 — EŞİK ═══
    const dar = await oku(darTok);
    check(
      "§1: `admin:users` VAR ama `admin:settings` YOK → 403",
      dar.status === 403,
      `HTTP ${dar.status}`,
    );
    const genis = await oku(genisTok);
    check("§1: her iki izin de VAR → 200 (davranış korunur)", genis.status === 200, `HTTP ${genis.status}`);
    check(
      "§1: yanıt gerçekten sır taşıyor (kontrol boş bir uçta koşmuyor)",
      /quickPin|cardToken|TEKSU/i.test(genis.body),
      genis.body.slice(0, 60),
    );

    // ═══ §2 — İZ ═══
    const iz = await prisma.systemLog.findFirst({
      where: { action: "USER_CREDENTIAL_READ", userId: genisId },
      orderBy: { createdAt: "desc" },
      select: { userId: true, newData: true },
    });
    check("§2: başarılı okuma audit'e düştü", iz != null, iz ? "kayıt var" : "KAYIT YOK");
    check(
      "§2: iz AKTÖRÜ ve HEDEFİ birlikte taşıyor",
      iz?.userId === genisId &&
        JSON.stringify(iz?.newData ?? {}).includes(hedefId),
      `aktör=${iz?.userId === genisId ? "✓" : "✗"} hedef=${JSON.stringify(iz?.newData ?? {}).includes(hedefId) ? "✓" : "✗"}`,
    );
    // ⚠️ REDDEDİLEN okuma iz BIRAKMAZ (ve bırakmamalı): 403 zaten rbac katmanında
    // durur, uç gövdesine hiç girilmez. Bu kontrol o sözleşmeyi kilitler —
    // aksi hâlde "iz var" iddiası 403'lerden de beslenip anlamını yitirirdi.
    const redIz = await prisma.systemLog.count({
      where: { action: "USER_CREDENTIAL_READ", userId: darId },
    });
    check("§2: REDDEDİLEN okuma iz bırakmaz", redIz === 0, `${redIz} satır`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.systemLog
      .deleteMany({ where: { userId: { in: olusan } } })
      .catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: olusan } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: olusan } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: olusan } } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
