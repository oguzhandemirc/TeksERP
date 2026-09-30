// =============================================================================
// SATICI COMPOSE YALITIM DENETİMİ (deploy/satici/compose-denetle.mjs) — DB'siz; docker compose yoksa ÖLÇÜLEMEDİ beyanı.
//   §1 runbook kurguları (örnek .env'lerden türetilir): SATICI-KURULUM §13.3 (üretim + geri döngü, --diger-env hazırlık) ·
//      §13.9-2 (üretim + geri döngü + portal-genel, --diger-env hazırlık) · PORTAL-GENEL-ERISIM §4.6 (hazırlık + geri döngü
//      + portal-genel; ⑫ ölçülmedi, çıkış 0) · ana (tailnet) kip + portal-genel — hepsi 0 ihlal, her servis ③b/③c'den geçer
//   §2 yalıtım gevşetmesi — her örtü çıkış 1 ve KENDİ servisinin ③b/③c satırıyla: volumes_from (incelemenin örtüsü
//      `satici-jwks: volumes_from: ["satici:ro"]`) · privileged · cap_add · pid service: · security_opt seccomp=unconfined ·
//      network_mode service: · userns host · devices · tanınmayan anahtar (ulimits) · ana kipte portal-tunel ağ kipi
//   §3 BİLDİRİM örtüsü (Ⓑ0–Ⓑ8): gerçek örtüyle üç kurgu 0 ihlal (hazırlık geri döngü + portal-genel + bildirim ·
//      ana kip + portal-genel + bildirim · üretim + geri döngü + portal-genel + bildirim, --diger-env hazırlık) ve her
//      Ⓑ satırı ✅ basılır; --patron-env yoksa Ⓑ7'nin patron ayağı ÖLÇÜLMEDİ (hazırlıkta çıkış 0, üretimde 2) · her Ⓑ
//      maddesi için bozuk örtü/ortam → çıkış 1 ve KENDİ satırı ❌ · .env'de BILDIRIM_DNS_1 değişince compose ile betik
//      birlikte değişir → Ⓑ8 YEŞİL (sabit kodlu denetim geçemez) · düz sır değeri çıktıya basılmaz.
// ⭐ KALICI SONDA ✓K36 (her koşumda): §2'nin on gevşetme örtüsü kendi satırıyla ❌ · geri döngü kipinde beyanlı
//    istisna (portal-tunel → service:satici) YEŞİL — "her network_mode ihlal" diyen kör denetim geçemez · dört kurgu 0
//    ihlal — her şeyi reddeden denetim geçemez · §3'ün Ⓑ sondaları kendi satırıyla ❌.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_compose_yalitimi.ts   (DB GEREKMEZ)
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

const D = path.resolve(SATICI_KOKU, "..", "..", "deploy", "satici");
const DENETLE = path.join(D, "compose-denetle.mjs");
const AUD = randomBytes(32).toString("hex");

interface Kosum {
  readonly status: number | null;
  readonly cikti: string;
}

