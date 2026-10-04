// =============================================================================
// BİLDİRİM GÖNDERİCİ (yan konteyner) — giden kutusunu EN AZ YETKİLİ rolle işler, sağlayıcılar SAHTE (yerel HTTP;
// gerçek Telegram/Resend çağrısı YOK).
//   §0 yapılandırma: kanal yalnız sırrı + hedefiyle açılır; eksik/biçimsiz/herkese açık/boş sır kanalı KAPALI yapar,
//      gerekçe yalnız DEĞİŞKEN ADI taşır; sağlayıcı kökü https (düz http yalnız geri döngü)
//   §1 uçtan uca: fabrikanın destek talebi → giden kutusu → Telegram (HTML, bağlantı) + Resend (Bearer · Idempotency-
//      Key = satır · alıcı/gönderen/konu); talep metni · açan · sağlık İLETİYE GİRMEZ; satır GONDERILDI + sağlayıcı kimliği
//   §2 geri çekilme ve tavan: 5xx → üstel bekleme (vadesi gelmeden alınmaz) → tavanda HATA · 429 → sağlayıcının
//      bekleme süresi · 4xx → hemen HATA · ağ kopması geçici · süper gruba taşınan sohbet kalıcı · belirteç hata kaydına girmez
//   §3 yapılandırılmamış kanal: satırı KAPALI (gönderim yok); süreç "kanal yapılandırılmamış" der (günlük + nabız)
//   §4 süresi geçen bekleyen HATA `SURESI_GECTI` (gönderilmez) · §5 kilidi dolan claim yeniden alınır, canlı claim'e dokunulmaz
//   §6 ATOMİK CLAIM: iki gönderici (süreç içi iki havuz + iki AYRI süreç) aynı satırı iki kez göndermez
//   §7 açılış kapısı: satıcının SAHİP rolüyle kalkan gönderici DURUR (fazla yetki)
// ⭐ KALICI SONDA ✓K (her koşumda): §7 kapı sahip rolde ısırır · §2b vadesi gelmemiş satır alınmaz (zamanlayıcı kör
//    değil) · §6 iki gönderici gerçekten YARIŞTI (kaçan claim > 0 ya da iki süreç de gönderdi).
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): G1 claim'de CAS yok (durum + deneme) → §6a/§6b ❌ ·
//   G2 sonuç yazımı claim'siz (`{id}`) → §5c ❌ (ilk sürümde §5 kendi sorgusunu ölçüyordu ve ISIRMADI — ürün yolundan
//   "asılı taşıyıcı" senaryosu yazıldı) · G3 üstel yok → §2c ❌ · G4 retry_after yok sayılır → §2e ❌ · G5 4xx geçici
//   → §2f/§2i/§2j ❌ · G6 kapalı kanal kapatılmaz → §3a ❌ · G7 açılış kapısı yok → §7a ❌ · G10 Idempotency-Key
//   yok → §1c/§6b ❌.
// Koşum: npx tsx scripts/test_bildirim_gonderici.ts   (yalnız *_test DB)
// =============================================================================
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { notificationBody } from "../src/notifications/catalog";
import { CLAIM_MS, runSenderCycle, type SenderDeps } from "../src/notifications/sender";
import { channelSummary, loadSenderConfig } from "../src/notifications/sender-config";
import { assertLeastPrivilege, openSenderDb, type SenderDb } from "../src/notifications/sender-db";
import { ResendTransport, TelegramTransport, type NotificationTransport, type SendOutcome } from "../src/notifications/transports";
import { gondericiRoluKur, type GondericiRolu } from "./lib/bildirim-rolu";
import { sahteSaglayici, type SahteSaglayici } from "./lib/bildirim-sahte";
import {
  ORTAM,
  SATICI_KOKU,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  yoklamaGovdesi,
} from "./lib/test-ortam";

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const TOKEN = `7000${RUN.replace(/[a-f]/g, "1")}:BEKCI_${RUN}_telegram_belirteci`;
const RESEND_KEY = `re_bekci_${RUN}_anahtar`;
const ALICI = "info@etkiliyazilim.com";
const GONDEREN = "TeksERP Bildirim <bildirim@etkiliyazilim.com>";
const PORTAL = "https://portal.test/portal";
const CHAT = "-1001234567890";
const KANARYA = `KANARYA-${RUN}`;
const T0 = Date.now();

interface Ortak {
  readonly prisma: Prisma;
  readonly tg: SahteSaglayici;
  readonly rs: SahteSaglayici;
  readonly db: SenderDb;
  readonly rol: GondericiRolu;
}

const ikisi = (o: Ortak): SenderDeps["transports"] => ({
  TELEGRAM: new TelegramTransport({ apiRoot: o.tg.kok, token: TOKEN, chatId: CHAT }),
  EPOSTA: new ResendTransport({ apiRoot: o.rs.kok, apiKey: RESEND_KEY, from: GONDEREN, to: [ALICI] }),
});
const deps = (db: SenderDb, transports: SenderDeps["transports"], maxAttempts = 3): SenderDeps => ({
  db: db.prisma,
  transports,
  settings: { maxAttempts, maxAgeHours: 72, portalBase: PORTAL, timeZone: "Europe/Istanbul" },
});

