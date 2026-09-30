#!/usr/bin/env node
// =============================================================================
// Satıcı compose'unun yalıtım değişmezleri — UYGULAMADAN ÖNCE (Mac'te, sunucunun .env'iyle) koşulur.
// =============================================================================
// `docker compose config --format json` çıktısını (değişkenler çözülmüş hâli) ölçer:
//   ① port yalnız `satici`de ve YALNIZ Tailscale adresine (100.64.0.0/10) yayımlı
//   ② docker soketi hiçbir servise bağlı değil
//   ③ her servis: salt okunur kök FS · cap_drop ALL · no-new-privileges · root olmayan kullanıcı ·
//      bellek + CPU + süreç sınırı
//   ③b her servis (yan konteynerler dahil): yalıtım GEVŞETMESİ yok — volumes_from · privileged · cap_add · pid/ipc/uts/
//      userns/cgroup · devices · runtime · sysctls YASAK; network_mode yalnız beyanlı istisna (geri döngü kipinde
//      portal-tunel → service:satici); security_opt TAM OLARAK no-new-privileges:true (seccomp/apparmor/label gevşetmesi yok)
//   ③c her servisin anahtarları TANINAN kümede (fail-closed: bilinmeyen anahtar = ihlal; yeni anahtar bilinçli eklenir)
//   ④ kenar + ic ağları internal; dış (`external`) ağa katılan servis yok (Traefik'in `web`i dahil)
//   ⑤ anahtar birimi her bağlandığı yerde salt okunur
//   ⑥ satıcı köprü ağları 100.64/10 ve 127/8 DIŞINDA — köprü ağ geçidi tailnet kapısını kandırmasın
//      (ölçüldü: tailnet ağı 100.100.100.0/28 iken host'tan yayımlı porta gelen istek geçidin
//      adresiyle girip portalı 200 açtı)
//   ⑥b kenar ağında dinamik dağıtım aralığı (ip_range) alt ağın içinde ve satıcının sabit adresi
//      onun DIŞINDA — Traefik (dinamik) satıcının adresini kapamasın
//   ⑦ Traefik etiketi yalnız `satici`de ve kenar ağını gösteriyor; DB'nin portu ve dış ağı yok
//   ⑧ İÇ API (patron bulutu → satıcı): `ic-api` ağı internal, satıcı sabit adresinde dinler (IC_BIND = o
//      adres, 4612), kaynak YALNIZ patronun sabit /32'si (alt ağda, ağ geçidi .1 değil, satıcı değil,
//      dinamik aralığın DIŞINDA); sır docker secret'ı (`ic_api_belirteci`) yalnız satıcıya bağlı
//   ⑨ DAĞITIM BAĞLARI (3d-1): kök FS salt okunur → satıcının yazdığı TEK yol `/dosyalar` (kendi birimi, rw);
//      `/derlemeler` ve `/yayin` (güncelleme sunucusu kökü) salt okunur; ortam adları bağlarla aynı; genel kök
//      https; dosya birimi yayın kökünün/anahtar biriminin içinde değil; üç bağ YALNIZ satıcıda
//   Ⓛ GERİ DÖNGÜ KİPİ (docker-compose.loopback.yml, satıcıda TAILNET_LOOPBACK=1 — Tailscale gelene dek):
//      ① yerine: HİÇBİR port yayımlanmaz · satıcının tailnet dinleyicisi 127.0.0.1'de · tailnet ağı
//      internal · `portal-tunel` satıcının ağ ad alanında, portsuz/birimsiz, tailnet köprü adresini dinler.
//      Ana kipte TAILNET_LOOPBACK ve `portal-tunel` YASAK (iki kip karışmaz).
//   ⑩ GENEL_KOK_ADRESI'nin makinesi Traefik Host kuralıyla aynı (/d · /y bağlantısı başka ortama gitmesin)
//   ⑪ satıcı gömülü güven çapasıyla koşar: GUVEN_CAPASI_DOSYASI YOK (yalnız test) · NODE_ENV=production
//   Ⓞ ÖRTÜLER (ana dosyanın üstüne bindirilen kipler; algı + beklenen servisler + kendi denetimleri, ORTULER listesi):
//      portal-genel (`docker-compose.portal-genel.yml`: `satici-jwks` servisi ya da satıcıda PORT_ERISIM) → ⑬.
//      Her kipte: satıcının ağ kümesi tam dört ağ (örtü satıcıya ağ EKLEMEZ); internal olmayan ağ yalnız ana kipte
//      `tailnet` (üyesi yalnız satıcı) ve örtünün çıkış ağı (üyesi yalnız örtünün yan konteyneri) — ④b/④c.
//      ⑦ BÜTÜN Traefik yönlendiricilerini ölçer: küme = genel (+ örtününkiler), her biri Host + websecure + tls;
//      birden çok hizmette her yönlendirici hizmetine AÇIKÇA bağlı, genel → 4610; hizmet portları 4611/4612 OLAMAZ.
//   ⑬ PORTAL-GENEL: PORT_ERISIM 4613 · ERISIM_BIND = kenar adresi · 4613 yayımlanmaz · Access ayarı biçimli · JWKS bağı
//      satıcıda salt okunur, yan konteynerde yazılır, create_host_path yok, anahtar/dağıtım birimlerinin dışında ·
//      `satici-jwks` satıcı imajı + çekici giriş noktası, sırsız/bağsız/portsuz/etiketsiz, yalnız `jwks-cikis`te ·
//      `jwks-cikis` internal değil, tek üyeli · portal yönlendiricisi 4613'e, ipallowlist = CLOUDFLARE_NETWORKS birebir.
//   ⑫ İKİ ORTAM YAN YANA (--diger-env <öteki ortamın .env'i>): proje/DB hacmi/Host/genel kök/sır grubu farklı,
//      köprü alt ağları çakışmaz, host bağları ve sır dosyaları ortak ya da iç içe değil (tek istisna salt
//      okunur yayın kökü), yayımlı portlar çakışmaz — üretim hazırlığın anahtarını/DB'sini ASLA bağlamasın.
//      Verilmezse ⑫ ÖLÇÜLMEDİ diye basılır (geçti sayılmaz); ORTAM=uretim'de çıkış 2 (hazırlığın yanına kurulur).
//
// Kullanım: node deploy/satici/compose-denetle.mjs --env-file <.env> [-f <compose> ...] [--diger-env <.env>]
//   -f verilmezse .env'deki COMPOSE_FILE (":" ayrık, bu dizine göre) — yoksa docker-compose.yml.
// Çıkış: 0 temiz · 1 ihlal · 2 ölçülemedi (docker yok / config çözülemedi).
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
if (!envDosyasi || (args.includes("--diger-env") && !digerEnv)) {
  console.error("kullanım: compose-denetle.mjs --env-file <.env> [-f <compose> ...] [--diger-env <.env>]");
  process.exit(2);
}
const acikF = args.flatMap((a, i) => (a === "-f" && args[i + 1] ? [args[i + 1]] : []));

