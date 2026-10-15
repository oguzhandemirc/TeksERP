// =============================================================================
// TEK KİMLİK → ÇOK TESİS BEKÇİSİ (kullanıcı kararı 2026-10-15), gerçek HTTP. Kimlik K: A ve B'de AKTİF, C'de KİLİTLİ
// üye; kimlik L yalnız D'de. (İkinci tesise üyelik API'si A2 diliminde; burada üyelik göç rolüyle kurulur.)
//   §1 giriş `tesisler` yalnız AKTİF üyelikleri ada göre listeler (KİLİTLİ C yok) · ipucuyla seçilen tesiste oturum ·
//      üye olunmayan/KİLİTLİ ipucu ada göre ilk tesise düşer · GET /oturum/tesisler aynı liste
//   §2 geçiş: aynı kimliğin B'sine 200 (yeni belirteç B'de, eski kapanır) · `bitis` eskiyi AŞMAZ · KİLİTLİ C'ye,
//      başka kimliğin D'sine ve uydurma tesise AYNI 403 TESIS_GECISI_YOK · A oturumu B'nin projeksiyonunu okumaz
//   §3 parola değişimi kimliğin BÜTÜN tesislerindeki öteki oturumları kapatır · `hepsi` çıkışı iki tesisi kapatır
//   §4 bilinmeyen e-posta · yanlış parola · yanlış TOTP · etkin üyeliği olmayan kimlik AYNI 401 (kod + ileti) ·
//      aynı TOTP kodu ikinci girişte (başka tesis ipucuyla da) RED (merkez adım claim'i)
// Koşum: npx tsx scripts/test_coklu_tesis.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withCentral, withTesis } from "../src/lib/tenant";
import type { FacilityChoice, LoginResponse } from "../src/wire/api";
import { TEST_PAROLASI, api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, totpKodu, type Ortam, type TestHesabi, type Yanit } from "./lib/test-ortam";

const IZINLER = ["bulut:siparis:oku"];

/** Kimliğin başka tesise üyeliği (göç rolüyle; davetle bağlama A2'de). */
async function uyeEkle(o: Ortam, tesisId: string, h: TestHesabi, status: "AKTIF" | "KILITLI"): Promise<string> {
  const kimlik = await withCentral(o.goc, {}, (tx) => tx.identity.findUniqueOrThrow({ where: { emailDigest: o.anahtar.emailDigest(h.eposta) }, select: { id: true } }));
  const hesap = await withTesis(o.goc, { tesisId }, (tx) => tx.account.create({ data: { tesisId, email: h.eposta, name: "Ortak Patron", permissions: IZINLER, status, identityId: kimlik.id } }));
  await withCentral(o.goc, {}, (tx) => tx.loginRoute.create({ data: { identityId: kimlik.id, tesisId, accountId: hesap.id } }));
  return hesap.id;
}

async function giris(o: Ortam, h: Pick<TestHesabi, "eposta" | "sir">, g: { tesisId?: string; parola?: string; totp?: string; ilerletme?: boolean } = {}): Promise<Yanit> {
  if (g.ilerletme !== false) o.saat.ilerlet(31_000);
  const govde = { eposta: h.eposta, parola: g.parola ?? TEST_PAROLASI, totp: g.totp ?? totpKodu(h.sir, o.saat.simdi()), ...(g.tesisId ? { tesisId: g.tesisId } : {}) };
  return api(o, "POST", "/api/oturum/ac", { govde });
}

const veri = (r: Yanit): LoginResponse => r.json.data as LoginResponse;
const idler = (l: readonly FacilityChoice[] | undefined): string => (l ?? []).map((t) => t.id).join(",");
const oturumTesisi = async (o: Ortam, belirtec: string): Promise<string | number> => {
  const r = await api(o, "GET", "/api/oturum", { belirtec });
  return r.status === 200 ? ((r.json.data as { tesis: { id: string } }).tesis.id ?? "") : r.status;
};

interface Kurgu {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly d: string;
  readonly k: TestHesabi;
  readonly l: TestHesabi;
  /** §3 parolayı değiştirir; sonraki bölümler yenisiyle girer. */
  parola: string;
}

