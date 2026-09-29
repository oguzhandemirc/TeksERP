// =============================================================================
// PORTAL — ROL / DİNLEYİCİ AYRIMI. Satıcı rolleri (YÖNETİCİ · OPERATÖR) YALNIZ tailnet dinleyicisinden,
// BAYI YALNIZ genel dinleyiciden girer; oturum doğduğu dinleyiciye bağlıdır (çerez adı + DB);
// uymayan hesap bilinmeyen hesap gibi davranır (aynı ileti, sayaç DEĞİŞMEZ — internetten satıcı
// hesabı kilitlenemez). İzinler tek kaynaktan (roles.ts); bayi yalnız kendi müşterisini görür.
//   §1 STATİK: rota tabloları — her rota tanımlı bir izin taşır · satıcı tablosunda BAYI izni yok ·
//      bayi tablosunda yalnız BAYI izni · her yazma işlem kimliğiyle idempotent (ya da gerekçeli muaf)
//      · yöntem+yol tekil · dinleyici rol kümeleri ayrık
//   §2–§5 ÇALIŞMA: gerçek HTTP (süreç içi iki dinleyici, kendi `_test` DB'si)
// ⭐ KALICI SONDA ✓K3 (her koşumda): (1) §1 çözümleyicisi sentetik bozuk tabloda ısırır (satıcı
//    rotasında bayi izni · kimliksiz yazma · tekrar eden yol) · (2) operatör izinli işi YAPAR (201)
//    — 403'ler kör bir kapıdan gelmiyor · (3) bayi kendi müşterisini GÖRÜR.
// Koşum: npx tsx scripts/test_portal_rol_dinleyici.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import type { PortalRouteDef } from "../src/http/portal-http";
import { DEALER_PORTAL_ROUTES } from "../src/http/dealer-routes";
import { VENDOR_PORTAL_ROUTES } from "../src/http/portal-routes";
import { LISTENER_ROLES, PORTAL_PERMISSIONS, type PortalRole } from "../src/portal/roles";
import {
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  type PortalKimlik,
} from "./lib/test-ortam";

/** §1 çözümleyicisi: bulgu listesi (boş = uyumlu). */
export function routeTableFindings(vendor: readonly PortalRouteDef[], dealer: readonly PortalRouteDef[]): string[] {
  const out: string[] = [];
  const perms = PORTAL_PERMISSIONS as Record<string, readonly PortalRole[]>;
  const check = (table: readonly PortalRouteDef[], name: string, allowed: (roles: readonly PortalRole[]) => boolean) => {
    const seen = new Set<string>();
    for (const r of table) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      if (seen.has(key)) out.push(`${name}: tekrar eden rota ${key}`);
      seen.add(key);
      const roles = perms[r.permission];
      if (!roles) out.push(`${name}: ${key} tanımsız izin ${r.permission}`);
      else if (!allowed(roles)) out.push(`${name}: ${key} izni (${r.permission}) bu dinleyicinin rollerine ait değil`);
      if (r.method !== "get" && r.kimlik !== "ISLEM_KIMLIGI" && !(typeof r.kimlik === "object" && r.kimlik.muaf.trim().length > 10)) {
        out.push(`${name}: ${key} yazma rotası işlem kimliği beyanı taşımıyor`);
      }
      if (r.method === "get" && r.kimlik !== "OKUMA") out.push(`${name}: ${key} okuma rotası OKUMA beyanı taşımıyor`);
    }
  };
  check(vendor, "satici", (roles) => roles.length > 0 && roles.every((x) => LISTENER_ROLES.TAILNET.includes(x)));
  check(dealer, "bayi", (roles) => roles.length > 0 && roles.every((x) => LISTENER_ROLES.GENEL.includes(x)));
  return out;
}

