// =============================================================================
// BEKÇİ — PATRON BULUTU "KİLİTLE" (fabrika tarafı; B6, `PATRON-BULUTU-ESITLEME.md` §17)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_hesap_kilitle   (kendi _test DB'si; ~3 sn)
//
// NE ÖLÇER (gerçek servis; bulut SAHTE — süreç içi taşıyıcı, imzayı protokolün doğrulayıcısıyla denetler):
//   §1 ⭐ ön koşul yoksa (HAK'ta patron-bulut yok) 409 PATRON_BULUT_KAPALI ve SIFIR dış istek
//   §2 ⭐ uygun → tek imzalı `POST /v1/hesap-kilitle` {v, hesapId, islemKimligi, isteyen}; yanıttaki hesap
//      bellekteki listeye yansır; iz `PATRON_CLOUD_ACCOUNT_LOCKED` (kim, hangi hesap)
//   §3 bulutun kesin reddi kodu aynen taşır (SON_YONETICI 409 · BULUNAMADI 404); ağ hatası 503
//      BULUT_ULASILAMADI (istemci aynı işlem kimliğiyle tekrar dener); sözleşmesiz yanıt 502
//   (L2-7 B) imzalı istek ucun yolunu (`SYNC_PATHS`) taşır, sahte bulut yolu doğrular — S25 `cloudPost` yolu imzalamaz → §2a ❌
//   (kaynakta mutasyon, sha eşit geri alındı)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SYNC_PATHS } from "../src/cloud-sync/wire";
import type { CloudHttpRequest, CloudHttpResponse, CloudTransport } from "../src/cloud-sync/cloud-client";
import { setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { PATRON_CLOUD_ENTITLEMENT } from "../src/cloud-sync/eligibility";
import { getPatronCloudStatus, lockCloudAccount, recordCloudAccounts, __resetPatronCloudStateForTests } from "../src/services/patron-cloud.service";
import { SYSTEM_EVENT } from "../src/constants/system-events";
import { REQUEST_HEADER, verifyRequest, DAY_MS, msToIso } from "../src/lib/license/protocol";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

interface Cagri {
  readonly yol: string;
  readonly govde: Record<string, unknown>;
  readonly imzaGecerli: boolean;
}

/** Sahte bulut: imzayı doğrular, `cevap` fonksiyonunun döndürdüğünü basar. */
function sahteBulut(kurulumX: string, kurulumId: string, cevap: (govde: Record<string, unknown>) => CloudHttpResponse | "AG_HATASI") {
  const cagrilar: Cagri[] = [];
  const tasiyici: CloudTransport = async (req: CloudHttpRequest) => {
    const yol = new URL(req.url).pathname;
    const v = verifyRequest(req.headers[REQUEST_HEADER], { publicKeyX: kurulumX, body: req.body, nowMs: Date.now(), purposes: ["esitle"], installationId: kurulumId, path: yol });
    const govde = JSON.parse(req.body.toString("utf8")) as Record<string, unknown>;
    // L2-7 B: geçerli = imza tutar VE imzalı `yol` bu uç (eski, yolsuz imza da reddedilmez ama burada geçerli sayılmaz).
    cagrilar.push({ yol, govde, imzaGecerli: v.ok && v.value.yol === yol });
    const c = cevap(govde);
    if (c === "AG_HATASI") throw new Error("ECONNRESET");
    return c;
  };
  return { cagrilar, tasiyici };
}

const json = (status: number, body: unknown): CloudHttpResponse => ({ status, body: Buffer.from(JSON.stringify(body), "utf8") });
const hata = (status: number, code: string): CloudHttpResponse => json(status, { success: false, message: "ret", details: { code } });

async function kodu(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
    return { status: 200, code: "YOK" };
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 0, code: String(x.details?.code ?? "?") };
  }
}

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const hesapId = randomUUID();
  const baslangic = new Date();
  setCloudUrlForTests("https://patron-bulut.test");
  const bulutEk = { esitlemeAraligiDk: 5, patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS) };
  const tamModul = ["production.enabled", PATRON_CLOUD_ENTITLEMENT];
  try {
    console.log("\n§1 ön koşul");
    let kur = lisansKipKur({ zorlama: false, kiraEk: bulutEk });
    let b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, () => json(200, {}));
    const r1 = await kodu(lockCloudAccount({ hesapId, islemKimligi: randomUUID(), actorUserId: admin.id }, b.tasiyici));
    check("§1 ⭐ HAK'ta patron-bulut yok → 409 PATRON_BULUT_KAPALI, sıfır dış istek", r1.status === 409 && r1.code === "PATRON_BULUT_KAPALI" && b.cagrilar.length === 0, `${r1.status}/${r1.code} çağrı=${b.cagrilar.length}`);

    console.log("\n§2 uygun kurulum");
    kur = lisansKipKur({ zorlama: false, moduller: tamModul, kiraEk: bulutEk });
    recordCloudAccounts([{ id: hesapId, ad: "Ayşe Patron", eposta: "ayse@example.com", durum: "AKTIF", sonGiris: null }]);
    b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, (g) => json(200, { v: 1, hesap: { id: g.hesapId, ad: "Ayşe Patron", eposta: "ayse@example.com", durum: "KILITLI", sonGiris: null } }));
    const islem = randomUUID();
    const h = await lockCloudAccount({ hesapId, islemKimligi: islem, actorUserId: admin.id }, b.tasiyici);
    const c = b.cagrilar[0];
    check("§2a ⭐ tek imzalı istek `/v1/hesap-kilitle` (imzada ucun yolu)", b.cagrilar.length === 1 && c?.yol === SYNC_PATHS.ACCOUNT_LOCK && c.imzaGecerli, b.cagrilar.map((x) => x.yol).join(","));
    check(
      "§2b gövde {v, hesapId, islemKimligi, isteyen} — başka alan yok",
      c !== undefined && c.govde.v === 1 && c.govde.hesapId === hesapId && c.govde.islemKimligi === islem && typeof c.govde.isteyen === "string" && Object.keys(c.govde).sort().join(",") === "hesapId,islemKimligi,isteyen,v",
      JSON.stringify(c?.govde),
    );
    const durum = await getPatronCloudStatus();
    check("§2c yanıt KILITLI ve bellekteki listeye yansıdı", h.durum === "KILITLI" && durum.hesaplar.find((x) => x.id === hesapId)?.durum === "KILITLI");
    await new Promise((r) => setTimeout(r, 200));
    const iz = await prisma.systemLog.findMany({ where: { action: SYSTEM_EVENT.PATRON_CLOUD_ACCOUNT_LOCKED, recordId: hesapId, createdAt: { gte: baslangic } } });
    check("§2d iz: PATRON_CLOUD_ACCOUNT_LOCKED, kim + hangi hesap", iz.length === 1 && iz[0]?.userId === admin.id, `iz=${iz.length}`);

    console.log("\n§3 ret ve belirsizlik");
    b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, () => hata(409, "SON_YONETICI"));
    const r3 = await kodu(lockCloudAccount({ hesapId, islemKimligi: randomUUID(), actorUserId: admin.id }, b.tasiyici));
    check("§3a bulut SON_YONETICI → 409 SON_YONETICI (kod aynen)", r3.status === 409 && r3.code === "SON_YONETICI", `${r3.status}/${r3.code}`);
    b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, () => hata(404, "BULUNAMADI"));
    const r4 = await kodu(lockCloudAccount({ hesapId, islemKimligi: randomUUID(), actorUserId: admin.id }, b.tasiyici));
    check("§3b bulut BULUNAMADI → 404", r4.status === 404 && r4.code === "BULUNAMADI", `${r4.status}/${r4.code}`);
    b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, () => "AG_HATASI");
    const r5 = await kodu(lockCloudAccount({ hesapId, islemKimligi: randomUUID(), actorUserId: admin.id }, b.tasiyici));
    check("§3c ağ hatası → 503 BULUT_ULASILAMADI (sonuç belirsiz, aynı kimlikle tekrar)", r5.status === 503 && r5.code === "BULUT_ULASILAMADI", `${r5.status}/${r5.code}`);
    b = sahteBulut(kur.f.kurulum.x, kur.f.kurulumId, () => json(200, { v: 1, hesap: { id: "x" } }));
    const r6 = await kodu(lockCloudAccount({ hesapId, islemKimligi: randomUUID(), actorUserId: admin.id }, b.tasiyici));
    check("§3d sözleşmesiz yanıt → 502 YANIT_GECERSIZ", r6.status === 502 && r6.code === "YANIT_GECERSIZ", `${r6.status}/${r6.code}`);
  } finally {
    await temizlik(hesapId, baslangic);
  }
}

async function temizlik(hesapId: string, baslangic: Date): Promise<void> {
  await prisma.systemLog.deleteMany({ where: { action: SYSTEM_EVENT.PATRON_CLOUD_ACCOUNT_LOCKED, recordId: hesapId, createdAt: { gte: baslangic } } });
  setCloudUrlForTests(null);
  temizleLisansKipDizini();
  __resetPatronCloudStateForTests();
}

main()
  .catch((err: Error) => {
    fail++;
    console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
