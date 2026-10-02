// =============================================================================
// BEKÇİ — LİSANS KAPISI (`licenseGate` + `constants/license-routes.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_kapisi   (kendi _test DB'si; §9/§11 geçici
// kullanıcı açar ve teardown'da siler — audit bellekte yutulur, defter satırı yazılmaz; §11/§13
// kapının kendi süreci içinde 127.0.0.1'de geçici dinleyici açar)
//
// NE ÖLÇER (rota envanteri `scripts/lib/rota-envanteri.ts` ile, gerçek Express ağacı):
//   §1 envanter tam (çözülemeyen mount 0) · §2 sınıflayıcı listelerden BAĞIMSIZ yeniden
//   hesapla birebir (listede olmayan açık yol yok) · §3 ölü desen yok; KISITLI ek listesi
//   yalnız yazma; bilerek kapalı yollar gerçekten kapalı; güvenlik eylemleri (pasifleştir ·
//   2FA sıfırla · bulut hesabını kilitle) K4'te açık, K5'te kapalı · §4 K5 ⊂ K4 · §5 "verilerimi al"
//   yolları var ve HER kademede açık · §5b donanım değişikliği bildirimi (K8) gerçek uç ve HER kademede
//   açık (§9i: K5'te oturumla kapıdan geçer) · §6 export/excel/pdf/print/backup adlı yazma rotası
//   açıkça sınıflı · §7 eşleştirici Express'le aynı (harf duyarsız, boş segment yok, HEAD=GET)
//   · §8 ⭐ gözlemde SIFIR FARK (K5 hesaplanır; her uç kapıdan eşzamanlı geçer, yanıta
//   dokunulmaz, "reddederdim" sayılır) · §9 ⭐ zorlamada KİMLİK ÖNCE: oturumsuz / bozuk /
//   süresi dolmuş / oturumu olmayan token kapıdan ROTAYA geçer, geçerli oturuma kademe kodu,
//   kimlik istemeyen kapalı uçta yalnız LICENSE_GATE; motor hazır değilse fail-open ·
//   §10 ⭐ `PUBLIC_ROUTES` envanterin kimliksiz uçlarıyla İKİ YÖNLÜ birebir; LICENSE_GATE kararı
//   ölçülür (kademede kapalı kimliksiz uç var mı) · §11 ⭐ HTTP: rotanın 401'i kapının 403'ünden
//   önce, kimliksize ayrıntı yok; etkinleştirme kodu taşıyan istek uçlarının POST biçimi var ·
//   §12 ⭐ panelin K5 kilit ekranının GERÇEK çağrıları (Electron kaynağından statik çıkarım,
//   `lib/lisans-k5-panel-cagrilari.ts`) ⊆ DURDURULMUŞ'ta açık; bellek içi sonda çıkarımın kör
//   olmadığını ölçer · §13 ⭐ erişim günlüğü sır parametresinin değerini maskeler (birim + gerçek
//   istek + `combined` biçimi).
//
// NEGATİF SONDA — dosya DIŞI mutasyon, cp + shasum ile birebir geri alındı (sonuçlar commit
// mesajında): N1 `isOpenInTier`e "yolda export geçerse aç" kaçağı · N2 K5 listesine sipariş
// yazması · N3 reissue açık listeye · N4 kimliksize kademe ayrıntısı · N5 gözlemde uygulanan
// yerine hesaplanan kademe · N6 ölü desen (olmayan yol) listeye · (2026-09-29 F1b) D1 kapı
// oturumsuza yeniden 403 · D2 `PUBLIC_ROUTES`tan bir satır düşer · D3 K5 listesinden `auth/me`
// düşer · D4 morgan `url` jetonu maskesiz · D5 imzası geçerli ama oturumsuz token'a kademe · (L2-10) N10 donanım
// bildirimi rotası yok → §5b. (L2-7 B) N11 çevrimdışı istek rotasının amaç listesinden `donanim` düşer → §11g.
// =============================================================================
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import { rotaEnvanteri, ornekYol } from "./lib/rota-envanteri";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import {
  ALWAYS_OPEN_ROUTES,
  DATA_EXPORT_PATHS,
  DECLARED_CLOSED_ROUTES,
  PUBLIC_ROUTES,
  RESTRICTED_OPEN_ROUTES,
  SUSPENDED_OPEN_ROUTES,
  isOpenInTier,
  isPublicRoute,
  routePatternMatches,
  ruleMatches,
  type LicenseRouteRule,
} from "../src/constants/license-routes";
import { REDACTED_VALUE, redactSecretQueryParams } from "../src/utils/url-redaction";
import { ELECTRON_SRC, K5_TOHUMLARI, k5PanelCagrilari } from "./lib/lisans-k5-panel-cagrilari";
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
  // §3e GÜVENLİK EYLEMLERİ: işten çıkanı kapatmak / sızan hesabı kilitlemek kısıtlı kipte de
  // yapılabilmeli (K4 AÇIK); DURDURULMUŞ kip yalnız "verilerimi al"dır (K5 KAPALI).
  const GUVENLIK = [
    "POST /api/admin/users/:id/deactivate",
    "POST /api/admin/users/:id/totp/reset",
    "POST /api/patron-bulut/hesap/:id/kilitle",
  ];
  for (const spec of GUVENLIK) {
    const [m, desen] = spec.split(" ");
    const var_ = uclar.some((u) => u.m === m && routePatternMatches(desen, u.ornek));
    const k4 = isOpenInTier("KISITLI", m, ornekYol(desen));
    const k5 = isOpenInTier("DURDURULMUS", m, ornekYol(desen));
    check(`§3e ⭐ güvenlik eylemi ${spec}: gerçek uç · KISITLI'da AÇIK · DURDURULMUŞ'ta KAPALI`, var_ && k4 && !k5, `var=${var_} K4=${k4} K5=${k5}`);
  }
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
  // K8: donanım değişikliği bildirimi kurtarma yoludur — kısıtlı kurulum donanımını bildirip lisansını onarabilmeli.
  const donanim = uclar.some((u) => u.m === "POST" && u.desen === "/api/license/donanim-bildir");
  const donanimKapali = STATE_TIERS.filter((t) => !isOpenInTier(t, "POST", "/api/license/donanim-bildir"));
  check("§5b ⭐ donanım değişikliği bildirimi (POST /api/license/donanim-bildir) gerçek uç ve HER kademede açık", donanim && donanimKapali.length === 0, `var=${donanim} kapalı=${donanimKapali.join(",") || "yok"}`);
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
interface KapiKarari {
  /** Kapı isteği rotaya geçirdi mi (hatasız `next()`). */
  readonly rotaya: boolean;
  readonly kod: Kod;
  readonly ayrinti: Record<string, unknown> | null;
}
async function kodu(u: Uc, token: string | null): Promise<KapiKarari> {
  const s = await kapidanGecir(licenseGate, u, token);
  const d = (s.hata as { details?: Record<string, unknown> } | undefined)?.details ?? null;
  return { rotaya: s.hata === undefined, kod: d?.code as Kod, ayrinti: d };
}
const uc = (m: string, yol: string): Uc => ({ m, desen: yol, ornek: yol });