/** Tek kanal satırı (sahip rolle; gövde allowlist kurucusundan). */
async function satir(prisma: Prisma, kanal: "EPOSTA" | "TELEGRAM", referans: string) {
  return prisma.bildirim.create({
    data: { olay: "DENEME", kanal, tekillikAnahtari: `DENEME:bekci-${RUN}-${randomUUID()}`, govde: notificationBody({ portalYolu: "/bildirimler", referans }) },
  });
}

const tazele = (prisma: Prisma, id: string) => prisma.bildirim.findUniqueOrThrow({ where: { id } });

function yapilandirma(): void {
  console.log("\n§0 yapılandırma");
  const dizin = mkdtempSync(path.join(os.tmpdir(), "bildirim-sir-"));
  try {
    const temel = { DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/z_test" };
    const tam = loadSenderConfig({ ...temel, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, RESEND_API_KEY: RESEND_KEY, BILDIRIM_EPOSTA_ALICI: ALICI, BILDIRIM_EPOSTA_GONDEREN: GONDEREN });
    kontrol("§0a iki kanal sırrı + hedefiyle açılır", tam.telegram.ok && tam.email.ok && Object.values(channelSummary(tam)).every((x) => x === "hazır"));
    const eksik = loadSenderConfig({ ...temel, TELEGRAM_BOT_TOKEN: TOKEN });
    const ozet = JSON.stringify(channelSummary(eksik));
    kontrol("§0b eksik hedef/sır → kanal KAPALI, gerekçe yalnız değişken adı (sır metni YOK)", !eksik.telegram.ok && !eksik.email.ok && ozet.includes("TELEGRAM_CHAT_ID yok") && ozet.includes("RESEND_API_KEY yok") && !ozet.includes(TOKEN), ozet);
    const dosya = (ad: string, icerik: string, mod: number) => {
      const p = path.join(dizin, ad);
      writeFileSync(p, icerik);
      chmodSync(p, mod);
      return p;
    };
    const sirli = (ek: Record<string, string>) => loadSenderConfig({ ...temel, TELEGRAM_CHAT_ID: CHAT, ...ek }).telegram;
    const iyi = sirli({ TELEGRAM_BOT_TOKEN_DOSYASI: dosya("iyi", `${TOKEN}\n`, 0o440) });
    const acik = sirli({ TELEGRAM_BOT_TOKEN_DOSYASI: dosya("acik", TOKEN, 0o644) });
    const bos = sirli({ TELEGRAM_BOT_TOKEN_DOSYASI: dosya("bos", "\n", 0o400) });
    const ikili = sirli({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_TOKEN_DOSYASI: path.join(dizin, "iyi") });
    const yok = sirli({ TELEGRAM_BOT_TOKEN_DOSYASI: path.join(dizin, "olmayan") });
    const bicimsiz = sirli({ TELEGRAM_BOT_TOKEN: "12345:kisa" });
    const neden = (s: typeof iyi) => (s.ok ? "AÇIK" : s.reason);
    kontrol(
      "§0c dosyadan sır: 0440 açık · herkese okunur / boş / ortam+dosya / okunamayan / biçimsiz → KAPALI",
      iyi.ok && /herkese okunur/.test(neden(acik)) && /boş/.test(neden(bos)) && /belirsiz/.test(neden(ikili)) && /okunamadı/.test(neden(yok)) && /biçimsiz/.test(neden(bicimsiz)) && !neden(bicimsiz).includes("kisa"),
      [acik, bos, ikili, yok, bicimsiz].map(neden).join(" | "),
    );
    let httpRed = false;
    try {
      loadSenderConfig({ ...temel, TELEGRAM_API_KOKU: "http://api.telegram.org" });
    } catch {
      httpRed = true;
    }
    let aliciRed = false;
    try {
      loadSenderConfig({ ...temel, BILDIRIM_EPOSTA_ALICI: "info@etkiliyazilim" });
    } catch {
      aliciRed = true;
    }
    kontrol("§0d düz http sağlayıcı kökü (geri döngü dışı) ve biçimsiz alıcı açılışı DURDURUR", httpRed && aliciRed);
    const grupDosyasi = dosya("grup", "-4012345678\n", 0o440);
    const dosyadan = loadSenderConfig({ ...temel, TELEGRAM_BOT_TOKEN_DOSYASI: path.join(dizin, "iyi"), TELEGRAM_CHAT_ID_DOSYASI: grupDosyasi }).telegram;
    const kanalAdi = loadSenderConfig({ ...temel, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "@bekci_kanali" }).telegram;
    kontrol(
      "§0f sohbet (grup) kimliği DOSYADAN okunur (sıradan grup -<sayı>); sayı olmayan kimlik → KAPALI, değer gerekçeye girmez",
      dosyadan.ok && dosyadan.settings.chatId === "-4012345678" && !kanalAdi.ok && /TELEGRAM_CHAT_ID biçimsiz/.test(kanalAdi.reason) && !kanalAdi.reason.includes("bekci_kanali"),
      dosyadan.ok ? dosyadan.settings.chatId : dosyadan.reason,
    );
    const bosCompose = loadSenderConfig({ ...temel, TELEGRAM_CHAT_ID: "", BILDIRIM_EPOSTA_ALICI: "", BILDIRIM_EPOSTA_GONDEREN: "", BILDIRIM_PORTAL_ADRESI: "", TELEGRAM_BOT_TOKEN: TOKEN });
    kontrol("§0e compose'un boş değişkeni (`${X:-}`) verilmemiş sayılır: açılış durmaz, kanal kapalı", !bosCompose.telegram.ok && !bosCompose.email.ok && bosCompose.portalBase === null);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

async function ucdanUca(o: Ortak): Promise<string[]> {
  console.log("\n§1 uçtan uca: destek talebi → giden kutusu → sahte Telegram + Resend");
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  try {
    const anahtar = kurulumAnahtariUret();
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const e = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar, govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }) });
    kiraIdOf(e.json);
    const saglik = yoklamaGovdesi({ sonKiraId: null, parmakIzi: f.parmakIzi }).saglik;
    const govde = { v: 1, talepId: randomUUID(), konu: "Tartı <ekranı> donuyor & kilitleniyor", aciklama: `Ayrıntı ${KANARYA}-ACIKLAMA`, acan: `Ayşe ${KANARYA}-ACAN`, panelSurum: "1.3.2", ek: null, saglik, ortam: ORTAM };
    const d = await imzaliPost(sunucu.genel, ENDPOINTS.SUPPORT, { kurulumId: k.kurulumId, amac: "destek", anahtar, govde });
    const talep = await o.prisma.destekTalebi.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
    const tg0 = o.tg.istekler.length;
    const rs0 = o.rs.istekler.length;
    const t = await runSenderCycle(deps(o.db, ikisi(o)), Date.now());
    const rows = await o.prisma.bildirim.findMany({ where: { olay: "DESTEK_TALEBI", kurulumId: k.kurulumDbId } });
    kontrol("§1a iki satır GONDERILDI + sağlayıcı kimliği (Telegram message_id · Resend id)", d.status === 200 && t.sent >= 2 && rows.length === 2 && rows.every((r) => r.durum === "GONDERILDI" && !!r.saglayiciKimligi && r.gonderimZamani !== null), JSON.stringify(t));
    // Sahte sağlayıcı bu turdaki BÜTÜN bekleyenleri alır: bu talebin iletisi numarasından/satır kimliğinden seçilir.
    const eposta = rows.find((r) => r.kanal === "EPOSTA")!;
    const tgIstek = o.tg.istekler.slice(tg0).filter((i) => String(i.govde.text ?? "").includes(talep.talepNo));
    const rsIstek = o.rs.istekler.slice(rs0).filter((i) => i.basliklar["idempotency-key"] === `bildirim-${eposta.id}`);
    const tgMetin = String(tgIstek[0]?.govde.text ?? "");
    kontrol(
      "§1b Telegram: bot yolu · sohbet · HTML (kaçışlı) · başlık · konu · fabrika adı · portal bağlantısı · önizleme kapalı",
      tgIstek.length === 1 && tgIstek[0]!.yol === `/bot${TOKEN}/sendMessage` && tgIstek[0]!.govde.chat_id === CHAT && tgIstek[0]!.govde.parse_mode === "HTML" &&
        tgMetin.includes("<b>Yeni destek talebi</b>") && tgMetin.includes("Tartı &lt;ekranı&gt; donuyor &amp; kilitleniyor") && tgMetin.includes(talep.talepNo) &&
        tgMetin.includes(`href="${PORTAL}/destek/${talep.id}"`) && JSON.stringify(tgIstek[0]!.govde.link_preview_options) === '{"is_disabled":true}',
      tgMetin.slice(0, 160),
    );
    const rsG = rsIstek[0]?.govde ?? {};
    kontrol(
      "§1c Resend: Bearer anahtar · Idempotency-Key = satır · gönderen/alıcı (env) · konu · metin (konu + bağlantı)",
      rsIstek.length === 1 && rsIstek[0]!.basliklar.authorization === `Bearer ${RESEND_KEY}` && rsIstek[0]!.basliklar["idempotency-key"] === `bildirim-${eposta.id}` &&
        rsG.from === GONDEREN && JSON.stringify(rsG.to) === JSON.stringify([ALICI]) && String(rsG.subject).includes("Yeni destek talebi") &&
        String(rsG.text).includes("Tartı <ekranı> donuyor") && String(rsG.text).includes(`${PORTAL}/destek/${talep.id}`),
      String(rsG.subject),
    );
    const ham = [...tgIstek, ...rsIstek].map((i) => i.ham).join("\n");
    kontrol("§1d talep metni · açan · sağlık/ortam İLETİYE GİRMEZ (kanarya yok, sürüm/disk yok)", !ham.includes(KANARYA) && !ham.includes("diskDolulukYuzde") && !ham.includes(ORTAM.isletimSistemi), `${ham.length} bayt`);
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    ortam.temizle();
  }
  return kurulumlar;
}

