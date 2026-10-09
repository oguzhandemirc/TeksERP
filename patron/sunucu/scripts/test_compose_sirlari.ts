// =============================================================================
// PATRON COMPOSE SIRLARI ↔ GİRİŞ BETİĞİ BEKÇİSİ — DB'siz; docker compose yoksa §2/§3 ÖLÇÜLEMEDİ (kırmızı).
// Sınıf: compose bir servise sırrı vermez ama giriş betiği o sırrı ister → servis yeniden başlama döngüsü
// (`patron-hazirla`, yerel duman 2026-10-09). Tersi (verilen ama okunmayan sır) en az yetkiyi bozar.
//   §1 patron-baslat.sh GERÇEKTEN koşulur (sır dizini geçici kopyada): her rol yalnız kendi sırlarıyla açılır ve
//      tablo dışı sırrı okumaz; hazırlayıcı uygulama parolasız açılır; eksik sır / tanınmayan rol → çıkış 1
//   §2 compose-denetle ⑩ gerçek compose + ornek.env ile beş servis ✅
//   §3 ⑩ negatif sondalar: hazırlayıcı rolü uygulama parolası ister (ilk arızanın aynısı) → EKSİK ❌ · compose
//      hazırlayıcıdan tesis anahtarını düşürür → EKSİK ❌ · göç rolü eşitleme parolasını okumaz → FAZLA ❌ · tanınmayan
//      PATRON_ROL ❌ · betik tablo dışı sır okur ❌ · yedek sırsız ❌
//   §4 duman.sh davet belirteci deseni yeni belirteci (tesis ön ekli, noktalı) tam alır
// NEGATİF SONDA (2026-10-09, dosya DIŞI, origin/main'deki patron-baslat.sh + duman.sh yerine konup geri alındı):
//   eski betik → §1 hazırlayıcı/fazla/zorunlu/rol · §2 rol tablosu YOK · §3 sondalar · §4 desen 0/66 ❌ (10/23).
// Koşum: npx tsx scripts/test_compose_sirlari.ts   (DB GEREKMEZ)
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { newToken } from "../src/auth/session.service";
import { PATRON_KOKU, kontrol, sonuc } from "./lib/test-ortam";

const D = path.resolve(PATRON_KOKU, "..", "..", "deploy", "patron");
const BASLAT = readFileSync(path.join(D, "patron-baslat.sh"), "utf8");
const TMP = mkdtempSync(path.join(os.tmpdir(), "patron-compose-sir-"));

// §1 betiğin gerçek davranışı
function baslat(rol: string | null, sirlar: readonly string[], betik = BASLAT): { status: number | null; env: Record<string, string>; hata: string } {
  const sd = mkdtempSync(path.join(TMP, "s-"));
  for (const s of sirlar) writeFileSync(path.join(sd, s), s === "ic_api_belirteci" ? "" : "a1b2c3d4\n");
  const kopya = path.join(sd, "baslat.sh");
  writeFileSync(kopya, betik.replace(/^S=\/run\/secrets$/m, `S=${sd}`));
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (rol) env.PATRON_ROL = rol;
  const r = spawnSync("sh", [kopya, "env"], { encoding: "utf8", env });
  const cikan: Record<string, string> = {};
  for (const l of (r.stdout ?? "").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0) cikan[l.slice(0, i)] = l.slice(i + 1);
  }
  return { status: r.status, env: cikan, hata: r.stderr ?? "" };
}