/** Sahte token'lar: imzası geçerli ama süresi dolmuş · imzası geçerli ama oturum kaydı yok. */
function sahteTokenlar(gecerli: string): { suresiDolmus: string; oturumsuz: string } {
  const yuk = jwt.decode(gecerli) as Record<string, unknown>;
  const sir = process.env.JWT_SECRET ?? "";
  const { exp: _exp, iat: _iat, ...govde } = yuk;
  const simdi = Math.floor(Date.now() / 1000);
  return {
    suresiDolmus: jwt.sign({ ...govde, iat: simdi - 7200, exp: simdi - 60 }, sir, { algorithm: "HS256" }),
    oturumsuz: jwt.sign({ ...govde, jti: randomUUID() }, sir, { algorithm: "HS256", expiresIn: 600 }),
  };
}

async function zorlama(token: string): Promise<void> {
  console.log("\n§9 — zorlamada kimlik ÖNCE, kademe sonra");
  const sahte = sahteTokenlar(token);
  lisansKipKur({ zorlama: true, kademe: "K4" });
  const siparis = uc("POST", "/api/orders");
  for (const [ad, t] of [["başlıksız", null], ["bozuk token", "bozuk.token.degeri"], ["süresi dolmuş token", sahte.suresiDolmus], ["imzası geçerli ama oturumu olmayan token", sahte.oturumsuz]] as const) {
    const k = await kodu(siparis, t);
    check(`§9a ⭐ ${ad} + kapalı yol → kapı ROTAYA geçirir (401 rotanın; kademe sızmaz)`, k.rotaya && k.ayrinti === null, JSON.stringify(k.ayrinti));
  }
  const k4 = await kodu(siparis, token);
  check("§9c oturumlu yazma → LICENSE_RESTRICTED + kademe", k4.kod === "LICENSE_RESTRICTED" && k4.ayrinti?.kademe === "KISITLI", JSON.stringify(k4.ayrinti));
  check("§9d KISITLI: okuma açık", (await kodu(uc("GET", "/api/orders"), token)).rotaya);
  check("§9e KISITLI: yedek al açık", (await kodu(uc("POST", "/api/admin/backup"), token)).rotaya);
  check("§9f KISITLI: reissue KAPALI", (await kodu(uc("POST", "/api/printed-documents/a/b/reissue"), token)).kod === "LICENSE_RESTRICTED");
  check("§9f2 KISITLI: iki adımlı doğrulama kurulum penceresi AÇIK (sıfırlanan kullanıcı yeniden kurar)", (await kodu(uc("POST", "/api/admin/users/x1/totp/window"), token)).rotaya);
  check("§9f3 KISITLI: kimliksiz cihaz duyurusu açık (ek listede)", (await kodu(uc("POST", "/api/devices/announce"), null)).rotaya);
  lisansKipKur({ zorlama: true, kademe: "K5" });
  const k5 = await kodu(uc("GET", "/api/orders"), token);
  check("§9g ⭐ K5 oturumlu okuma → LICENSE_SUSPENDED", k5.kod === "LICENSE_SUSPENDED" && k5.ayrinti?.kademe === "DURDURULMUS");
  const k5a = await kodu(uc("GET", "/api/orders"), null);
  check("§9h ⭐ K5 kimliksiz, kimlik isteyen uç → ROTAYA (401), kademe yok", k5a.rotaya && k5a.ayrinti === null);
  for (const [m, yol] of [["POST", "/api/devices/announce"], ["GET", "/api/devices/status"]] as const) {
    const g = await kodu(uc(m, yol), null);
    check(`§9h2 ⭐ K5 kimliksiz, kimlik İSTEMEYEN kapalı uç (${m} ${yol}) → yalnız LICENSE_GATE`, g.kod === "LICENSE_GATE" && Object.keys(g.ayrinti ?? {}).join() === "code", JSON.stringify(g.ayrinti));
  }
  const g2 = await kodu(uc("GET", "/api/devices/status"), token);
  check("§9h3 kimlik istemeyen uca OTURUMLU çağrı → kademe kodu (kimlik doğrulandı)", g2.kod === "LICENSE_SUSPENDED");
  for (const [m, yol] of [["GET", "/api/admin/health"], ["GET", "/api/mobile/updates/ota/1/manifest"], ["GET", "/api/license/durum"], ["POST", "/api/license/donanim-bildir"], ["POST", "/api/auth/login"], ["GET", "/api/auth/me"], ["GET", "/api/admin/backups/a.dump/download"]]) {
    check(`§9i K5'te açık: ${m} ${yol}`, (await kodu(uc(m, yol), token)).rotaya);
  }
  for (const m of ["GET", "POST"] as const) {
    check(`§9i2 ⭐ K5'te iki adımlı doğrulama kurulumu açık, kimliksiz (${m} /api/auth/totp/enroll — giriş akışı, yönetici kararı)`, (await kodu(uc(m, "/api/auth/totp/enroll"), null)).rotaya);
  }
  lisansHazirDegil();
  check("§9j motor hazır değil → fail-open (lisans belirsizliği fabrikayı durdurmaz)", (await kodu(uc("POST", "/api/orders"), null)).rotaya);
  await anahtarOkunamazKapi(token);
}

