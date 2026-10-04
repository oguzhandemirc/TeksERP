#!/usr/bin/env node
// =============================================================================
// Satıcı compose'unun yalıtım değişmezleri — UYGULAMADAN ÖNCE (Mac'te, sunucunun .env'iyle) koşulur.
// =============================================================================
// `docker compose config --format json` çıktısını (değişkenler çözülmüş hâli) ölçer:
//   Ⓚ TÜNEL KALINTISI YOK (portal tüneli 2026-10 kapandı; tek portal yolu portal-genel örtüsü): .env'de TAILNET_* anahtarı
//      ve emekli örtü (docker-compose.loopback.yml) yok — compose ÇÖZÜLMEDEN ölçülür (eski örtü yeni imajla koşarsa
//      `portal-tunel` çökme döngüsüne girer: imaj ve compose AYNI adımda iner); çözülmüş yapılandırmada `portal-tunel`
//      servisi, `tailnet` ağı ve TAILNET_*/PORT_TAILNET ortam anahtarı yok
//   ① HİÇBİR servis port yayımlamaz (genel + portal Traefik'ten, iç API köprüden; host'a yayın yok)
//   ② docker soketi hiçbir servise bağlı değil
//   ③ her servis: salt okunur kök FS · cap_drop ALL · no-new-privileges · root olmayan kullanıcı ·
//      bellek + CPU + süreç sınırı
//   ③b her servis (yan konteynerler dahil): yalıtım GEVŞETMESİ yok — volumes_from · privileged · cap_add · pid/ipc/uts/
//      userns/cgroup · devices · runtime · sysctls · network_mode YASAK (istisna yok); security_opt TAM OLARAK
//      no-new-privileges:true (seccomp/apparmor/label gevşetmesi yok)
//   ③c her servisin anahtarları TANINAN kümede (fail-closed: bilinmeyen anahtar = ihlal; yeni anahtar bilinçli eklenir);
//      yapılandırma BÜTÜN profillerle çözülür (`--profile '*'`) ve `profiles` yalnız satici-goc'ta, tam olarak ["goc"]
//   ③d host bağları servis başına ALLOWLIST (hedef → .env değişkeni, salt okunurluk; DB yalnız kendi birimi): beyansız
//      bağ, .env'den farklı kaynak, sistem yolu (/ · /etc · /root · /run · docker…), iç içe kaynak, bağın içinde sır YASAK
//   ③e group_add yalnız SIR_GID (sayısal, ≥ 1000) ve yalnız sırrı okuyan servislerde; birincil grup root olamaz (③)
//   ④ kenar + ic ağları internal; dış (`external`) ağa katılan servis yok (Traefik'in `web`i dahil)
//   ⑤ anahtar birimi her bağlandığı yerde salt okunur
//   ⑥ satıcı köprü ağları 100.64/10 ve 127/8 DIŞINDA — köprü ağ geçidinin adresi geri döngü/CGNAT sayan bir kaynak
//      kapısını (iç API IC_KAYNAK_AGLARI, eski imajın tünel kapısı) kandırmasın
//   ⑥c her ağda IPv6 KAPALI (enable_ipv6 · v6 alt ağı · ipv6 sürücü seçeneği yok) — çıkış kuralları yalnız IPv4'ü daraltır
//   ⑥b kenar ağında dinamik dağıtım aralığı (ip_range) alt ağın içinde ve satıcının sabit adresi
//      onun DIŞINDA — Traefik (dinamik) satıcının adresini kapamasın
//   ⑦ Traefik etiketi yalnız `satici`de ve kenar ağını gösteriyor; DB'nin portu ve dış ağı yok
//   ⑧ İÇ API (patron bulutu → satıcı): `ic-api` ağı internal, satıcı sabit adresinde dinler (IC_BIND = o
//      adres, 4612), kaynak YALNIZ patronun sabit /32'si (alt ağda, ağ geçidi .1 değil, satıcı değil,
//      dinamik aralığın DIŞINDA); sır docker secret'ı (`ic_api_belirteci`) yalnız satıcıya bağlı
//   ⑨ DAĞITIM BAĞLARI (3d-1): kök FS salt okunur → satıcının yazdığı TEK yol `/dosyalar` (kendi birimi, rw);
//      `/derlemeler` ve `/yayin` (güncelleme sunucusu kökü) salt okunur; ortam adları bağlarla aynı; genel kök
//      https; dosya birimi yayın kökünün/anahtar biriminin içinde değil; üç bağ YALNIZ satıcıda
//   ⑩ GENEL_KOK_ADRESI'nin makinesi Traefik Host kuralıyla aynı (/d · /y bağlantısı başka ortama gitmesin)
//   ⑪ satıcı gömülü güven çapasıyla koşar: GUVEN_CAPASI_DOSYASI YOK (yalnız test) · NODE_ENV=production ·
//      GUVEN_CAPASI = projenin ORTAMI (üretim satıcısı hazırlık köküne güvenmez)
//   Ⓞ ÖRTÜLER (ana dosyanın üstüne bindirilen kipler; algı + beklenen servisler + kendi denetimleri, ORTULER listesi):
//      portal-genel (`docker-compose.portal-genel.yml`: `satici-jwks` servisi ya da satıcıda PORT_ERISIM) → ⑬.
//      Ⓞ TEK PORTAL (kullanıcı kararı 2026-10-05): portal-genel örtüsü ÜRETİMDE ZORUNLU (portalın tek yolu), HAZIRLIKTA YOK.
//      Her durumda: satıcının ağ kümesi tam üç ağ, üçü internal (örtü satıcıya ağ EKLEMEZ); internal olmayan ağ yalnız
//      örtünün çıkış ağı (üyesi yalnız örtünün yan konteyneri) — ④b/④c.
//      ⑦ BÜTÜN Traefik yönlendiricilerini ölçer: küme = genel (+ örtününkiler), her biri Host + websecure + tls;
//      birden çok hizmette her yönlendirici hizmetine AÇIKÇA bağlı, genel → 4610; hizmet portları yalnız beyanlı
//      (4610 + örtününkiler) — emekli tünel portu 4611 ve iç API 4612 OLAMAZ.
//   ⑬ PORTAL-GENEL: PORT_ERISIM 4613 · ERISIM_BIND = kenar adresi · 4613 yayımlanmaz · Access ayarı biçimli · JWKS bağı
//      satıcıda salt okunur, yan konteynerde yazılır, create_host_path yok, anahtar/dağıtım birimlerinin dışında ·
//      `satici-jwks` satıcı imajı + çekici giriş noktası, sırsız/bağsız/portsuz/etiketsiz, yalnız `jwks-cikis`te ·
//      `jwks-cikis` internal değil, tek üyeli · portal yönlendiricisi 4613'e, ipallowlist = CLOUDFLARE_NETWORKS birebir ·
//      ⑬g yan konteyner ortamı ALLOWLIST · ⑬h `jwks-cikis` alt ağı = .env'deki JWKS_CIKIS_AGI (DOCKER-USER kuralının ağı).
//   Ⓑ BİLDİRİM (`docker-compose.bildirim.yml`: dosya COMPOSE_FILE'da ya da `satici-bildirim` servisi) — satıcı dış
//      bağlantısız kalır, dışarı YALNIZ en az yetkili gönderici çıkar: Ⓑ0 dosya ↔ servis · Ⓑ1 internal olmayan ağlar
//      tam olarak örtü çıkış ağları, bildirim-cikis tek üyeli · Ⓑ2 gönderici ağları tam ic +
//      bildirim-cikis, çekirdek servisler bildirim-cikis'e katılmaz · Ⓑ3 port/birim/Traefik etiketi/soket yok · Ⓑ4 tam dört
//      kanal sırrı, başka serviste yok · Ⓑ5 ortam ALLOWLIST: satici_bildirim rolü, sır yolları /run/secrets/, DB adresi ve
//      sağlayıcı kökleri yalnız beklenen değer, tanınmayan anahtar (NODE_OPTIONS, düz sır, DATABASE_URL…) yok · Ⓑ6 satıcı
//      imajı + gönderici komutu · Ⓑ7 çıkış alt ağı 100.64/10 · 127/8 · satıcı ağları · patron ağlarıyla (--patron-env;
//      verilmezse ÖLÇÜLMEDİ) çakışmaz · Ⓑ7b çıkış alt ağı = .env'deki BILDIRIM_CIKIS_AGI = betiğin kural koyduğu ağ ·
//      Ⓑ8 dns iki sabit IPv4 = `vds/bildirim-cikis.sh`in 53'ü açtığı adresler (betiğin varsayılanı + .env'deki BILDIRIM_DNS_1/2).
//   ⑫ İKİ ORTAM YAN YANA (--diger-env <öteki ortamın .env'i>): proje/DB hacmi/Host/genel kök/sır grubu farklı,
//      köprü alt ağları çakışmaz, host bağları ve sır dosyaları ortak ya da iç içe değil (tek istisna salt
//      okunur yayın kökü), öteki ortamda da port yayını ve tünel kalıntısı yok — üretim hazırlığın anahtarını/DB'sini
//      ASLA bağlamasın.
//      Verilmezse ⑫ ÖLÇÜLMEDİ diye basılır (geçti sayılmaz); ORTAM=uretim'de çıkış 2 (hazırlığın yanına kurulur).
//
// Kullanım: node deploy/satici/compose-denetle.mjs --env-file <.env> [-f <compose> ...] [--diger-env <.env>] [--patron-env <.env>]
//   --patron-env: patron bulutunun .env'i (deploy/patron/docker-compose.yml onunla çözülür) — Ⓑ7'nin patron ayağı.
//   -f verilmezse .env'deki COMPOSE_FILE (":" ayrık, bu dizine göre) — yoksa docker-compose.yml.
// Çıkış: 0 temiz · 1 ihlal (Ⓚ kalıntısı yüzünden config çözülemese de) · 2 ölçülemedi (docker yok / config çözülemedi).
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const burasi = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const al = (ad) => {
  const i = args.indexOf(ad);
  return i >= 0 ? args[i + 1] : undefined;
};
const envDosyasi = al("--env-file");
const digerEnv = al("--diger-env");
const patronEnv = al("--patron-env");
if (!envDosyasi || (args.includes("--diger-env") && !digerEnv) || (args.includes("--patron-env") && !patronEnv)) {
  console.error("kullanım: compose-denetle.mjs --env-file <.env> [-f <compose> ...] [--diger-env <.env>] [--patron-env <.env>]");
  process.exit(2);
}
const acikF = args.flatMap((a, i) => (a === "-f" && args[i + 1] ? [args[i + 1]] : []));