async function main(): Promise<void> {
  console.log("\n§1 rota tabloları (statik)");
  const bulgular = routeTableFindings(VENDOR_PORTAL_ROUTES, DEALER_PORTAL_ROUTES);
  kontrol("§1a tablolar dolu", VENDOR_PORTAL_ROUTES.length >= 40 && DEALER_PORTAL_ROUTES.length >= 10, `${VENDOR_PORTAL_ROUTES.length} + ${DEALER_PORTAL_ROUTES.length}`);
  kontrol("§1b her rota: tanımlı izin · dinleyicisine ait rol · yazmada işlem kimliği · tekil yol", bulgular.length === 0, bulgular.join(" | "));
  const ayrik = LISTENER_ROLES.TAILNET.every((r) => !LISTENER_ROLES.GENEL.includes(r));
  kontrol("§1c dinleyici rol kümeleri ayrık (TAILNET ∩ GENEL = ∅)", ayrik && LISTENER_ROLES.GENEL.length > 0);
  const saticiBayiIzni = VENDOR_PORTAL_ROUTES.filter((r) => (PORTAL_PERMISSIONS[r.permission] as readonly string[]).includes("BAYI"));
  kontrol("§1d satıcı tablosunda BAYI'ya açık rota yok", saticiBayiIzni.length === 0, saticiBayiIzni.map((r) => r.path).join(","));
  const bozuk: PortalRouteDef[] = [
    { method: "get", path: "/x", permission: "bayi:portal", kimlik: "OKUMA", handler: async () => ({ data: null }) },
    { method: "post", path: "/y", permission: "musteri:yaz", kimlik: { muaf: "" }, handler: async () => ({ data: null }) },
    { method: "post", path: "/y", permission: "musteri:yaz", kimlik: "ISLEM_KIMLIGI", handler: async () => ({ data: null }) },
  ];
  const sonda = routeTableFindings(bozuk, [{ method: "get", path: "/z", permission: "portal:oku", kimlik: "OKUMA", handler: async () => ({ data: null }) }]);
  kontrol(
    "§1e ✓K çözümleyici sentetik bozuklukta ısırır (satıcıda bayi izni · kimliksiz yazma · tekrar · bayide satıcı izni)",
    sonda.some((b) => b.includes("/x")) && sonda.some((b) => b.includes("işlem kimliği")) && sonda.some((b) => b.includes("tekrar")) && sonda.some((b) => b.startsWith("bayi:")),
    `${sonda.length} bulgu`,
  );

  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const kurulumlar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  const ac = async (rol: PortalKimlik["rol"], bayiId: string | null = null) => {
    const k = await portalKullaniciAc(ctx, rol, bayiId);
    kullanicilar.push(k.id);
    return k;
  };
  try {
    const yonetici = await ac("SATICI_YONETICI");
    const operator = await ac("SATICI_OPERATOR");
    const yGiris = await portalGiris(sunucu.tailnet, "/portal/api", yonetici);
    const yCerez = yGiris.cerez!;
    const bayiAc = async (ad: string) => {
      const r = await portalIstek(sunucu.tailnet, "/portal/api/bayiler", {
        cerez: yCerez,
        govde: { clientToken: randomUUID(), ad, tavan: { moduller: ["production.enabled"], siniflar: ["URETIM"], kurulumAdedi: 5 }, sebep: "bekçi bayisi" },
      });
      const id = r.veri.id as string;
      bayiler.push(id);
      return id;
    };
    const bayiA = await bayiAc("Bekçi Bayi A");
    const bayiB = await bayiAc("Bekçi Bayi B");
    const bayiKullaniciA = await ac("BAYI", bayiA);
    const bayiKullaniciB = await ac("BAYI", bayiB);

    console.log("\n§2 dinleyici ayrımı — giriş");
    const saticiGenelde = await portalGiris(sunucu.genel, "/bayi/api", operator);
    const bilinmeyen = await portalIstek(sunucu.genel, "/bayi/api/oturum/ac", { govde: { kullaniciAdi: "hic-olmayan", parola: "x".repeat(20), totp: "123456" } });
    const opSatir = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: operator.id } });
    kontrol(
      "§2a satıcı rolü GENEL dinleyiciden (doğru üçlüyle) → 401, bilinmeyen hesapla AYNI ileti",
      saticiGenelde.status === 401 && saticiGenelde.json.message === bilinmeyen.json.message && saticiGenelde.setCookie === null,
      `${saticiGenelde.status}`,
    );
    kontrol("§2b genelden satıcı denemesi hata sayacını ARTIRMAZ ve adımı TÜKETMEZ", opSatir.basarisizGiris === 0 && opSatir.totpSonAdim === null, `${opSatir.basarisizGiris}/${opSatir.totpSonAdim}`);
    const bayiTailnette = await portalGiris(sunucu.tailnet, "/portal/api", bayiKullaniciA);
    kontrol("§2c BAYI tailnet dinleyicisinden → 401", bayiTailnette.status === 401, `${bayiTailnette.status}`);
    const opGiris = await portalGiris(sunucu.tailnet, "/portal/api", operator);
    const bayiGirisA = await portalGiris(sunucu.genel, "/bayi/api", bayiKullaniciA);
    const bayiGirisB = await portalGiris(sunucu.genel, "/bayi/api", bayiKullaniciB);
    kontrol("§2d satıcı tailnet'ten, bayi genelden → 200", opGiris.status === 200 && bayiGirisA.status === 200 && bayiGirisB.status === 200);
    kontrol("§2e bayi çerezi Secure + Path=/bayi", /Secure/.test(bayiGirisA.setCookie ?? "") && /Path=\/bayi(;|$)/.test(bayiGirisA.setCookie ?? ""));

    console.log("\n§3 oturum dinleyiciye bağlı");
    const saticiBelirteci = yCerez.split("=")[1]!;
    const bayiBelirteci = bayiGirisA.cerez!.split("=")[1]!;
    const tasinanSatici = await portalIstek(sunucu.genel, "/bayi/api/ben", { cerez: `bayi_oturum=${saticiBelirteci}` });
    kontrol("§3a satıcı oturum belirteci genelde (bayi çerezi adıyla) → 401 OTURUM_YOK", tasinanSatici.status === 401 && tasinanSatici.kod === "OTURUM_YOK", `${tasinanSatici.status}`);
    const tasinanBayi = await portalIstek(sunucu.tailnet, "/portal/api/pano", { cerez: `satici_oturum=${bayiBelirteci}` });
    kontrol("§3b bayi oturum belirteci tailnet'te (satıcı çerezi adıyla) → 401", tasinanBayi.status === 401, `${tasinanBayi.status}`);
    const saticiUcuGenelde = await portalIstek(sunucu.genel, "/portal/api/pano", { cerez: yCerez });
    kontrol("§3c satıcı portal ucu genel dinleyicide YOK → 404", saticiUcuGenelde.status === 404, `${saticiUcuGenelde.status}`);
    const bayiUcuTailnette = await portalIstek(sunucu.tailnet, "/bayi/api/ben", { cerez: bayiGirisA.cerez! });
    kontrol("§3d bayi ucu tailnet dinleyicisinde YOK → 404", bayiUcuTailnette.status === 404, `${bayiUcuTailnette.status}`);

    console.log("\n§4 rol izinleri");
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const opCerez = opGiris.cerez!;
    const opK4 = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}/agir-yaptirim`, {
      cerez: opCerez,
      govde: { clientToken: randomUUID(), kademe: "K4", sebep: "deneme", onay: k.lisansNo },
    });
    kontrol("§4a operatör K4 → 403 YETKISIZ", opK4.status === 403 && opK4.kod === "YETKISIZ", `${opK4.status} ${opK4.kod}`);
    const opKullanicilar = await portalIstek(sunucu.tailnet, "/portal/api/kullanicilar", { cerez: opCerez });
    const opBayi = await portalIstek(sunucu.tailnet, "/portal/api/bayiler", { cerez: opCerez, govde: { clientToken: randomUUID(), ad: "x", tavan: { moduller: [], siniflar: ["URETIM"], kurulumAdedi: 1 }, sebep: "x" } });
    const opIptal = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}/iptal`, { cerez: opCerez, govde: { clientToken: randomUUID(), sebep: "x" } });
    const opZorla = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}/zorlama`, { cerez: opCerez, govde: { clientToken: randomUUID(), zorla: true, sebep: "x" } });
    kontrol("§4b operatör kullanıcı/bayi yönetimi · kurulum iptali · zorlama → 403", [opKullanicilar, opBayi, opIptal, opZorla].every((y) => y.status === 403), [opKullanicilar, opBayi, opIptal, opZorla].map((y) => y.status).join(","));
    const opK0 = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}/yaptirim`, {
      cerez: opCerez,
      govde: { clientToken: randomUUID(), kademe: "K0", mesaj: "Ödeme hatırlatması", sebep: "vade yaklaşıyor" },
    });
    kontrol("§4c ✓K operatör K0 (izinli) → 201", opK0.status === 201, `${opK0.status} ${opK0.kod ?? ""}`);
    const yK4 = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}/agir-yaptirim`, {
      cerez: yCerez,
      govde: { clientToken: randomUUID(), kademe: "K4", sebep: "sözleşme ihlali", onay: k.lisansNo },
    });
    const opGeriK4 = await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${yK4.veri.id as string}/geri-al`, { cerez: opCerez, govde: { clientToken: randomUUID(), sebep: "uzlaşıldı" } });
    kontrol("§4d yönetici K4 → 201; operatör onu geri ALAMAZ → 403", yK4.status === 201 && opGeriK4.status === 403, `${yK4.status}/${opGeriK4.status}`);
    const bayiSaticiIzni = await portalIstek(sunucu.genel, "/bayi/api/kurulumlar", { cerez: bayiGirisA.cerez! });
    kontrol("§4e bayi kendi alt-portalında liste okur → 200", bayiSaticiIzni.status === 200, `${bayiSaticiIzni.status}`);

    console.log("\n§5 bayi yalnız KENDİ müşterisini görür");
    const mB = await portalIstek(sunucu.genel, "/bayi/api/musteriler", { cerez: bayiGirisB.cerez!, govde: { clientToken: randomUUID(), ad: "B'nin Müşterisi" } });
    const mA = await portalIstek(sunucu.genel, "/bayi/api/musteriler", { cerez: bayiGirisA.cerez!, govde: { clientToken: randomUUID(), ad: "A'nın Müşterisi" } });
    const mBId = mB.veri.id as string;
    const mAId = mA.veri.id as string;
    const aBGoruyor = await portalIstek(sunucu.genel, `/bayi/api/musteriler/${mBId}`, { cerez: bayiGirisA.cerez! });
    kontrol("§5a A, B'nin müşterisini → 404", mB.status === 201 && aBGoruyor.status === 404, `${mB.status}/${aBGoruyor.status}`);
    const aBTesis = await portalIstek(sunucu.genel, "/bayi/api/tesisler", { cerez: bayiGirisA.cerez!, govde: { clientToken: randomUUID(), musteriId: mBId, ad: "sızma" } });
    kontrol("§5b A, B'nin müşterisine tesis açamaz → 404", aBTesis.status === 404, `${aBTesis.status}`);
    const aListe = await portalIstek(sunucu.genel, "/bayi/api/musteriler", { cerez: bayiGirisA.cerez! });
    const aIdler = ((aListe.veri.items as { id: string }[] | undefined) ?? []).map((x) => x.id);
    const aKendi = await portalIstek(sunucu.genel, `/bayi/api/musteriler/${mAId}`, { cerez: bayiGirisA.cerez! });
    kontrol("§5c ✓K A kendi müşterisini görür; listesinde B'ninki yok", aKendi.status === 200 && aIdler.includes(mAId) && !aIdler.includes(mBId), `${aKendi.status} · ${aIdler.length}`);
    const mSatici = await prisma.musteri.findUniqueOrThrow({ where: { id: mAId } });
    kontrol("§5d bayinin açtığı müşteri bayiye bağlı doğar (gövdeden bayiId alınmaz)", mSatici.bayiId === bayiA);
    const bayiGovdeBayiId = await portalIstek(sunucu.genel, "/bayi/api/musteriler", { cerez: bayiGirisA.cerez!, govde: { clientToken: randomUUID(), ad: "x", bayiId: bayiB } });
    kontrol("§5e bayi gövdesinde bayiId → 400 (KATI şema)", bayiGovdeBayiId.status === 400, `${bayiGovdeBayiId.status}`);

    console.log("\n§6 pasif bayi");
    await portalIstek(sunucu.tailnet, `/portal/api/bayiler/${bayiB}/pasif`, { cerez: yCerez, govde: { clientToken: randomUUID(), sebep: "sözleşme bitti" } });
    const pasifOturum = await portalIstek(sunucu.genel, "/bayi/api/ben", { cerez: bayiGirisB.cerez! });
    const pasifGiris = await portalGiris(sunucu.genel, "/bayi/api", bayiKullaniciB, { adimKaydir: 1 });
    kontrol("§6 bayi pasife alınınca oturumu düşer ve giriş 401", pasifOturum.status === 401 && pasifGiris.status === 401, `${pasifOturum.status}/${pasifGiris.status}`);
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