function denetle(env: string, g: { diger?: string; dosyalar?: readonly string[] } = {}): Kosum {
  const r = spawnSync(process.execPath, [DENETLE, "--env-file", env, ...(g.diger ? ["--diger-env", g.diger] : []), ...(g.dosyalar ?? []).flatMap((f) => ["-f", f])], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const ozet = (k: Kosum): string => /=== (\d+ geçti, \d+ ihlal(?:, \d+ ölçülmedi)?) ===/.exec(k.cikti)?.[1] ?? k.cikti.trim().split("\n").pop()?.slice(0, 160) ?? "";
const kirmizi = (k: Kosum): string[] => k.cikti.split("\n").filter((l) => l.startsWith("❌"));

function main(): void {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (docker.status !== 0) {
    console.log("⏭ ÖLÇÜLEMEDİ: docker compose yok — yalıtım denetimi koşturulamadı (geçti SAYILMAZ)");
    sonuc();
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "satici-compose-yalitim-"));
  try {
    const imaj = (s: string) => s.replace(/^SATICI_IMAJ=.*$/m, "SATICI_IMAJ=tekserp-satici:bekci").replace(/^SATICI_YEDEK_IMAJ=.*$/m, "SATICI_YEDEK_IMAJ=tekserp-satici-yedek:bekci");
    const portal = (ortam: string, jwksAgi: string) =>
      `PORTAL_HOST=portal.bekci.test\nCF_ACCESS_TAKIM_ALANI=bekci-takim.cloudflareaccess.com\nCF_ACCESS_AUD=${AUD}\nERISIM_JWKS_DIZINI_HOST=/opt/stack/apps/tekserp-satici-${ortam}/erisim-jwks\nJWKS_CIKIS_AGI=${jwksAgi}\n`;
    const yaz = (ad: string, metin: string): string => {
      const p = path.join(tmp, ad);
      writeFileSync(p, metin);
      return p;
    };
    const hazirlikMetni = imaj(readFileSync(path.join(D, "ornek.env"), "utf8"))
      .replace(/^TAILNET_IP=.*$/m, "TAILNET_IP=127.0.0.1")
      .replace(/^# COMPOSE_FILE=docker-compose\.yml:docker-compose\.loopback\.yml$/m, "COMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml");
    const uretimMetni = imaj(readFileSync(path.join(D, "ornek-uretim.env"), "utf8"));
    const hazirlik = yaz("hazirlik.env", hazirlikMetni);
    const uretim = yaz("uretim.env", uretimMetni);
    const uretimPortal = yaz(
      "uretim-portal.env",
      `${uretimMetni}\nCOMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml\n${portal("uretim", "172.31.251.48/29")}`,
    );
    const hazirlikPortal = yaz("hazirlik-portal.env", `${hazirlikMetni}\nCOMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml\n${portal("hazirlik", "172.31.255.0/29")}`);
    const hazirlikAna = yaz(
      "hazirlik-ana.env",
      `${hazirlikMetni.replace(/^TAILNET_IP=.*$/m, "TAILNET_IP=100.64.0.9")}\nCOMPOSE_FILE=docker-compose.yml:docker-compose.portal-genel.yml\n${portal("hazirlik", "172.31.255.0/29")}`,
    );

    console.log("\n§1 runbook kurguları — 0 ihlal");
    const kurgular: [string, Kosum, number, RegExp][] = [
      ["§1a SATICI-KURULUM §13.3 üretim + geri döngü (--diger-env hazırlık)", denetle(uretim, { diger: hazirlik }), 0, /\d+ geçti, 0 ihlal$/],
      ["§1b SATICI-KURULUM §13.9-2 üretim + geri döngü + portal-genel (--diger-env hazırlık)", denetle(uretimPortal, { diger: hazirlik }), 0, /\d+ geçti, 0 ihlal$/],
      ["§1c PORTAL-GENEL-ERISIM §4.6 hazırlık + geri döngü + portal-genel (⑫ ölçülmedi, çıkış 0)", denetle(hazirlikPortal), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
      ["§1d ana (tailnet) kip + portal-genel", denetle(hazirlikAna), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
    ];
    for (const [ad, k, cikis, desen] of kurgular) {
      const servisSayisi = (k.cikti.match(/^✅ ③c /gm) ?? []).length;
      kontrol(`${ad} → çıkış ${cikis}, her serviste ③b + ③c`, k.status === cikis && desen.test(ozet(k)) && servisSayisi >= 5 && (k.cikti.match(/^✅ ③b /gm) ?? []).length === servisSayisi, `${k.status} · ${ozet(k)} · ${servisSayisi} servis ${kirmizi(k).join(" | ").slice(0, 200)}`);
    }
    kontrol(
      "§1e ✓K geri döngüde beyanlı istisna YEŞİL: portal-tunel network_mode=service:satici",
      /^✅ ③b portal-tunel yalıtım gevşetmesi yok — beyanlı istisna: network_mode=service:satici$/m.test(kurgular[2]![1].cikti),
    );

    console.log("\n§2 yalıtım gevşetmesi — her örtü kendi satırıyla kırmızı (çıkış 1)");
    const temel = [path.join(D, "docker-compose.yml"), path.join(D, "docker-compose.loopback.yml"), path.join(D, "docker-compose.portal-genel.yml")];
    const sondalar: [string, string, RegExp][] = [
      ["volumes_from (incelemenin örtüsü)", "services:\n  satici-jwks:\n    volumes_from: [\"satici:ro\"]\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — volumes_from=/m],
      ["privileged", "services:\n  satici:\n    privileged: true\n", /^❌ ③b satici yalıtım gevşetmesi yok — privileged=true/m],
      ["cap_add NET_ADMIN (cap_drop ALL'ı ezer)", "services:\n  satici-yedek:\n    cap_add: [NET_ADMIN]\n", /^❌ ③b satici-yedek yalıtım gevşetmesi yok — cap_add=\["NET_ADMIN"\]/m],
      ["pid service:satici", "services:\n  satici-jwks:\n    pid: \"service:satici\"\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — pid="service:satici"/m],
      ["security_opt seccomp=unconfined", "services:\n  satici-db:\n    security_opt: [\"no-new-privileges:true\", \"seccomp=unconfined\"]\n", /^❌ ③b satici-db yalıtım gevşetmesi yok — security_opt=/m],
      ["network_mode service:satici (beyansız)", "services:\n  satici-yedek:\n    network_mode: \"service:satici\"\n    networks: !reset []\n", /^❌ ③b satici-yedek yalıtım gevşetmesi yok — network_mode="service:satici"/m],
      ["userns_mode host", "services:\n  satici:\n    userns_mode: host\n", /^❌ ③b satici yalıtım gevşetmesi yok — userns_mode="host"/m],
      ["devices", "services:\n  satici-jwks:\n    devices: [\"/dev/fuse:/dev/fuse\"]\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — devices=/m],
      ["tanınmayan anahtar (ulimits)", "services:\n  satici-jwks:\n    ulimits: { nofile: 65535 }\n", /^❌ ③c satici-jwks yalnız tanınan anahtarlar — tanınmayan: ulimits/m],
    ];
    for (const [ad, ortu, desen] of sondalar) {
      const f = yaz(`sonda-${ad.replace(/[^a-z0-9]+/gi, "-")}.yml`, ortu);
      const k = denetle(hazirlikPortal, { dosyalar: [...temel, f] });
      kontrol(`§2 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 200) || ozet(k)}`);
    }
    const tunel = yaz(
      "sonda-ana-kip-tunel.yml",
      'services:\n  portal-tunel:\n    image: ${SATICI_IMAJ}\n    network_mode: "service:satici"\n    user: "10001:10001"\n    read_only: true\n    security_opt: ["no-new-privileges:true"]\n    cap_drop: ["ALL"]\n    mem_limit: 64m\n    cpus: 0.1\n    pids_limit: 20\n',
    );
    const anaTunel = denetle(hazirlikAna, { dosyalar: [path.join(D, "docker-compose.yml"), path.join(D, "docker-compose.portal-genel.yml"), tunel] });
    kontrol(
      "§2 istisna yalnız geri döngü kipinde: ana kipte portal-tunel'in network_mode'u ③b ihlali",
      anaTunel.status === 1 && /^❌ ③b portal-tunel yalıtım gevşetmesi yok — network_mode="service:satici"/m.test(anaTunel.cikti),
      `${anaTunel.status} · ${kirmizi(anaTunel).join(" | ").slice(0, 200)}`,
    );

    console.log("\n§3 bildirim örtüsü (Ⓑ0–Ⓑ8) — gerçek örtü 0 ihlal, her bozuk örtü kendi satırıyla kırmızı");
    const PATRON = path.join(D, "..", "patron", "ornek.env");
    const BILDIRIM = path.join(D, "docker-compose.bildirim.yml");
    const ekle = (metin: string, dosyalar: string) => `${metin}\nCOMPOSE_FILE=${dosyalar}\n`;
    // Üretimin bildirim satırları örnekte YER AYRILMIŞ (yorumlu) — örnek tek kaynak kalsın diye açılarak kullanılır.
    const uretimBildirimMetni = uretimMetni.replace(/^# ((?:BILDIRIM|TELEGRAM|RESEND)_[A-Z0-9_]+=)/gm, "$1");
    const hazirlikPB = yaz("hazirlik-pb.env", `${ekle(hazirlikMetni, "docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml:docker-compose.bildirim.yml")}${portal("hazirlik", "172.31.255.0/29")}`);
    const hazirlikAnaPB = yaz(
      "hazirlik-ana-pb.env",
      `${ekle(hazirlikMetni.replace(/^TAILNET_IP=.*$/m, "TAILNET_IP=100.64.0.9"), "docker-compose.yml:docker-compose.portal-genel.yml:docker-compose.bildirim.yml")}${portal("hazirlik", "172.31.255.0/29")}`,
    );
    const uretimPB = yaz("uretim-pb.env", `${ekle(uretimBildirimMetni, "docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml:docker-compose.bildirim.yml")}${portal("uretim", "172.31.251.48/29")}`);
    const hazirlikB = yaz("hazirlik-b.env", ekle(hazirlikMetni, "docker-compose.yml:docker-compose.loopback.yml:docker-compose.bildirim.yml"));
    const uretimB = yaz("uretim-b.env", ekle(uretimBildirimMetni, "docker-compose.yml:docker-compose.loopback.yml:docker-compose.bildirim.yml"));
    const denetleP = (env: string, g: { diger?: string; dosyalar?: readonly string[]; patron?: boolean } = {}): Kosum => {
      const r = spawnSync(
        process.execPath,
        [DENETLE, "--env-file", env, ...(g.diger ? ["--diger-env", g.diger] : []), ...(g.patron === false ? [] : ["--patron-env", PATRON]), ...(g.dosyalar ?? []).flatMap((f) => ["-f", f])],
        { encoding: "utf8", timeout: 60_000 },
      );
      return { status: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const bKurgular: [string, Kosum, number, RegExp][] = [
      ["§3a hazırlık + geri döngü + portal-genel + bildirim (--patron-env)", denetleP(hazirlikPB), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
      ["§3b ana (tailnet) kip + portal-genel + bildirim (--patron-env)", denetleP(hazirlikAnaPB), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
      ["§3c üretim + geri döngü + portal-genel + bildirim (--diger-env hazırlık + bildirim · --patron-env)", denetleP(uretimPB, { diger: hazirlikPB }), 0, /\d+ geçti, 0 ihlal$/],
      ["§3d üretim + geri döngü + bildirim (--diger-env hazırlık + bildirim · --patron-env)", denetleP(uretimB, { diger: hazirlikB }), 0, /\d+ geçti, 0 ihlal$/],
    ];
    const B_SATIRLARI = ["Ⓑ0", "Ⓑ1", "Ⓑ2", "Ⓑ3", "Ⓑ4", "Ⓑ5", "Ⓑ6", "Ⓑ7", "Ⓑ8"];
    for (const [ad, k, cikis, desen] of bKurgular) {
      const eksikB = B_SATIRLARI.filter((b) => !new RegExp(`^✅ ${b} `, "m").test(k.cikti));
      const yedi = (k.cikti.match(/^✅ Ⓑ7 /gm) ?? []).length;
      kontrol(
        `${ad} → çıkış ${cikis}, örtü: portal/bildirim algılandı, Ⓑ0–Ⓑ8 hepsi ✅ (Ⓑ7 iki ayak)`,
        k.status === cikis && desen.test(ozet(k)) && /örtü: [^\n]*bildirim/.test(k.cikti) && eksikB.length === 0 && yedi === 2,
        `${k.status} · ${ozet(k)} · eksik ${eksikB.join(",") || "yok"} · ${kirmizi(k).join(" | ").slice(0, 200)}`,
      );
    }
    const patronsuzH = denetleP(hazirlikB, { patron: false });
    kontrol(
      "§3e ✓K --patron-env yoksa Ⓑ7 patron ayağı ÖLÇÜLMEDİ beyanı (geçti sayılmaz) — hazırlıkta çıkış 0",
      patronsuzH.status === 0 && /^⏭ Ⓑ7 bildirim-cikis ↔ patron ağları ÖLÇÜLMEDİ/m.test(patronsuzH.cikti) && /0 ihlal, 2 ölçülmedi$/.test(ozet(patronsuzH)),
      `${patronsuzH.status} · ${ozet(patronsuzH)}`,
    );
    const patronsuzU = denetleP(uretimB, { diger: hazirlikB, patron: false });
    kontrol("§3f ✓K üretimde --patron-env yoksa çıkış 2 (ÖLÇÜLMEDİ üretimde zorunlu)", patronsuzU.status === 2 && /ÜRETİMDE ZORUNLU/.test(patronsuzU.cikti), `${patronsuzU.status} · ${ozet(patronsuzU)}`);

    const bTemel = [...temel, BILDIRIM];
    // Ⓑ0: örtü dosyası listede ama servis başka adla → beklenen servis eksik.
    const adsiz = path.join(tmp, "b0", "docker-compose.bildirim.yml");
    mkdirSync(path.dirname(adsiz));
    writeFileSync(adsiz, readFileSync(BILDIRIM, "utf8").replace(/^  satici-bildirim:$/m, "  gonderici:"));
    const b0 = denetleP(hazirlikPB, { dosyalar: [...temel, adsiz] });
    kontrol("§3 Ⓑ0 örtü dosyası listede, satici-bildirim yok → çıkış 1, Ⓑ0 + körlük zemini ❌", b0.status === 1 && /^❌ Ⓑ0 /m.test(b0.cikti) && /^❌ körlük zemini/m.test(b0.cikti), `${b0.status} · ${kirmizi(b0).join(" | ").slice(0, 200)}`);

    const bSondalar: [string, string, RegExp][] = [
      ["Ⓑ1 çekirdek servis ek bir AÇIK ağa katılır", "services:\n  satici-goc:\n    networks: [acik]\nnetworks:\n  acik:\n    name: bekci-acik\n", /^❌ Ⓑ1 /m],
      ["Ⓑ2 satici-yedek bildirim-cikis'e katılır", "services:\n  satici-yedek:\n    networks: [bildirim-cikis]\n", /^❌ Ⓑ2 [^\n]*çıkışta: satici-yedek/m],
      ["Ⓑ2 gönderici kenar ağına katılır", "services:\n  satici-bildirim:\n    networks: [kenar]\n", /^❌ Ⓑ2 [^\n]*gönderici: bildirim-cikis, ic, kenar/m],
      ["Ⓑ3 göndericiye anahtar birimi", 'services:\n  satici-bildirim:\n    volumes: ["${ANAHTAR_DIZINI_HOST}:/anahtarlar:ro"]\n', /^❌ Ⓑ3 [^\n]*birim \/anahtarlar/m],
      ["Ⓑ3 göndericide Traefik etiketi", 'services:\n  satici-bildirim:\n    labels: { traefik.enable: "true" }\n', /^❌ Ⓑ3 [^\n]*Traefik etiketi/m],
      ["Ⓑ4 göndericiye db_parolasi", "services:\n  satici-bildirim:\n    secrets: [db_parolasi]\n", /^❌ Ⓑ4 [^\n]*db_parolasi/m],
      ["Ⓑ4 satıcıya telegram_bot_token", "services:\n  satici:\n    secrets: [telegram_bot_token]\n", /^❌ Ⓑ4 [^\n]*başka serviste: satici:telegram_bot_token/m],
      ["Ⓑ5 düz TELEGRAM_BOT_TOKEN", 'services:\n  satici-bildirim:\n    environment: { TELEGRAM_BOT_TOKEN: "bekci-duz-sir-degeri" }\n', /^❌ Ⓑ5 [^\n]*düz TELEGRAM_BOT_TOKEN var/m],
      ["Ⓑ5 düz DATABASE_URL", 'services:\n  satici-bildirim:\n    environment: { DATABASE_URL: "postgresql://bekci@satici-db/satici" }\n', /^❌ Ⓑ5 [^\n]*düz DATABASE_URL var/m],
      ["Ⓑ5 DB_KULLANICI satıcının sahibi", "services:\n  satici-bildirim:\n    environment: { DB_KULLANICI: satici }\n", /^❌ Ⓑ5 [^\n]*DB_KULLANICI satici_bildirim değil/m],
      ["Ⓑ5 DB parolası satıcının sırrından", "services:\n  satici-bildirim:\n    environment: { DB_PAROLA_DOSYASI: /run/secrets/db_parolasi }\n", /^❌ Ⓑ5 [^\n]*DB_PAROLA_DOSYASI/m],
      ["Ⓑ5 sır dosyası /run/secrets dışında", "services:\n  satici-bildirim:\n    environment: { EK_ANAHTAR_DOSYASI: /anahtarlar/kok.json }\n", /^❌ Ⓑ5 [^\n]*EK_ANAHTAR_DOSYASI \/run\/secrets\/ altında değil/m],
      ["Ⓑ5 sağlayıcı kökü düz http", 'services:\n  satici-bildirim:\n    environment: { TELEGRAM_API_KOKU: "http://api.telegram.org" }\n', /^❌ Ⓑ5 [^\n]*TELEGRAM_API_KOKU https değil/m],
      ["Ⓑ6 başka komut", 'services:\n  satici-bildirim:\n    command: ["node", "dist/server.js"]\n', /^❌ Ⓑ6 [^\n]*komut/m],
      ["Ⓑ6 başka imaj", "services:\n  satici-bildirim:\n    image: tekserp-satici:baska\n", /^❌ Ⓑ6 [^\n]*imaj tekserp-satici:baska/m],
      ["Ⓑ6 giriş noktası ezilir", 'services:\n  satici-bildirim:\n    entrypoint: ["node"]\n', /^❌ Ⓑ6 [^\n]*giriş noktası ezilmiş/m],
      ["Ⓑ8 dns betikten farklı", 'services:\n  satici-bildirim:\n    dns: !override ["8.8.8.8", "1.1.1.1"]\n', /^❌ Ⓑ8 [^\n]*compose 8\.8\.8\.8, 1\.1\.1\.1/m],
      ["Ⓑ8 dns ad (IPv4 değil)", 'services:\n  satici-bildirim:\n    dns: !override ["dns.google", "9.9.9.9"]\n', /^❌ Ⓑ8 /m],
      ["Ⓑ8 üç çözücü", 'services:\n  satici-bildirim:\n    dns: ["8.8.8.8"]\n', /^❌ Ⓑ8 [^\n]*compose 1\.1\.1\.1, 9\.9\.9\.9, 8\.8\.8\.8/m],
    ];
    for (const [ad, ortu, desen] of bSondalar) {
      const f = yaz(`b-sonda-${ad.replace(/[^a-z0-9]+/gi, "-")}.yml`, ortu);
      const k = denetleP(hazirlikPB, { dosyalar: [...bTemel, f] });
      kontrol(`§3 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 220) || ozet(k)}`);
      if (ad.includes("düz TELEGRAM_BOT_TOKEN")) kontrol("§3 Ⓑ5 düz sır DEĞERİ çıktıya basılmaz (yalnız anahtar adı)", !k.cikti.includes("bekci-duz-sir-degeri"));
    }
    const agSondalari: [string, string, RegExp][] = [
      ["Ⓑ7 çıkış ağı JWKS ağıyla çakışır (172.31.255.0/28)", "172.31.255.0/28", /^❌ Ⓑ7 bildirim-cikis alt ağı [^\n]*jwks-cikis 172\.31\.255\.0\/29/m],
      ["Ⓑ7 çıkış ağı tailnet aralığında (100.100.0.0/28)", "100.100.0.0/28", /^❌ Ⓑ7 bildirim-cikis alt ağı [^\n]*100\.64\.0\.0\/10/m],
      ["Ⓑ7 çıkış ağı patronun çıkış ağıyla çakışır (172.31.250.16/28)", "172.31.250.16/28", /^❌ Ⓑ7 bildirim-cikis patronun ağlarıyla çakışmaz [^\n]*cikis 172\.31\.250\.16\/28/m],
    ];
    const pbMetni = readFileSync(hazirlikPB, "utf8");
    for (const [ad, alt, desen] of agSondalari) {
      const env = yaz(`b7-${alt.replace(/[^0-9]+/g, "-")}.env`, pbMetni.replace(/^BILDIRIM_CIKIS_AGI=.*$/m, `BILDIRIM_CIKIS_AGI=${alt}`));
      const k = denetleP(env);
      kontrol(`§3 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 220) || ozet(k)}`);
    }
    const dnsEnv = yaz("b8-dns.env", `${pbMetni}\nBILDIRIM_DNS_1=8.8.8.8\n`);
    const dnsK = denetleP(dnsEnv);
    kontrol(
      "§3 Ⓑ8 ✓K .env'de BILDIRIM_DNS_1=8.8.8.8 → compose ve betik birlikte değişir → Ⓑ8 YEŞİL (sabit kodlu denetim geçemez)",
      dnsK.status === 0 && /^✅ Ⓑ8 [^\n]*compose 8\.8\.8\.8, 9\.9\.9\.9 · betik 8\.8\.8\.8, 9\.9\.9\.9/m.test(dnsK.cikti),
      `${dnsK.status} · ${kirmizi(dnsK).join(" | ").slice(0, 200) || ozet(dnsK)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  sonuc();
}

main();
