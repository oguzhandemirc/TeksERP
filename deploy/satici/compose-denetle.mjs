#!/usr/bin/env node
// =============================================================================
// Satıcı compose'unun yalıtım değişmezleri — UYGULAMADAN ÖNCE (Mac'te, sunucunun .env'iyle) koşulur.
// =============================================================================
// `docker compose config --format json` çıktısını (değişkenler çözülmüş hâli) ölçer:
//   ① port yalnız `satici`de ve YALNIZ Tailscale adresine (100.64.0.0/10) yayımlı
//   ② docker soketi hiçbir servise bağlı değil
//   ③ her servis: salt okunur kök FS · cap_drop ALL · no-new-privileges · root olmayan kullanıcı ·
//      bellek + CPU + süreç sınırı
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
//   Ⓛ GERİ DÖNGÜ KİPİ (docker-compose.loopback.yml, satıcıda TAILNET_LOOPBACK=1 — Tailscale gelene dek):
//      ① yerine: HİÇBİR port yayımlanmaz · satıcının tailnet dinleyicisi 127.0.0.1'de · tailnet ağı
//      internal · `portal-tunel` satıcının ağ ad alanında, portsuz/birimsiz, tailnet köprü adresini dinler.
//      Ana kipte TAILNET_LOOPBACK ve `portal-tunel` YASAK (iki kip karışmaz).
//
// Kullanım: node deploy/satici/compose-denetle.mjs --env-file <.env> [-f <compose> ...]
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
if (!envDosyasi) {
  console.error("kullanım: compose-denetle.mjs --env-file <.env> [-f <compose> ...]");
  process.exit(2);
}
let envMetni;
try {
  envMetni = readFileSync(envDosyasi, "utf8");
} catch (err) {
  console.error(`ÖLÇÜLEMEDİ: .env okunamadı — ${err.message}`);
  process.exit(2);
}
const composeFileSatiri = envMetni
  .split(/\r?\n/)
  .map((l) => l.match(/^\s*COMPOSE_FILE\s*=\s*(.*?)\s*$/)?.[1])
  .filter((v) => v !== undefined)
  .pop();
const acikF = args.flatMap((a, i) => (a === "-f" && args[i + 1] ? [args[i + 1]] : []));
const composeDosyalari =
  acikF.length > 0
    ? acikF
    : composeFileSatiri
      ? composeFileSatiri.replace(/^["']|["']$/g, "").split(":").filter(Boolean).map((f) => path.resolve(burasi, f))
      : [path.join(burasi, "docker-compose.yml")];

const r = spawnSync(
  "docker",
  ["compose", "--env-file", envDosyasi, ...composeDosyalari.flatMap((f) => ["-f", f]), "--profile", "goc", "config", "--format", "json"],
  { encoding: "utf8" },
);
if (r.status !== 0) {
  console.error(`ÖLÇÜLEMEDİ: docker compose config — ${(r.stderr || r.error?.message || "").trim()}`);
  process.exit(2);
}
const cfg = JSON.parse(r.stdout);

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
console.log(`kip: ${geriDongu ? "GERİ DÖNGÜ (Tailscale öncesi, portal yalnız VDS içinden)" : "TAILNET"} · dosyalar: ${composeDosyalari.map((f) => path.basename(f)).join(" + ")}\n`);
const beklenen = geriDongu ? ["satici-db", "satici", "satici-goc", "satici-yedek", "portal-tunel"] : ["satici-db", "satici", "satici-goc", "satici-yedek"];
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

// ④ ağlar
const aglar = cfg.networks ?? {};
for (const anahtar of geriDongu ? ["kenar", "ic", "tailnet", "ic-api"] : ["kenar", "ic", "ic-api"]) {
  kontrol(`④ ${anahtar} ağı internal`, aglar[anahtar]?.internal === true, aglar[anahtar]?.name ?? "YOK");
}
const disAglar = Object.entries(aglar).filter(([, n]) => n.external).map(([a]) => a);
const disaKatilan = servisler.filter(([, s]) => Object.keys(s.networks ?? {}).some((n) => disAglar.includes(n) || !(n in aglar))).map(([a]) => a);
kontrol("④ dış (external) ağa katılan servis yok (`web` dahil)", disAglar.length === 0 && disaKatilan.length === 0, [...disAglar, ...disaKatilan].join(", "));

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
const traefikli = servisler.filter(([, s]) => String(s.labels?.["traefik.enable"] ?? "") === "true").map(([a]) => a);
kontrol("⑦ Traefik etiketi yalnız `satici`de", traefikli.length === 1 && traefikli[0] === "satici", traefikli.join(", ") || "hiçbiri");
const satici = cfg.services?.satici ?? {};
kontrol("⑦ Traefik kenar ağını kullanır", satici.labels?.["traefik.docker.network"] === aglar.kenar?.name, `${satici.labels?.["traefik.docker.network"]} ↔ ${aglar.kenar?.name}`);
const kural = Object.entries(satici.labels ?? {}).find(([k]) => /^traefik\.http\.routers\..+\.rule$/.test(k))?.[1] ?? "";
kontrol("⑦ yönlendirici Host kuralı taşır", /^Host\(`[a-z0-9.-]+`\)$/.test(kural), kural || "YOK");
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

console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal ===`);
process.exit(ihlal > 0 ? 1 : 0);