kontrol("§1 betik `S=/run/secrets` satırını taşır (sonda onu geçici dizine çevirir)", /^S=\/run\/secrets$/m.test(BASLAT));
const DORT = ["uygulama_parolasi", "esitleme_parolasi", "tesis_rol_anahtari", "ic_api_belirteci"];
{
  const r = baslat(null, DORT);
  kontrol("§1 rol verilmezse sunucu: dört sırla açılır, DB + eşitleme URL'i + tesis anahtarı yolu kurulur, göç URL'i YOK", r.status === 0 && !!r.env.DATABASE_URL && !!r.env.ESITLEME_DATABASE_URL && !!r.env.TESIS_ROL_ANAHTARI_DOSYASI && !r.env.GOC_DATABASE_URL, r.hata.trim());
}
{
  const r = baslat("hazirla", ["goc_parolasi", "tesis_rol_anahtari"]);
  kontrol("§1 hazırlayıcı göç parolası + tesis anahtarıyla açılır (uygulama parolası istemez)", r.status === 0 && !!r.env.GOC_DATABASE_URL && !!r.env.TESIS_ROL_ANAHTARI_DOSYASI, r.hata.trim());
  kontrol("§1 hazırlayıcı çalışma rollerinin URL'ini kurmaz", !r.env.DATABASE_URL && !r.env.ESITLEME_DATABASE_URL);
}
{
  const r = baslat("hazirla", ["goc_parolasi", "tesis_rol_anahtari", "uygulama_parolasi", "esitleme_parolasi"]);
  kontrol("§1 hazırlayıcı fazladan bağlanmış uygulama parolasını OKUMAZ", r.status === 0 && !r.env.DATABASE_URL && !r.env.ESITLEME_DATABASE_URL, r.hata.trim());
}
{
  const r = baslat("goc", ["goc_parolasi", "uygulama_parolasi", "esitleme_parolasi", "tesis_rol_anahtari"]);
  kontrol("§1 göç dört sırla açılır (göç + iki çalışma URL'i + anahtar)", r.status === 0 && !!r.env.GOC_DATABASE_URL && !!r.env.DATABASE_URL && !!r.env.ESITLEME_DATABASE_URL && !!r.env.TESIS_ROL_ANAHTARI_DOSYASI, r.hata.trim());
}
kontrol("§1 sunucu iç API belirteci sırrı yoksa çıkış 1 (zorunlu, boş = kapalı)", baslat("sunucu", DORT.slice(0, 3)).status === 1);
kontrol("§1 hazırlayıcı tesis anahtarı yoksa çıkış 1", baslat("hazirla", ["goc_parolasi"]).status === 1);
kontrol("§1 tanınmayan PATRON_ROL çıkış 1", baslat("yedek", DORT).status === 1);