async function listeVeIpucu(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§1 giriş: tesis listesi + ipucu");
  const r = await giris(o, s.k);
  const beklenen = [s.a, s.b].join(",");
  kontrol("§1a ⭐ `tesisler` yalnız AKTİF üyelikler, ada göre (Alfa, Beta) — KİLİTLİ C yok", r.status === 200 && idler(veri(r).tesisler) === beklenen, idler(veri(r).tesisler));
  kontrol("§1b ipucusuz giriş ada göre ilk tesiste (A) · hizmet alanı dolu", veri(r).tesisId === s.a && (veri(r).tesisler ?? []).every((t) => t.hizmet === "ACIK" && t.ad.length > 0));
  const ipucu = await giris(o, s.k, { tesisId: s.b });
  kontrol("§1c ⭐ ipucuyla seçilen tesiste oturum (B) · belirteç B'ye çıkar", ipucu.status === 200 && veri(ipucu).tesisId === s.b && (await oturumTesisi(o, veri(ipucu).belirtec)) === s.b);
  const kilitli = await giris(o, s.k, { tesisId: s.c });
  const yabanci = await giris(o, s.k, { tesisId: s.d });
  kontrol("§1d KİLİTLİ (C) ya da üye olunmayan (D) ipucu ilk açık tesise (A) düşer", veri(kilitli).tesisId === s.a && veri(yabanci).tesisId === s.a);
  const liste = await api(o, "GET", "/api/oturum/tesisler", { belirtec: veri(r).belirtec });
  kontrol("§1e GET /oturum/tesisler aynı liste", liste.status === 200 && idler(liste.json.data as FacilityChoice[]) === beklenen, idler(liste.json.data as FacilityChoice[]));
}

async function gecis(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§2 tesis geçişi");
  const ilk = await giris(o, s.k);
  const eski = veri(ilk).belirtec;
  o.saat.ilerlet(3_600_000);
  const g = await api(o, "POST", "/api/oturum/gecis", { belirtec: eski, govde: { tesisId: s.b } });
  const yeni = g.status === 200 ? veri(g) : null;
  kontrol("§2a ⭐ aynı kimliğin B'sine geçiş 200 · yeni belirteç B'de · liste döner", yeni?.tesisId === s.b && (await oturumTesisi(o, yeni.belirtec)) === s.b && idler(yeni.tesisler) === [s.a, s.b].join(","), `${g.status}`);
  kontrol("§2b eski oturum kapandı (401)", (await oturumTesisi(o, eski)) === 401);
  const bitisDb = await withTesis(o.goc, { tesisId: s.b }, (tx) => tx.session.findFirst({ where: { tesisId: s.b, closedAt: null }, orderBy: { createdAt: "desc" }, select: { expiresAt: true } }));
  kontrol("§2c ⭐ geçiş oturum ömrünü UZATMAZ (bitiş = ilk girişinki, 1 saat sonra geçilse de)", yeni?.bitis === veri(ilk).bitis && bitisDb?.expiresAt.toISOString() === veri(ilk).bitis, `${yeni?.bitis} / ${veri(ilk).bitis}`);
  const retler: Yanit[] = [];
  for (const hedef of [s.c, s.d, randomUUID()]) retler.push(await api(o, "POST", "/api/oturum/gecis", { belirtec: yeni?.belirtec ?? "", govde: { tesisId: hedef } }));
  const [kilitli, baska, uydurma] = retler as [Yanit, Yanit, Yanit];
  kontrol("§2d ⭐ başka kimliğin tesisine (D) geçiş 403 TESIS_GECISI_YOK", baska.status === 403 && baska.json.details?.code === "TESIS_GECISI_YOK", `${baska.status} ${baska.json.details?.code}`);
  kontrol("§2e ⭐ KİLİTLİ üyeliğe (C) geçiş 403", kilitli.status === 403 && kilitli.json.details?.code === "TESIS_GECISI_YOK", `${kilitli.status}`);
  kontrol(
    "§2f ret yanıtları ayırt edilemez (C · D · uydurma: kod + ileti aynı) · reddedilen geçiş oturumu kapatmaz",
    retler.every((r) => r.status === 403 && r.json.message === kilitli.json.message && r.json.details?.code === kilitli.json.details?.code) && (await oturumTesisi(o, yeni?.belirtec ?? "")) === s.b,
  );
  const kayit = async (tesisId: string, no: string) =>
    withTesis(o.goc, { tesisId, projections: ["siparis"] }, (tx) =>
      tx.projectionRow.create({ data: { tesisId, projection: "siparis", recordId: randomUUID(), data: { no }, versionAt: new Date(), sortAt: new Date() } }),
    );
  await kayit(s.a, "ALFA-1");
  await kayit(s.b, "BETA-1");
  const aOturum = veri(await giris(o, s.k, { tesisId: s.a })).belirtec;
  const okuma = JSON.stringify((await api(o, "GET", "/api/veri/siparis", { belirtec: aOturum })).json.data ?? null);
  kontrol("§2g ⭐ A oturumu yalnız A'nın verisini okur (B'nin satırı yok)", okuma.includes("ALFA-1") && !okuma.includes("BETA-1"), okuma.slice(0, 120));
}

