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
//   ⑦ Traefik etiketi yalnız `satici`de ve kenar ağını gösteriyor; DB'nin portu ve dış ağı yok
//
// Kullanım: node deploy/satici/compose-denetle.mjs --env-file <.env> [-f <compose>]
// Çıkış: 0 temiz · 1 ihlal · 2 ölçülemedi (docker yok / config çözülemedi).
// =============================================================================
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const burasi = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const al = (ad) => {
  const i = args.indexOf(ad);
  return i >= 0 ? args[i + 1] : undefined;
};
const envDosyasi = al("--env-file");
const composeDosyasi = al("-f") ?? path.join(burasi, "docker-compose.yml");
if (!envDosyasi) {
  console.error("kullanım: compose-denetle.mjs --env-file <.env> [-f <compose>]");
  process.exit(2);
}

const r = spawnSync("docker", ["compose", "--env-file", envDosyasi, "-f", composeDosyasi, "--profile", "goc", "config", "--format", "json"], {
  encoding: "utf8",
});
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
kontrol("körlük zemini: dört servis çözüldü (db · satici · goc · yedek)", servisler.length === 4, servisler.map(([a]) => a).join(", "));

// ① port yayını
const yayinlayan = servisler.filter(([, s]) => (s.ports ?? []).length > 0);
kontrol("① yalnız `satici` port yayımlar", yayinlayan.length === 1 && yayinlayan[0][0] === "satici", yayinlayan.map(([a]) => a).join(", ") || "hiçbiri");
for (const [ad, s] of yayinlayan) {
  for (const p of s.ports) {
    const ip = p.host_ip ?? "";
    kontrol(`① ${ad}:${p.published}→${p.target} yalnız Tailscale adresine (100.64.0.0/10)`, ip !== "" && aralikta(ip, "100.64.0.0/10"), ip || "host_ip YOK (0.0.0.0)");
  }
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
for (const anahtar of ["kenar", "ic"]) {
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

// ⑦ Traefik + DB
const traefikli = servisler.filter(([, s]) => String(s.labels?.["traefik.enable"] ?? "") === "true").map(([a]) => a);
kontrol("⑦ Traefik etiketi yalnız `satici`de", traefikli.length === 1 && traefikli[0] === "satici", traefikli.join(", ") || "hiçbiri");
const satici = cfg.services?.satici ?? {};
kontrol("⑦ Traefik kenar ağını kullanır", satici.labels?.["traefik.docker.network"] === aglar.kenar?.name, `${satici.labels?.["traefik.docker.network"]} ↔ ${aglar.kenar?.name}`);
const kural = Object.entries(satici.labels ?? {}).find(([k]) => /^traefik\.http\.routers\..+\.rule$/.test(k))?.[1] ?? "";
kontrol("⑦ yönlendirici Host kuralı taşır", /^Host\(`[a-z0-9.-]+`\)$/.test(kural), kural || "YOK");
const db = cfg.services?.["satici-db"] ?? {};
kontrol("⑦ DB portsuz ve yalnız iç ağda", (db.ports ?? []).length === 0 && JSON.stringify(Object.keys(db.networks ?? {})) === '["ic"]', Object.keys(db.networks ?? {}).join(", "));

console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal ===`);
process.exit(ihlal > 0 ? 1 : 0);