// §2–§3 compose-denetle ⑩
function denetle(g: { dosyalar?: readonly string[]; baslat?: string; yedek?: string } = {}): string {
  const varsayilan = g.dosyalar?.length ? [path.join(D, "docker-compose.yml"), ...g.dosyalar] : [];
  const r = spawnSync(
    process.execPath,
    [
      path.join(D, "compose-denetle.mjs"),
      "--env-file",
      path.join(D, "ornek.env"),
      ...varsayilan.flatMap((f) => ["-f", f]),
      ...(g.baslat ? ["--baslat-betigi", g.baslat] : []),
      ...(g.yedek ? ["--yedek-betigi", g.yedek] : []),
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}
const satir = (cikti: string, parca: string): string => cikti.split("\n").find((l) => l.includes("⑩") && l.includes(parca)) ?? "";
const dosya = (ad: string, icerik: string): string => {
  const p = path.join(TMP, ad);
  writeFileSync(p, icerik);
  return p;
};

const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
if (docker.status !== 0) {
  kontrol("§2 docker compose ÖLÇÜLEMEDİ (yok) — ⑩ sondaları koşulamadı", false);
} else {
  const temiz = denetle();
  for (const s of ["patron:", "patron-db:", "patron-goc:", "patron-hazirla:", "patron-yedek:"]) {
    kontrol(`§2 ⑩ ${s.slice(0, -1)} ✅`, satir(temiz, ` ${s} `).startsWith("✅"), satir(temiz, ` ${s} `) || "satır YOK");
  }
  kontrol("§2 ⑩ rol tablosu çözüldü ✅", satir(temiz, "rol tablosu").startsWith("✅"), satir(temiz, "rol tablosu"));

  const hazirlaUygulama = dosya("b1.sh", BASLAT.replace('hazirla) echo "goc_parolasi tesis_rol_anahtari"', 'hazirla) echo "goc_parolasi tesis_rol_anahtari uygulama_parolasi"'));
  const c1 = denetle({ baslat: hazirlaUygulama });
  kontrol("§3 ⑩ hazırlayıcı rolü uygulama parolası ister, compose vermez → patron-hazirla EKSİK ❌", /^❌ .*patron-hazirla:.*EKSİK.*uygulama_parolasi/m.test(c1), satir(c1, "patron-hazirla:"));

  const anahtarsiz = dosya("o1.yml", "services:\n  patron-hazirla:\n    secrets: !override [goc_parolasi]\n");
  const c2 = denetle({ dosyalar: [anahtarsiz] });
  kontrol("§3 ⑩ compose hazırlayıcıdan tesis anahtarını düşürür → EKSİK ❌", /^❌ .*patron-hazirla:.*EKSİK.*tesis_rol_anahtari/m.test(c2), satir(c2, "patron-hazirla:"));

  const gocEsitlemesiz = dosya("b2.sh", BASLAT.replace('goc) echo "goc_parolasi uygulama_parolasi esitleme_parolasi tesis_rol_anahtari"', 'goc) echo "goc_parolasi uygulama_parolasi tesis_rol_anahtari"'));
  const c3 = denetle({ baslat: gocEsitlemesiz });
  kontrol("§3 ⑩ göç rolü eşitleme parolasını okumaz, compose verir → patron-goc FAZLA ❌", /^❌ .*patron-goc:.*FAZLA.*esitleme_parolasi/m.test(c3), satir(c3, "patron-goc:"));

  const yabanciRol = dosya("o2.yml", "services:\n  patron-hazirla:\n    environment:\n      PATRON_ROL: izle\n");
  const c4 = denetle({ dosyalar: [yabanciRol] });
  kontrol("§3 ⑩ tanınmayan PATRON_ROL ❌", /^❌ .*patron-hazirla: PATRON_ROL tanınır/m.test(c4), satir(c4, "patron-hazirla"));

  const tabloDisi = dosya("b3.sh", BASLAT.replace(/^exec "\$@"$/m, 'X="$(parola destek_parolasi)"\nexec "$@"'));
  const c5 = denetle({ baslat: tabloDisi });
  kontrol("§3 ⑩ betik rol tablosu dışında sır okur ❌", /^❌ .*rol tablosu.*destek_parolasi/m.test(c5), satir(c5, "rol tablosu"));

  const yedekSirsiz = dosya("y1.sh", "#!/bin/sh\nPGPASSWORD=x\n");
  const c6 = denetle({ yedek: yedekSirsiz });
  kontrol("§3 ⑩ yedek betiği sır okumaz, compose verir → patron-yedek FAZLA ❌", /^❌ .*patron-yedek:.*FAZLA.*goc_parolasi/m.test(c6), satir(c6, "patron-yedek:"));
}

// §4 duman.sh davet belirteci deseni
{
  const duman = readFileSync(path.join(D, "duman.sh"), "utf8");
  const ifade = /sed -n '(s\/\.\*: [^']*\/p)' > "\$D\/davet"/.exec(duman)?.[1];
  kontrol("§4 duman.sh davet çıkarma ifadesi bulundu", !!ifade);
  if (ifade) {
    const { token } = newToken("4d980a36-460c-4aec-a1d8-70d30e3bda44");
    const girdi = `✅ davet hazır — hesap x, bitiş y\n   Davet belirteci (BİR KEZ gösterilir; yöneticiye güvenli kanaldan iletin): ${token}\n`;
    const r = spawnSync("sed", ["-n", ifade], { input: girdi, encoding: "utf8" });
    kontrol("§4 yeni belirteç (ön ek + '.' + gövde) tam çıkarılır", r.stdout.trim() === token, `uzunluk ${r.stdout.trim().length}/${token.length}`);
  }
}

rmSync(TMP, { recursive: true, force: true });
sonuc();