async function geriCekilme(o: Ortak): Promise<void> {
  console.log("\n§2 geri çekilme · tavan · hata sınıfları");
  const yalniz = deps(o.db, { TELEGRAM: ikisi(o).TELEGRAM });
  const r = await satir(o.prisma, "TELEGRAM", `geri-${RUN}`);
  o.tg.sonraki.push({ status: 500 }, { status: 502 }, { status: 503 });
  const t = Date.now();
  await runSenderCycle(yalniz, t);
  const a1 = await tazele(o.prisma, r.id);
  kontrol("§2a 5xx → BEKLIYOR · deneme 1 · 1 dk sonra · kod TELEGRAM_HTTP_500", a1.durum === "BEKLIYOR" && a1.deneme === 1 && a1.sonHata === "TELEGRAM_HTTP_500" && Math.abs(a1.sonrakiDeneme.getTime() - (t + 60_000)) < 1_000, `${a1.durum} ${a1.deneme} ${a1.sonHata}`);
  const n = o.tg.istekler.length;
  await runSenderCycle(yalniz, t + 30_000);
  kontrol("§2b ✓K vadesi gelmemiş satır alınmaz (istek yok)", o.tg.istekler.length === n && (await tazele(o.prisma, r.id)).deneme === 1);
  await runSenderCycle(yalniz, t + 61_000);
  const a2 = await tazele(o.prisma, r.id);
  kontrol("§2c ikinci deneme → 4 dk sonra (üstel)", a2.deneme === 2 && a2.sonHata === "TELEGRAM_HTTP_502" && Math.abs(a2.sonrakiDeneme.getTime() - (t + 61_000 + 240_000)) < 1_000, `${a2.deneme} ${a2.sonrakiDeneme.toISOString()}`);
  await runSenderCycle(yalniz, t + 61_000 + 241_000);
  const a3 = await tazele(o.prisma, r.id);
  kontrol("§2d tavanda (3) geçici hata → HATA, son kod kalır", a3.durum === "HATA" && a3.deneme === 3 && a3.sonHata === "TELEGRAM_HTTP_503", `${a3.durum} ${a3.deneme}`);

  const tek = async (y: Parameters<SahteSaglayici["sonraki"]["push"]>[0], kanal: "TELEGRAM" | "EPOSTA" = "TELEGRAM") => {
    const s = await satir(o.prisma, kanal, `sinif-${RUN}`);
    (kanal === "TELEGRAM" ? o.tg : o.rs).sonraki.push(y);
    await runSenderCycle(deps(o.db, ikisi(o)), Date.now());
    return tazele(o.prisma, s.id);
  };
  const hiz = await tek({ status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 600 } } });
  kontrol("§2e 429 → sağlayıcının bekleme süresi (≥ 600 sn) uygulanır", hiz.durum === "BEKLIYOR" && hiz.sonHata === "TELEGRAM_HIZ_SINIRI" && hiz.sonrakiDeneme.getTime() >= Date.now() + 590_000, hiz.sonrakiDeneme.toISOString());
  await o.prisma.bildirim.update({ where: { id: hiz.id }, data: { durum: "HATA", sonHata: "BEKCI_KAPATTI" } });
  const kalici = await tek({ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: chat not found" } });
  kontrol("§2f 4xx → hemen HATA (deneme 1)", kalici.durum === "HATA" && kalici.deneme === 1 && kalici.sonHata === "TELEGRAM_HTTP_400", `${kalici.durum} ${kalici.sonHata}`);
  const kopuk = await tek({ status: 0, kopar: true });
  kontrol("§2g bağlantı kopması → geçici (TELEGRAM_AG_HATASI)", kopuk.durum === "BEKLIYOR" && kopuk.sonHata === "TELEGRAM_AG_HATASI", `${kopuk.durum} ${kopuk.sonHata}`);
  await o.prisma.bildirim.update({ where: { id: kopuk.id }, data: { durum: "HATA", sonHata: "BEKCI_KAPATTI" } });
  const tasindi = await tek({ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1009999 } } });
  const sonra = o.tg.istekler.length;
  await runSenderCycle(deps(o.db, ikisi(o)), Date.now() + 24 * 3_600_000);
  kontrol(
    "§2h sıradan grup süper gruba taşındı → İLK denemede kalıcı HATA (tavan tüketilmez), yeni kimlik (yalnız sayı) satırda, bir daha denenmez",
    tasindi.durum === "HATA" && tasindi.deneme === 1 && tasindi.sonHata === "TELEGRAM_SOHBET_TASINDI" && tasindi.yeniSohbetKimligi === "-1009999" && o.tg.istekler.length === sonra,
    `${tasindi.durum} ${tasindi.deneme} ${tasindi.yeniSohbetKimligi ?? "-"}`,
  );
  const bozuk = await tek({ status: 400, body: { ok: false, parameters: { migrate_to_chat_id: "-100abc; DROP" } } });
  kontrol("§2h' sayı olmayan taşınma kimliği yazılmaz (kod yine TELEGRAM_SOHBET_TASINDI)", bozuk.durum === "HATA" && bozuk.sonHata === "TELEGRAM_SOHBET_TASINDI" && bozuk.yeniSohbetKimligi === null);
  const yetkisiz = await tek({ status: 401, body: { ok: false, description: `Unauthorized ${TOKEN}` } });
  kontrol("§2i 401 (yanıt belirteci yansıtsa da) → kayıtta yalnız KOD", yetkisiz.durum === "HATA" && yetkisiz.sonHata === "TELEGRAM_HTTP_401" && !JSON.stringify(yetkisiz).includes(TOKEN));
  const resend = await tek({ status: 422, body: { name: "validation_error", message: "Invalid `to` field" } }, "EPOSTA");
  kontrol("§2j Resend 422 → HATA RESEND_HTTP_422", resend.durum === "HATA" && resend.sonHata === "RESEND_HTTP_422", `${resend.durum} ${resend.sonHata}`);
  await hizSiniri(o);
}