let ihlal = 0;
let gecti = 0;
let olculmedi = 0;
function kontrol(ad, ok, ayrinti = "") {
  if (ok) gecti++;
  else ihlal++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

// Ⓚ portal tüneli emekli (D5): bu dosyalar ve anahtarlar repoda yok; .env/COMPOSE_FILE'da görünmesi yarım geçiştir.
const EMEKLI_ORTULER = ["docker-compose.loopback.yml"];
const EMEKLI_SERVISLER = ["portal-tunel"];
const tunelAnahtari = (k) => /^(TAILNET_|PORT_TAILNET$)/.test(k);

function envOku(env) {
  try {
    return readFileSync(env, "utf8");
  } catch (err) {
    console.error(`ÖLÇÜLEMEDİ: .env okunamadı (${env}) — ${err.message}`);
    process.exit(2);
  }
}

/** .env'in COMPOSE_FILE (ya da -f) dosya listesi; ikisi de yoksa docker-compose.yml. */
function composeDosyalariOf(envMetni, fDosyalari) {
  const composeFileSatiri = envMetni
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*COMPOSE_FILE\s*=\s*(.*?)\s*$/)?.[1])
    .filter((v) => v !== undefined)
    .pop();
  return fDosyalari.length > 0
    ? fDosyalari
    : composeFileSatiri
      ? composeFileSatiri.replace(/^["']|["']$/g, "").split(":").filter(Boolean).map((f) => path.resolve(burasi, f))
      : [path.join(burasi, "docker-compose.yml")];
}

/** Ⓚ compose ÇÖZÜLMEDEN: .env'de TAILNET_* anahtarı ve dosya listesinde emekli örtü yok (eski örtü yeni imajla koşmasın). */
function kalintiOnDenetle(env, fDosyalari, etiket) {
  const metin = envOku(env);
  const anahtarlar = metin.split(/\r?\n/).map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]).filter((k) => k && tunelAnahtari(k));
  const emekli = composeDosyalariOf(metin, fDosyalari).filter((f) => EMEKLI_ORTULER.includes(path.basename(f))).map((f) => path.basename(f));
  kontrol(`Ⓚ ${etiket}: .env'de tünel anahtarı (TAILNET_*) yok · dosya listesinde emekli örtü (${EMEKLI_ORTULER.join(", ")}) yok`,
    anahtarlar.length === 0 && emekli.length === 0,
    [...new Set(anahtarlar)].map((k) => `anahtar ${k}`).concat(emekli.map((f) => `örtü ${f} — yeni imajda portal-tunel YOK, compose ile imaj AYNI adımda iner`)).join(" · "));
}

