#!/usr/bin/env node
// =============================================================================
// Patron bulutu compose'unun yalıtım değişmezleri — UYGULAMADAN ÖNCE (Mac'te, sunucunun .env'iyle) koşulur.
// =============================================================================
// `docker compose config --format json` çıktısını (değişkenler çözülmüş hâli) ölçer:
//   ① hiçbir servis port yayımlamaz (tek giriş Traefik; kenar ağı internal)
//   ② docker soketi hiçbir servise bağlı değil
//   ③ her servis: salt okunur kök FS · cap_drop ALL · no-new-privileges · root olmayan kullanıcı ·
//      bellek + CPU + süreç sınırı; uzun ömürlü servislerin bellek tavanı toplamı ≤ 1 GiB (VDS 3 GB)
//   ④ kenar + ic internal; TEK dış ağ satıcının ic-api'si ve ona yalnız `patron` katılır (`web` yok)
//   ⑤ anahtar birimi her bağlandığı yerde salt okunur
//   ⑥ köprü ağları 100.64/10 ve 127/8 DIŞINDA · ⑥b kenarda dinamik aralık alt ağda, patronun sabit
//      adresi aralığın DIŞINDA (Traefik patronun adresini kapamasın)
//   ⑦ Traefik etiketi yalnız `patron`de, kenar ağını gösterir; kural Host + iç ad alanı dışlaması
//      (web-static.ts IC_ONEKLER); patron YALNIZ kenar adresinde dinler (BIND); DB portsuz, yalnız ic'te
//   ⑧ sırlar: göç parolası sunucuya BAĞLANMAZ (yalnız DB · göç · yedek); çalışma parolaları yalnız
//      sunucu + göç; iç API belirteci yalnız sunucu; ortamda düz parola/belirteç yok
//   ⑨ SATICIYLA UYUM (--satici-env): ic-api ağ adı, satıcı iç adresi ve PATRON_IC_IP satıcınınkiyle AYNI;
//      SIR_GID satıcınınkinden FARKLI; patronun kenar ağı satıcının hiçbir ağıyla çakışmaz
//
// Kullanım: node deploy/patron/compose-denetle.mjs --env-file <.env> --satici-env <satıcının .env'i> [-f <compose> ...]
// Çıkış: 0 temiz · 1 ihlal · 2 ölçülemedi (docker yok / config çözülemedi / satıcı .env'i yok).
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
const saticiEnvDosyasi = al("--satici-env");
if (!envDosyasi) {
  console.error("kullanım: compose-denetle.mjs --env-file <.env> --satici-env <satıcı .env> [-f <compose> ...]");
  process.exit(2);
}
function envOku(dosya) {
  const out = {};
  for (const l of readFileSync(dosya, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
let saticiEnv = null;
try {
  envOku(envDosyasi);
  if (saticiEnvDosyasi) saticiEnv = envOku(saticiEnvDosyasi);
} catch (err) {
  console.error(`ÖLÇÜLEMEDİ: .env okunamadı — ${err.message}`);
  process.exit(2);
}
const acikF = args.flatMap((a, i) => (a === "-f" && args[i + 1] ? [args[i + 1]] : []));
const composeDosyalari = acikF.length > 0 ? acikF : [path.join(burasi, "docker-compose.yml")];
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
let olculemedi = 0;
function kontrol(ad, ok, ayrinti = "") {
  if (ok) gecti++;
  else ihlal++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}
function ipv4(s) {
  const p = String(s).split(".").map(Number);
  return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
function aralikta(ip, cidr) {
  const [ag, bit] = String(cidr).split("/");
  const a = ipv4(ip);
  const b = ipv4(ag);
  if (a === null || b === null || bit === undefined) return false;
  const maske = bit === "0" ? 0 : (~0 << (32 - Number(bit))) >>> 0;
  return (a & maske) >>> 0 === (b & maske) >>> 0;
}
function cakisir(cidr, diger) {
  const [ag, bit] = String(cidr).split("/");
  const [dag, dbit] = String(diger).split("/");
  return aralikta(ag, `${dag}/${Math.min(Number(bit), Number(dbit))}`);
}
function bayt(v) {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/^(\d+)([kmg]?)b?$/i);
  if (!m) return NaN;
  return Number(m[1]) * { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()];
}
const sirlari = (s) => (s.secrets ?? []).map((x) => x.source ?? x);

const servisler = Object.entries(cfg.services ?? {});
const aglar = cfg.networks ?? {};
const patron = cfg.services?.patron ?? {};
const ortam = patron.environment ?? {};
const beklenen = ["patron-db", "patron", "patron-goc", "patron-yedek"];
kontrol(
  `körlük zemini: ${beklenen.length} servis çözüldü (${beklenen.join(" · ")})`,
  servisler.length === beklenen.length && beklenen.every((a) => a in (cfg.services ?? {})),
  servisler.map(([a]) => a).join(", "),
);

// ① port yayını
const yayinlayan = servisler.filter(([, s]) => (s.ports ?? []).length > 0).map(([a]) => a);
kontrol("① hiçbir servis port yayımlamaz (tek giriş Traefik)", yayinlayan.length === 0, yayinlayan.join(", ") || "hiçbiri");

// ② docker soketi
const soket = servisler.filter(([, s]) => (s.volumes ?? []).some((v) => /docker\.sock/.test(`${v.source ?? ""} ${v.target ?? ""}`))).map(([a]) => a);
kontrol("② docker soketi hiçbir servise bağlı değil", soket.length === 0, soket.join(", "));

// ③ servis sertliği + bellek bütçesi
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
const surekli = servisler.filter(([, s]) => !(s.profiles ?? []).length);
const toplam = surekli.reduce((t, [, s]) => t + bayt(s.mem_limit), 0);
kontrol("③ uzun ömürlü servislerin bellek tavanı toplamı ≤ 1 GiB", Number.isFinite(toplam) && toplam <= 1024 ** 3, `${Math.round(toplam / 1024 ** 2)} MiB (${surekli.map(([a]) => a).join(" + ")})`);

// ④ ağlar
for (const anahtar of ["kenar", "ic"]) kontrol(`④ ${anahtar} ağı internal`, aglar[anahtar]?.internal === true, aglar[anahtar]?.name ?? "YOK");
const disAglar = Object.entries(aglar).filter(([, n]) => n.external).map(([a]) => a);
kontrol("④ tek dış ağ satıcının ic-api'si (tekserp-satici-<ortam>-ic-api)", JSON.stringify(disAglar) === '["ic-api"]' && /^tekserp-satici-[a-z0-9]+-ic-api$/.test(aglar["ic-api"]?.name ?? ""), `${disAglar.join(", ") || "YOK"} · ${aglar["ic-api"]?.name ?? "YOK"}`);
const disaKatilan = servisler.filter(([, s]) => Object.keys(s.networks ?? {}).some((n) => !(n in aglar) || (aglar[n].external && !(n === "ic-api" && s === patron)))).map(([a]) => a);
kontrol("④ dış ağa yalnız `patron` katılır; tanımsız (`web` dahil) ağ yok", disaKatilan.length === 0, disaKatilan.join(", "));

// ⑤ anahtar birimi
for (const [ad, s] of servisler) {
  for (const v of s.volumes ?? []) if (v.target === "/anahtarlar") kontrol(`⑤ ${ad} anahtar birimi salt okunur`, v.read_only === true);
}

// ⑥ köprü ağları tailnet/geri döngü aralığı dışında · ⑥b kenar dinamik aralığı
for (const [anahtar, n] of Object.entries(aglar)) {
  for (const c of n.ipam?.config ?? []) {
    if (!c.subnet) continue;
    const kotu = ["100.64.0.0/10", "127.0.0.0/8"].filter((y) => cakisir(c.subnet, y));
    kontrol(`⑥ ${anahtar} ağı (${c.subnet}) tailnet/geri döngü aralığında DEĞİL`, kotu.length === 0, kotu.join(", "));
  }
}
const kc = aglar.kenar?.ipam?.config?.[0] ?? {};
const kenarIp = patron.networks?.kenar?.ipv4_address ?? "";
const aralikIcinde = kc.ip_range && kc.subnet ? cakisir(kc.ip_range, kc.subnet) && Number(kc.ip_range.split("/")[1]) >= Number(kc.subnet.split("/")[1]) : false;
kontrol("⑥b kenarda dinamik aralık alt ağda, patronun sabit adresi aralığın DIŞINDA", aralikIcinde && kenarIp !== "" && aralikta(kenarIp, kc.subnet) && !aralikta(kenarIp, kc.ip_range), `alt ağ ${kc.subnet ?? "YOK"} · dinamik ${kc.ip_range ?? "YOK"} · patron ${kenarIp || "YOK"}`);

// ⑦ Traefik + dinleyici + DB
const traefikli = servisler.filter(([, s]) => String(s.labels?.["traefik.enable"] ?? "") === "true").map(([a]) => a);
kontrol("⑦ Traefik etiketi yalnız `patron`de", JSON.stringify(traefikli) === '["patron"]', traefikli.join(", ") || "hiçbiri");
const et = patron.labels ?? {};
kontrol("⑦ Traefik kenar ağını kullanır", et["traefik.docker.network"] === aglar.kenar?.name, `${et["traefik.docker.network"]} ↔ ${aglar.kenar?.name}`);
// `config` çıktısı `$` kaçışını (`$$`) korur; konteyner etiketinde tek `$` olur (yerel dumanda ölçüldü).
const kurallar = Object.entries(et).filter(([k]) => /^traefik\.http\.routers\..+\.rule$/.test(k)).map(([, v]) => v);
kontrol("⑦ tek yönlendirici: Host + iç ad alanı dışlaması (ic|yonetim)", kurallar.length === 1 && /^Host\(`[a-z0-9.-]+`\) && !PathRegexp\(`\^\/\(ic\|yonetim\)\(\/\|\$\$?\)`\)$/.test(kurallar[0]), kurallar.join(" | ") || "YOK");
const hizmetPortu = Object.entries(et).find(([k]) => /\.loadbalancer\.server\.port$/.test(k))?.[1];
kontrol("⑦ yönlendirici 4620'ye, websecure + TLS", String(hizmetPortu) === "4620" && Object.entries(et).some(([k, v]) => k.endsWith(".entrypoints") && v === "websecure") && Object.entries(et).some(([k, v]) => k.endsWith(".tls") && String(v) === "true"), `port ${hizmetPortu ?? "YOK"}`);
kontrol("⑦ patron YALNIZ kenar adresinde dinler (BIND = kenar IP, PORT 4620)", ortam.BIND === kenarIp && kenarIp !== "" && String(ortam.PORT) === "4620", `BIND=${ortam.BIND ?? "YOK"} · kenar=${kenarIp || "YOK"}`);
const db = cfg.services?.["patron-db"] ?? {};
kontrol("⑦ DB portsuz ve yalnız ic ağında", (db.ports ?? []).length === 0 && JSON.stringify(Object.keys(db.networks ?? {})) === '["ic"]', Object.keys(db.networks ?? {}).join(", "));

// ⑧ sırlar
const sahipler = (sir) => servisler.filter(([, s]) => sirlari(s).includes(sir)).map(([a]) => a).sort().join(",");
kontrol("⑧ göç parolası YALNIZ DB · göç · yedek (sunucuya bağlanmaz)", sahipler("goc_parolasi") === "patron-db,patron-goc,patron-yedek", sahipler("goc_parolasi") || "hiçbiri");
for (const sir of ["uygulama_parolasi", "esitleme_parolasi"]) kontrol(`⑧ ${sir} yalnız sunucu + göç`, sahipler(sir) === "patron,patron-goc", sahipler(sir) || "hiçbiri");
kontrol("⑧ iç API belirteci yalnız sunucuda", sahipler("ic_api_belirteci") === "patron", sahipler("ic_api_belirteci") || "hiçbiri");
const duzSir = servisler.flatMap(([a, s]) => Object.keys(s.environment ?? {}).filter((k) => /PAROLA|PASSWORD|BELIRTEC|SECRET|DATABASE_URL/.test(k) && !/_FILE$|DOSYASI$/.test(k)).map((k) => `${a}.${k}`));
kontrol("⑧ ortamda düz parola/belirteç/DB URL'i yok (yalnız *_FILE)", duzSir.length === 0, duzSir.join(", "));
kontrol("⑧ DB parolası dosyadan (POSTGRES_PASSWORD_FILE)", db.environment?.POSTGRES_PASSWORD_FILE === "/run/secrets/goc_parolasi");
const gidler = [...new Set(servisler.map(([, s]) => JSON.stringify(s.group_add ?? [])))];
kontrol("⑧ tüm servisler aynı sır grubunda (SIR_GID)", gidler.length === 1 && JSON.parse(gidler[0]).length === 1, gidler.join(" | "));

// ⑨ satıcıyla uyum — ÜÇ SONUÇ: satıcı .env'i yoksa "ölçülemedi" (geçti sayılmaz, çıkış 2)
const icIp = patron.networks?.["ic-api"]?.ipv4_address ?? "";
const url = String(ortam.SATICI_IC_API_URL ?? "");
kontrol("⑨ KURULUM_KAYNAGI tanınır (satici|kayit)", ["satici", "kayit"].includes(String(ortam.KURULUM_KAYNAGI)), String(ortam.KURULUM_KAYNAGI ?? "YOK"));
if (!saticiEnv) {
  olculemedi++;
  console.log("⚠️  ⑨ satıcıyla uyum ÖLÇÜLEMEDİ — --satici-env <satıcının .env'i> verilmedi (ağ adı · adresler · SIR_GID)");
} else {
  const s = saticiEnv;
  kontrol("⑨ ic-api ağ adı satıcının ağı", aglar["ic-api"]?.name === `tekserp-satici-${s.ORTAM}-ic-api`, `${aglar["ic-api"]?.name} ↔ tekserp-satici-${s.ORTAM}-ic-api`);
  kontrol("⑨ PATRON_IC_IP satıcının kaynak kapısındaki /32 ile AYNI", icIp !== "" && icIp === s.PATRON_IC_IP && icIp !== s.IC_API_IP, `patron ${icIp || "YOK"} · satıcı PATRON_IC_IP ${s.PATRON_IC_IP ?? "YOK"}`);
  kontrol("⑨ satıcı iç API adresi satıcının IC_API_IP:4612'si", url === `http://${s.IC_API_IP}:4612`, url || "YOK");
  kontrol("⑨ PATRON_IC_IP satıcının ic-api alt ağında, dinamik aralık dışında", !!s.IC_API_AGI && aralikta(icIp, s.IC_API_AGI) && !aralikta(icIp, s.IC_API_DINAMIK_ARALIK ?? "0.0.0.0/32"), `${s.IC_API_AGI ?? "YOK"} · dinamik ${s.IC_API_DINAMIK_ARALIK ?? "YOK"}`);
  const gid = JSON.parse(gidler[0] ?? "[]")[0];
  kontrol("⑨ SIR_GID satıcınınkinden FARKLI (sır grubu ortak değil)", !!s.SIR_GID && String(gid) !== String(s.SIR_GID), `patron ${gid} · satıcı ${s.SIR_GID ?? "YOK"}`);
  const cakisan = ["KENAR_AGI", "TAILNET_AGI", "IC_API_AGI"].filter((k) => s[k] && kc.subnet && cakisir(kc.subnet, s[k]));
  kontrol("⑨ patronun kenar ağı satıcının hiçbir ağıyla çakışmaz", !!kc.subnet && cakisan.length === 0, cakisan.join(", "));
}

console.log(`\n=== ${gecti} geçti, ${ihlal} ihlal${olculemedi ? `, ${olculemedi} ölçülemedi` : ""} ===`);
process.exit(ihlal > 0 ? 1 : olculemedi > 0 ? 2 : 0);
