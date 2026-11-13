// =============================================================================
// PATRON COMPOSE SIRLARI ↔ GİRİŞ BETİĞİ BEKÇİSİ — DB'siz; docker compose yoksa §2/§3 ÖLÇÜLEMEDİ (kırmızı).
// Sınıf: compose bir servise sırrı vermez ama giriş betiği o sırrı ister → servis yeniden başlama döngüsü
// (`patron-hazirla`, yerel duman 2026-10-09). Tersi (verilen ama okunmayan sır) en az yetkiyi bozar.
//   §1 patron-baslat.sh GERÇEKTEN koşulur (sır dizini geçici kopyada): her rol yalnız kendi sırlarıyla açılır ve
//      tablo dışı sırrı okumaz; hazırlayıcı uygulama parolasız açılır; eksik sır / tanınmayan rol → çıkış 1; güvenlik
//      bildirimi sırları İSTEĞE BAĞLI (yoksa açılır, yol kurulmaz — eski betikle sonda ❌)
//   §2 compose-denetle ⑩ gerçek compose + ornek.env ile beş servis ✅ (örnekte güvenlik bildirimi satırları yorumlu:
//      isteğe bağlı sır yolu ölçülür — compose `:?`a dönerse §2 ÖLÇÜLEMEDİ ❌; 2026-10-12 sondası 12/24)
//   §3 ⑩ negatif sondalar: hazırlayıcı rolü uygulama parolası ister (ilk arızanın aynısı) → EKSİK ❌ · compose
//      hazırlayıcıdan tesis anahtarını düşürür → EKSİK ❌ · göç rolü eşitleme parolasını okumaz → FAZLA ❌ · tanınmayan
//      PATRON_ROL ❌ · betik tablo dışı sır okur ❌ · yedek sırsız ❌
//   §4 duman.sh davet belirteci deseni yeni belirteci (tesis ön ekli, noktalı) tam alır
//   §5 telefon push (Expo erişim belirteci İSTEĞE BAĞLI sır + BILDIRIM_NATIVE_PUSH + KOPRU_*): betik dolu sırdan değişkeni
//      kurar, yok/boş/biçimsiz sırda açılır ve kurmaz; sır değeri betiğin ve compose-denetle'nin ÇIKTISINA düşmez;
//      ⑪ ornek.env ile ✅; negatif: sır compose'dan düşer · `:?` zorunlu olur · ayar geçirilmez · boş dize geçer · varsayılan
//      acik olur · ortama düz değer konur → ❌ (2026-11-13 sondası, dosya DIŞI: origin/main compose + betik + denetçi + örnekle 26/42, §5 16 ❌)
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
// Expo erişim belirteci sondası: sahte ama biçimli (harf/rakam/_/-, ≥ 16). Çıktı taraması bu değeri arar.
const EXPO_SONDA = "SONDAexpoErisim_0123456789-abcdefXYZ";
function baslat(
  rol: string | null,
  sirlar: readonly string[],
  betik = BASLAT,
  g: { icerik?: Record<string, string>; komut?: readonly string[] } = {},
): { status: number | null; env: Record<string, string>; hata: string; cikti: string } {
  const sd = mkdtempSync(path.join(TMP, "s-"));
  const varsayilanIcerik = (s: string): string => (s === "ic_api_belirteci" ? "" : s === "expo_erisim_belirteci" ? `${EXPO_SONDA}\n` : "a1b2c3d4\n");
  for (const s of sirlar) writeFileSync(path.join(sd, s), g.icerik?.[s] ?? varsayilanIcerik(s));
  const kopya = path.join(sd, "baslat.sh");
  writeFileSync(kopya, betik.replace(/^S=\/run\/secrets$/m, `S=${sd}`));
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (rol) env.PATRON_ROL = rol;
  const r = spawnSync("sh", [kopya, ...(g.komut ?? ["env"])], { encoding: "utf8", env });
  const cikan: Record<string, string> = {};
  for (const l of (r.stdout ?? "").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0) cikan[l.slice(0, i)] = l.slice(i + 1);
  }
  return { status: r.status, env: cikan, hata: r.stderr ?? "", cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

kontrol("§1 betik `S=/run/secrets` satırını taşır (sonda onu geçici dizine çevirir)", /^S=\/run\/secrets$/m.test(BASLAT));
const DORT = ["uygulama_parolasi", "esitleme_parolasi", "tesis_rol_anahtari", "ic_api_belirteci", "guvenlik_telegram_bot_token", "guvenlik_telegram_chat_id", "expo_erisim_belirteci"];
{
  const r = baslat(null, DORT);
  kontrol("§1 rol verilmezse sunucu: yedi sırla açılır, DB + eşitleme URL'i + tesis anahtarı + güvenlik bildirimi yolları kurulur, göç URL'i YOK", r.status === 0 && !!r.env.DATABASE_URL && !!r.env.ESITLEME_DATABASE_URL && !!r.env.TESIS_ROL_ANAHTARI_DOSYASI && !!r.env.GUVENLIK_TELEGRAM_BOT_TOKEN_DOSYASI && !!r.env.GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI && !r.env.GOC_DATABASE_URL, r.hata.trim());
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
{
  // Güvenlik bildirimi sırları İSTEĞE BAĞLI: yoksa sunucu açılır, yol verilmez (kanal KAPALI), uyarı stderr'e.
  const r = baslat("sunucu", DORT.slice(0, 4));
  kontrol("§1 güvenlik bildirimi sırları YOKKEN sunucu açılır, güvenlik yolları kurulmaz, uyarı basılır", r.status === 0 && !!r.env.DATABASE_URL && !r.env.GUVENLIK_TELEGRAM_BOT_TOKEN_DOSYASI && !r.env.GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI && /guvenlik_telegram_bot_token okunamıyor[^\n]*KAPALI/.test(r.hata), `${r.status} · ${r.hata.trim()}`);
}
kontrol("§1 sunucu iç API belirteci sırrı yoksa çıkış 1 (zorunlu, boş = kapalı)", baslat("sunucu", DORT.slice(0, 3)).status === 1);
kontrol("§1 hazırlayıcı tesis anahtarı yoksa çıkış 1", baslat("hazirla", ["goc_parolasi"]).status === 1);
kontrol("§1 tanınmayan PATRON_ROL çıkış 1", baslat("yedek", DORT).status === 1);

// §2–§3 compose-denetle ⑩
function denetle(g: { dosyalar?: readonly string[]; baslat?: string; yedek?: string; taban?: string; envDosyasi?: string } = {}): string {
  const varsayilan = g.dosyalar?.length || g.taban ? [g.taban ?? path.join(D, "docker-compose.yml"), ...(g.dosyalar ?? [])] : [];
  const r = spawnSync(
    process.execPath,
    [
      path.join(D, "compose-denetle.mjs"),
      "--env-file",
      g.envDosyasi ?? path.join(D, "ornek.env"),
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

// §5 telefon push: Expo erişim belirteci (İSTEĞE BAĞLI sır) + BILDIRIM_NATIVE_PUSH + KOPRU_* geçişi
{
  const SUNUCU = DORT.filter((x) => x !== "expo_erisim_belirteci");
  const dolu = baslat("sunucu", DORT);
  kontrol("§5 dolu Expo sırrı → EXPO_ERISIM_BELIRTECI kurulur (sunucu açılır)", dolu.status === 0 && dolu.env.EXPO_ERISIM_BELIRTECI === EXPO_SONDA, `${dolu.status} · ${dolu.hata.trim()}`);
  const sessiz = baslat("sunucu", DORT, BASLAT, { komut: ["true"] });
  kontrol("§5 sır değeri betiğin stdout/stderr'ine düşmez (yalnız süreç ortamında)", sessiz.status === 0 && !sessiz.cikti.includes(EXPO_SONDA), `${sessiz.status}`);
  const yok = baslat("sunucu", SUNUCU);
  kontrol("§5 Expo sırrı YOKKEN sunucu açılır, değişken kurulmaz, ad uyarısı basılır", yok.status === 0 && !!yok.env.DATABASE_URL && !("EXPO_ERISIM_BELIRTECI" in yok.env) && /expo_erisim_belirteci okunamıyor[^\n]*KAPALI/.test(yok.hata), `${yok.status} · ${yok.hata.trim()}`);
  const bos = baslat("sunucu", DORT, BASLAT, { icerik: { expo_erisim_belirteci: "" } });
  kontrol("§5 Expo sırrı BOŞKEN (/dev/null) sunucu açılır, değişken kurulmaz", bos.status === 0 && !("EXPO_ERISIM_BELIRTECI" in bos.env) && /expo_erisim_belirteci boş[^\n]*KAPALI/.test(bos.hata), `${bos.status} · ${bos.hata.trim()}`);
  const kisa = baslat("sunucu", DORT, BASLAT, { icerik: { expo_erisim_belirteci: "kisaSONDA12\n" } });
  kontrol("§5 kısa Expo sırrı → açılır, kurulmaz, değer uyarıda YOK", kisa.status === 0 && !("EXPO_ERISIM_BELIRTECI" in kisa.env) && /16 karakterden kısa/.test(kisa.hata) && !kisa.hata.includes("kisaSONDA12"), `${kisa.status} · ${kisa.hata.trim()}`);
  const bicimsiz = baslat("sunucu", DORT, BASLAT, { icerik: { expo_erisim_belirteci: `${EXPO_SONDA} ek\n` } });
  kontrol("§5 biçimsiz Expo sırrı (boşluk) → açılır, kurulmaz, değer uyarıda YOK", bicimsiz.status === 0 && !("EXPO_ERISIM_BELIRTECI" in bicimsiz.env) && /biçimsiz/.test(bicimsiz.hata) && !bicimsiz.hata.includes(EXPO_SONDA), `${bicimsiz.status} · ${bicimsiz.hata.trim()}`);
  const crlf = baslat("sunucu", DORT, BASLAT, { icerik: { expo_erisim_belirteci: `${EXPO_SONDA}\r\n` } });
  kontrol("§5 CRLF'li Expo sırrı kırpılır", crlf.env.EXPO_ERISIM_BELIRTECI === EXPO_SONDA, crlf.hata.trim());

  if (docker.status === 0) {
    const temiz = denetle();
    const p11 = temiz.split("\n").filter((l) => l.includes("⑪"));
    kontrol("§5 ⑪ ornek.env ile yedi satır, hepsi ✅", p11.length === 7 && p11.every((l) => l.startsWith("✅")), p11.filter((l) => !l.startsWith("✅")).join(" | ") || `${p11.length} satır`);
    const ana = readFileSync(path.join(D, "docker-compose.yml"), "utf8");
    const varyant = (ad: string, f: (x: string) => string): string | null => {
      const y = f(ana);
      return y === ana ? null : dosya(ad, y);
    };
    const sonda = (ad: string, f: (x: string) => string, bek: RegExp, aciklama: string): void => {
      const v = varyant(ad, f);
      if (!v) return kontrol(`§5 sonda kurulamadı (${aciklama}) — compose metni değişmiş`, false);
      const c = denetle({ taban: v });
      kontrol(`§5 negatif: ${aciklama}`, bek.test(c), c.split("\n").filter((l) => l.startsWith("❌") || l.startsWith("ÖLÇÜLEMEDİ")).join(" | ").slice(0, 300) || "kırmızı YOK");
    };
    // Kalıplar compose-denetle'nin yerel (Mac) koşumunda bile `${…}`/override'sız tam dosya varyantıyla ölçülür.
    sonda("n1.yml", (x) => x.replace(", expo_erisim_belirteci]", "]"), /^❌ .*patron:.*EKSİK.*expo_erisim_belirteci/m, "sır sunucunun secrets listesinden düşer → ⑩ EKSİK");
    sonda("n2.yml", (x) => x.replace("${EXPO_ERISIM_BELIRTECI_DOSYASI_HOST:-/dev/null}", "${EXPO_ERISIM_BELIRTECI_DOSYASI_HOST:?gerekli}"), /ÖLÇÜLEMEDİ/, "sır ZORUNLU (`:?`) olur → sırsız .env'le config çözülmez");
    sonda("n3.yml", (x) => x.replace(/^ {6}KOPRU_DURT_DK:\n/m, ""), /^❌ ⑪ KOPRU_DURT_DK.*compose geçirmiyor/m, "KOPRU_DURT_DK konteynere geçirilmez");
    sonda("n4.yml", (x) => x.replace(/^ {6}KOPRU_DURT_SURE_SN:$/m, "      KOPRU_DURT_SURE_SN: ${KOPRU_DURT_SURE_SN:-}"), /^❌ ⑪ KOPRU_DURT_SURE_SN/m, "köprü ayarı boş dizeyle geçer (sayı 0 → açılış durur)");
    sonda("n5.yml", (x) => x.replace(/^ {6}BILDIRIM_NATIVE_PUSH: .*\n/m, ""), /^❌ ⑪ BILDIRIM_NATIVE_PUSH/m, "BILDIRIM_NATIVE_PUSH geçirilmez");
    sonda("n6.yml", (x) => x.replace("${BILDIRIM_NATIVE_PUSH:-kapali}", "${BILDIRIM_NATIVE_PUSH:-acik}"), /^❌ ⑪ BILDIRIM_NATIVE_PUSH/m, "varsayılan acik olur (bugünkü davranış değil)");
    sonda("n7.yml", (x) => x.replace("      KOPRU_DURT_DK:\n", "      KOPRU_DURT_DK:\n      EXPO_ERISIM_BELIRTECI: ${EXPO_ERISIM_BELIRTECI:-x}\n"), /^❌ ⑧ ortamda düz/m, "belirteç ortama düz değer olarak konur → ⑧");
    // Sır dosyası verilmiş .env: denetçi yolu ölçer, İÇERİĞİ hiçbir satıra basmaz.
    const sirDosyasi = dosya("expo-erisim-belirteci", `${EXPO_SONDA}\n`);
    const env2 = dosya("sirli.env", `${readFileSync(path.join(D, "ornek.env"), "utf8")}\nEXPO_ERISIM_BELIRTECI_DOSYASI_HOST=${sirDosyasi}\nBILDIRIM_NATIVE_PUSH=acik\nKOPRU_DURT_DK=30\n`);
    const c8 = denetle({ envDosyasi: env2 });
    const c8Satirlar = c8.split("\n").filter((l) => l.includes("⑪"));
    kontrol("§5 sırlı .env: ⑪ yol + acik + KOPRU_DURT_DK=30 ✅", c8Satirlar.length === 7 && c8Satirlar.every((l) => l.startsWith("✅")), c8Satirlar.filter((l) => !l.startsWith("✅")).join(" | ") || `${c8Satirlar.length} satır`);
    kontrol("§5 sırlı .env: sır değeri compose-denetle çıktısına düşmez", c8.length > 0 && !c8.includes(EXPO_SONDA));
    const cfg = spawnSync("docker", ["compose", "--env-file", env2, "-f", path.join(D, "docker-compose.yml"), "config"], { encoding: "utf8" });
    kontrol("§5 sırlı .env: sır değeri `docker compose config` çıktısına düşmez (yalnız yol)", cfg.status === 0 && cfg.stdout.includes(sirDosyasi) && !`${cfg.stdout}${cfg.stderr}`.includes(EXPO_SONDA), `${cfg.status}`);
  }
}

rmSync(TMP, { recursive: true, force: true });
sonuc();