/** .env'in çözülmüş compose yapılandırması (COMPOSE_FILE ya da -f); okunamazsa ÖLÇÜLEMEDİ (çıkış 2) — Ⓚ ihlali varsa çıkış 1. */
function coz(env, fDosyalari) {
  const dosyalar = composeDosyalariOf(envOku(env), fDosyalari);
  // BÜTÜN profiller çözülür ("*"): yalnız `goc` açılsaydı başka profildeki servis hiç denetlenmezdi. Profil anahtarı
  // ③c'de ölçülür (yalnız satici-goc = ["goc"]); "*"i tanımayan compose satici-goc'u çözmez → körlük zemini kırmızı.
  const r = spawnSync(
    "docker",
    ["compose", "--env-file", env, ...dosyalar.flatMap((f) => ["-f", f]), "--profile", "*", "config", "--format", "json"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(`${ihlal > 0 ? "ÇÖZÜLEMEDİ" : "ÖLÇÜLEMEDİ"}: docker compose config (${env}) — ${(r.stderr || r.error?.message || "").trim()}`);
    if (ihlal > 0) {
      console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal (yapılandırma çözülmeden) ===`);
      process.exit(1);
    }
    process.exit(2);
  }
  return { cfg: JSON.parse(r.stdout), dosyalar };
}
kalintiOnDenetle(envDosyasi, acikF, "bu ortam");
if (digerEnv) kalintiOnDenetle(digerEnv, [], `öteki ortam (${path.basename(digerEnv)})`);
const { cfg, dosyalar: composeDosyalari } = coz(envDosyasi, acikF);

function ipv4(s) {
  const p = s.split(".").map(Number);
  return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
function aralikta(ip, cidr) {
  const [ag, bit] = cidr.split("/");
  const a = ipv4(ip);
  const b = ipv4(ag);
  if (a === null || b === null) return false;
  const maske = bit === "0" ? 0 : (~0 << (32 - Number(bit))) >>> 0;
  return (a & maske) >>> 0 === (b & maske) >>> 0;
}
function cakisir(cidr, yasak) {
  const [ag, bit] = cidr.split("/");
  const [yag, ybit] = yasak.split("/");
  const n = Math.min(Number(bit), Number(ybit));
  return aralikta(ag, `${yag}/${n}`);
}

const servisler = Object.entries(cfg.services ?? {});
const projeOrtamiAdi = /^tekserp-satici-(uretim|hazirlik)$/.exec(String(cfg.name ?? ""))?.[1] ?? null;

// Ⓑ bildirim örtüsü — gönderici yan konteyneri satıcının TEK dış bağlantısıdır; sırrı, ağı ve imajı burada ölçülür.
const BILDIRIM_ORTU_DOSYASI = "docker-compose.bildirim.yml";
const BILDIRIM_SIR_ORTAMI = {
  DB_PAROLA_DOSYASI: "bildirim_db_parolasi",
  TELEGRAM_BOT_TOKEN_DOSYASI: "telegram_bot_token",
  TELEGRAM_CHAT_ID_DOSYASI: "telegram_chat_id",
  RESEND_API_KEY_DOSYASI: "resend_api_key",
};
const BILDIRIM_SIRLARI = Object.values(BILDIRIM_SIR_ORTAMI).sort();
const BILDIRIM_DUZ_SIRLAR = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "DATABASE_URL"];
const sabit = (deger) => ({ gecerli: (v) => v === deger, aciklama: `≠ ${deger}` });
const tamsayi = { gecerli: (v) => /^\d{1,6}$/.test(v), aciklama: "tamsayı değil" };
const serbest = { gecerli: () => true, aciklama: "" };
/** Göndericinin ortam ALLOWLIST'i (sender-config.ts + satici-baslat.sh'ın okuduğu anahtarlar); başka her anahtar Ⓑ5 ihlali. */
const BILDIRIM_ORTAMI = {
  NODE_ENV: { ...sabit("production"), zorunlu: true },
  DB_KULLANICI: { ...sabit("satici_bildirim"), zorunlu: true },
  ...Object.fromEntries(Object.entries(BILDIRIM_SIR_ORTAMI).map(([k, sir]) => [k, { ...sabit(`/run/secrets/${sir}`), zorunlu: true }])),
  DB_HOST: sabit("satici-db"),
  DB_ADI: sabit("satici"),
  BILDIRIM_NABIZ_DOSYASI: { gecerli: (v) => /^\/tmp\/[A-Za-z0-9._-]+$/.test(v), aciklama: "/tmp/ altında değil" },
  BILDIRIM_EPOSTA_ALICI: serbest,
  BILDIRIM_EPOSTA_GONDEREN: serbest,
  BILDIRIM_PORTAL_ADRESI: { gecerli: (v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), aciklama: "http(s) adresi değil" },
  TELEGRAM_API_KOKU: sabit("https://api.telegram.org"),
  RESEND_API_KOKU: sabit("https://api.resend.com"),
  BILDIRIM_DONGU_SN: tamsayi,
  BILDIRIM_DENEME_TAVANI: tamsayi,
  BILDIRIM_AZAMI_YAS_SAAT: tamsayi,
  BILDIRIM_SAAT_DILIMI: { gecerli: (v) => /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(v), aciklama: "saat dilimi adı değil" },
};

// Örtüler: her biri kendi algısı, yan konteynerleri, çıkış ağları (ağ → izinli tek üyeler), Traefik yönlendiricileri ve
// hizmet portlarıyla. Yeni örtü buraya bir girdi + kendi denetim işleviyle eklenir.
const ORTULER = [
  {
    ad: "portal-genel",
    simge: "⑬",
    var: (c) => "satici-jwks" in (c.services ?? {}) || "PORT_ERISIM" in (c.services?.satici?.environment ?? {}),
    servisler: ["satici-jwks"],
    cikisAglari: { "jwks-cikis": ["satici-jwks"] },
    yonlendiriciler: (c) => [`${c.name}-portal`],
    hizmetPortlari: ["4613"],
    denetle: (c) => portalGenelDenetle(c),
  },
  {
    ad: "bildirim",
    simge: "Ⓑ",
    var: (c) => "satici-bildirim" in (c.services ?? {}) || composeDosyalari.some((f) => path.basename(f) === BILDIRIM_ORTU_DOSYASI),
    servisler: ["satici-bildirim"],
    cikisAglari: { "bildirim-cikis": ["satici-bildirim"] },
    yonlendiriciler: () => [],
    hizmetPortlari: [],
    denetle: (c) => bildirimDenetle(c),
  },
];
const aktif = ORTULER.filter((o) => o.var(cfg));
console.log(`\nortam: ${projeOrtamiAdi ?? cfg.name}${aktif.length ? ` · örtü: ${aktif.map((o) => o.ad).join(" + ")}` : ""} · dosyalar: ${composeDosyalari.map((f) => path.basename(f)).join(" + ")}\n`);
const beklenen = [...["satici-db", "satici", "satici-goc", "satici-yedek"], ...aktif.flatMap((o) => o.servisler)];
kontrol(
  `körlük zemini: ${beklenen.length} servis çözüldü (${beklenen.join(" · ")})`,
  servisler.length === beklenen.length && beklenen.every((a) => a in (cfg.services ?? {})),
  servisler.map(([a]) => a).join(", "),
);

// ① port yayını — hiçbir servis host'a port yayımlamaz (127.0.0.1 dahil: eski tünel portu 4611 de buradan geri gelemez)
const yayinlayan = servisler.filter(([, s]) => (s.ports ?? []).length > 0);
kontrol("① hiçbir servis port yayımlamaz", yayinlayan.length === 0,
  yayinlayan.map(([a, s]) => `${a}: ${s.ports.map((p) => `${p.host_ip ?? "0.0.0.0"}:${p.published}→${p.target}`).join(",")}`).join(" · ") || "hiçbiri");

// Ⓚ çözülmüş yapılandırmada tünel kalıntısı — ön denetimin göremediği (örtü başka adla bindirilmiş olabilir) her iz.
{
  const iz = [
    ...servisler.filter(([ad]) => EMEKLI_SERVISLER.includes(ad)).map(([ad]) => `servis ${ad}`),
    ...Object.entries(cfg.networks ?? {}).filter(([a, n]) => /tailnet/i.test(`${a} ${n.name ?? ""}`)).map(([a]) => `ağ ${a}`),
    ...servisler.flatMap(([ad, s]) => Object.keys(s.environment ?? {}).filter(tunelAnahtari).map((k) => `${ad}: ${k}`)),
  ];
  kontrol(`Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok (${EMEKLI_SERVISLER.join(", ")} servisi · tailnet ağı · TAILNET_*/PORT_TAILNET ortamı)`, iz.length === 0, iz.join(" · "));
}

// Ⓞ tek portal — portal-genel örtüsü üretimde zorunlu (portalın tek yolu), hazırlıkta yasak (kullanıcı kararı 2026-10-05).
{
  const portalVar = aktif.some((o) => o.ad === "portal-genel");
  const beklenenPortal = projeOrtamiAdi === "uretim";
  kontrol(
    projeOrtamiAdi === "hazirlik"
      ? "Ⓞ hazırlıkta portal YOK: portal-genel örtüsü (satici-jwks · PORT_ERISIM) bindirilmemiş — tek portal üretimde"
      : "Ⓞ üretimde portal-genel örtüsü ZORUNLU (satici-jwks + PORT_ERISIM) — portalın tek yolu",
    projeOrtamiAdi !== null && portalVar === beklenenPortal,
    `ortam ${projeOrtamiAdi ?? `TANINMADI (${cfg.name})`} · portal-genel ${portalVar ? "VAR" : "YOK"}`,
  );
}

// ② docker soketi
const soket = [];
for (const [ad, s] of servisler) {
  for (const v of s.volumes ?? []) if (/docker\.sock/.test(`${v.source ?? ""} ${v.target ?? ""}`)) soket.push(ad);
}
kontrol("② docker soketi hiçbir servise bağlı değil", soket.length === 0, soket.join(", "));

// ③ servis sertliği
for (const [ad, s] of servisler) {
  const kullanici = String(s.user ?? "");
  const [uid, gid] = kullanici.split(":");
  const eksik = [];
  if (s.read_only !== true) eksik.push("read_only");
  if (!(s.cap_drop ?? []).includes("ALL")) eksik.push("cap_drop ALL");
  if (!(s.security_opt ?? []).includes("no-new-privileges:true")) eksik.push("no-new-privileges");
  if (!kullanici || uid === "0" || uid === "root") eksik.push("root olmayan user");
  if (gid === "0" || gid === "root") eksik.push("root olmayan birincil grup");
  if (!s.mem_limit) eksik.push("mem_limit");
  if (!s.cpus) eksik.push("cpus");
  if (!s.pids_limit) eksik.push("pids_limit");
  kontrol(`③ ${ad} sertleştirilmiş`, eksik.length === 0, eksik.length ? `eksik: ${eksik.join(", ")}` : `user ${kullanici} · ${s.mem_limit} · ${s.cpus} cpu · ${s.pids_limit} süreç`);
}

// ③b yalıtım gevşetmesi — cap_drop ALL'ı cap_add/privileged ezse ③ yine yeşil verirdi; burada her anahtar ayrı ölçülür.
// İstisna YOK: network_mode'un tek beyanlı kullanıcısı (geri döngü iletici portal-tunel) tünelle birlikte emekli.
const doluMu = (v) => v !== undefined && v !== null && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const YASAK_ANAHTARLAR = ["volumes_from", "privileged", "cap_add", "pid", "ipc", "uts", "userns_mode", "cgroup", "cgroup_parent", "devices", "device_cgroup_rules", "runtime", "isolation", "sysctls", "network_mode"];
for (const [ad, s] of servisler) {
  const gevsek = YASAK_ANAHTARLAR.filter((k) => doluMu(s[k])).map((k) => `${k}=${JSON.stringify(s[k])}`);
  const so = s.security_opt ?? [];
  if (JSON.stringify(so) !== JSON.stringify(["no-new-privileges:true"])) gevsek.push(`security_opt=${JSON.stringify(so)} (yalnız no-new-privileges:true)`);
  kontrol(`③b ${ad} yalıtım gevşetmesi yok`, gevsek.length === 0, gevsek.join(" · "));
}

// ③c tanınan anahtarlar: `docker compose config` çıktısında bugün görülen (+ bildirim yan konteynerinin `dns`i) küme.
const TANINAN_ANAHTARLAR = new Set([
  "cap_drop", "command", "container_name", "cpus", "depends_on", "dns", "entrypoint", "environment", "group_add", "healthcheck", "image",
  "init", "labels", "logging", "mem_limit", "memswap_limit", "network_mode", "networks", "pids_limit", "ports", "profiles", "read_only",
  "restart", "secrets", "security_opt", "tmpfs", "user", "volumes",
]);
// Profil tek beyanlı: göç servisi `goc` profilinde (her `up`ta koşmasın); başka her profil ihlal (denetimden saklanan servis).
const PROFILLER = { "satici-goc": ["goc"] };
for (const [ad, s] of servisler) {
  const bilinmeyen = Object.keys(s).filter((k) => !TANINAN_ANAHTARLAR.has(k));
  const beklenenProfil = Object.hasOwn(PROFILLER, ad) ? PROFILLER[ad] : [];
  const profil = s.profiles ?? [];
  const profilKotu = JSON.stringify(profil) !== JSON.stringify(beklenenProfil);
  kontrol(
    `③c ${ad} yalnız tanınan anahtarlar · profil ${beklenenProfil.length ? `tam olarak ${JSON.stringify(beklenenProfil)}` : "yok"}`,
    bilinmeyen.length === 0 && !profilKotu,
    [bilinmeyen.length ? `tanınmayan: ${bilinmeyen.join(", ")}` : "", profilKotu ? `profiles=${JSON.stringify(profil)}` : ""].filter(Boolean).join(" · "),
  );
}

// ③d HOST BAĞLARI — servis başına beyanlı bağ kümesi (hedef → .env değişkeni + salt okunurluk; DB yalnız kendi birimi);
// beyansız hedef, kaynağı .env'deki değerden farklı bağ, salt okunurluğu kalkmış bağ ihlal. Kaynak sistem yolu olamaz,
// farklı değişkenlerin kaynakları iç içe olamaz, sır dosyaları hiçbir bağın içinde olamaz (anahtar/sır dizini sızmasın).
const BAGLAR = {
  "satici-db": [{ hedef: "/var/lib/postgresql/data", birim: "satici-pg" }],
  satici: [
    { hedef: "/anahtarlar", degisken: "ANAHTAR_DIZINI_HOST", ro: true },
    { hedef: "/dosyalar", degisken: "DOSYA_DIZINI_HOST", ro: false },
    { hedef: "/derlemeler", degisken: "DERLEME_DIZINI_HOST", ro: true },
    { hedef: "/yayin", degisken: "YAYIN_DIZINI_HOST", ro: true },
    { hedef: "/erisim-jwks", degisken: "ERISIM_JWKS_DIZINI_HOST", ro: true },
  ],
  "satici-yedek": [
    { hedef: "/yedek", degisken: "YEDEK_DIZINI_HOST", ro: false },
    { hedef: "/yedek-alici", degisken: "YEDEK_ALICI_DIZINI_HOST", ro: true },
    { hedef: "/anahtarlar", degisken: "ANAHTAR_DIZINI_HOST", ro: true },
  ],
  "satici-jwks": [{ hedef: "/erisim-jwks", degisken: "ERISIM_JWKS_DIZINI_HOST", ro: false }],
};
const SISTEM_YOLLARI = ["/etc", "/root", "/home", "/run", "/var/run", "/proc", "/sys", "/dev", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/var/lib/docker", "/var/lib/containerd", "/snap"];
const yolNorm = (p) => String(p ?? "").replace(/\/+$/, "") || "/";
const yolIcIce = (x, y) => {
  const a = yolNorm(x);
  const b = yolNorm(y);
  return a === b || a === "/" || b === "/" || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};
{
  const kullanilan = [];
  for (const [ad, s] of servisler) {
    const izinli = Object.hasOwn(BAGLAR, ad) ? BAGLAR[ad] : [];
    const kotu = [];
    for (const v of s.volumes ?? []) {
      const b = izinli.find((x) => x.hedef === v.target);
      const etiket = `${v.source ?? "?"}:${v.target ?? "?"}`;
      if (!b) {
        kotu.push(`beyansız bağ ${etiket}`);
        continue;
      }
      if (b.birim) {
        if (v.type !== "volume" || v.source !== b.birim) kotu.push(`${v.target} yalnız ${b.birim} birimi (${v.type} ${v.source ?? "?"})`);
        continue;
      }
      const beklenenKaynak = envDegeri(envDosyasi, b.degisken);
      if (v.type !== "bind") kotu.push(`${v.target} bind değil (${v.type})`);
      else if (!beklenenKaynak.startsWith("/") || yolNorm(v.source) !== yolNorm(beklenenKaynak)) kotu.push(`${v.target} kaynağı .env'deki ${b.degisken} değil (${v.source ?? "?"})`);
      else kullanilan.push({ ad, degisken: b.degisken, kaynak: yolNorm(v.source) });
      if (b.ro && v.read_only !== true) kotu.push(`${v.target} salt okunur değil`);
    }
    kontrol(`③d ${ad} host bağları beyanlı (hedef · kaynak = .env değişkeni · salt okunurluk)`, kotu.length === 0, kotu.join(" · "));
  }
  const tumBaglar = servisler.flatMap(([ad, s]) => (s.volumes ?? []).filter((v) => v.type === "bind").map((v) => ({ ad, kaynak: yolNorm(v.source) })));
  const sistem = tumBaglar.filter((x) => x.kaynak === "/" || SISTEM_YOLLARI.some((y) => yolIcIce(x.kaynak, y))).map((x) => `${x.ad}:${x.kaynak}`);
  const icIceler = kullanilan.flatMap((x, i) => kullanilan.slice(i + 1).filter((y) => y.degisken !== x.degisken && yolIcIce(x.kaynak, y.kaynak)).map((y) => `${x.degisken}↔${y.degisken}`));
  const sirDosyalari = Object.entries(cfg.secrets ?? {}).map(([ad, x]) => [ad, x.file]).filter(([, f]) => !!f);
  const sizan = sirDosyalari.flatMap(([sir, f]) => tumBaglar.filter((x) => yolIcIce(f, x.kaynak)).map((x) => `${sir}→${x.ad}:${x.kaynak}`));
  kontrol(
    "③d bağ kaynakları sistem yolu değil (/ · /etc · /root · /run · /var/run · docker …) · farklı değişkenlerin kaynakları iç içe değil · sır dosyaları hiçbir bağın içinde değil",
    sistem.length === 0 && icIceler.length === 0 && sizan.length === 0,
    [...sistem.map((x) => `sistem yolu ${x}`), ...[...new Set(icIceler)].map((x) => `iç içe ${x}`), ...sizan.map((x) => `sır bağda ${x}`)].join(" · "),
  );
}

// ③e group_add YALNIZ sır grubu (SIR_GID; sayısal, sistem grubu değil) ve yalnız sırrı okuyan servislerde.
{
  const GRUPLU = ["satici-db", "satici", "satici-goc", "satici-yedek", "satici-bildirim"];
  const sirGid = envDegeri(envDosyasi, "SIR_GID");
  const gidGecerli = /^\d{1,10}$/.test(sirGid) && Number(sirGid) >= 1000 && Number(sirGid) !== 65534;
  const kotu = servisler
    .filter(([ad, s]) => JSON.stringify((s.group_add ?? []).map(String)) !== JSON.stringify(GRUPLU.includes(ad) ? [sirGid] : []))
    .map(([ad, s]) => `${ad}: ${JSON.stringify(s.group_add ?? [])}`);
  kontrol(`③e group_add yalnız SIR_GID (sayısal, ≥ 1000) ve yalnız ${GRUPLU.join(" · ")}'de`, gidGecerli && kotu.length === 0, [gidGecerli ? "" : `SIR_GID=${sirGid || "YOK"} geçersiz`, ...kotu].filter(Boolean).join(" · "));
}

// ④ ağlar
const aglar = cfg.networks ?? {};
for (const anahtar of ["kenar", "ic", "ic-api"]) {
  kontrol(`④ ${anahtar} ağı internal`, aglar[anahtar]?.internal === true, aglar[anahtar]?.name ?? "YOK");
}
const disAglar = Object.entries(aglar).filter(([, n]) => n.external).map(([a]) => a);
const disaKatilan = servisler.filter(([, s]) => Object.keys(s.networks ?? {}).some((n) => disAglar.includes(n) || !(n in aglar))).map(([a]) => a);
kontrol("④ dış (external) ağa katılan servis yok (`web` dahil)", disAglar.length === 0 && disaKatilan.length === 0, [...disAglar, ...disaKatilan].join(", "));
const saticiAglari = Object.keys(cfg.services?.satici?.networks ?? {}).sort();
kontrol("④b satıcının ağ kümesi tam üç ağ (kenar · ic · ic-api), üçü internal — örtü satıcıya ağ eklemez", JSON.stringify(saticiAglari) === JSON.stringify(["ic", "ic-api", "kenar"]), saticiAglari.join(", "));
{
  const uyeler = (ag) => servisler.filter(([, sv]) => ag in (sv.networks ?? {})).map(([a]) => a).sort();
  const izinli = Object.assign({}, ...aktif.map((o) => o.cikisAglari));
  const acik = Object.entries(aglar).filter(([, n]) => n.internal !== true && !n.external).map(([a]) => a);
  const kotu = acik.filter((a) => !(a in izinli) || JSON.stringify(uyeler(a)) !== JSON.stringify([...izinli[a]].sort()));
  kontrol(
    "④c internal olmayan ağ yalnız örtü çıkış ağları (yalnız yan konteyner) — satıcının dış bağlantısı yok",
    kotu.length === 0,
    acik.map((a) => `${a}: ${uyeler(a).join("+") || "boş"}`).join(" · ") || "hepsi internal",
  );
}

// ⑤ anahtar birimi
for (const [ad, s] of servisler) {
  for (const v of s.volumes ?? []) {
    if (v.target === "/anahtarlar") kontrol(`⑤ ${ad} anahtar birimi salt okunur`, v.read_only === true);
  }
}

// ⑥ köprü ağları CGNAT/geri döngü aralığı dışında (ağ geçidi adresi kaynak kapısını kandırmasın)
for (const [anahtar, n] of Object.entries(aglar)) {
  for (const c of n.ipam?.config ?? []) {
    if (!c.subnet) continue;
    const kotu = ["100.64.0.0/10", "127.0.0.0/8"].filter((y) => cakisir(c.subnet, y));
    kontrol(`⑥ ${anahtar} ağı (${c.subnet}) 100.64/10 (CGNAT) ve geri döngü aralığında DEĞİL`, kotu.length === 0, kotu.join(", "));
  }
}

// ⑥c IPv6 KAPALI — çıkış kuralları (DOCKER-USER, vds/bildirim-cikis.sh · runbook §5) yalnız IPv4'ü daraltır; v6 açık bir
// köprü (özellikle bildirim-cikis / jwks-cikis) kuralı atlayan ikinci çıkış olur. Her ağda enable_ipv6 ve v6 alt ağı YASAK.
for (const [anahtar, n] of Object.entries(aglar)) {
  const v6 = (n.ipam?.config ?? []).map((c) => c.subnet ?? "").filter((x) => x.includes(":"));
  const secenek = Object.keys(n.driver_opts ?? {}).filter((k) => /ipv6/i.test(k));
  kontrol(`⑥c ${anahtar} ağında IPv6 kapalı (enable_ipv6 · v6 alt ağı · ipv6 sürücü seçeneği YOK)`, n.enable_ipv6 !== true && v6.length === 0 && secenek.length === 0,
    [n.enable_ipv6 === true ? "enable_ipv6=true" : "", ...v6.map((x) => `v6 alt ağ ${x}`), ...secenek].filter(Boolean).join(" · "));
}

// ⑥b kenar: dinamik aralık alt ağda, satıcının sabit adresi aralık dışında ve alt ağda
{
  const kc = aglar.kenar?.ipam?.config?.[0] ?? {};
  const sabit = cfg.services?.satici?.networks?.kenar?.ipv4_address ?? "";
  const aralikIcinde = kc.ip_range && kc.subnet ? cakisir(kc.ip_range, kc.subnet) && Number(kc.ip_range.split("/")[1]) >= Number(kc.subnet.split("/")[1]) : false;
  kontrol(
    "⑥b kenar ağında dinamik aralık alt ağda, satıcının sabit adresi aralığın DIŞINDA",
    aralikIcinde && sabit !== "" && aralikta(sabit, kc.subnet) && !aralikta(sabit, kc.ip_range),
    `alt ağ ${kc.subnet ?? "YOK"} · dinamik ${kc.ip_range ?? "YOK"} · satıcı ${sabit || "YOK"}`,
  );
}

// ⑦ Traefik + DB
const traefikli = servisler.filter(([, s]) => Object.keys(s.labels ?? {}).some((k) => k.startsWith("traefik."))).map(([a]) => a);
kontrol("⑦ Traefik etiketi yalnız `satici`de", traefikli.length === 1 && traefikli[0] === "satici", traefikli.join(", ") || "hiçbiri");
const satici = cfg.services?.satici ?? {};
kontrol("⑦ Traefik kenar ağını kullanır", satici.labels?.["traefik.docker.network"] === aglar.kenar?.name, `${satici.labels?.["traefik.docker.network"]} ↔ ${aglar.kenar?.name}`);
// Genel yönlendirici ADIYLA (= proje adı) seçilir: bir örtü ikinci yönlendirici eklerse (portal) sıralama onu öne almasın.
const genelKural = (c) => c.services?.satici?.labels?.[`traefik.http.routers.${c.name}.rule`] ?? "";
const kural = genelKural(cfg);
kontrol("⑦ genel yönlendirici (proje adıyla) Host kuralı taşır", /^Host\(`[a-z0-9.-]+`\)$/.test(kural), kural || "YOK");
const etiket = satici.labels ?? {};
const yonlendiriciler = [...new Set(Object.keys(etiket).map((k) => /^traefik\.http\.routers\.([^.]+)\./.exec(k)?.[1]).filter(Boolean))].sort();
const hizmetPortu = Object.fromEntries(Object.entries(etiket).flatMap(([k, v]) => {
  const m = /^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/.exec(k);
  return m ? [[m[1], String(v)]] : [];
}));
{
  const beklenenY = [cfg.name, ...aktif.flatMap((o) => o.yonlendiriciler(cfg))].sort();
  kontrol("⑦ yönlendirici kümesi = genel + örtülerinki", JSON.stringify(yonlendiriciler) === JSON.stringify(beklenenY), `${yonlendiriciler.join(", ")} ↔ ${beklenenY.join(", ")}`);
  const kotuY = yonlendiriciler.filter((r) => !/^Host\(`[a-z0-9.-]+`\)$/.test(etiket[`traefik.http.routers.${r}.rule`] ?? "") || etiket[`traefik.http.routers.${r}.entrypoints`] !== "websecure" || etiket[`traefik.http.routers.${r}.tls`] !== "true");
  kontrol("⑦ her yönlendirici: tek Host kuralı · websecure · tls", kotuY.length === 0, kotuY.join(", "));
  const cokHizmet = Object.keys(hizmetPortu).length > 1;
  const hizmetinPortu = (r) => {
    const h = etiket[`traefik.http.routers.${r}.service`];
    if (h) return hizmetPortu[h];
    return cokHizmet ? undefined : Object.values(hizmetPortu)[0];
  };
  const baglanmamis = yonlendiriciler.filter((r) => hizmetinPortu(r) === undefined);
  kontrol("⑦ her yönlendirici bir hizmete bağlı (birden çok hizmette AÇIKÇA); genel yönlendirici → 4610", baglanmamis.length === 0 && hizmetinPortu(cfg.name) === "4610", `${baglanmamis.join(", ") || "tamam"} · genel → ${hizmetinPortu(cfg.name) ?? "YOK"}`);
  const izinliPort = ["4610", ...aktif.flatMap((o) => o.hizmetPortlari)];
  const kotuPort = Object.entries(hizmetPortu).filter(([, pt]) => !izinliPort.includes(pt));
  kontrol("⑦ Traefik hizmet portları yalnız genel (4610) + örtülerinki — emekli tünel 4611 / iç API 4612 ASLA", kotuPort.length === 0, kotuPort.map(([h, pt]) => `${h}:${pt}`).join(", ") || Object.values(hizmetPortu).join(", "));
}
const db = cfg.services?.["satici-db"] ?? {};
kontrol("⑦ DB portsuz ve yalnız iç ağda", (db.ports ?? []).length === 0 && JSON.stringify(Object.keys(db.networks ?? {})) === '["ic"]', Object.keys(db.networks ?? {}).join(", "));

// ⑧ iç API
{
  const ac = aglar["ic-api"]?.ipam?.config?.[0] ?? {};
  const icIp = satici.networks?.["ic-api"]?.ipv4_address ?? "";
  const ortamIc = satici.environment ?? {};
  const kaynaklar = String(ortamIc.IC_KAYNAK_AGLARI ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const gecit = ac.subnet ? (() => {
    const [ag] = ac.subnet.split("/");
    const p = ag.split(".").map(Number);
    return `${p[0]}.${p[1]}.${p[2]}.${p[3] + 1}`;
  })() : "";
  const dinamikte = (ip) => !!ac.ip_range && aralikta(ip, ac.ip_range);
  kontrol("⑧a satıcı iç API'yi ic-api ağındaki sabit adresinde dinler (IC_BIND, 4612)", icIp !== "" && ortamIc.IC_BIND === icIp && String(ortamIc.PORT_IC) === "4612", `IC_BIND=${ortamIc.IC_BIND ?? "YOK"} · adres=${icIp || "YOK"} · PORT_IC=${ortamIc.PORT_IC ?? "YOK"}`);
  kontrol("⑧b satıcının iç adresi alt ağda, ağ geçidi değil, dinamik aralığın DIŞINDA", icIp !== "" && !!ac.subnet && aralikta(icIp, ac.subnet) && icIp !== gecit && !dinamikte(icIp), `alt ağ ${ac.subnet ?? "YOK"} · dinamik ${ac.ip_range ?? "YOK"}`);
  const kaynakIp = kaynaklar.length === 1 && kaynaklar[0].endsWith("/32") ? kaynaklar[0].slice(0, -3) : "";
  kontrol(
    "⑧c kaynak YALNIZ tek /32 (patron): alt ağda, ağ geçidi/satıcı değil, dinamik aralık dışında",
    kaynakIp !== "" && aralikta(kaynakIp, ac.subnet ?? "0.0.0.0/32") && kaynakIp !== gecit && kaynakIp !== icIp && !dinamikte(kaynakIp),
    `IC_KAYNAK_AGLARI=${ortamIc.IC_KAYNAK_AGLARI ?? "YOK"}`,
  );
  const sirli = servisler.filter(([, sv]) => (sv.secrets ?? []).some((x) => (x.source ?? x) === "ic_api_belirteci")).map(([a]) => a);
  kontrol("⑧d iç API sırrı docker secret'ı, yalnız satıcıda", JSON.stringify(sirli) === '["satici"]' && ortamIc.IC_API_BELIRTEC_DOSYASI === "/run/secrets/ic_api_belirteci", `${sirli.join(", ") || "hiçbiri"} · ${ortamIc.IC_API_BELIRTEC_DOSYASI ?? "YOK"}`);
  const yayin4612 = servisler.flatMap(([a, sv]) => (sv.ports ?? []).filter((p) => String(p.target) === "4612").map(() => a));
  kontrol("⑧e 4612 hiçbir yere yayımlanmaz", yayin4612.length === 0, yayin4612.join(", "));
}

// ⑨ dağıtım bağları
{
  const bag = (hedef) => (satici.volumes ?? []).find((v) => v.target === hedef);
  const ortam = satici.environment ?? {};
  const dosya = bag("/dosyalar");
  kontrol("⑨a /dosyalar bağlı ve YAZILIR (satıcının kendi birimi)", !!dosya && dosya.read_only !== true, dosya ? `${dosya.source} ro=${dosya.read_only === true}` : "YOK");
  for (const hedef of ["/derlemeler", "/yayin"]) {
    const v = bag(hedef);
    kontrol(`⑨b ${hedef} bağlı ve SALT OKUNUR`, !!v && v.read_only === true, v ? `${v.source} ro=${v.read_only === true}` : "YOK");
  }
  const bek = { DOSYA_DIZINI: "/dosyalar", DERLEME_DIZINI: "/derlemeler", YAYIN_DIZINI: "/yayin" };
  const kotu = Object.entries(bek).filter(([k, v]) => ortam[k] !== v).map(([k, v]) => `${k}=${ortam[k] ?? "YOK"} (beklenen ${v})`);
  kontrol("⑨c ortam adları bağlarla aynı", kotu.length === 0, kotu.join(", "));
  kontrol("⑨d GENEL_KOK_ADRESI https kökü", /^https:\/\/[a-z0-9.-]+\/?$/.test(String(ortam.GENEL_KOK_ADRESI ?? "")), String(ortam.GENEL_KOK_ADRESI ?? "YOK"));
  const icinde = (a, b) => !!a && !!b && (a === b || a.startsWith(`${b.replace(/\/$/, "")}/`) || b.startsWith(`${a.replace(/\/$/, "")}/`));
  const src = dosya?.source ?? "";
  kontrol("⑨e dosya birimi yayın kökü ve anahtar birimiyle iç içe değil", !!src && !icinde(src, bag("/yayin")?.source) && !icinde(src, bag("/anahtarlar")?.source), src || "YOK");
  const baska = servisler.filter(([ad, sv]) => ad !== "satici" && (sv.volumes ?? []).some((v) => ["/dosyalar", "/derlemeler", "/yayin"].includes(v.target))).map(([ad]) => ad);
  kontrol("⑨f dağıtım bağları yalnız satıcıda", baska.length === 0, baska.join(", "));
}

// create_host_path'in JSON izi compose sürümüne göre TERS anlam taşır (biri false'u, öteki true'yu düşürür; ikisinde de
// `bind: {}` kalır) — anlam iki açık değerli kalibrasyon bağının izinden ölçülür; ayırt edilemezse ÖLÇÜLEMEDİ (çıkış 2).
const hostYoluIzi = (v) => (v?.bind === undefined ? "bind yok" : Object.hasOwn(v.bind, "create_host_path") ? `create_host_path=${v.bind.create_host_path}` : "bind {}");
function hostYoluYaratmazIzi() {
  const dizin = mkdtempSync(path.join(os.tmpdir(), "compose-denetle-kalibrasyon-"));
  let r;
  try {
    const f = path.join(dizin, "kalibrasyon.yml");
    writeFileSync(
      f,
      "services:\n  k:\n    image: kalibrasyon\n    volumes:\n" +
        "      - { type: bind, source: /kalibrasyon-false, target: /false, bind: { create_host_path: false } }\n" +
        "      - { type: bind, source: /kalibrasyon-true, target: /true, bind: { create_host_path: true } }\n",
    );
    r = spawnSync("docker", ["compose", "-p", "kalibrasyon", "-f", f, "config", "--format", "json"], { encoding: "utf8" });
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
  const baglar = r.status === 0 ? (JSON.parse(r.stdout).services?.k?.volumes ?? []) : [];
  const yanlis = hostYoluIzi(baglar.find((v) => v.target === "/false"));
  const dogru = hostYoluIzi(baglar.find((v) => v.target === "/true"));
  if (r.status !== 0 || yanlis === dogru) {
    console.error(`ÖLÇÜLEMEDİ: create_host_path kalibrasyonu — ${r.status !== 0 ? (r.stderr || r.error?.message || "").trim() : `false ve true aynı izi bırakıyor (${yanlis})`}`);
    process.exit(2);
  }
  return yanlis;
}

// ⑬ örtülerin kendi denetimleri
function portalGenelDenetle(c) {
  const s = c.services?.satici ?? {};
  const ortam = s.environment ?? {};
  const j = c.services?.["satici-jwks"] ?? {};
  const jOrtam = j.environment ?? {};
  const kenarIp = s.networks?.kenar?.ipv4_address ?? "";
  const yayin4613 = Object.entries(c.services ?? {}).flatMap(([a, sv]) => (sv.ports ?? []).filter((pt) => String(pt.target) === "4613").map(() => a));
  kontrol("⑬a PORT_ERISIM 4613 · ERISIM_BIND = satıcının kenar adresi · 4613 hiçbir yere yayımlanmaz",
    String(ortam.PORT_ERISIM) === "4613" && kenarIp !== "" && ortam.ERISIM_BIND === kenarIp && yayin4613.length === 0,
    `PORT_ERISIM=${ortam.PORT_ERISIM ?? "YOK"} · ERISIM_BIND=${ortam.ERISIM_BIND ?? "YOK"} · kenar=${kenarIp || "YOK"} · yayın ${yayin4613.join(", ") || "yok"}`);
  const alan = String(ortam.CF_ACCESS_TAKIM_ALANI ?? "");
  const dosya = String(ortam.CF_ACCESS_JWKS_DOSYASI ?? "");
  kontrol("⑬b Access ayarı: takım alanı <takım>.cloudflareaccess.com · AUD 64 onaltılık · JWKS dosyası /erisim-jwks/ altında · yan konteyner aynı alan ve dosya",
    /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(alan) && /^[0-9a-f]{64}$/.test(String(ortam.CF_ACCESS_AUD ?? "")) && dosya.startsWith("/erisim-jwks/") &&
      jOrtam.CF_ACCESS_TAKIM_ALANI === alan && jOrtam.JWKS_DOSYASI === dosya,
    `alan=${alan || "YOK"} · AUD ${String(ortam.CF_ACCESS_AUD ?? "").length} kr · dosya=${dosya || "YOK"} · yan=${jOrtam.JWKS_DOSYASI ?? "YOK"}`);
  const sBag = (s.volumes ?? []).find((v) => v.target === "/erisim-jwks");
  const jBag = (j.volumes ?? []).find((v) => v.target === "/erisim-jwks");
  const kaynak = sBag?.source ?? "";
  const icIce = (x, y) => !!x && !!y && (x === y || x.startsWith(`${y.replace(/\/$/, "")}/`) || y.startsWith(`${x.replace(/\/$/, "")}/`));
  const yasakKaynak = ["/anahtarlar", "/dosyalar", "/derlemeler", "/yayin"].map((h) => (s.volumes ?? []).find((v) => v.target === h)?.source).filter(Boolean);
  const yaratmazIzi = hostYoluYaratmazIzi();
  const yaratmaz = (v) => !!v && hostYoluIzi(v) === yaratmazIzi;
  kontrol("⑬c JWKS bağı: satıcıda SALT OKUNUR, yan konteynerde aynı kaynak YAZILIR, ikisinde create_host_path yok, kaynak anahtar/dağıtım birimlerinin dışında",
    !!sBag && sBag.read_only === true && !!jBag && jBag.read_only !== true && jBag.source === kaynak && yaratmaz(sBag) && yaratmaz(jBag) &&
      !yasakKaynak.some((y) => icIce(kaynak, y)),
    `${kaynak || "YOK"} · satıcı ro=${sBag?.read_only === true} · yan ro=${jBag?.read_only === true} · host yolu yaratmaz: satıcı=${yaratmaz(sBag)} yan=${yaratmaz(jBag)}`);
  const jBaglar = (j.volumes ?? []).map((v) => v.target);
  const jEksik = [];
  if (j.image !== s.image) jEksik.push(`imaj ${j.image ?? "YOK"} ≠ satıcı`);
  if (JSON.stringify(j.entrypoint) !== JSON.stringify(["node", "/uygulama/dist/jwks-cekici.js"])) jEksik.push(`giriş ${JSON.stringify(j.entrypoint)}`);
  if ((j.secrets ?? []).length > 0) jEksik.push("sır bağlı");
  if (JSON.stringify(jBaglar) !== JSON.stringify(["/erisim-jwks"])) jEksik.push(`bağlar ${jBaglar.join(",")}`);
  if ((j.ports ?? []).length > 0) jEksik.push("port");
  if (Object.keys(j.labels ?? {}).some((k) => k.startsWith("traefik."))) jEksik.push("Traefik etiketi");
  if (JSON.stringify(Object.keys(j.networks ?? {})) !== '["jwks-cikis"]') jEksik.push(`ağlar ${Object.keys(j.networks ?? {}).join(",")}`);
  kontrol("⑬d satici-jwks: satıcı imajı + çekici giriş noktası · sır/anahtar/dağıtım bağı/port/Traefik etiketi YOK · ağı yalnız jwks-cikis", jEksik.length === 0, jEksik.join(" · "));
  const ca = c.networks?.["jwks-cikis"] ?? {};
  const uyeler = Object.entries(c.services ?? {}).filter(([, sv]) => "jwks-cikis" in (sv.networks ?? {})).map(([a]) => a);
  const alt = ca.ipam?.config?.[0]?.subnet ?? "";
  kontrol("⑬e jwks-cikis: internal değil · external değil · alt ağı 100.64/10 ve 127/8 dışında · tek üyesi satici-jwks",
    ca.internal !== true && !ca.external && alt !== "" && !cakisir(alt, "100.64.0.0/10") && !cakisir(alt, "127.0.0.0/8") && JSON.stringify(uyeler) === '["satici-jwks"]',
    `${ca.name ?? "YOK"} · ${alt || "alt ağ YOK"} · üyeler ${uyeler.join(",") || "yok"}`);
  const e = s.labels ?? {};
  const r = `${c.name}-portal`;
  const h = e[`traefik.http.routers.${r}.service`] ?? "";
  const ara = e[`traefik.http.routers.${r}.middlewares`] ?? "";
  const kaynaklar = String(e[`traefik.http.middlewares.${ara}.ipallowlist.sourcerange`] ?? "").split(",").map((x) => x.trim()).filter(Boolean).sort();
  const cf = cloudflareAglari();
  kontrol("⑬f portal yönlendiricisi: PORTAL_HOST Host kuralı · hizmeti 4613 · ipallowlist kaynakları CLOUDFLARE_NETWORKS ile BİREBİR",
    /^Host\(`[a-z0-9.-]+`\)$/.test(e[`traefik.http.routers.${r}.rule`] ?? "") && e[`traefik.http.services.${h}.loadbalancer.server.port`] === "4613" &&
      !ara.includes(",") && cf !== null && JSON.stringify(kaynaklar) === JSON.stringify([...cf].sort()),
    `${e[`traefik.http.routers.${r}.rule`] ?? "kural YOK"} · hizmet ${h || "YOK"} · ${kaynaklar.length} kaynak ↔ ${cf === null ? "CLOUDFLARE_NETWORKS OKUNAMADI" : `${cf.length} Cloudflare aralığı`}`);
  // Ortam ALLOWLIST'i: çekicinin okuduğu üç anahtar (+ NODE_ENV); vekil/CA/NODE_OPTIONS gibi her fazla anahtar ihlal.
  const jIzinli = {
    CF_ACCESS_TAKIM_ALANI: (v) => v === alan,
    JWKS_DOSYASI: (v) => v === dosya,
    JWKS_CEKIM_DK: (v) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 60,
    NODE_ENV: (v) => v === "production",
  };
  // Object.hasOwn: `in` prototip zincirine bakar — `toString`/`constructor` adlı ortam anahtarı allowlist'i geçmesin.
  const jKotu = Object.entries(jOrtam).filter(([k, v]) => !Object.hasOwn(jIzinli, k) || !jIzinli[k](String(v ?? ""))).map(([k]) => (Object.hasOwn(jIzinli, k) ? `${k} beklenen değer değil` : `tanınmayan ${k}`));
  for (const k of ["CF_ACCESS_TAKIM_ALANI", "JWKS_DOSYASI"]) if (!Object.hasOwn(jOrtam, k)) jKotu.push(`${k} YOK`);
  kontrol("⑬g satici-jwks ortamı ALLOWLIST: CF_ACCESS_TAKIM_ALANI · JWKS_DOSYASI (satıcınınkiyle aynı) · JWKS_CEKIM_DK 1–60 · NODE_ENV=production; başka anahtar YOK", jKotu.length === 0, jKotu.join(" · "));
  const jAg = envDegeri(envDosyasi, "JWKS_CIKIS_AGI");
  const jCfg = ca.ipam?.config ?? [];
  kontrol("⑬h jwks-cikis alt ağı = .env'deki JWKS_CIKIS_AGI (DOCKER-USER kuralının ağı, runbook §5) · tek ipam girdisi",
    jAg !== "" && jCfg.length === 1 && jCfg[0]?.subnet === jAg,
    `compose ${jCfg.map((x) => x.subnet ?? "?").join(", ") || "YOK"} · .env ${jAg || "YOK"}`);
}

function bildirimDenetle(c) {
  const hizmetler = c.services ?? {};
  const b = hizmetler["satici-bildirim"] ?? {};
  const ag = c.networks ?? {};
  const uyeler = (a) => Object.entries(hizmetler).filter(([, sv]) => a in (sv.networks ?? {})).map(([x]) => x).sort();

  const dosyada = composeDosyalari.some((f) => path.basename(f) === BILDIRIM_ORTU_DOSYASI);
  const serviste = "satici-bildirim" in hizmetler;
  kontrol(`Ⓑ0 örtü dosyası (${BILDIRIM_ORTU_DOSYASI}) COMPOSE_FILE'da ↔ satici-bildirim beklenen servislerde ve çözüldü`, dosyada && serviste, `dosya ${dosyada ? "var" : "YOK"} · servis ${serviste ? "var" : "YOK"}`);

  const acik = Object.entries(ag).filter(([, n]) => n.internal !== true && !n.external).map(([a]) => a).sort();
  const beklenenAcik = aktif.flatMap((o) => Object.keys(o.cikisAglari)).sort();
  const cikisUyeleri = uyeler("bildirim-cikis");
  kontrol(
    `Ⓑ1 internal olmayan ağlar tam olarak ${beklenenAcik.join(" + ")} · bildirim-cikis'in tek üyesi satici-bildirim`,
    JSON.stringify(acik) === JSON.stringify(beklenenAcik) && JSON.stringify(cikisUyeleri) === '["satici-bildirim"]',
    `açık: ${acik.join(", ") || "yok"} · bildirim-cikis üyeleri: ${cikisUyeleri.join(", ") || "yok"}`,
  );

  const bAglari = Object.keys(b.networks ?? {}).sort();
  const cekirdekCikista = ["satici", "satici-db", "satici-goc", "satici-yedek"].filter((x) => "bildirim-cikis" in (hizmetler[x]?.networks ?? {}));
  kontrol(
    "Ⓑ2 satici-bildirim ağları tam olarak ic + bildirim-cikis · satıcı/DB/göç/yedek bildirim-cikis'e katılmaz",
    JSON.stringify(bAglari) === '["bildirim-cikis","ic"]' && cekirdekCikista.length === 0,
    `gönderici: ${bAglari.join(", ") || "yok"}${cekirdekCikista.length ? ` · çıkışta: ${cekirdekCikista.join(", ")}` : ""}`,
  );

  const k3 = [];
  if ((b.ports ?? []).length > 0) k3.push("port");
  if ((b.volumes ?? []).length > 0) k3.push(`birim ${(b.volumes ?? []).map((v) => v.target).join(",")}`);
  if (Object.keys(b.labels ?? {}).some((k) => k.startsWith("traefik."))) k3.push("Traefik etiketi");
  if (JSON.stringify(b.volumes ?? []).includes("docker.sock")) k3.push("docker soketi");
  kontrol("Ⓑ3 satici-bildirim: port · birim (anahtar/dosya/derleme/yayın) · Traefik etiketi · docker soketi YOK", k3.length === 0, k3.join(" · "));

  const sirAdi = (x) => (typeof x === "string" ? x : x.source);
  const bSirlar = (b.secrets ?? []).map(sirAdi).sort();
  const hedefKotu = (b.secrets ?? []).filter((x) => typeof x !== "string" && x.target !== undefined && x.target !== `/run/secrets/${x.source}`).map((x) => `${x.source}→${x.target}`);
  const baskasinda = Object.entries(hizmetler)
    .filter(([a]) => a !== "satici-bildirim")
    .flatMap(([a, sv]) => (sv.secrets ?? []).map(sirAdi).filter((x) => BILDIRIM_SIRLARI.includes(x)).map((x) => `${a}:${x}`));
  kontrol(
    `Ⓑ4 satici-bildirim sırları tam olarak dört (${BILDIRIM_SIRLARI.join(" · ")}) — db_parolasi/ic_api_belirteci YOK; bu dördü başka serviste YOK`,
    JSON.stringify(bSirlar) === JSON.stringify(BILDIRIM_SIRLARI) && hedefKotu.length === 0 && baskasinda.length === 0,
    [`gönderici: ${bSirlar.join(", ") || "yok"}`, ...hedefKotu, ...(baskasinda.length ? [`başka serviste: ${baskasinda.join(", ")}`] : [])].join(" · "),
  );

  // Ortam ALLOWLIST'i (değer basılmaz — sır olabilir; ayrıntıda yalnız anahtar adı): zorunlu sabitler + göndericinin
  // okuduğu isteğe bağlı ayarlar. NODE_OPTIONS · vekil · CA · DATABASE_URL · düz sır gibi her tanınmayan anahtar ihlal;
  // DB adresi/adı ve sağlayıcı kökleri yalnız beklenen değerle (başka kök belirteci ve iletiyi dışarı taşır).
  const e = b.environment ?? {};
  const k5 = [];
  for (const [k, v] of Object.entries(e)) {
    const kural = Object.hasOwn(BILDIRIM_ORTAMI, k) ? BILDIRIM_ORTAMI[k] : undefined;
    if (!kural) k5.push(`tanınmayan ${BILDIRIM_DUZ_SIRLAR.includes(k) ? `düz ${k}` : k}`);
    else if (!kural.gecerli(String(v ?? ""))) k5.push(`${k} ${kural.aciklama}`);
  }
  for (const [k, kural] of Object.entries(BILDIRIM_ORTAMI)) if (kural.zorunlu && !Object.hasOwn(e, k)) k5.push(`${k} YOK`);
  kontrol("Ⓑ5 ortam ALLOWLIST: DB_KULLANICI=satici_bildirim · sır yolları /run/secrets/ · nabız /tmp · DB_HOST/DB_ADI ve sağlayıcı kökleri yalnız beklenen değer · başka anahtar YOK", k5.length === 0, k5.join(" · "));

  const k6 = [];
  if (!b.image || b.image !== hizmetler.satici?.image) k6.push(`imaj ${b.image ?? "YOK"} ≠ satıcı ${hizmetler.satici?.image ?? "YOK"}`);
  if (JSON.stringify(b.command) !== JSON.stringify(["node", "dist/notifications/sender-main.js"])) k6.push(`komut ${JSON.stringify(b.command ?? null)}`);
  if (b.entrypoint !== undefined && b.entrypoint !== null) k6.push(`giriş noktası ezilmiş ${JSON.stringify(b.entrypoint)}`);
  kontrol("Ⓑ6 satici-bildirim imajı SATICI_IMAJ (satıcıyla aynı) · komut node dist/notifications/sender-main.js · imajın giriş noktası", k6.length === 0, k6.join(" · "));

  const alt = ag["bildirim-cikis"]?.ipam?.config?.[0]?.subnet ?? "";
  const altlar = (aglar) => Object.entries(aglar ?? {}).flatMap(([a, n]) => (n.ipam?.config ?? []).filter((x) => x.subnet).map((x) => [a, x.subnet]));
  const saticiCakisan = alt ? altlar(ag).filter(([a, sn]) => a !== "bildirim-cikis" && cakisir(alt, sn)).map(([a, sn]) => `${a} ${sn}`) : [];
  const ayrilmis = alt ? ["100.64.0.0/10", "127.0.0.0/8"].filter((y) => cakisir(alt, y)) : [];
  kontrol("Ⓑ7 bildirim-cikis alt ağı 100.64/10 ve 127/8 dışında, satıcının öteki ağlarıyla çakışmaz", alt !== "" && ayrilmis.length === 0 && saticiCakisan.length === 0, `${alt || "alt ağ YOK"}${[...ayrilmis, ...saticiCakisan].length ? ` ↔ ${[...ayrilmis, ...saticiCakisan].join(", ")}` : ""}`);
  if (!patronEnv) {
    olculmedi++;
    console.log(`⏭ Ⓑ7 bildirim-cikis ↔ patron ağları ÖLÇÜLMEDİ (--patron-env verilmedi) — geçti SAYILMAZ${c.name === "tekserp-satici-uretim" ? "; ÜRETİMDE ZORUNLU (çıkış 2)" : ""}`);
  } else {
    const p = coz(patronEnv, [path.join(burasi, "..", "patron", "docker-compose.yml")]).cfg;
    const pAltlar = altlar(p.networks);
    const pCakisan = alt ? pAltlar.filter(([, sn]) => cakisir(alt, sn)).map(([a, sn]) => `${p.name}/${a} ${sn}`) : [];
    kontrol("Ⓑ7 bildirim-cikis patronun ağlarıyla çakışmaz (--patron-env)", alt !== "" && pAltlar.length > 0 && pCakisan.length === 0, `${alt || "alt ağ YOK"} ↔ ${pCakisan.join(", ") || pAltlar.map(([a, sn]) => `${a} ${sn}`).join(" · ") || "patron alt ağı YOK"}`);
  }
  // Çıkış kuralı ALT AĞA bağlıdır (-s $AG): compose'un köprüsü betiğin daralttığı ağdan farklıysa gönderici kuralsız çıkar.
  const betikDegiskeni = bildirimCikisAgDegiskeni();
  const envAgi = betikDegiskeni ? envDegeri(envDosyasi, betikDegiskeni) : "";
  const bCfg = ag["bildirim-cikis"]?.ipam?.config ?? [];
  kontrol(
    "Ⓑ7b bildirim-cikis alt ağı = .env'deki BILDIRIM_CIKIS_AGI = vds/bildirim-cikis.sh'ın kural koyduğu ağ · tek ipam girdisi",
    betikDegiskeni !== null && envAgi !== "" && bCfg.length === 1 && bCfg[0]?.subnet === envAgi,
    `compose ${bCfg.map((x) => x.subnet ?? "?").join(", ") || "YOK"} · .env ${envAgi || "YOK"} · betik ${betikDegiskeni ? `AG=$${betikDegiskeni}` : "OKUNAMADI"}`,
  );

  const betik = bildirimCikisDns();
  const beklenenDns = betik ? betik.map(([ad, vars]) => envDegeri(envDosyasi, ad) || vars).sort() : null;
  const dns = (Array.isArray(b.dns) ? b.dns : b.dns ? [b.dns] : []).map(String);
  kontrol(
    "Ⓑ8 dns iki sabit IPv4 ve vds/bildirim-cikis.sh'ın 53'ü açtığı adreslerle aynı",
    beklenenDns !== null && dns.length === 2 && new Set(dns).size === 2 && dns.every((x) => ipv4(x) !== null) && JSON.stringify([...dns].sort()) === JSON.stringify(beklenenDns),
    `compose ${dns.join(", ") || "YOK"} · betik ${beklenenDns ? beklenenDns.join(", ") : "OKUNAMADI"}`,
  );
}

/** bildirim-cikis.sh'ın 53'ü açtığı iki çözücü: [ortam adı, varsayılan] — betik biçimi değişirse null (Ⓑ8 kırmızı). */
function bildirimCikisDns() {
  try {
    const metin = readFileSync(path.join(burasi, "vds", "bildirim-cikis.sh"), "utf8");
    const tanim = [...metin.matchAll(/^DNS([12])=\$\{([A-Z0-9_]+):-([0-9.]+)\}$/gm)].map((m) => [m[1], m[2], m[3]]);
    const dongu = /for d in "\$DNS1" "\$DNS2"; do/.test(metin);
    return tanim.length === 2 && dongu && tanim[0][0] === "1" && tanim[1][0] === "2" ? tanim.map(([, ad, vars]) => [ad, vars]) : null;
  } catch {
    return null;
  }
}

/** bildirim-cikis.sh'ın kural koyduğu ağın .env değişkeni (`. ./.env` + `AG=$<DEĞİŞKEN>`); betik biçimi değişirse null (Ⓑ7b kırmızı). */
function bildirimCikisAgDegiskeni() {
  try {
    const metin = readFileSync(path.join(burasi, "vds", "bildirim-cikis.sh"), "utf8");
    const env = /^\. \.\/\.env$/m.test(metin);
    const ag = [...metin.matchAll(/^AG=\$\{?([A-Z0-9_]+)\}?$/gm)].map((m) => m[1]);
    return env && ag.length === 1 && /-s "\$AG"/.test(metin) ? ag[0] : null;
  } catch {
    return null;
  }
}

/** .env'deki son atama (tırnak soyulur); yoksa "" — betik `. ./.env` ile aynı dosyayı okur. */
function envDegeri(dosya, ad) {
  const satirlar = readFileSync(dosya, "utf8").split(/\r?\n/);
  const v = satirlar.map((l) => l.match(new RegExp(`^\\s*${ad}\\s*=\\s*(.*?)\\s*$`))?.[1]).filter((x) => x !== undefined).pop() ?? "";
  return v.replace(/^["']|["']$/g, "");
}

/** CLOUDFLARE_NETWORKS'ün tek kaynağı satıcının `client-address.ts`i; okunamazsa null (⑬f ölçülemez → kırmızı). */
function cloudflareAglari() {
  try {
    const kaynak = readFileSync(path.join(burasi, "..", "..", "satici", "sunucu", "src", "http", "client-address.ts"), "utf8");
    const govde = /CLOUDFLARE_NETWORKS[^=]*=\s*\[([\s\S]*?)\]/.exec(kaynak)?.[1] ?? "";
    const liste = [...govde.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return liste.length > 0 ? liste : null;
  } catch {
    return null;
  }
}

for (const o of aktif) {
  console.log(`\n${o.simge} örtü: ${o.ad}`);
  o.denetle(cfg);
}

// ⑩ genel kök ↔ Host kuralı
{
  const host = /^Host\(`([a-z0-9.-]+)`\)$/.exec(kural)?.[1] ?? "";
  const kokHost = /^https:\/\/([a-z0-9.-]+)\/?$/.exec(String(satici.environment?.GENEL_KOK_ADRESI ?? ""))?.[1] ?? "";
  kontrol("⑩ GENEL_KOK_ADRESI'nin makinesi Traefik Host kuralıyla aynı", host !== "" && host === kokHost, `Host=${host || "YOK"} · genel kök=${kokHost || "YOK"}`);
}

// ⑪ gömülü güven çapası
{
  const ortam = satici.environment ?? {};
  const projeOrtami = /^tekserp-satici-(uretim|hazirlik)$/.exec(String(cfg.name ?? ""))?.[1] ?? null;
  kontrol("⑪ GUVEN_CAPASI_DOSYASI YOK (gömülü çapa; dosya çapası yalnız test) · NODE_ENV=production · GUVEN_CAPASI = projenin ORTAMI",
    !("GUVEN_CAPASI_DOSYASI" in ortam) && ortam.NODE_ENV === "production" && projeOrtami !== null && ortam.GUVEN_CAPASI === projeOrtami,
    `GUVEN_CAPASI_DOSYASI=${ortam.GUVEN_CAPASI_DOSYASI ?? "yok"} · NODE_ENV=${ortam.NODE_ENV ?? "YOK"} · GUVEN_CAPASI=${ortam.GUVEN_CAPASI ?? "YOK"} · proje ${projeOrtami ?? cfg.name}`);
}

// ⑫ iki ortam yan yana
const uretim = cfg.name === "tekserp-satici-uretim";
if (!digerEnv) {
  olculmedi++;
  console.log(`⏭ ⑫ ortamlar arası çakışma ÖLÇÜLMEDİ (--diger-env verilmedi) — geçti SAYILMAZ${uretim ? "; ÜRETİM hazırlığın yanına kurulur → ZORUNLU (çıkış 2)" : ""}`);
} else {
  const o = coz(digerEnv, []).cfg;
  const bu = (c) => ({
    proje: c.name,
    pg: c.volumes?.["satici-pg"]?.name,
    host: genelKural(c),
    kokAdres: String(c.services?.satici?.environment?.GENEL_KOK_ADRESI ?? ""),
    gid: JSON.stringify(c.services?.satici?.group_add ?? []),
    agAdlari: Object.values(c.networks ?? {}).map((n) => n.name),
    altAglar: Object.values(c.networks ?? {}).flatMap((n) => (n.ipam?.config ?? []).map((x) => x.subnet).filter(Boolean)),
    baglar: Object.values(c.services ?? {}).flatMap((sv) => (sv.volumes ?? []).filter((v) => v.type === "bind").map((v) => ({ kaynak: v.source, hedef: v.target }))),
    sirlar: Object.values(c.secrets ?? {}).map((x) => x.file).filter(Boolean),
    portlar: Object.values(c.services ?? {}).flatMap((sv) => (sv.ports ?? []).map((p) => `${p.host_ip ?? "0.0.0.0"}:${p.published}`)),
    kalinti: [
      ...Object.keys(c.services ?? {}).filter((x) => EMEKLI_SERVISLER.includes(x)),
      ...Object.entries(c.networks ?? {}).filter(([x, n]) => /tailnet/i.test(`${x} ${n.name ?? ""}`)).map(([x]) => `ağ ${x}`),
    ],
  });
  const a = bu(cfg);
  const b = bu(o);
  console.log(`\n⑫ öteki ortam: ${b.proje} (${path.basename(digerEnv)})`);
  kontrol("⑫a proje · DB hacmi · Traefik Host · genel kök · sır grubu FARKLI", a.proje !== b.proje && a.pg !== b.pg && a.host !== b.host && a.kokAdres !== b.kokAdres && a.gid !== b.gid,
    `${a.proje}/${b.proje} · ${a.pg}/${b.pg} · ${a.host}/${b.host} · gid ${a.gid}/${b.gid}`);
  const ortakAg = a.agAdlari.filter((n) => b.agAdlari.includes(n));
  kontrol("⑫b ağ adları ortak değil", ortakAg.length === 0, ortakAg.join(", "));
  const cakisan = a.altAglar.flatMap((x) => b.altAglar.filter((y) => cakisir(x, y)).map((y) => `${x}↔${y}`));
  kontrol("⑫c köprü alt ağları çakışmaz", cakisan.length === 0, cakisan.join(", ") || `${a.altAglar.join(" ")} | ${b.altAglar.join(" ")}`);
  const icIce = (x, y) => x === y || x.startsWith(`${y.replace(/\/$/, "")}/`) || y.startsWith(`${x.replace(/\/$/, "")}/`);
  const ortakBag = a.baglar.flatMap((x) => b.baglar.filter((y) => icIce(x.kaynak, y.kaynak) && !(x.hedef === "/yayin" && y.hedef === "/yayin")).map((y) => `${x.kaynak}→${x.hedef} ↔ ${y.kaynak}→${y.hedef}`));
  kontrol("⑫d host bağları ortak/iç içe değil (anahtar · yedek · alıcı · dosya · derleme; yalnız /yayin ortak)", ortakBag.length === 0, ortakBag.join(" | "));
  const ortakSir = a.sirlar.filter((x) => b.sirlar.some((y) => icIce(x, y)));
  kontrol("⑫e sır dosyaları (DB parolası · iç API belirteci) ortak değil", ortakSir.length === 0, ortakSir.join(", "));
  kontrol("⑫f öteki ortam da port yayımlamaz ve tünel kalıntısı taşımaz (portal-tunel · tailnet ağı)", b.portlar.length === 0 && b.kalinti.length === 0, [...b.portlar, ...b.kalinti].join(", "));
}

console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal${olculmedi ? `, ${olculmedi} ölçülmedi` : ""} ===`);
process.exit(ihlal > 0 ? 1 : olculmedi > 0 && uretim ? 2 : 0);
