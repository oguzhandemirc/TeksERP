// =============================================================================
// SATICI COMPOSE YALITIM DENETİMİ (deploy/satici/compose-denetle.mjs) — DB'siz; docker compose yoksa ÖLÇÜLEMEDİ beyanı.
//   §1 runbook kurguları (örnek .env'lerden türetilir; portal tüneli YOK, tek portal üretimde): üretim + portal-genel
//      (--diger-env hazırlık) · hazırlık yalnız ana dosya (⑫ ölçülmedi, çıkış 0) · hazırlık (--diger-env üretim) — hepsi
//      0 ihlal, her servis ③b/③c'den geçer; Ⓚ/Ⓞ/① satırları YEŞİL (her şeyi reddeden denetim geçemez)
//   §2 yalıtım gevşetmesi — her örtü çıkış 1 ve KENDİ servisinin ③b/③c satırıyla: volumes_from (incelemenin örtüsü
//      `satici-jwks: volumes_from: ["satici:ro"]`) · privileged · cap_add · pid service: · security_opt seccomp=unconfined ·
//      network_mode service: (istisna yok) · userns host · devices · tanınmayan anahtar (ulimits)
//   §2b ⑬c host yolu yaratma (create_host_path: true · kısa sözdizimi) her compose sürümünde kendi satırıyla ❌ — JSON izi
//      sürüme göre ters anlam taşır (2.x false'u, 5.x true'yu düşürür); denetim kalibrasyonla okur
//   §3 BİLDİRİM örtüsü (Ⓑ0–Ⓑ8): gerçek örtüyle üç kurgu 0 ihlal (hazırlık + bildirim · üretim + portal-genel + bildirim,
//      --diger-env hazırlık + bildirim · aynı, --diger-env düz hazırlık) ve her Ⓑ satırı ✅; --patron-env yoksa Ⓑ7'nin
//      patron ayağı ÖLÇÜLMEDİ (hazırlıkta çıkış 0, üretimde 2) · her Ⓑ maddesi için bozuk örtü/ortam → çıkış 1 ve KENDİ
//      satırı ❌ · .env'de BILDIRIM_DNS_1 değişince compose ile betik birlikte değişir → Ⓑ8 YEŞİL · düz sır basılmaz.
//   §4 üretim öncesi sertleştirme: yapılandırma BÜTÜN profillerle · ③d host bağı allowlist'i · ③e group_add yalnız SIR_GID ·
//      birincil grup root değil · Ⓑ5/⑬g ortam ALLOWLIST'i · Ⓑ7b/⑬h çıkış alt ağı = .env = betik · ⑥c IPv6 — her biri
//      kendi satırıyla ❌; ✓K pozitifler yeşil.
//   §5 TÜNEL KAPALI + TEK PORTAL (D5): satıcıya 127.0.0.1:4611 yayını → ① · tailnet ağı geri → ④b + Ⓚ · portal-tunel
//      servisi → Ⓚ + ③b · satıcı ortamında TAILNET_BIND → Ⓚ · .env'de TAILNET_* → Ⓚ ön denetim · COMPOSE_FILE'da emekli
//      docker-compose.loopback.yml (repoda yok) → çıkış 1 (2 DEĞİL), Ⓚ ön denetim · ESKİ loopback örtüsü (portal-tunel'li,
//      aynı adla) yeni compose'a bindirilir → Ⓚ ❌ (R4: imaj ile compose aynı adımda iner) · üretimde portal-genel yok →
//      Ⓞ · hazırlığa portal-genel → Ⓞ · öteki ortamın .env'inde TAILNET_* → Ⓚ öteki — her biri kendi satırıyla ❌.
// ⭐ KALICI SONDA (her koşumda): §2'nin gevşetme örtüleri · §3'ün Ⓑ sondaları · §4'ün sondaları · §5'in tünel/portal
//    sondaları kendi satırıyla ❌; üç kurgu 0 ihlal — her şeyi reddeden denetim geçemez.
// NEGATİF SONDA (D5 tünel kapatma T2, 2026-10-05, compose-denetle.mjs'te dosya DIŞI, cp + shasum ile geri alındı):
//   ① yayın listesi boşa çekildi → §5 4611 ❌ (84/85) · EMEKLI_SERVISLER boş → §5 portal-tunel · R4 eski örtü ❌ (83/85) ·
//   Ⓞ beklenen = örtü var mı → §5 üretimde örtü yok · hazırlığa örtü ❌ (83/85) · tunelAnahtari hep false → §5 TAILNET_BIND ·
//   R4 · .env TAILNET_* · öteki .env TAILNET_* ❌ (81/85) · B: ece294986'daki eski (iki kipli) denetim → 24 ❌ (61/85).
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
    // Örnek üretim .env'inin Access satırları yer tutucudur (<takım>…); kurgu bekçi değerleriyle EZER (son atama kazanır).
    const hazirlikMetni = imaj(readFileSync(path.join(D, "ornek.env"), "utf8"));
    const uretimMetni = `${imaj(readFileSync(path.join(D, "ornek-uretim.env"), "utf8"))}\n${portal("uretim", "172.31.251.48/29")}`;
    const hazirlik = yaz("hazirlik.env", hazirlikMetni);
    const uretim = yaz("uretim.env", uretimMetni);

    console.log("\n§1 runbook kurguları — 0 ihlal (tünel yok, tek portal üretimde)");
    const kurgular: [string, Kosum, number, RegExp][] = [
      ["§1a SATICI-KURULUM §13 üretim + portal-genel (örnek COMPOSE_FILE, --diger-env hazırlık)", denetle(uretim, { diger: hazirlik }), 0, /\d+ geçti, 0 ihlal$/],
      ["§1b hazırlık yalnız ana dosya — portal YOK (⑫ ölçülmedi, çıkış 0)", denetle(hazirlik), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
      ["§1c hazırlık (--diger-env üretim)", denetle(hazirlik, { diger: uretim }), 0, /\d+ geçti, 0 ihlal$/],
    ];
    for (const [ad, k, cikis, desen] of kurgular) {
      const servisSayisi = (k.cikti.match(/^✅ ③c /gm) ?? []).length;
      kontrol(`${ad} → çıkış ${cikis}, her serviste ③b + ③c`, k.status === cikis && desen.test(ozet(k)) && servisSayisi >= 4 && (k.cikti.match(/^✅ ③b /gm) ?? []).length === servisSayisi, `${k.status} · ${ozet(k)} · ${servisSayisi} servis ${kirmizi(k).join(" | ").slice(0, 200)}`);
    }
    const yesilD5 = [/^✅ Ⓚ bu ortam: /m, /^✅ ① hiçbir servis port yayımlamaz/m, /^✅ Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok/m, /^✅ ④b satıcının ağ kümesi tam üç ağ/m];
    const eksik1d = (k: Kosum, ozel: RegExp[]) => [...yesilD5, ...ozel].filter((d) => !d.test(k.cikti)).map(String);
    const e1a = eksik1d(kurgular[0]![1], [/^✅ Ⓞ üretimde portal-genel örtüsü ZORUNLU/m, /^✅ Ⓚ öteki ortam /m, /^✅ ⑫f öteki ortam da port yayımlamaz/m]);
    const e1b = eksik1d(kurgular[1]![1], [/^✅ Ⓞ hazırlıkta portal YOK/m]);
    kontrol("§1d ✓K Ⓚ · ① · ④b · Ⓞ (üretim zorunlu / hazırlık yok) · ⑫f satırları YEŞİL basılır (kör RED değil, sessiz atlama değil)", e1a.length === 0 && e1b.length === 0, [...e1a, ...e1b].join(" ; "));

    console.log("\n§2 yalıtım gevşetmesi — her örtü kendi satırıyla kırmızı (çıkış 1)");
    const temel = [path.join(D, "docker-compose.yml"), path.join(D, "docker-compose.portal-genel.yml")];
    const sondalar: [string, string, RegExp][] = [
      ["volumes_from (incelemenin örtüsü)", "services:\n  satici-jwks:\n    volumes_from: [\"satici:ro\"]\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — volumes_from=/m],
      ["privileged", "services:\n  satici:\n    privileged: true\n", /^❌ ③b satici yalıtım gevşetmesi yok — privileged=true/m],
      ["cap_add NET_ADMIN (cap_drop ALL'ı ezer)", "services:\n  satici-yedek:\n    cap_add: [NET_ADMIN]\n", /^❌ ③b satici-yedek yalıtım gevşetmesi yok — cap_add=\["NET_ADMIN"\]/m],
      ["pid service:satici", "services:\n  satici-jwks:\n    pid: \"service:satici\"\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — pid="service:satici"/m],
      // !override: liste birleştirmesi sürüme bağlı (eski compose tekrarı tekilleştirmez, şema uniqueItems ile reddeder).
      ["security_opt seccomp=unconfined", "services:\n  satici-db:\n    security_opt: !override [\"no-new-privileges:true\", \"seccomp=unconfined\"]\n", /^❌ ③b satici-db yalıtım gevşetmesi yok — security_opt=/m],
      ["network_mode service:satici (beyansız)", "services:\n  satici-yedek:\n    network_mode: \"service:satici\"\n    networks: !reset []\n", /^❌ ③b satici-yedek yalıtım gevşetmesi yok — network_mode="service:satici"/m],
      ["userns_mode host", "services:\n  satici:\n    userns_mode: host\n", /^❌ ③b satici yalıtım gevşetmesi yok — userns_mode="host"/m],
      ["devices", "services:\n  satici-jwks:\n    devices: [\"/dev/fuse:/dev/fuse\"]\n", /^❌ ③b satici-jwks yalıtım gevşetmesi yok — devices=/m],
      ["tanınmayan anahtar (ulimits)", "services:\n  satici-jwks:\n    ulimits: { nofile: 65535 }\n", /^❌ ③c satici-jwks yalnız tanınan anahtarlar[^\n]* — tanınmayan: ulimits/m],
    ];
    for (const [ad, ortu, desen] of sondalar) {
      const f = yaz(`sonda-${ad.replace(/[^a-z0-9]+/gi, "-")}.yml`, ortu);
      const k = denetle(uretim, { diger: hazirlik, dosyalar: [...temel, f] });
      kontrol(`§2 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 200) || ozet(k)}`);
    }

    // create_host_path'in JSON izi compose sürümüne göre ters anlam taşır: açık true her iki yönde de ❌ kalmalı.
    console.log("\n§2b ⑬c host yolu yaratma — compose sürümünden bağımsız kırmızı (çıkış 1)");
    const yaratmaSondalari: [string, string, RegExp][] = [
      [
        "satıcıda create_host_path: true",
        "services:\n  satici:\n    volumes:\n      - { type: bind, source: \"${ERISIM_JWKS_DIZINI_HOST}\", target: /erisim-jwks, read_only: true, bind: { create_host_path: true } }\n",
        /^❌ ⑬c JWKS bağı[^\n]* host yolu yaratmaz: satıcı=false yan=true$/m,
      ],
      [
        "yan konteynerde kısa sözdizimi (host yolunu yaratır)",
        "services:\n  satici-jwks:\n    volumes:\n      - \"${ERISIM_JWKS_DIZINI_HOST}:/erisim-jwks\"\n",
        /^❌ ⑬c JWKS bağı[^\n]* host yolu yaratmaz: satıcı=true yan=false$/m,
      ],
    ];
    for (const [ad, ortu, desen] of yaratmaSondalari) {
      const f = yaz(`sonda-yaratma-${ad.replace(/[^a-z0-9]+/gi, "-")}.yml`, ortu);
      const k = denetle(uretim, { diger: hazirlik, dosyalar: [...temel, f] });
      kontrol(`§2b ${ad} → çıkış 1, ⑬c ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 200) || ozet(k)}`);
    }

    console.log("\n§3 bildirim örtüsü (Ⓑ0–Ⓑ8) — gerçek örtü 0 ihlal, her bozuk örtü kendi satırıyla kırmızı");
    const PATRON = path.join(D, "..", "patron", "ornek.env");
    const BILDIRIM = path.join(D, "docker-compose.bildirim.yml");
    const ekle = (metin: string, dosyalar: string) => `${metin}\nCOMPOSE_FILE=${dosyalar}\n`;
    // Üretimin bildirim satırları örnekte YER AYRILMIŞ (yorumlu) — örnek tek kaynak kalsın diye açılarak kullanılır.
    const uretimBildirimMetni = uretimMetni.replace(/^# ((?:BILDIRIM|TELEGRAM|RESEND)_[A-Z0-9_]+=)/gm, "$1");
    const uretimPB = yaz("uretim-pb.env", ekle(uretimBildirimMetni, "docker-compose.yml:docker-compose.portal-genel.yml:docker-compose.bildirim.yml"));
    const hazirlikB = yaz("hazirlik-b.env", ekle(hazirlikMetni, "docker-compose.yml:docker-compose.bildirim.yml"));
    const denetleP = (env: string, g: { diger?: string; dosyalar?: readonly string[]; patron?: boolean } = {}): Kosum => {
      const r = spawnSync(
        process.execPath,
        [DENETLE, "--env-file", env, ...(g.diger ? ["--diger-env", g.diger] : []), ...(g.patron === false ? [] : ["--patron-env", PATRON]), ...(g.dosyalar ?? []).flatMap((f) => ["-f", f])],
        { encoding: "utf8", timeout: 60_000 },
      );
      return { status: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    // Üretim kurgusu öteki ortamla (hazırlık + bildirim) koşar: ⑫ ölçülmeden üretim çıkışı 2 olurdu.
    const denetleU = (env: string, g: { dosyalar?: readonly string[]; patron?: boolean } = {}): Kosum => denetleP(env, { diger: hazirlikB, ...g });
    const bKurgular: [string, Kosum, number, RegExp][] = [
      ["§3a hazırlık + bildirim (--patron-env)", denetleP(hazirlikB), 0, /\d+ geçti, 0 ihlal, 1 ölçülmedi$/],
      ["§3b üretim + portal-genel + bildirim (--diger-env hazırlık + bildirim · --patron-env)", denetleU(uretimPB), 0, /\d+ geçti, 0 ihlal$/],
      ["§3c üretim + portal-genel + bildirim (--diger-env düz hazırlık · --patron-env)", denetleP(uretimPB, { diger: hazirlik }), 0, /\d+ geçti, 0 ihlal$/],
    ];
    const B_SATIRLARI = ["Ⓑ0", "Ⓑ1", "Ⓑ2", "Ⓑ3", "Ⓑ4", "Ⓑ5", "Ⓑ6", "Ⓑ7", "Ⓑ7b", "Ⓑ8"];
    for (const [ad, k, cikis, desen] of bKurgular) {
      const eksikB = B_SATIRLARI.filter((b) => !new RegExp(`^✅ ${b} `, "m").test(k.cikti));
      const yedi = (k.cikti.match(/^✅ Ⓑ7 /gm) ?? []).length;
      kontrol(
        `${ad} → çıkış ${cikis}, örtü: bildirim algılandı, Ⓑ0–Ⓑ8 hepsi ✅ (Ⓑ7 iki ayak)`,
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
    const patronsuzU = denetleU(uretimPB, { patron: false });
    kontrol("§3f ✓K üretimde --patron-env yoksa çıkış 2 (ÖLÇÜLMEDİ üretimde zorunlu)", patronsuzU.status === 2 && /ÜRETİMDE ZORUNLU/.test(patronsuzU.cikti), `${patronsuzU.status} · ${ozet(patronsuzU)}`);

    const bTemel = [...temel, BILDIRIM];
    // Ⓑ0: örtü dosyası listede ama servis başka adla → beklenen servis eksik.
    const adsiz = path.join(tmp, "b0", "docker-compose.bildirim.yml");
    mkdirSync(path.dirname(adsiz));
    writeFileSync(adsiz, readFileSync(BILDIRIM, "utf8").replace(/^  satici-bildirim:$/m, "  gonderici:"));
    const b0 = denetleU(uretimPB, { dosyalar: [...temel, adsiz] });
    kontrol("§3 Ⓑ0 örtü dosyası listede, satici-bildirim yok → çıkış 1, Ⓑ0 + körlük zemini ❌", b0.status === 1 && /^❌ Ⓑ0 /m.test(b0.cikti) && /^❌ körlük zemini/m.test(b0.cikti), `${b0.status} · ${kirmizi(b0).join(" | ").slice(0, 200)}`);

    const bSondalar: [string, string, RegExp][] = [
      ["Ⓑ1 çekirdek servis ek bir AÇIK ağa katılır", "services:\n  satici-goc:\n    networks: [acik]\nnetworks:\n  acik:\n    name: bekci-acik\n", /^❌ Ⓑ1 /m],
      ["Ⓑ2 satici-yedek bildirim-cikis'e katılır", "services:\n  satici-yedek:\n    networks: [bildirim-cikis]\n", /^❌ Ⓑ2 [^\n]*çıkışta: satici-yedek/m],
      ["Ⓑ2 gönderici kenar ağına katılır", "services:\n  satici-bildirim:\n    networks: [kenar]\n", /^❌ Ⓑ2 [^\n]*gönderici: bildirim-cikis, ic, kenar/m],
      ["Ⓑ3 göndericiye anahtar birimi", 'services:\n  satici-bildirim:\n    volumes: ["${ANAHTAR_DIZINI_HOST}:/anahtarlar:ro"]\n', /^❌ Ⓑ3 [^\n]*birim \/anahtarlar/m],
      ["Ⓑ3 göndericide Traefik etiketi", 'services:\n  satici-bildirim:\n    labels: { traefik.enable: "true" }\n', /^❌ Ⓑ3 [^\n]*Traefik etiketi/m],
      ["Ⓑ4 göndericiye db_parolasi", "services:\n  satici-bildirim:\n    secrets: [db_parolasi]\n", /^❌ Ⓑ4 [^\n]*db_parolasi/m],
      ["Ⓑ4 satıcıya telegram_bot_token", "services:\n  satici:\n    secrets: [telegram_bot_token]\n", /^❌ Ⓑ4 [^\n]*başka serviste: satici:telegram_bot_token/m],
      ["Ⓑ5 düz TELEGRAM_BOT_TOKEN", 'services:\n  satici-bildirim:\n    environment: { TELEGRAM_BOT_TOKEN: "bekci-duz-sir-degeri" }\n', /^❌ Ⓑ5 [^\n]*tanınmayan düz TELEGRAM_BOT_TOKEN/m],
      ["Ⓑ5 düz DATABASE_URL", 'services:\n  satici-bildirim:\n    environment: { DATABASE_URL: "postgresql://bekci@satici-db/satici" }\n', /^❌ Ⓑ5 [^\n]*tanınmayan düz DATABASE_URL/m],
      ["Ⓑ5 DB_KULLANICI satıcının sahibi", "services:\n  satici-bildirim:\n    environment: { DB_KULLANICI: satici }\n", /^❌ Ⓑ5 [^\n]*DB_KULLANICI ≠ satici_bildirim/m],
      ["Ⓑ5 DB parolası satıcının sırrından", "services:\n  satici-bildirim:\n    environment: { DB_PAROLA_DOSYASI: /run/secrets/db_parolasi }\n", /^❌ Ⓑ5 [^\n]*DB_PAROLA_DOSYASI/m],
      ["Ⓑ5 sır dosyası /run/secrets dışında", "services:\n  satici-bildirim:\n    environment: { EK_ANAHTAR_DOSYASI: /anahtarlar/kok.json }\n", /^❌ Ⓑ5 [^\n]*tanınmayan EK_ANAHTAR_DOSYASI/m],
      ["Ⓑ5 sağlayıcı kökü düz http", 'services:\n  satici-bildirim:\n    environment: { TELEGRAM_API_KOKU: "http://api.telegram.org" }\n', /^❌ Ⓑ5 [^\n]*TELEGRAM_API_KOKU ≠ https:\/\/api\.telegram\.org/m],
      ["Ⓑ6 başka komut", 'services:\n  satici-bildirim:\n    command: ["node", "dist/server.js"]\n', /^❌ Ⓑ6 [^\n]*komut/m],
      ["Ⓑ6 başka imaj", "services:\n  satici-bildirim:\n    image: tekserp-satici:baska\n", /^❌ Ⓑ6 [^\n]*imaj tekserp-satici:baska/m],
      ["Ⓑ6 giriş noktası ezilir", 'services:\n  satici-bildirim:\n    entrypoint: ["node"]\n', /^❌ Ⓑ6 [^\n]*giriş noktası ezilmiş/m],
      ["Ⓑ8 dns betikten farklı", 'services:\n  satici-bildirim:\n    dns: !override ["8.8.8.8", "1.1.1.1"]\n', /^❌ Ⓑ8 [^\n]*compose 8\.8\.8\.8, 1\.1\.1\.1/m],
      ["Ⓑ8 dns ad (IPv4 değil)", 'services:\n  satici-bildirim:\n    dns: !override ["dns.google", "9.9.9.9"]\n', /^❌ Ⓑ8 /m],
      ["Ⓑ8 üç çözücü", 'services:\n  satici-bildirim:\n    dns: ["8.8.8.8"]\n', /^❌ Ⓑ8 [^\n]*compose 1\.1\.1\.1, 9\.9\.9\.9, 8\.8\.8\.8/m],
    ];
    for (const [ad, ortu, desen] of bSondalar) {
      const f = yaz(`b-sonda-${ad.replace(/[^a-z0-9]+/gi, "-")}.yml`, ortu);
      const k = denetleU(uretimPB, { dosyalar: [...bTemel, f] });
      kontrol(`§3 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 220) || ozet(k)}`);
      if (ad.includes("düz TELEGRAM_BOT_TOKEN")) kontrol("§3 Ⓑ5 düz sır DEĞERİ çıktıya basılmaz (yalnız anahtar adı)", !k.cikti.includes("bekci-duz-sir-degeri"));
    }
    const agSondalari: [string, string, RegExp][] = [
      ["Ⓑ7 çıkış ağı JWKS ağıyla çakışır (172.31.251.48/28)", "172.31.251.48/28", /^❌ Ⓑ7 bildirim-cikis alt ağı [^\n]*jwks-cikis 172\.31\.251\.48\/29/m],
      ["Ⓑ7 çıkış ağı CGNAT aralığında (100.100.0.0/28)", "100.100.0.0/28", /^❌ Ⓑ7 bildirim-cikis alt ağı [^\n]*100\.64\.0\.0\/10/m],
      ["Ⓑ7 çıkış ağı patronun çıkış ağıyla çakışır (172.31.250.16/28)", "172.31.250.16/28", /^❌ Ⓑ7 bildirim-cikis patronun ağlarıyla çakışmaz [^\n]*cikis 172\.31\.250\.16\/28/m],
    ];
    const pbMetni = readFileSync(uretimPB, "utf8");
    for (const [ad, alt, desen] of agSondalari) {
      const env = yaz(`b7-${alt.replace(/[^0-9]+/g, "-")}.env`, pbMetni.replace(/^BILDIRIM_CIKIS_AGI=.*$/m, `BILDIRIM_CIKIS_AGI=${alt}`));
      const k = denetleU(env);
      kontrol(`§3 ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 220) || ozet(k)}`);
    }
    const dnsEnv = yaz("b8-dns.env", `${pbMetni}\nBILDIRIM_DNS_1=8.8.8.8\n`);
    const dnsK = denetleU(dnsEnv);
    kontrol(
      "§3 Ⓑ8 ✓K .env'de BILDIRIM_DNS_1=8.8.8.8 → compose ve betik birlikte değişir → Ⓑ8 YEŞİL (sabit kodlu denetim geçemez)",
      dnsK.status === 0 && /^✅ Ⓑ8 [^\n]*compose 8\.8\.8\.8, 9\.9\.9\.9 · betik 8\.8\.8\.8, 9\.9\.9\.9/m.test(dnsK.cikti),
      `${dnsK.status} · ${kirmizi(dnsK).join(" | ").slice(0, 200) || ozet(dnsK)}`,
    );

    console.log("\n§4 üretim öncesi sertleştirme — profil · host bağı · grup · ortam allowlist'i · çıkış ağı ↔ .env/betik · IPv6");
    const ilk = kurgular[0]![1].cikti;
    kontrol(
      "§4a ✓K runbook kurgusunda profil + bağ + grup satırları YEŞİL (her şeyi reddeden denetim geçemez): satici-goc [goc] · satıcı/yedek/DB bağları · group_add",
      /^✅ ③c satici-goc yalnız tanınan anahtarlar · profil tam olarak \["goc"\]/m.test(ilk) && /^✅ ③d satici host bağları/m.test(ilk) && /^✅ ③d satici-yedek host bağları/m.test(ilk) && /^✅ ③d satici-db host bağları/m.test(ilk) && /^✅ ③d bağ kaynakları/m.test(ilk) && /^✅ ③e group_add/m.test(ilk),
      kirmizi(kurgular[0]![1]).join(" | ").slice(0, 200),
    );
    const sertSondalar: [string, string, RegExp[]][] = [
      [
        "`bakim` profilli privileged + host ağlı + docker.sock'lu servis (--profile goc onu hiç görmezdi)",
        'services:\n  bakim:\n    image: alpine:3\n    profiles: ["bakim"]\n    privileged: true\n    network_mode: host\n    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]\n',
        [/^❌ körlük zemini/m, /^❌ ② docker soketi/m, /^❌ ③b bakim yalıtım gevşetmesi yok — [^\n]*privileged=true[^\n]*network_mode="host"/m, /^❌ ③c bakim [^\n]*profiles=\["bakim"\]/m, /^❌ ③d bakim host bağları [^\n]*beyansız bağ \/var\/run\/docker\.sock/m],
      ],
      ["satici-goc profili goc değil (her up'ta göç)", 'services:\n  satici-goc:\n    profiles: !override ["bakim"]\n', [/^❌ ③c satici-goc [^\n]*profiles=\["bakim"\]/m]],
      ["satıcıya profil (denetimden saklanır)", 'services:\n  satici:\n    profiles: ["gizli"]\n', [/^❌ ③c satici [^\n]*profiles=\["gizli"\]/m]],
      ["satici-yedek'e / bağı + group_add 0", 'services:\n  satici-yedek:\n    volumes: ["/:/host"]\n    group_add: !override ["0"]\n', [/^❌ ③d satici-yedek host bağları [^\n]*beyansız bağ \/:\/host/m, /^❌ ③d bağ kaynakları [^\n]*sistem yolu satici-yedek:\//m, /^❌ ③e group_add [^\n]*satici-yedek: \["0"\]/m]],
      ["satici-jwks'e anahtar dizini (başka servisin anahtarı)", 'services:\n  satici-jwks:\n    volumes: ["${ANAHTAR_DIZINI_HOST}:/anahtarlar:ro"]\n', [/^❌ ③d satici-jwks host bağları [^\n]*beyansız bağ \/opt\/stack\/apps\/tekserp-satici-uretim\/anahtarlar:\/anahtarlar/m]],
      ["yedek bağının kaynağı sır dizini", 'services:\n  satici-yedek:\n    volumes: ["/opt/stack/apps/tekserp-satici-uretim/sirlar:/yedek"]\n', [/^❌ ③d satici-yedek host bağları [^\n]*\/yedek kaynağı \.env'deki YEDEK_DIZINI_HOST değil/m, /^❌ ③d bağ kaynakları [^\n]*sır bağda db_parolasi→satici-yedek/m]],
      ["satıcının anahtar bağı yazılır (ro kalkar)", 'services:\n  satici:\n    volumes: ["${ANAHTAR_DIZINI_HOST}:/anahtarlar"]\n', [/^❌ ③d satici host bağları [^\n]*\/anahtarlar salt okunur değil/m]],
      ["/etc bağı satıcıda", 'services:\n  satici:\n    volumes: ["/etc:/etc-host:ro"]\n', [/^❌ ③d satici host bağları [^\n]*beyansız bağ \/etc:\/etc-host/m, /^❌ ③d bağ kaynakları [^\n]*sistem yolu satici:\/etc/m]],
      ["satici-jwks'e SIR_GID", 'services:\n  satici-jwks:\n    group_add: ["${SIR_GID}"]\n', [/^❌ ③e group_add [^\n]*satici-jwks: \["61063"\]/m]],
      ["birincil grup root", 'services:\n  satici:\n    user: "10001:0"\n', [/^❌ ③ satici sertleştirilmiş — eksik: root olmayan birincil grup/m]],
      ["Ⓑ5 NODE_OPTIONS (hata ayıklayıcı)", 'services:\n  satici-bildirim:\n    environment: { NODE_OPTIONS: "--inspect=0.0.0.0:9229" }\n', [/^❌ Ⓑ5 [^\n]*tanınmayan NODE_OPTIONS/m]],
      ["Ⓑ5 DB_HOST satıcı konteyneri", "services:\n  satici-bildirim:\n    environment: { DB_HOST: satici }\n", [/^❌ Ⓑ5 [^\n]*DB_HOST ≠ satici-db/m]],
      ["Ⓑ5 DB_ADI başka DB", "services:\n  satici-bildirim:\n    environment: { DB_ADI: postgres }\n", [/^❌ Ⓑ5 [^\n]*DB_ADI ≠ satici/m]],
      ["Ⓑ5 vekil (HTTPS_PROXY)", 'services:\n  satici-bildirim:\n    environment: { HTTPS_PROXY: "http://10.0.0.1:3128" }\n', [/^❌ Ⓑ5 [^\n]*tanınmayan HTTPS_PROXY/m]],
      ["Ⓑ5 sağlayıcı kökü başka https adresi", 'services:\n  satici-bildirim:\n    environment: { RESEND_API_KOKU: "https://ornek.example" }\n', [/^❌ Ⓑ5 [^\n]*RESEND_API_KOKU ≠ https:\/\/api\.resend\.com/m]],
      ["⑬g jwks çekicisine NODE_OPTIONS", 'services:\n  satici-jwks:\n    environment: { NODE_OPTIONS: "--require /tmp/x.js" }\n', [/^❌ ⑬g [^\n]*tanınmayan NODE_OPTIONS/m]],
      ["prototip adlı ortam anahtarları (toString · constructor — `in` allowlist'i geçerdi)", 'services:\n  satici-jwks:\n    environment: { toString: x, constructor: y }\n  satici-bildirim:\n    environment: { toString: x }\n', [/^❌ ⑬g [^\n]*tanınmayan constructor · tanınmayan toString/m, /^❌ Ⓑ5 [^\n]*tanınmayan toString/m]],
      ["Ⓑ7b örtü bildirim-cikis'i 172.31.200.0/28'e çevirir (betik .env'dekini daraltır)", 'networks:\n  bildirim-cikis:\n    ipam:\n      config: !override [{ subnet: "172.31.200.0/28" }]\n', [/^❌ Ⓑ7b [^\n]*compose 172\.31\.200\.0\/28 · \.env 172\.31\.251\.64\/28/m]],
      ["Ⓑ7b bildirim-cikis'e ikinci alt ağ (betiğin ağı + kuralsız ağ)", 'networks:\n  bildirim-cikis:\n    ipam:\n      config: !override [{ subnet: "172.31.251.64/28" }, { subnet: "172.31.200.0/28" }]\n', [/^❌ Ⓑ7b [^\n]*compose 172\.31\.251\.64\/28, 172\.31\.200\.0\/28/m]],
      ["⑬h örtü jwks-cikis'i 172.31.200.0/28'e çevirir", 'networks:\n  jwks-cikis:\n    ipam:\n      config: !override [{ subnet: "172.31.200.0/28" }]\n', [/^❌ ⑬h [^\n]*compose 172\.31\.200\.0\/28 · \.env 172\.31\.251\.48\/29/m]],
      ["⑥c bildirim-cikis'te IPv6", "networks:\n  bildirim-cikis:\n    enable_ipv6: true\n", [/^❌ ⑥c bildirim-cikis ağında IPv6 kapalı [^\n]*enable_ipv6=true/m]],
      ["⑥c jwks-cikis'e v6 alt ağı", 'networks:\n  jwks-cikis:\n    enable_ipv6: true\n    ipam:\n      config: [{ subnet: "fd00:dead:beef::/64" }]\n', [/^❌ ⑥c jwks-cikis ağında IPv6 kapalı [^\n]*enable_ipv6=true · v6 alt ağ fd00:dead:beef::\/64/m]],
    ];
    for (const [ad, ortu, desenler] of sertSondalar) {
      const f = yaz(`s4-${ad.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.yml`, ortu);
      const k = denetleU(uretimPB, { dosyalar: [...bTemel, f] });
      const eksik = desenler.filter((d) => !d.test(k.cikti));
      kontrol(`§4 ${ad} → çıkış 1, kendi satır(lar)ı ❌`, k.status === 1 && eksik.length === 0, `${k.status} · eksik ${eksik.map(String).join(" ; ").slice(0, 160) || "yok"} · ${kirmizi(k).join(" | ").slice(0, 240)}`);
    }
    const envSondalari: [string, string, RegExp][] = [
      ["SIR_GID=0 (root grubu)", "SIR_GID=0", /^❌ ③e group_add [^\n]*SIR_GID=0 geçersiz/m],
      ["YEDEK_DIZINI_HOST anahtar dizininin atası", "YEDEK_DIZINI_HOST=/opt/stack/apps/tekserp-satici-uretim", /^❌ ③d bağ kaynakları [^\n]*iç içe (ANAHTAR_DIZINI_HOST↔YEDEK_DIZINI_HOST|YEDEK_DIZINI_HOST↔ANAHTAR_DIZINI_HOST)/m],
      ["DOSYA_DIZINI_HOST=/var (docker'ın atası)", "DOSYA_DIZINI_HOST=/var", /^❌ ③d bağ kaynakları [^\n]*sistem yolu satici:\/var/m],
    ];
    for (const [ad, satir, desen] of envSondalari) {
      const [anahtar] = satir.split("=");
      const env = yaz(`s4-env-${anahtar}.env`, pbMetni.replace(new RegExp(`^${anahtar}=.*$`, "m"), satir));
      const k = denetleU(env);
      kontrol(`§4 .env ${ad} → çıkış 1, kendi satırı ❌`, k.status === 1 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 240) || ozet(k)}`);
    }
    const olumlu: [string, string, RegExp][] = [
      ["Ⓑ5 isteğe bağlı anahtar beklenen değerle (DB_HOST=satici-db · resmî Resend kökü)", 'services:\n  satici-bildirim:\n    environment: { DB_HOST: satici-db, RESEND_API_KOKU: "https://api.resend.com" }\n', /^✅ Ⓑ5 /m],
      ["⑬g JWKS_CEKIM_DK=5", 'services:\n  satici-jwks:\n    environment: { JWKS_CEKIM_DK: "5" }\n', /^✅ ⑬g /m],
    ];
    for (const [ad, ortu, desen] of olumlu) {
      const f = yaz(`s4-olumlu-${ad.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.yml`, ortu);
      const k = denetleU(uretimPB, { dosyalar: [...bTemel, f] });
      kontrol(`§4 ✓K ${ad} → çıkış 0 (allowlist kör RED değil)`, k.status === 0 && desen.test(k.cikti), `${k.status} · ${kirmizi(k).join(" | ").slice(0, 200) || ozet(k)}`);
    }
    const agEnv = yaz("s4-ag.env", pbMetni.replace(/^BILDIRIM_CIKIS_AGI=.*$/m, "BILDIRIM_CIKIS_AGI=172.31.251.80/28"));
    const agK = denetleU(agEnv);
    kontrol(
      "§4 ✓K .env'de BILDIRIM_CIKIS_AGI değişince compose ve betik birlikte değişir → Ⓑ7b YEŞİL (sabit kodlu denetim geçemez)",
      agK.status === 0 && /^✅ Ⓑ7b [^\n]*compose 172\.31\.251\.80\/28 · \.env 172\.31\.251\.80\/28 · betik AG=\$BILDIRIM_CIKIS_AGI/m.test(agK.cikti),
      `${agK.status} · ${kirmizi(agK).join(" | ").slice(0, 200) || ozet(agK)}`,
    );

    console.log("\n§5 tünel kapalı + tek portal (D5) — her kalıntı kendi satırıyla kırmızı (çıkış 1)");
    const tunelSondalari: [string, string, RegExp[]][] = [
      ["satıcıya 127.0.0.1:4611 yayını", 'services:\n  satici:\n    ports: ["127.0.0.1:4611:4611"]\n', [/^❌ ① hiçbir servis port yayımlamaz — satici: 127\.0\.0\.1:4611→4611/m]],
      [
        "tailnet ağı geri (satıcıya dış köprü)",
        'services:\n  satici:\n    networks:\n      tailnet: {}\nnetworks:\n  tailnet:\n    name: tekserp-satici-${ORTAM}-tailnet\n',
        [/^❌ ④b satıcının ağ kümesi tam üç ağ[^\n]* — ic, ic-api, kenar, tailnet$/m, /^❌ Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok[^\n]* — ağ tailnet$/m, /^❌ ④c internal olmayan ağ /m],
      ],
      [
        "portal-tunel servisi (eski geri döngü iletici)",
        'services:\n  portal-tunel:\n    image: ${SATICI_IMAJ}\n    network_mode: "service:satici"\n    user: "10001:10001"\n    read_only: true\n    security_opt: ["no-new-privileges:true"]\n    cap_drop: ["ALL"]\n    mem_limit: 64m\n    cpus: 0.1\n    pids_limit: 20\n',
        [/^❌ Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok[^\n]* — servis portal-tunel$/m, /^❌ ③b portal-tunel yalıtım gevşetmesi yok — network_mode="service:satici"$/m, /^❌ körlük zemini/m],
      ],
      ["satıcı ortamında TAILNET_BIND", 'services:\n  satici:\n    environment:\n      TAILNET_BIND: "127.0.0.1"\n', [/^❌ Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok[^\n]* — satici: TAILNET_BIND$/m]],
    ];
    for (const [ad, ortu, desenler] of tunelSondalari) {
      const f = yaz(`s5-${ad.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.yml`, ortu);
      const k = denetle(uretim, { diger: hazirlik, dosyalar: [...temel, f] });
      const eksik = desenler.filter((d) => !d.test(k.cikti));
      kontrol(`§5 ${ad} → çıkış 1, kendi satır(lar)ı ❌`, k.status === 1 && eksik.length === 0, `${k.status} · eksik ${eksik.map(String).join(" ; ").slice(0, 160) || "yok"} · ${kirmizi(k).join(" | ").slice(0, 240)}`);
    }
    // R4: eski örtü yeni imajla koşarsa portal-tunel çöker — örtü AYNI ADLA (VDS'te kalmış kopya) bindirildiğinde de kırmızı.
    const eskiDizin = path.join(tmp, "eski");
    mkdirSync(eskiDizin);
    const eskiOrtu = path.join(eskiDizin, "docker-compose.loopback.yml");
    writeFileSync(
      eskiOrtu,
      'services:\n  satici:\n    environment:\n      TAILNET_BIND: "127.0.0.1"\n      TAILNET_LOOPBACK: "1"\n  portal-tunel:\n    image: ${SATICI_IMAJ}\n    network_mode: "service:satici"\n    depends_on: [satici]\n    user: "10001:10001"\n    entrypoint: ["node", "/usr/local/lib/portal-tunel.cjs"]\n    read_only: true\n    init: true\n    security_opt: ["no-new-privileges:true"]\n    cap_drop: ["ALL"]\n    cpus: 0.1\n    mem_limit: 64m\n    pids_limit: 20\n',
    );
    const eski = denetle(uretim, { diger: hazirlik, dosyalar: [...temel, eskiOrtu] });
    const eskiEksik = [
      /^❌ Ⓚ bu ortam: [^\n]*örtü docker-compose\.loopback\.yml — yeni imajda portal-tunel YOK/m,
      /^❌ Ⓚ çözülmüş yapılandırmada tünel kalıntısı yok[^\n]* — servis portal-tunel · satici: TAILNET_BIND · satici: TAILNET_LOOPBACK$/m,
    ].filter((d) => !d.test(eski.cikti));
    kontrol("§5 ⭐ R4 eski geri döngü örtüsü (aynı adla, portal-tunel'li) yeni compose'a bindirilir → çıkış 1, Ⓚ ön + çözülmüş ❌", eski.status === 1 && eskiEksik.length === 0, `${eski.status} · eksik ${eskiEksik.map(String).join(" ; ").slice(0, 160) || "yok"} · ${kirmizi(eski).join(" | ").slice(0, 240)}`);
    const emekliEnv = yaz("s5-emekli-compose-file.env", `${uretimMetni}\nCOMPOSE_FILE=docker-compose.yml:docker-compose.loopback.yml:docker-compose.portal-genel.yml\n`);
    const emekli = denetle(emekliEnv, { diger: hazirlik });
    kontrol(
      "§5 ⭐ R4 VDS .env'i hâlâ COMPOSE_FILE'da docker-compose.loopback.yml (repoda yok) → çıkış 1 (ÖLÇÜLEMEDİ değil), Ⓚ ön ❌",
      emekli.status === 1 && /^❌ Ⓚ bu ortam: [^\n]*örtü docker-compose\.loopback\.yml/m.test(emekli.cikti) && /yapılandırma çözülmeden/.test(emekli.cikti),
      `${emekli.status} · ${kirmizi(emekli).join(" | ").slice(0, 200) || ozet(emekli)}`,
    );
    const envKalinti = yaz("s5-env-tailnet.env", `${uretimMetni}\nTAILNET_IP=127.0.0.1\nTAILNET_AGI=172.31.251.16/28\n`);
    const envK = denetle(envKalinti, { diger: hazirlik });
    kontrol("§5 .env'de TAILNET_IP/TAILNET_AGI kalmış → çıkış 1, Ⓚ ön ❌ (adlarıyla)", envK.status === 1 && /^❌ Ⓚ bu ortam: [^\n]* — anahtar TAILNET_IP · anahtar TAILNET_AGI$/m.test(envK.cikti), `${envK.status} · ${kirmizi(envK).join(" | ").slice(0, 200)}`);
    const digerKalinti = yaz("s5-diger-tailnet.env", `${hazirlikMetni}\nTAILNET_KONTEYNER_IP=172.31.253.2\n`);
    const digerK = denetle(uretim, { diger: digerKalinti });
    kontrol("§5 öteki ortamın .env'inde TAILNET_KONTEYNER_IP → çıkış 1, Ⓚ öteki ❌", digerK.status === 1 && /^❌ Ⓚ öteki ortam \(s5-diger-tailnet\.env\): [^\n]*anahtar TAILNET_KONTEYNER_IP/m.test(digerK.cikti), `${digerK.status} · ${kirmizi(digerK).join(" | ").slice(0, 200)}`);
    const digerPortlu = yaz("s5-diger-port.yml", 'services:\n  satici:\n    ports: ["127.0.0.1:4611:4611"]\n');
    const digerPortEnv = yaz("s5-diger-port.env", `${hazirlikMetni}\nCOMPOSE_FILE=docker-compose.yml:${digerPortlu}\n`);
    const digerP = denetle(uretim, { diger: digerPortEnv });
    kontrol("§5 öteki ortam 127.0.0.1:4611 yayımlar → çıkış 1, ⑫f ❌", digerP.status === 1 && /^❌ ⑫f öteki ortam da port yayımlamaz[^\n]* — 127\.0\.0\.1:4611$/m.test(digerP.cikti), `${digerP.status} · ${kirmizi(digerP).join(" | ").slice(0, 200)}`);
    const portalsizU = yaz("s5-uretim-portalsiz.env", `${uretimMetni}\nCOMPOSE_FILE=docker-compose.yml\n`);
    const pU = denetle(portalsizU, { diger: hazirlik });
    kontrol("§5 ⭐ üretimde portal-genel örtüsü YOK → çıkış 1, Ⓞ ❌ (portalsız üretim)", pU.status === 1 && /^❌ Ⓞ üretimde portal-genel örtüsü ZORUNLU[^\n]* — ortam uretim · portal-genel YOK$/m.test(pU.cikti), `${pU.status} · ${kirmizi(pU).join(" | ").slice(0, 200)}`);
    const portalliH = yaz("s5-hazirlik-portalli.env", `${hazirlikMetni}\nCOMPOSE_FILE=docker-compose.yml:docker-compose.portal-genel.yml\n${portal("hazirlik", "172.31.255.0/29")}`);
    const pH = denetle(portalliH, { diger: uretim });
    kontrol("§5 ⭐ hazırlığa portal-genel örtüsü → çıkış 1, Ⓞ ❌ (tek portal üretimde)", pH.status === 1 && /^❌ Ⓞ hazırlıkta portal YOK[^\n]* — ortam hazirlik · portal-genel VAR$/m.test(pH.cikti), `${pH.status} · ${kirmizi(pH).join(" | ").slice(0, 200)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  sonuc();
}

main();