/** 429 retry_after: kanal o süre boyunca İSTEK görmez (aynı turdaki diğer satır da), deneme hakkı yanmaz. */
async function hizSiniri(o: Ortak): Promise<void> {
  const d = { ...deps(o.db, { TELEGRAM: ikisi(o).TELEGRAM }), pausedUntil: new Map() };
  const a = await satir(o.prisma, "TELEGRAM", `hiz-${RUN}-a`);
  const b = await satir(o.prisma, "TELEGRAM", `hiz-${RUN}-b`);
  o.tg.sonraki.push({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 30", parameters: { retry_after: 30 } } });
  const t = Date.now();
  const n0 = o.tg.istekler.length;
  const c1 = await runSenderCycle(d, t);
  const [a1, b1] = [await tazele(o.prisma, a.id), await tazele(o.prisma, b.id)];
  const ilk = a1.sonHata === "TELEGRAM_HIZ_SINIRI" ? a1 : b1;
  const ikinci = ilk === a1 ? b1 : a1;
  kontrol(
    "§2k 429 → aynı turda kanala ikinci istek YOK; satır 30 sn sonra, deneme hakkı YANMAZ (0); diğer satır dokunulmadan bekler",
    o.tg.istekler.length === n0 + 1 && c1.paused >= 1 && ilk.durum === "BEKLIYOR" && ilk.deneme === 0 && Math.abs(ilk.sonrakiDeneme.getTime() - (t + 30_000)) < 1_000 && ikinci.durum === "BEKLIYOR" && ikinci.deneme === 0 && ikinci.sonHata === null,
    JSON.stringify(c1),
  );
  await runSenderCycle(d, t + 10_000);
  kontrol("§2l kanal beklemesi sürerken vadesi gelmiş satıra da istek YOK", o.tg.istekler.length === n0 + 1);
  await runSenderCycle(d, t + 31_000);
  const [a2, b2] = [await tazele(o.prisma, a.id), await tazele(o.prisma, b.id)];
  kontrol("§2m bekleme bitince ikisi de gönderilir (deneme 1)", o.tg.istekler.length === n0 + 3 && [a2, b2].every((r) => r.durum === "GONDERILDI" && r.deneme === 1), `${a2.durum}/${b2.durum}`);
}

async function kapaliKanal(o: Ortak): Promise<void> {
  console.log("\n§3 yapılandırılmamış kanal");
  const e = await satir(o.prisma, "EPOSTA", `kapali-${RUN}`);
  const t = await satir(o.prisma, "TELEGRAM", `kapali-${RUN}`);
  const rs0 = o.rs.istekler.length;
  const c = await runSenderCycle(deps(o.db, { TELEGRAM: ikisi(o).TELEGRAM }), Date.now());
  const e1 = await tazele(o.prisma, e.id);
  kontrol("§3a e-posta yapılandırılmamış → KAPALI (gönderim yok), Telegram gönderildi", e1.durum === "KAPALI" && e1.sonHata === "KANAL_YAPILANDIRILMAMIS" && o.rs.istekler.length === rs0 && (await tazele(o.prisma, t.id)).durum === "GONDERILDI" && c.closed >= 1);
  const dizin = mkdtempSync(path.join(os.tmpdir(), "bildirim-nabiz-"));
  try {
    const nabiz = path.join(dizin, "nabiz.json");
    const p = await surec({ DATABASE_URL: o.rol.url, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TELEGRAM_API_KOKU: o.tg.kok, BILDIRIM_NABIZ_DOSYASI: nabiz }, ["--tek-tur"]);
    const kalp = JSON.parse(readFileSync(nabiz, "utf8")) as { kanallar: Record<string, string> };
    kontrol(
      "§3b süreç: 'kanal yapılandırılmamış' (günlük + nabız, değişken adıyla), belirteç günlükte YOK",
      p.kod === 0 && p.cikti.includes("BILDIRIM_GONDERICI_HAZIR eposta=kapali telegram=acik") && /kanal yapılandırılmamış \(RESEND_API_KEY yok/.test(kalp.kanallar.EPOSTA ?? "") && kalp.kanallar.TELEGRAM === "hazır" && !p.cikti.includes(TOKEN),
      `${p.kod} ${kalp.kanallar.EPOSTA ?? ""}`,
    );
    const grup = path.join(dizin, "grup");
    writeFileSync(grup, "-4012345678\n");
    chmodSync(grup, 0o440);
    const tasinan = await satir(o.prisma, "TELEGRAM", `tasinan-${RUN}`);
    o.tg.sonraki.push({ status: 400, body: { ok: false, error_code: 400, parameters: { migrate_to_chat_id: -1004012345678 } } });
    const nabiz2 = path.join(dizin, "nabiz2.json");
    const p2 = await surec({ DATABASE_URL: o.rol.url, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID_DOSYASI: grup, TELEGRAM_API_KOKU: o.tg.kok, BILDIRIM_NABIZ_DOSYASI: nabiz2 }, ["--tek-tur"]);
    const kalp2 = JSON.parse(readFileSync(nabiz2, "utf8")) as { kanallar: Record<string, string> };
    const giden = o.tg.istekler[o.tg.istekler.length - 1]?.govde.chat_id;
    const t1 = await tazele(o.prisma, tasinan.id);
    kontrol(
      "§3c süreç: sohbet kimliği DOSYADAN (-4012345678) gider; taşınınca nabız + günlük YENİ kimliği (-1004012345678) ve yapılacak işi söyler, satır kalıcı HATA",
      p2.kod === 0 && giden === "-4012345678" && /yeni sohbet kimliği -1004012345678/.test(kalp2.kanallar.TELEGRAM ?? "") && /yeni sohbet kimliği -1004012345678/.test(p2.cikti) &&
        t1.durum === "HATA" && t1.yeniSohbetKimligi === "-1004012345678" && !p2.cikti.includes(TOKEN),
      `${p2.kod} ${String(giden)} · ${kalp2.kanallar.TELEGRAM ?? ""}`,
    );
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

async function sureVeKilit(o: Ortak): Promise<void> {
  console.log("\n§4–§5 süresi geçen · kilidi dolan claim");
  const eski = await satir(o.prisma, "TELEGRAM", `eski-${RUN}`);
  await o.prisma.bildirim.update({ where: { id: eski.id }, data: { createdAt: new Date(Date.now() - 80 * 3_600_000) } });
  const n0 = o.tg.istekler.length;
  await runSenderCycle(deps(o.db, ikisi(o)), Date.now());
  const e1 = await tazele(o.prisma, eski.id);
  kontrol("§4a 72 saatten eski bekleyen → HATA SURESI_GECTI, gönderilmez", e1.durum === "HATA" && e1.sonHata === "SURESI_GECTI" && o.tg.istekler.length === n0);
  const olu = await satir(o.prisma, "TELEGRAM", `olu-${RUN}`);
  await o.prisma.bildirim.update({ where: { id: olu.id }, data: { durum: "GONDERILIYOR", deneme: 1, kilitBitis: new Date(Date.now() - 1_000) } });
  const canli = await satir(o.prisma, "TELEGRAM", `canli-${RUN}`);
  await o.prisma.bildirim.update({ where: { id: canli.id }, data: { durum: "GONDERILIYOR", deneme: 1, kilitBitis: new Date(Date.now() + 60_000) } });
  await runSenderCycle(deps(o.db, ikisi(o)), Date.now());
  const olu1 = await tazele(o.prisma, olu.id);
  kontrol("§5a çöken göndericinin kilidi dolunca yeniden alınır ve gönderilir", olu1.durum === "GONDERILDI" && olu1.deneme === 2, `${olu1.durum} ${olu1.deneme}`);
  const canli1 = await tazele(o.prisma, canli.id);
  kontrol("§5b canlı claim'e (kilit sürüyor) dokunulmaz", canli1.durum === "GONDERILIYOR" && canli1.deneme === 1 && !o.tg.istekler.some((i) => i.ham.includes(`canli-${RUN}`)));
  await o.prisma.bildirim.update({ where: { id: canli.id }, data: { durum: "HATA", kilitBitis: null, sonHata: "BEKCI_KAPATTI" } });
  // Geç kalan gönderici (ürün yolu): A satırı alır ve ağda asılı kalır; kilit dolar, B yeniden alıp gönderir;
  // A'nın geç gelen (geçici) sonucu B'nin GONDERILDI'sinin üstüne YAZILAMAZ.
  const gec = await satir(o.prisma, "TELEGRAM", `gec-${RUN}`);
  const asili = new AsiliTasiyici();
  const t = Date.now();
  const aTuru = runSenderCycle(deps(o.db, { TELEGRAM: asili }), t);
  await asili.basladi;
  const ikinci = openSenderDb(o.rol.url);
  try {
    await runSenderCycle(deps(ikinci, ikisi(o)), t + CLAIM_MS + 1_000);
  } finally {
    await ikinci.close();
  }
  asili.birak({ kind: "GECICI", code: "TELEGRAM_HTTP_503" });
  const aSonuc = await aTuru.catch((err: Error) => err);
  const gec1 = await tazele(o.prisma, gec.id);
  const aOk = !(aSonuc instanceof Error) && aSonuc.lost === 1 && aSonuc.retried === 0;
  kontrol("§5c geç kalan claim sonucu YAZAMAZ: satır B'nin GONDERILDI'si (deneme 2), A 'kaçan claim' sayar", gec1.durum === "GONDERILDI" && gec1.deneme === 2 && aOk, `${gec1.durum} ${gec1.deneme} ${aSonuc instanceof Error ? aSonuc.message.split("\n").filter(Boolean).pop() : JSON.stringify(aSonuc)}`);
}

/** Ağda asılı kalan taşıyıcı: `birak` çağrılana dek yanıt vermez (geç kalan gönderici benzetimi). */
class AsiliTasiyici implements NotificationTransport {
  readonly channel = "TELEGRAM" as const;
  private cozucu: ((o: SendOutcome) => void) | null = null;
  private baslat: () => void = () => undefined;
  readonly basladi = new Promise<void>((r) => (this.baslat = r));
  send(): Promise<SendOutcome> {
    this.baslat();
    return new Promise((r) => (this.cozucu = r));
  }
  birak(o: SendOutcome): void {
    this.cozucu?.(o);
  }
}

async function yaris(o: Ortak): Promise<void> {
  console.log("\n§6 atomik claim — iki gönderici");
  o.tg.gecikmeMs = 30;
  o.rs.gecikmeMs = 30;
  const ikinci = openSenderDb(o.rol.url);
  try {
    const idler: string[] = [];
    for (let i = 0; i < 10; i++) idler.push((await satir(o.prisma, "TELEGRAM", `ic-${RUN}-${i}`)).id);
    const n0 = o.tg.istekler.length;
    const [a, b] = await Promise.all([runSenderCycle(deps(o.db, ikisi(o)), Date.now()), runSenderCycle(deps(ikinci, ikisi(o)), Date.now())]);
    const gelen = o.tg.istekler.slice(n0).map((x) => /ic-[a-f0-9]+-(\d+)/.exec(x.ham)?.[1]).filter(Boolean);
    const rows = await o.prisma.bildirim.findMany({ where: { id: { in: idler } } });
    kontrol(
      "§6a süreç içi iki havuz: 10 satır, 10 istek, her satır BİR kez (deneme 1); ✓K yarış gerçekten oldu (kaçan claim > 0)",
      gelen.length === 10 && new Set(gelen).size === 10 && rows.every((r) => r.durum === "GONDERILDI" && r.deneme === 1) && a.sent + b.sent === 10 && a.lost + b.lost > 0,
      `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
    );
  } finally {
    await ikinci.close();
  }
  const olaylar = 8;
  const { enqueueNotificationTx } = await import("../src/notifications/outbox");
  for (let i = 0; i < olaylar; i++) {
    await o.prisma.$transaction((tx) => enqueueNotificationTx(tx, { event: "DENEME", keyParts: [`bekci-${RUN}-surec-${i}`], installationDbId: null, portalPath: "/bildirimler", referans: `surec-${RUN}-${i}` }));
  }
  const tg0 = o.tg.istekler.length;
  const rs0 = o.rs.istekler.length;
  const ortam = { DATABASE_URL: o.rol.url, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TELEGRAM_API_KOKU: o.tg.kok, RESEND_API_KEY: RESEND_KEY, RESEND_API_KOKU: o.rs.kok, BILDIRIM_EPOSTA_ALICI: ALICI, BILDIRIM_EPOSTA_GONDEREN: GONDEREN, BILDIRIM_DONGU_SN: "1" };
  const iki = [baslat({ ...ortam, BILDIRIM_NABIZ_DOSYASI: path.join(os.tmpdir(), `nabiz-a-${RUN}`) }), baslat({ ...ortam, BILDIRIM_NABIZ_DOSYASI: path.join(os.tmpdir(), `nabiz-b-${RUN}`) })];
  const bitti = async () => (await o.prisma.bildirim.count({ where: { tekillikAnahtari: { startsWith: `DENEME:bekci-${RUN}-surec-` }, durum: { in: ["BEKLIYOR", "GONDERILIYOR"] } } })) === 0;
  const son = Date.now() + 30_000;
  while (!(await bitti()) && Date.now() < son) await new Promise((r) => setTimeout(r, 200));
  const sonuclar = await Promise.all(iki.map((s) => s.durdur()));
  const tgGelen = o.tg.istekler.slice(tg0).map((x) => /surec-[a-f0-9]+-(\d+)/.exec(x.ham)?.[1]).filter(Boolean);
  const rsAnahtar = o.rs.istekler.slice(rs0).map((x) => String(x.basliklar["idempotency-key"]));
  const rows = await o.prisma.bildirim.findMany({ where: { tekillikAnahtari: { startsWith: `DENEME:bekci-${RUN}-surec-` } } });
  const gonderen = sonuclar.filter((s) => /gönderilen [1-9]/.test(s.cikti)).length;
  const hazir = sonuclar.filter((s) => s.cikti.includes("BILDIRIM_GONDERICI_HAZIR eposta=acik telegram=acik")).length;
  kontrol(
    "§6b iki AYRI gönderici süreci: 16 satır → 8 Telegram + 8 e-posta, her biri BİR kez; ✓K iki süreç de kalktı ve koştu (en az biri gönderdi)",
    tgGelen.length === olaylar && new Set(tgGelen).size === olaylar && rsAnahtar.length === olaylar && new Set(rsAnahtar).size === olaylar &&
      rows.length === 2 * olaylar && rows.every((r) => r.durum === "GONDERILDI" && r.deneme === 1) && sonuclar.every((s) => s.kod === 0) && hazir === 2 && gonderen >= 1,
    `tg=${tgGelen.length} rs=${rsAnahtar.length} satır=${rows.length} hazır=${hazir} gönderen süreç=${gonderen}`,
  );
  const gunluk = sonuclar.map((s) => s.cikti).join("\n");
  kontrol("§6c gönderici günlüğünde belirteç / API anahtarı / ileti metni YOK", !gunluk.includes(TOKEN) && !gunluk.includes(RESEND_KEY) && !gunluk.includes(`surec-${RUN}`));
  o.tg.gecikmeMs = 0;
  o.rs.gecikmeMs = 0;
}

interface Surec {
  durdur(): Promise<{ kod: number | null; cikti: string }>;
}

function baslat(env: Record<string, string>, args: string[] = []): Surec {
  const s = spawn(process.execPath, ["--import", "tsx", "src/notifications/sender-main.ts", ...args], { cwd: SATICI_KOKU, env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let cikti = "";
  s.stdout!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  s.stderr!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  const bitis = new Promise<number | null>((r) => s.once("exit", (kod) => r(kod)));
  return {
    durdur: async () => {
      if (s.exitCode === null) s.kill("SIGTERM");
      const zaman = setTimeout(() => s.kill("SIGKILL"), 10_000);
      const kod = await bitis;
      clearTimeout(zaman);
      return { kod, cikti };
    },
  };
}

/** Tek turluk süreç (`--tek-tur` kendiliğinden çıkar). */
async function surec(env: Record<string, string>, args: string[]): Promise<{ kod: number | null; cikti: string }> {
  const s = spawn(process.execPath, ["--import", "tsx", "src/notifications/sender-main.ts", ...args], { cwd: SATICI_KOKU, env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let cikti = "";
  s.stdout!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  s.stderr!.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  const kod = await new Promise<number | null>((r) => s.once("exit", (k) => r(k)));
  return { kod, cikti };
}

async function acilisKapisi(o: Ortak): Promise<void> {
  console.log("\n§7 açılış kapısı");
  const sahip = await surec({ DATABASE_URL: process.env.DATABASE_URL ?? "", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, TELEGRAM_API_KOKU: o.tg.kok }, ["--tek-tur"]);
  kontrol("§7a ✓K satıcının SAHİP rolüyle kalkan gönderici DURUR (fazla yetki)", sahip.kod === 1 && /FAZLA yetkili/.test(sahip.cikti), `${sahip.kod} ${sahip.cikti.trim().split("\n").pop() ?? ""}`);
  let dar = "";
  try {
    await assertLeastPrivilege(o.db.prisma);
  } catch (err) {
    dar = (err as Error).message;
  }
  kontrol("§7b en az yetkili rol kapıdan geçer", dar === "", dar);
}

async function main(): Promise<void> {
  hedefDbKapisi();
  yapilandirma();
  const { prisma } = await import("../src/lib/prisma");
  const tg = await sahteSaglayici("telegram");
  const rs = await sahteSaglayici("resend");
  const rol = await gondericiRoluKur();
  const db = openSenderDb(rol.url);
  const o: Ortak = { prisma, tg, rs, db, rol };
  try {
    await ucdanUca(o);
    await geriCekilme(o);
    await kapaliKanal(o);
    await sureVeKilit(o);
    await yaris(o);
    await acilisKapisi(o);
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    await db.close();
    await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { startsWith: `DENEME:bekci-${RUN}-` } } });
    await rol.kaldir().catch((err: Error) => console.error(`rol kaldırılamadı: ${err.message}`));
    await tg.kapat();
    await rs.kapat();
    for (const ad of [`nabiz-a-${RUN}`, `nabiz-b-${RUN}`]) rmSync(path.join(os.tmpdir(), ad), { force: true });
    await kapat();
  }
  console.log(`  (süre ${Math.round((Date.now() - T0) / 1000)} sn)`);
  sonuc();
}

void main();