/** G12 §3.1-1 (Z9): kurulum anahtarı okunamazsa YALNIZ imza durur — kapı kararı DB izindeki açık anahtarla sürer. */
async function anahtarOkunamazKapi(token: string): Promise<void> {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    console.log("⏭️  §9k atlandı (Windows ya da root: izin kilidi ölçülemez)");
    return;
  }
  const { snap } = lisansKipKur({ zorlama: true, kademe: "K4", anahtarOkunamaz: true });
  const k = await kodu(uc("POST", "/api/orders"), token);
  check(
    "§9k ⭐ anahtar okunamaz (imzaHazir=false, durumHazir=true) + K4 → kapı kararı SÜRER: LICENSE_RESTRICTED (eskiden fail-open)",
    !snap.imzaHazir && snap.durumHazir && k.kod === "LICENSE_RESTRICTED",
    `imza=${snap.imzaHazir} durum=${snap.durumHazir} ${JSON.stringify(k.ayrinti)}`,
  );
  check("§9k2 aynı durumda okuma ve yedek AÇIK (veri erişimi her kademede)", (await kodu(uc("GET", "/api/orders"), token)).rotaya && (await kodu(uc("POST", "/api/admin/backup"), token)).rotaya);
}

function kimliksizUclar(): void {
  console.log("\n§10 — kimlik istemeyen uç listesi ↔ envanter (iki yönlü) · LICENSE_GATE kararı");
  const kimliksiz = envanter.routes
    .filter((r) => r.path.startsWith("/api/") && !r.hasAuth)
    .flatMap((r) => r.methods.map((m) => ({ m, desen: r.path, ornek: ornekYol(r.path) })));
  const kimlikli = uclar.filter((u) => !kimliksiz.some((k) => k.m === u.m && k.desen === u.desen));
  const eksik = kimliksiz.filter((u) => !isPublicRoute(u.m, u.ornek));
  check("§10a ⭐ envanterdeki HER kimliksiz uç `PUBLIC_ROUTES`ta (eksik satır = oturumsuz istek kapıyı rotaya geçerek atlar)", kimliksiz.length >= 10 && eksik.length === 0, `${kimliksiz.length} uç; eksik: ${eksik.map((u) => `${u.m} ${u.desen}`).join(" | ")}`);
  const olu = PUBLIC_ROUTES.filter((r) => !kimliksiz.some((u) => ruleMatches(r, u.m, u.ornek)));
  check("§10b ölü satır yok (her satır gerçek bir kimliksiz uca uyar)", olu.length === 0, olu.map((r) => `${r.method} ${r.path}`).join(" | "));
  const tasan = kimlikli.filter((u) => isPublicRoute(u.m, u.ornek));
  check("§10c satır kimlik İSTEYEN uca taşmaz (orada oturumsuz istek 401 almalı)", tasan.length === 0, tasan.map((u) => `${u.m} ${u.desen}`).join(" | "));
  check("§10d her satırın gerekçesi var", PUBLIC_ROUTES.every((r) => r.reason.trim().length >= 8));
  const gerekli = STATE_TIERS.flatMap((t) => kimliksiz.filter((u) => !isOpenInTier(t, u.m, u.ornek)).map((u) => `${t} ${u.m} ${u.desen}`));
  check("§10e ⭐ KARAR: LICENSE_GATE yalnız kademede KAPALI kimliksiz uç için yaşar — böyle uç VAR (kod ölü değil)", gerekli.length > 0, gerekli.join(" | "));
}

