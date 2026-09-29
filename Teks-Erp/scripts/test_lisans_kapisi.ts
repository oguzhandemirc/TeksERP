// =============================================================================
// BEKÇİ — LİSANS KAPISI (`licenseGate` + `constants/license-routes.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_kapisi   (kendi _test DB'si; §9 geçici
// kullanıcı açar ve teardown'da siler — audit bellekte yutulur, defter satırı yazılmaz)
//
// NE ÖLÇER (rota envanteri `scripts/lib/rota-envanteri.ts` ile, gerçek Express ağacı):
//   §1 envanter tam (çözülemeyen mount 0) · §2 sınıflayıcı listelerden BAĞIMSIZ yeniden
//   hesapla birebir (listede olmayan açık yol yok) · §3 ölü desen yok; KISITLI ek listesi
//   yalnız yazma; bilerek kapalı yollar gerçekten kapalı · §4 K5 ⊂ K4 · §5 "verilerimi al"
//   yolları var ve HER kademede açık · §6 export/excel/pdf/print/backup adlı yazma rotası
//   açıkça sınıflı · §7 eşleştirici Express'le aynı (harf duyarsız, boş segment yok, HEAD=GET)
//   · §8 ⭐ gözlemde SIFIR FARK (K5 hesaplanır; her uç kapıdan eşzamanlı geçer, yanıta
//   dokunulmaz, "reddederdim" sayılır) · §9 ⭐ zorlamada kimliksize yalnız LICENSE_GATE
//   (kademe sızmaz), oturumluya kademe kodu; motor hazır değilse fail-open.
//
// NEGATİF SONDA — dosya DIŞI mutasyon, cp + shasum ile birebir geri alındı (sonuçlar commit
// mesajında): N1 `isOpenInTier`e "yolda export geçerse aç" kaçağı · N2 K5 listesine sipariş
// yazması · N3 reissue açık listeye · N4 kimliksize kademe ayrıntısı · N5 gözlemde uygulanan
// yerine hesaplanan kademe · N6 ölü desen (olmayan yol) listeye.
// =============================================================================
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { rotaEnvanteri, ornekYol } from "./lib/rota-envanteri";
import {
  ALWAYS_OPEN_ROUTES,
  DATA_EXPORT_PATHS,
  DECLARED_CLOSED_ROUTES,
  RESTRICTED_OPEN_ROUTES,
  SUSPENDED_OPEN_ROUTES,
  isOpenInTier,
  routePatternMatches,
  ruleMatches,
  type LicenseRouteRule,
} from "../src/constants/license-routes";
import { STATE_TIERS, type StateTier } from "../src/lib/license/protocol";
import { peekObservationCounters, resetObservationCounters } from "../src/lib/license/runtime";
import { licenseGate } from "../src/middlewares/license.middleware";
import { lisansHazirDegil, lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { kapidanGecir, type Uc } from "./lib/lisans-kapi-surucu";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const SAFE = new Set(["GET", "HEAD"]);
const envanter = rotaEnvanteri(app);
const uclar: Uc[] = envanter.routes
  .filter((r) => r.path.startsWith("/api/"))
  .flatMap((r) => r.methods.map((m) => ({ m, desen: r.path, ornek: ornekYol(r.path) })));
const yazmalar = uclar.filter((u) => !SAFE.has(u.m));
const eslesir = (rules: readonly LicenseRouteRule[], u: Uc): boolean => rules.some((r) => ruleMatches(r, u.m, u.ornek));

function envanterVeSiniflama(): void {
  console.log("\n§1–§2 — envanter ve sınıflayıcı");
  check("§1a her mount önekinin karşılığı çözüldü (çözülemeyen = yanlış yol = varsayılan RED)", envanter.cozulemeyen === 0, `${envanter.cozulemeyen}`);
  check("§1b körlük zemini: ≥ 800 uç, ≥ 400 yazma", uclar.length >= 800 && yazmalar.length >= 400, `${uclar.length}/${yazmalar.length}`);
  const ayrisan: string[] = [];
  for (const u of uclar) {
    const kisitli = SAFE.has(u.m) || eslesir(ALWAYS_OPEN_ROUTES, u) || eslesir(RESTRICTED_OPEN_ROUTES, u);
    const durdurulmus = eslesir(ALWAYS_OPEN_ROUTES, u) || eslesir(SUSPENDED_OPEN_ROUTES, u);
    if (kisitli !== isOpenInTier("KISITLI", u.m, u.ornek)) ayrisan.push(`KISITLI ${u.m} ${u.desen}`);
    if (durdurulmus !== isOpenInTier("DURDURULMUS", u.m, u.ornek)) ayrisan.push(`DURDURULMUS ${u.m} ${u.desen}`);
    for (const t of ["NORMAL", "UYARI", "EK_SURE"] as const) {
      if (!isOpenInTier(t, u.m, u.ornek)) ayrisan.push(`${t} ${u.m} ${u.desen}`);
    }
  }
  check("§2a ⭐ sınıflayıcı = listelerden bağımsız hesap (beyansız açık yol yok)", ayrisan.length === 0, ayrisan.slice(0, 5).join(" | "));
  const acikYazma = yazmalar.filter((u) => isOpenInTier("KISITLI", u.m, u.ornek)).length;
  check("§2b KISITLI'da yazmaların çoğu KAPALI (varsayılan RED)", acikYazma > 0 && acikYazma < yazmalar.length / 4, `${acikYazma}/${yazmalar.length} açık`);
  check("§2c tanınmayan kademe fail-closed", !isOpenInTier("BILINMEYEN" as StateTier, "GET", "/api/orders"));
}

function oluDesenler(): void {
  console.log("\n§3 — ölü desen ve bilerek kapalı yollar");
  const listeler: Array<[string, readonly LicenseRouteRule[]]> = [
    ["her-kademe", ALWAYS_OPEN_ROUTES],
    ["KISITLI ek", RESTRICTED_OPEN_ROUTES],
    ["DURDURULMUŞ ek", SUSPENDED_OPEN_ROUTES],
    ["bilerek kapalı", DECLARED_CLOSED_ROUTES],
  ];
  for (const [ad, liste] of listeler) {
    const olu = liste.filter((r) => !uclar.some((u) => ruleMatches(r, u.m, u.ornek)));
    check(`§3a ⭐ ${ad}: her desen gerçek bir uca uyar (ölü desen yok)`, olu.length === 0, olu.map((r) => `${r.method} ${r.path}`).join(" | "));
    check(`§3b ${ad}: her satırın gerekçesi var`, liste.every((r) => r.reason.trim().length >= 8));
  }
  const okumaKural = RESTRICTED_OPEN_ROUTES.filter((r) => r.method === "GET" || r.method === "*");
  check("§3c KISITLI ek listesi yalnız YAZMA taşır (okuma zaten serbest)", okumaKural.length === 0, okumaKural.map((r) => r.path).join(" | "));
  const acikKapali = uclar.filter(
    (u) => eslesir(DECLARED_CLOSED_ROUTES, u) && (isOpenInTier("KISITLI", u.m, u.ornek) || isOpenInTier("DURDURULMUS", u.m, u.ornek)),
  );
  check("§3d bilerek kapalı yollar KISITLI ve DURDURULMUŞ'ta kapalı (reissue = yeni iş)", acikKapali.length === 0, acikKapali.map((u) => u.desen).join(" | "));
}

function kapsamaVeDisariAktarim(): void {
  console.log("\n§4–§6 — K5 ⊂ K4 · verilerimi al · adı yanıltıcı yazmalar");
  const ihlal = uclar.filter((u) => isOpenInTier("DURDURULMUS", u.m, u.ornek) && !isOpenInTier("KISITLI", u.m, u.ornek));
  check("§4a ⭐ K5 ⊂ K4 (DURDURULMUŞ'ta açık her uç KISITLI'da da açık)", ihlal.length === 0, ihlal.map((u) => `${u.m} ${u.desen}`).join(" | "));
  const herKademe = uclar.filter((u) => eslesir(ALWAYS_OPEN_ROUTES, u));
  const kapaliHer = herKademe.filter((u) => STATE_TIERS.some((t) => !isOpenInTier(t, u.m, u.ornek)));
  check("§4b her-kademe listesi gerçekten her kademede açık", herKademe.length >= 10 && kapaliHer.length === 0, `${herKademe.length} uç`);
  for (const [ad, spec] of Object.entries(DATA_EXPORT_PATHS)) {
    const [m, yol] = spec.split(" ");
    const desen = yol.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
    const var_ = uclar.some((u) => u.m === m && routePatternMatches(desen, u.ornek));
    const acik = STATE_TIERS.every((t) => isOpenInTier(t, m, ornekYol(desen)));
    check(`§5 ⭐ verilerimi al '${ad}' (${spec}) gerçek uç ve HER kademede açık`, var_ && acik, `var=${var_} açık=${acik}`);
  }
  const ADLI = /export|excel|pdf|print|backup|yedek/i;
  const adli = yazmalar.filter((u) => ADLI.test(u.desen));
  const tumListe = [...ALWAYS_OPEN_ROUTES, ...RESTRICTED_OPEN_ROUTES, ...SUSPENDED_OPEN_ROUTES, ...DECLARED_CLOSED_ROUTES];
  const sinifsiz = adli.filter((u) => !eslesir(tumListe, u));
  check("§6 ⭐ export/excel/pdf/print/backup adlı her YAZMA rotası açıkça sınıflı", adli.length >= 5 && sinifsiz.length === 0, `${adli.length} uç; sınıfsız: ${sinifsiz.map((u) => `${u.m} ${u.desen}`).join(" | ")}`);
}

function eslestirici(): void {
  console.log("\n§7 — eşleştirici Express'le aynı");
  check("§7a sabit segment harf duyarsız", routePatternMatches("/api/admin/backup", "/API/Admin/backup"));
  check("§7b parametre boş segmenti eşlemez", !routePatternMatches("/api/x/:id/y", "/api/x//y"));
  check("§7c çift eğik çizgi birleştirilmez (kaçak yol yok)", !routePatternMatches("/api/admin/backup", "/api//admin/backup"));
  check("§7d sondaki eğik çizgi eşdeğer", routePatternMatches("/api/work-sessions", "/api/work-sessions/"));
  check("§7e `*` 0+ segment", routePatternMatches("/api/license/*", "/api/license") && routePatternMatches("/api/license/*", "/api/license/a/b"));
  check("§7f fazla segment eşleşmez", !routePatternMatches("/api/admin/backup", "/api/admin/backup/x"));
  check("§7g HEAD, GET kuralına uyar; POST uymaz", ruleMatches(ALWAYS_OPEN_ROUTES[1], "HEAD", "/api/admin/health") && !ruleMatches(ALWAYS_OPEN_ROUTES[1], "POST", "/api/admin/health"));
}

function gozlemSifirFark(): Promise<void> {
  console.log("\n§8 — gözlem kipinde sıfır fark (K5 hesaplanır, uygulanmaz)");
  const { snap } = lisansKipKur({ zorlama: false, kademe: "K5" });
  check("§8a zemin: hesaplanan DURDURULMUŞ, uygulanan NORMAL", snap.state.hesaplananKademe === "DURDURULMUS" && snap.state.uygulananKademe === "NORMAL");
  resetObservationCounters();
  const beklenenSayac = uclar.filter((u) => !isOpenInTier("DURDURULMUS", u.m, u.ornek)).length;
  const dokunulan: string[] = [];
  return Promise.all(uclar.map((u) => kapidanGecir(licenseGate, u, null))).then((sonuclar) => {
    sonuclar.forEach((s, i) => {
      if (!s.esZamanli || s.hata !== undefined || s.yanitaDokunuldu) dokunulan.push(`${uclar[i].m} ${uclar[i].desen}`);
    });
    check("§8b ⭐ her uç kapıdan EŞZAMANLI ve hatasız geçer, yanıta dokunulmaz", dokunulan.length === 0, dokunulan.slice(0, 5).join(" | "));
    const sayac = peekObservationCounters().reddedilecekIstek;
    check("§8c 'reddederdim' sayacı = K5'te kapalı uç sayısı", sayac === beklenenSayac && sayac > 400, `${sayac}/${beklenenSayac}`);
  });
}

type Kod = string | undefined;
async function kodu(u: Uc, token: string | null): Promise<{ kod: Kod; ayrinti: Record<string, unknown> | null }> {
  const s = await kapidanGecir(licenseGate, u, token);
  const d = (s.hata as { details?: Record<string, unknown> } | undefined)?.details ?? null;
  return { kod: d?.code as Kod, ayrinti: d };
}
const uc = (m: string, yol: string): Uc => ({ m, desen: yol, ornek: yol });

async function zorlama(token: string): Promise<void> {
  console.log("\n§9 — zorlamada kimlik ve kademe");
  lisansKipKur({ zorlama: true, kademe: "K4" });
  const anonim = await kodu(uc("POST", "/api/orders"), null);
  check("§9a ⭐ kimliksiz yazma → yalnız LICENSE_GATE (kademe/gün sızmaz)", anonim.kod === "LICENSE_GATE" && Object.keys(anonim.ayrinti ?? {}).join() === "code", JSON.stringify(anonim.ayrinti));
  const bozuk = await kodu(uc("POST", "/api/orders"), "bozuk.token.degeri");
  check("§9b geçersiz token = kimliksiz → LICENSE_GATE", bozuk.kod === "LICENSE_GATE");
  const k4 = await kodu(uc("POST", "/api/orders"), token);
  check("§9c oturumlu yazma → LICENSE_RESTRICTED + kademe", k4.kod === "LICENSE_RESTRICTED" && k4.ayrinti?.kademe === "KISITLI", JSON.stringify(k4.ayrinti));
  check("§9d KISITLI: okuma açık", (await kodu(uc("GET", "/api/orders"), token)).kod === undefined);
  check("§9e KISITLI: yedek al açık", (await kodu(uc("POST", "/api/admin/backup"), token)).kod === undefined);
  check("§9f KISITLI: reissue KAPALI", (await kodu(uc("POST", "/api/printed-documents/a/b/reissue"), token)).kod === "LICENSE_RESTRICTED");
  lisansKipKur({ zorlama: true, kademe: "K5" });
  const k5 = await kodu(uc("GET", "/api/orders"), token);
  check("§9g ⭐ K5 oturumlu okuma → LICENSE_SUSPENDED", k5.kod === "LICENSE_SUSPENDED" && k5.ayrinti?.kademe === "DURDURULMUS");
  const k5a = await kodu(uc("GET", "/api/orders"), null);
  check("§9h ⭐ K5 kimliksiz → LICENSE_GATE, kademe yok", k5a.kod === "LICENSE_GATE" && k5a.ayrinti?.kademe === undefined);
  for (const [m, yol] of [["GET", "/api/admin/health"], ["GET", "/api/mobile/updates/ota/1/manifest"], ["GET", "/api/license/durum"], ["POST", "/api/auth/login"], ["GET", "/api/auth/me"], ["GET", "/api/admin/backups/a.dump/download"]]) {
    check(`§9i K5'te açık: ${m} ${yol}`, (await kodu(uc(m, yol), token)).kod === undefined);
  }
  lisansHazirDegil();
  check("§9j motor hazır değil → fail-open (lisans belirsizliği fabrikayı durdurmaz)", (await kodu(uc("POST", "/api/orders"), null)).kod === undefined);
}

async function temizlikKullanici(uid: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: uid } }).catch(() => undefined);
}

async function main(): Promise<void> {
  console.log("=== Lisans kapısı ===");
  // Audit bellekte yutulur (gerçek imzayla atanır — tip kapısı menzilde kalır).
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  envanterVeSiniflama();
  oluDesenler();
  kapsamaVeDisariAktarim();
  eslestirici();
  await gozlemSifirFark();
  const ad = `TEST-lisans-kapi-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST Lisans Kapısı" }, select: { id: true } });
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await zorlama(token);
  } finally {
    await temizlikKullanici(u.id);
    temizleLisansKipDizini();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
