// =============================================================================
// SATICI COMPOSE YALITIM DENETİMİ (deploy/satici/compose-denetle.mjs) — DB'siz; docker compose yoksa ÖLÇÜLEMEDİ beyanı.
//   §1 runbook kurguları (örnek .env'lerden türetilir): SATICI-KURULUM §13.3 (üretim + geri döngü, --diger-env hazırlık) ·
//      §13.9-2 (üretim + geri döngü + portal-genel, --diger-env hazırlık) · PORTAL-GENEL-ERISIM §4.6 (hazırlık + geri döngü
//      + portal-genel; ⑫ ölçülmedi, çıkış 0) · ana (tailnet) kip + portal-genel — hepsi 0 ihlal, her servis ③b/③c'den geçer
//   §2 yalıtım gevşetmesi — her örtü çıkış 1 ve KENDİ servisinin ③b/③c satırıyla: volumes_from (incelemenin örtüsü
//      `satici-jwks: volumes_from: ["satici:ro"]`) · privileged · cap_add · pid service: · security_opt seccomp=unconfined ·
//      network_mode service: · userns host · devices · tanınmayan anahtar (ulimits) · ana kipte portal-tunel ağ kipi
// ⭐ KALICI SONDA ✓K12 (her koşumda): §2'nin on gevşetme örtüsü kendi satırıyla ❌ · geri döngü kipinde beyanlı istisna
//    (portal-tunel → service:satici) YEŞİL — "her network_mode ihlal" diyen kör denetim geçemez · dört kurgu 0 ihlal —
//    her şeyi reddeden denetim geçemez.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_compose_yalitimi.ts   (DB GEREKMEZ)
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  sonuc();
}

main();