interface HttpYanit {
  readonly status: number;
  readonly json: { details?: Record<string, unknown> } | null;
}
function istek(port: number, yontem: string, yol: string, token: string | null, govde?: unknown): Promise<HttpYanit> {
  const veri = govde === undefined ? undefined : JSON.stringify(govde);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
        path: yol,
        method: yontem,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(veri ? { "content-type": "application/json", "content-length": Buffer.byteLength(veri) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c: Buffer) => (b += c.toString("utf8")));
        res.on("end", () => {
          let json: HttpYanit["json"] = null;
          try {
            json = JSON.parse(b) as HttpYanit["json"];
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    r.on("error", reject);
    if (veri) r.write(veri);
    r.end();
  });
}

/**
 * L2-7 B: donanım bildirimi zarfla da gider — K5'te bile `license:manage` sahibi istek oluşturabilmeli: gövde doğrulamasından
 * geçer (400 değil), kapıda düşmez (403 değil). Ölçülen kapı ve şemadır; cevap deponun hâline göre zarf (200) ya da 409.
 */
async function donanimZarfiK5(port: number): Promise<void> {
  const izin = await prisma.permission.findUnique({ where: { code: "license:manage" }, select: { id: true } });
  if (!izin) {
    check("§11g license:manage izni katalogda (DB'de) var", false);
    return;
  }
  const ad = `TEST-lisans-yonetici-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST Lisans Yöneticisi" }, select: { id: true } });
  try {
    await prisma.userPermission.create({ data: { userId: u.id, permissionId: izin.id } });
    const { token } = await AuthService.login(ad, "Deneme-12345");
    for (const yol of ["/api/license/cevrimdisi-istek", "/api/license/aktarma-istegi"]) {
      const d = await istek(port, "POST", yol, token, { amac: "donanim", gerekce: "disk değişti" });
      const kod = String(d.json?.details?.code ?? "");
      check(`§11g ⭐ K5 POST ${yol} amac=donanim (license:manage): gövde doğrulamasından geçer (400 değil), kapıda düşmez (403 değil)`, d.status !== 400 && d.status !== 403, `${d.status} ${kod}`);
    }
  } finally {
    await temizlikKullanici(u.id);
  }
}

async function httpAyagi(port: number, token: string): Promise<void> {
  console.log("\n§11 — HTTP: kimlik önce (rotanın 401'i), kademe sonra (kapının 403'ü)");
  const sahte = sahteTokenlar(token);
  lisansKipKur({ zorlama: true, kademe: "K4" });
  for (const [ad, t] of [["başlıksız", null], ["bozuk token", "bozuk.token.degeri"], ["süresi dolmuş", sahte.suresiDolmus], ["oturumu olmayan", sahte.oturumsuz]] as const) {
    const y = await istek(port, "POST", "/api/orders", t, {});
    check(`§11a ⭐ K4 ${ad} POST /api/orders → 401 (403 değil), lisans kodu yok`, y.status === 401 && !String(y.json?.details?.code ?? "").startsWith("LICENSE"), `${y.status} ${JSON.stringify(y.json?.details ?? null)}`);
  }
  const k4 = await istek(port, "POST", "/api/orders", token, {});
  check("§11b ⭐ K4 geçerli oturum → 403 LICENSE_RESTRICTED + kademe", k4.status === 403 && k4.json?.details?.code === "LICENSE_RESTRICTED" && k4.json.details.kademe === "KISITLI", `${k4.status} ${JSON.stringify(k4.json?.details ?? null)}`);
  lisansKipKur({ zorlama: true, kademe: "K5" });
  const anon = await istek(port, "GET", "/api/orders", null);
  check("§11c ⭐ K5 kimliksiz okuma → 401", anon.status === 401, `${anon.status}`);
  const duyuru = await istek(port, "POST", "/api/devices/announce", null, {});
  check("§11d ⭐ K5 kimliksiz, kimlik istemeyen uç → 403 LICENSE_GATE, ayrıntı yalnız {code}", duyuru.status === 403 && duyuru.json?.details?.code === "LICENSE_GATE" && Object.keys(duyuru.json.details).join() === "code", `${duyuru.status} ${JSON.stringify(duyuru.json?.details ?? null)}`);
  const k5 = await istek(port, "GET", "/api/orders", token);
  check("§11e K5 geçerli oturum → 403 LICENSE_SUSPENDED", k5.status === 403 && k5.json?.details?.code === "LICENSE_SUSPENDED", `${k5.status}`);
  for (const yol of ["/api/license/cevrimdisi-istek", "/api/license/aktarma-istegi"]) {
    const post = uclar.some((u) => u.m === "POST" && u.desen === yol);
    const get = uclar.some((u) => u.m === "GET" && u.desen === yol);
    const y = await istek(port, "POST", yol, null, { amac: "etkinlestir", kod: "TKS-0000-0000-0000-0000" });
    check(`§11f ⭐ etkinleştirme kodu gövdeyle: POST ${yol} var (GET geçiş için duruyor), kimlik ister`, post && get && y.status === 401, `post=${post} get=${get} kimliksiz=${y.status}`);
  }
  await donanimZarfiK5(port);
  lisansHazirDegil();
}

function k5PanelUzlasmasi(): void {
  console.log("\n§12 — panelin K5 'verilerimi al' sayfası çağrıları ⊆ DURDURULMUŞ'ta açık (F3: oturum-dışı router)");
  const r = k5PanelCagrilari();
  const kapali = (c: { method: string; path: string }): boolean => !isOpenInTier("DURDURULMUS", c.method, c.path.replace(/\{[^}]*\}/g, "x1"));
  check("§12a tohumlar canlı (ölü beyan yok)", r.oluTohum.length === 0, r.oluTohum.join(" | "));
  check("§12b ÖLÇÜLEMEDİ yok (çözülemeyen URL · tanınmayan HTTP istemcisi)", r.olculemedi.length === 0, r.olculemedi.join(" | "));
  const TABAN = ["GET /api/auth/me", "POST /api/auth/logout", "GET /api/license/durum", "POST /api/license/yokla", "GET /api/license/veri-disari", "POST /api/admin/backup", "GET /api/admin/backups/{x}/download", "GET /api/import/entities", "GET /api/import/{x}/export"];
  const bulunan = new Set(r.cagrilar.map((c) => `${c.method} ${c.path}`));
  const eksikTaban = TABAN.filter((t) => !bulunan.has(t));
  check("§12c körlük zemini: bilinen K5 çağrılarının hepsi çıkarıldı", eksikTaban.length === 0, `${r.cagrilar.length} çağrı · ${r.ziyaretEdilenDosya} dosya; eksik: ${eksikTaban.join(" | ")}`);
  const ihlal = r.cagrilar.filter(kapali);
  check("§12d ⭐ K5 kilit ekranının her çağrısı DURDURULMUŞ'ta açık", ihlal.length === 0, ihlal.map((c) => `${c.method} ${c.path} (${c.kaynak})`).join(" | "));
  // Bellek içi sonda: panele kapalı bir yazma eklenince çıkarım onu GÖRMELİ ve §12d kırmızıya dönmeli.
  const panel = path.join(ELECTRON_SRC, "components", "license", "DataExportPanel.tsx");
  const sonda = k5PanelCagrilari((abs) => {
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(abs)) return null;
    const metin = fs.readFileSync(abs, "utf8");
    return abs === panel ? metin.replace("const startBackup = () =>", 'const sonda = () => apiClient.post("/api/orders", {});\n  const startBackup = () =>') : metin;
  });
  const sondaIhlal = sonda.cagrilar.filter(kapali).map((c) => `${c.method} ${c.path}`);
  check("§12e ⭐ sonda: kilit paneline eklenen kapalı çağrı (POST /api/orders) yakalanır", sondaIhlal.join() === "POST /api/orders", sondaIhlal.join(" | "));
  check("§12f tohum beyanları gerekçeli", Object.values(K5_TOHUMLARI).every((v) => v.trim().length >= 8));
}

async function gunlukMaskesi(port: number): Promise<void> {
  console.log("\n§13 — erişim günlüğü sır parametresinin değerini maskeler");
  const birim: Array<[string, string]> = [
    ["/api/license/cevrimdisi-istek?amac=etkinlestir&kod=TKS-GIZLI-1234", `/api/license/cevrimdisi-istek?amac=etkinlestir&kod=${REDACTED_VALUE}`],
    ["/api/auth/totp/enroll?token=abc-123", `/api/auth/totp/enroll?token=${REDACTED_VALUE}`],
    ["/x?KOD=a&Kod=b&%6Bod=c&kod%5B%5D=d", `/x?KOD=${REDACTED_VALUE}&Kod=${REDACTED_VALUE}&%6Bod=${REDACTED_VALUE}&kod%5B%5D=${REDACTED_VALUE}`],
    ["/x?code=istasyon1&amac=yokla#kod=z", "/x?code=istasyon1&amac=yokla#kod=z"],
    ["/api/orders", "/api/orders"],
  ];
  const yanlis = birim.filter(([g, b]) => redactSecretQueryParams(g) !== b);
  check("§13a birim: ad kalır, değer maskelenir (harf/yüzde kodu/dizi biçimi); sır olmayan parametre ve sorgusuz yol aynen", yanlis.length === 0, yanlis.map(([g]) => `${g} → ${redactSecretQueryParams(g)}`).join(" | "));

  const yazilan: string[] = [];
  const asil = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (parca: unknown, ...geri: unknown[]): boolean => {
    yazilan.push(String(parca));
    return (asil as (...a: unknown[]) => boolean)(parca, ...geri);
  };
  try {
    await istek(port, "GET", "/api/license/cevrimdisi-istek?amac=etkinlestir&kod=TKS-GIZLI-1234", null);
    await istek(port, "GET", "/api/auth/totp/enroll?token=00000000-0000-4000-8000-00000000abcd", null);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    (process.stdout as { write: unknown }).write = asil;
  }
  const satirlar = yazilan.join("").split("\n").filter((l) => l.includes("/api/license/cevrimdisi-istek") || l.includes("/api/auth/totp/enroll"));
  const sizan = satirlar.filter((l) => l.includes("GIZLI") || l.includes("abcd"));
  check("§13b ⭐ gerçek istek: uygulamanın erişim günlüğü satırı kodu/token'ı taşımaz", satirlar.length === 2 && sizan.length === 0 && satirlar.every((l) => l.includes(REDACTED_VALUE)), satirlar.join(" ¶ "));

  const combined: string[] = [];
  const mini = express();
  mini.use(morgan("combined", { stream: { write: (l: string) => void combined.push(l) } }));
  mini.get("/iz", (_q, r) => void r.status(204).end());
  const s2 = http.createServer(mini);
  await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
  try {
    const p2 = (s2.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: p2, path: "/iz?kod=TKS-GIZLI-9", method: "GET", headers: { referer: "http://panel/#/x?token=gizli-ref" } }, (res) => {
        res.resume();
        res.on("end", () => resolve());
      });
      r.on("error", reject);
      r.end();
    });
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await new Promise<void>((r) => s2.close(() => r()));
  }
  const cs = combined.join("");
  check("§13c ⭐ `combined` biçimi de (url + referrer jetonu) maskeli", cs.includes(`/iz?kod=${REDACTED_VALUE}`) && cs.includes(`#/x?token=${REDACTED_VALUE}`) && !cs.includes("GIZLI") && !cs.includes("gizli-ref"), cs.trim());
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
  kimliksizUclar();
  k5PanelUzlasmasi();
  const ad = `TEST-lisans-kapi-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST Lisans Kapısı" }, select: { id: true } });
  const sunucu = http.createServer(app);
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await zorlama(token);
    const port = (sunucu.address() as { port: number }).port;
    await httpAyagi(port, token);
    await gunlukMaskesi(port);
  } finally {
    await new Promise<void>((r) => sunucu.close(() => r()));
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