async function kapanislar(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§3 parola değişimi + `hepsi` çıkışı");
  const acA = veri(await giris(o, s.k)).belirtec;
  const acB = veri(await giris(o, s.k, { tesisId: s.b })).belirtec;
  const simdiki = veri(await giris(o, s.k)).belirtec;
  o.saat.ilerlet(31_000);
  const yeniParola = "bekci-yeni-parola-coklu-2026";
  const deg = await api(o, "POST", "/api/oturum/parola", { belirtec: simdiki, govde: { mevcutParola: TEST_PAROLASI, yeniParola, totp: totpKodu(s.k.sir, o.saat.simdi()) } });
  kontrol(
    "§3a ⭐ parola değişimi kimliğin İKİ tesisindeki öteki oturumları kapatır (A ve B 401), değiştiren oturum sürer",
    deg.status === 200 && (await oturumTesisi(o, acA)) === 401 && (await oturumTesisi(o, acB)) === 401 && (await oturumTesisi(o, simdiki)) === s.a,
    `${deg.status}`,
  );
  const yeniGiris = await giris(o, s.k, { parola: yeniParola, tesisId: s.b });
  kontrol("§3b yeni parola merkez kimlikte: B'ye de girer · eski parola 401", yeniGiris.status === 200 && veri(yeniGiris).tesisId === s.b && (await giris(o, s.k)).status === 401);
  const ikinciA = veri(await giris(o, s.k, { parola: yeniParola })).belirtec;
  const cik = await api(o, "POST", "/api/oturum/kapat", { belirtec: ikinciA, govde: { hepsi: true } });
  kontrol("§3c ⭐ `hepsi` çıkışı A ve B oturumlarını kapatır", cik.status === 200 && (await oturumTesisi(o, ikinciA)) === 401 && (await oturumTesisi(o, veri(yeniGiris).belirtec)) === 401 && (await oturumTesisi(o, simdiki)) === 401);
  const tek = veri(await giris(o, s.l)).belirtec;
  const tekB = veri(await giris(o, s.k, { parola: yeniParola, tesisId: s.b })).belirtec;
  const tekCik = await api(o, "POST", "/api/oturum/kapat", { belirtec: tek, govde: {} });
  kontrol("§3d boş gövdeli (eski istemci) çıkış yalnız kendi oturumunu kapatır", tekCik.status === 200 && (await oturumTesisi(o, tek)) === 401 && (await oturumTesisi(o, tekB)) === s.b);
  s.parola = yeniParola;
}

async function ayniRet(o: Ortam, s: Kurgu, kilitsiz: TestHesabi): Promise<void> {
  console.log("\n§4 aynı 401 + merkez TOTP adımı");
  const parola = s.parola;
  const yanitlar = [
    await giris(o, { eposta: `yok-${randomUUID().slice(0, 8)}@ornek.test`, sir: s.k.sir }, { parola }),
    await giris(o, s.k, { parola: "yanlis-parola-coklu-2026" }),
    await giris(o, s.k, { parola, totp: "000000" }),
    await giris(o, kilitsiz),
  ];
  const ilk = yanitlar[0]!;
  kontrol(
    "§4a ⭐ bilinmeyen e-posta · yanlış parola · yanlış TOTP · etkin üyeliği olmayan kimlik AYNI 401 (kod + ileti)",
    yanitlar.every((r) => r.status === 401 && r.json.details?.code === "GIRIS_BASARISIZ" && r.json.message === ilk.json.message),
    yanitlar.map((r) => `${r.status}:${r.json.details?.code}`).join(" "),
  );
  o.saat.ilerlet(31_000);
  const kod = totpKodu(s.k.sir, o.saat.simdi());
  const bir = await giris(o, s.k, { parola, totp: kod, ilerletme: false });
  const iki = await giris(o, s.k, { parola, totp: kod, tesisId: s.b, ilerletme: false });
  kontrol("§4b ⭐ aynı TOTP kodu ikinci girişte (başka tesis ipucuyla) RED — adım merkezde claim'li", bir.status === 200 && iki.status === 401 && iki.json.details?.code === "GIRIS_BASARISIZ", `${bir.status}/${iki.status}`);
}

async function main(): Promise<void> {
  const o = await ortamKur({ GIRIS_HIZ_DK: "1000", GIRIS_ESIGI: "50" });
  const tesisler = [await tesisKur(o, { ad: "Bekçi Alfa" }), await tesisKur(o, { ad: "Bekçi Beta" }), await tesisKur(o, { ad: "Bekçi Gama" }), await tesisKur(o, { ad: "Bekçi Delta" })];
  const [a, b, c, d] = tesisler.map((t) => t.tesisId) as [string, string, string, string];
  try {
    const k = await hesapKur(o, a, IZINLER);
    await uyeEkle(o, b, k, "AKTIF");
    await uyeEkle(o, c, k, "KILITLI");
    const l = await hesapKur(o, d, IZINLER);
    const kilitsiz = await hesapKur(o, d, IZINLER);
    await withTesis(o.goc, { tesisId: d }, (tx) => tx.account.update({ where: { id: kilitsiz.accountId }, data: { status: "KILITLI" } }));
    const s: Kurgu = { a, b, c, d, k, l, parola: TEST_PAROLASI };
    await listeVeIpucu(o, s);
    await gecis(o, s);
    await kapanislar(o, s);
    await ayniRet(o, s, kilitsiz);
  } finally {
    for (const t of tesisler) await temizleTesis(o, t.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