/** .env'in çözülmüş compose yapılandırması (COMPOSE_FILE ya da -f); okunamazsa ÖLÇÜLEMEDİ (çıkış 2). */
function coz(env, fDosyalari) {
  let envMetni;
  try {
    envMetni = readFileSync(env, "utf8");
  } catch (err) {
    console.error(`ÖLÇÜLEMEDİ: .env okunamadı (${env}) — ${err.message}`);
    process.exit(2);
  }
  const composeFileSatiri = envMetni
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*COMPOSE_FILE\s*=\s*(.*?)\s*$/)?.[1])
    .filter((v) => v !== undefined)
    .pop();
  const dosyalar =
    fDosyalari.length > 0
      ? fDosyalari
      : composeFileSatiri
        ? composeFileSatiri.replace(/^["']|["']$/g, "").split(":").filter(Boolean).map((f) => path.resolve(burasi, f))
        : [path.join(burasi, "docker-compose.yml")];
  const r = spawnSync(
    "docker",
    ["compose", "--env-file", env, ...dosyalar.flatMap((f) => ["-f", f]), "--profile", "goc", "config", "--format", "json"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(`ÖLÇÜLEMEDİ: docker compose config (${env}) — ${(r.stderr || r.error?.message || "").trim()}`);
    process.exit(2);
  }
  return { cfg: JSON.parse(r.stdout), dosyalar };
}
const { cfg, dosyalar: composeDosyalari } = coz(envDosyasi, acikF);

let ihlal = 0;
let gecti = 0;
function kontrol(ad, ok, ayrinti = "") {
  if (ok) gecti++;
  else ihlal++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

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
const saticiOrtam = cfg.services?.satici?.environment ?? {};
const geriDongu = String(saticiOrtam.TAILNET_LOOPBACK ?? "") === "1";
const tunel = cfg.services?.["portal-tunel"];

// Örtüler: her biri kendi algısı, yan konteynerleri, çıkış ağları (ağ → izinli tek üyeler), Traefik yönlendiricileri ve
// hizmet portlarıyla. Yeni örtü (ör. bildirim) buraya bir girdi + kendi denetim işleviyle eklenir.
const ORTULER = [
  {
    ad: "portal-genel",
    var: (c) => "satici-jwks" in (c.services ?? {}) || "PORT_ERISIM" in (c.services?.satici?.environment ?? {}),
    servisler: ["satici-jwks"],
    cikisAglari: { "jwks-cikis": ["satici-jwks"] },
    yonlendiriciler: (c) => [`${c.name}-portal`],
    hizmetPortlari: ["4613"],
    denetle: (c) => portalGenelDenetle(c),
  },
];
const aktif = ORTULER.filter((o) => o.var(cfg));
console.log(`kip: ${geriDongu ? "GERİ DÖNGÜ (Tailscale öncesi, portal yalnız VDS içinden)" : "TAILNET"}${aktif.length ? ` · örtü: ${aktif.map((o) => o.ad).join(" + ")}` : ""} · dosyalar: ${composeDosyalari.map((f) => path.basename(f)).join(" + ")}\n`);
const beklenen = [
  ...(geriDongu ? ["satici-db", "satici", "satici-goc", "satici-yedek", "portal-tunel"] : ["satici-db", "satici", "satici-goc", "satici-yedek"]),
  ...aktif.flatMap((o) => o.servisler),
];
kontrol(
  `körlük zemini: ${beklenen.length} servis çözüldü (${beklenen.join(" · ")})`,
  servisler.length === beklenen.length && beklenen.every((a) => a in (cfg.services ?? {})),
  servisler.map(([a]) => a).join(", "),
);

// ① port yayını
const yayinlayan = servisler.filter(([, s]) => (s.ports ?? []).length > 0);
if (geriDongu) {
  kontrol("①Ⓛ hiçbir servis port yayımlamaz (portal yalnız VDS'in içinden, SSH tüneliyle)", yayinlayan.length === 0, yayinlayan.map(([a]) => a).join(", ") || "hiçbiri");
  kontrol("①Ⓛ satıcının tailnet dinleyicisi konteynerin geri döngüsünde (TAILNET_BIND=127.0.0.1)", saticiOrtam.TAILNET_BIND === "127.0.0.1", String(saticiOrtam.TAILNET_BIND ?? "YOK"));
  const kopruIp = cfg.services?.satici?.networks?.tailnet?.ipv4_address;
  const tunelOrtam = tunel?.environment ?? {};
  kontrol("①Ⓛ portal-tunel satıcının ağ ad alanında", tunel?.network_mode === "service:satici", String(tunel?.network_mode ?? "YOK"));
  kontrol(
    "①Ⓛ portal-tunel portsuz ve birimsiz, yalnız tailnet köprü adresini dinler",
    (tunel?.ports ?? []).length === 0 && (tunel?.volumes ?? []).length === 0 && !!kopruIp && tunelOrtam.TUNEL_DINLE === kopruIp,
    `TUNEL_DINLE=${tunelOrtam.TUNEL_DINLE ?? "YOK"} · köprü=${kopruIp ?? "YOK"}`,
  );
} else {
  kontrol("① yalnız `satici` port yayımlar", yayinlayan.length === 1 && yayinlayan[0][0] === "satici", yayinlayan.map(([a]) => a).join(", ") || "hiçbiri");
  for (const [ad, s] of yayinlayan) {
    for (const p of s.ports) {
      const ip = p.host_ip ?? "";
      kontrol(`① ${ad}:${p.published}→${p.target} yalnız Tailscale adresine (100.64.0.0/10)`, ip !== "" && aralikta(ip, "100.64.0.0/10"), ip || "host_ip YOK (0.0.0.0)");
    }
  }
  kontrol("① geri döngü kalıntısı yok (TAILNET_LOOPBACK · portal-tunel)", !tunel && saticiOrtam.TAILNET_LOOPBACK === undefined, [tunel ? "portal-tunel" : "", saticiOrtam.TAILNET_LOOPBACK !== undefined ? `TAILNET_LOOPBACK=${saticiOrtam.TAILNET_LOOPBACK}` : ""].filter(Boolean).join(", "));
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
  const uid = kullanici.split(":")[0];
  const eksik = [];
  if (s.read_only !== true) eksik.push("read_only");
  if (!(s.cap_drop ?? []).includes("ALL")) eksik.push("cap_drop ALL");
  if (!(s.security_opt ?? []).includes("no-new-privileges:true")) eksik.push("no-new-privileges");
  if (!kullanici || uid === "0" || uid === "root") eksik.push("root olmayan user");
  if (!s.mem_limit) eksik.push("mem_limit");
  if (!s.cpus) eksik.push("cpus");
  if (!s.pids_limit) eksik.push("pids_limit");
  kontrol(`③ ${ad} sertleştirilmiş`, eksik.length === 0, eksik.length ? `eksik: ${eksik.join(", ")}` : `user ${kullanici} · ${s.mem_limit} · ${s.cpus} cpu · ${s.pids_limit} süreç`);
}

// ③b yalıtım gevşetmesi — cap_drop ALL'ı cap_add/privileged ezse ③ yine yeşil verirdi; burada her anahtar ayrı ölçülür.
// Beyanlı istisnalar (servis · anahtar · değer · koşul); başka her gevşetme ihlaldir.
const ISTISNALAR = [
  { servis: "portal-tunel", anahtar: "network_mode", deger: "service:satici", kosul: () => geriDongu, neden: "geri döngü iletici (§4a)" },
];
const istisna = (ad, anahtar, deger) => ISTISNALAR.some((i) => i.servis === ad && i.anahtar === anahtar && i.deger === deger && i.kosul());
const doluMu = (v) => v !== undefined && v !== null && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const YASAK_ANAHTARLAR = ["volumes_from", "privileged", "cap_add", "pid", "ipc", "uts", "userns_mode", "cgroup", "cgroup_parent", "devices", "device_cgroup_rules", "runtime", "isolation", "sysctls", "network_mode"];
for (const [ad, s] of servisler) {
  const gevsek = YASAK_ANAHTARLAR.filter((k) => doluMu(s[k]) && !istisna(ad, k, s[k])).map((k) => `${k}=${JSON.stringify(s[k])}`);
  const so = s.security_opt ?? [];
  if (JSON.stringify(so) !== JSON.stringify(["no-new-privileges:true"])) gevsek.push(`security_opt=${JSON.stringify(so)} (yalnız no-new-privileges:true)`);
  kontrol(`③b ${ad} yalıtım gevşetmesi yok`, gevsek.length === 0, gevsek.join(" · ") || (s.network_mode ? `beyanlı istisna: network_mode=${s.network_mode}` : ""));
}

// ③c tanınan anahtarlar: `docker compose config` çıktısında bugün görülen (+ bildirim yan konteynerinin `dns`i) küme.
const TANINAN_ANAHTARLAR = new Set([
  "cap_drop", "command", "container_name", "cpus", "depends_on", "dns", "entrypoint", "environment", "group_add", "healthcheck", "image",
  "init", "labels", "logging", "mem_limit", "memswap_limit", "network_mode", "networks", "pids_limit", "ports", "profiles", "read_only",
  "restart", "secrets", "security_opt", "tmpfs", "user", "volumes",
]);
for (const [ad, s] of servisler) {
  const bilinmeyen = Object.keys(s).filter((k) => !TANINAN_ANAHTARLAR.has(k));
  kontrol(`③c ${ad} yalnız tanınan anahtarlar`, bilinmeyen.length === 0, bilinmeyen.length ? `tanınmayan: ${bilinmeyen.join(", ")}` : "");
}

// ④ ağlar
const aglar = cfg.networks ?? {};
for (const anahtar of geriDongu ? ["kenar", "ic", "tailnet", "ic-api"] : ["kenar", "ic", "ic-api"]) {
  kontrol(`④ ${anahtar} ağı internal`, aglar[anahtar]?.internal === true, aglar[anahtar]?.name ?? "YOK");
}
const disAglar = Object.entries(aglar).filter(([, n]) => n.external).map(([a]) => a);
const disaKatilan = servisler.filter(([, s]) => Object.keys(s.networks ?? {}).some((n) => disAglar.includes(n) || !(n in aglar))).map(([a]) => a);
kontrol("④ dış (external) ağa katılan servis yok (`web` dahil)", disAglar.length === 0 && disaKatilan.length === 0, [...disAglar, ...disaKatilan].join(", "));
const saticiAglari = Object.keys(cfg.services?.satici?.networks ?? {}).sort();
kontrol("④b satıcının ağ kümesi tam dört ağ (kenar · ic · tailnet · ic-api) — örtü satıcıya ağ eklemez", JSON.stringify(saticiAglari) === JSON.stringify(["ic", "ic-api", "kenar", "tailnet"]), saticiAglari.join(", "));
{
  const uyeler = (ag) => servisler.filter(([, sv]) => ag in (sv.networks ?? {})).map(([a]) => a).sort();
  const izinli = { ...(geriDongu ? {} : { tailnet: ["satici"] }), ...Object.assign({}, ...aktif.map((o) => o.cikisAglari)) };
  const acik = Object.entries(aglar).filter(([, n]) => n.internal !== true && !n.external).map(([a]) => a);
  const kotu = acik.filter((a) => !(a in izinli) || JSON.stringify(uyeler(a)) !== JSON.stringify([...izinli[a]].sort()));
  kontrol(
    `④c internal olmayan ağ yalnız ${geriDongu ? "" : "tailnet (yalnız satıcı) ve "}örtü çıkış ağları (yalnız yan konteyner)`,
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

// ⑥ köprü ağları tailnet/geri döngü aralığı dışında
for (const [anahtar, n] of Object.entries(aglar)) {
  for (const c of n.ipam?.config ?? []) {
    if (!c.subnet) continue;
    const kotu = ["100.64.0.0/10", "127.0.0.0/8"].filter((y) => cakisir(c.subnet, y));
    kontrol(`⑥ ${anahtar} ağı (${c.subnet}) tailnet/geri döngü aralığında DEĞİL`, kotu.length === 0, kotu.join(", "));
  }
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
  kontrol("⑦ Traefik hizmet portları yalnız genel (4610) + örtülerinki — tailnet 4611 / iç API 4612 ASLA", kotuPort.length === 0, kotuPort.map(([h, pt]) => `${h}:${pt}`).join(", ") || Object.values(hizmetPortu).join(", "));
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
  kontrol("⑬c JWKS bağı: satıcıda SALT OKUNUR, yan konteynerde aynı kaynak YAZILIR, ikisinde create_host_path yok, kaynak anahtar/dağıtım birimlerinin dışında",
    !!sBag && sBag.read_only === true && !!jBag && jBag.read_only !== true && jBag.source === kaynak && sBag.bind?.create_host_path === false && jBag.bind?.create_host_path === false &&
      !yasakKaynak.some((y) => icIce(kaynak, y)),
    `${kaynak || "YOK"} · satıcı ro=${sBag?.read_only === true} · yan ro=${jBag?.read_only === true}`);
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
  console.log(`\n⑬ örtü: ${o.ad}`);
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
  kontrol("⑪ GUVEN_CAPASI_DOSYASI YOK (gömülü ROOT_PUBLIC_KEYS; dosya çapası yalnız test) · NODE_ENV=production",
    !("GUVEN_CAPASI_DOSYASI" in ortam) && ortam.NODE_ENV === "production", `GUVEN_CAPASI_DOSYASI=${ortam.GUVEN_CAPASI_DOSYASI ?? "yok"} · NODE_ENV=${ortam.NODE_ENV ?? "YOK"}`);
}

// ⑫ iki ortam yan yana
let olculmedi = 0;
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
  const ortakPort = a.portlar.filter((x) => b.portlar.includes(x));
  kontrol("⑫f yayımlı portlar çakışmaz", ortakPort.length === 0, ortakPort.join(", "));
}

console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal${olculmedi ? `, ${olculmedi} ölçülmedi` : ""} ===`);
process.exit(ihlal > 0 ? 1 : olculmedi > 0 && uretim ? 2 : 0);
