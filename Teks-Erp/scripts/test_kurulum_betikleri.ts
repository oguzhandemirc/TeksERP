// =============================================================================
// BEKÇİ — SUNUCU KURULUMU (TeksERP-Kurulum.exe, Dağıtım v2 · D5) sözleşmesi, DB'siz
// Çalıştır: npx tsx scripts/run-all-tests.ts kurulum_betikleri
// =============================================================================
// setup.exe = Inno sihirbazı (`deploy/kurulum/tekserp-kurulum.iss`) + PowerShell aşama koşucusu
// (`deploy/kurulum/kurulum.ps1`, ortak işlevler `kurulum-ortak.ps1`, ön ölçüm `on-olcum.ps1`, kaldırma
// `kaldir.ps1`) + cevap şeması (`cevap-semasi.json`, bayinin sessiz kipi). Ölçülen sözleşmeler:
//   §1 harness (pwsh varsa): `deploy/test/kurulum.harness.ps1` saf işlevleri GERÇEK kabukta koşar — cevap şeması
//      (KATI, SIRSIZ, tür/desen/seçenek; değişmez + tr-TR kültürü), portSec D4 altın vektörleri, .env sade
//      biçim, JSON ASCII kaçışı, maske, sürüm önceliği (güncelleyicinin `surum-karsilastir` vektörleri), gerçek
//      kurulu sürüm + eski paket engeli. Beklenen kontrol adları sayılır (boş küme yeşil sayılmaz).
//   §2 cevap şeması ↔ sihirbaz ↔ örnek: sihirbazın yazdığı cevap (CevapJson, Pascal) GEÇERLİ JSON ve alan
//      kümesi şemayla BİREBİR; ornek-cevap.json da öyle
//   §3 sır hijyeni: satıcı parolası/PIN ve yedek parolası argv'ye, ortama, cevap dosyasına, günlüğe, sonuç
//      INI'sine girmez — sihirbazda yalnız doğrulama + boru (BoruIleKos); orkestratörde STDIN
//   §4 sıra: OnKosul (dosyalardan ÖNCE) → Paket (iskelet -YalnizIskelet, SIRDAN önce) → PostgreSQL → Backend →
//      Hizmetler (backend -Uygula → güncelleyici -Uygula → başlat) → [Sirlar] → Dogrulama
//   §5 tek çağrı noktası: D6'nın iki betiği yalnız BackendHizmetBetigi / GuncelleyiciHizmetBetigi'nde; kurulum
//      hizmet kaydı YAZMAZ (hizmet-kur / New-Service / sc create yok)
//   §6 kaldırma VERİYİ KORUR: Remove-Item yalnız program dizinleri; bağlantı noktası özyinelemesiz silinir
//   §7 .env yalnız EnvYaz'dan (sade biçim kapısı) yazılır
//   §8 setup.exe içeriği orkestratörün ihtiyacını karşılar ($PG_DIZINI okumaları, pg-sablon şablonları ve
//      ithal ettiği lib, doğrulayıcı yolu) · yönetici · 64-bit kip · kaldırıcı kaldir.ps1 · çıkış kodu tablosu
//   §9 CI (kurulum-windows.yml): tetikler, doğrulayıcı üretim derlemesi, iki ISCC derlemesi, boru öz-sınaması
//      sonucu ölçülür, PS 5.1 harness, kuru koşu
//   §11 sihirbaz deneyimi (D8d, thinkpad-1 bulguları 2026-10-01): ön ölçüm "Sistem denetleniyor" penceresiyle koşar
//      (ölçüm yalnız o yoldan), açılış HAFİF (CIM/port/kök Hafif dalının dışında değil); eski paket iki kapıda
//      (ön ölçüm engeli + OnKosul DurumYaz'dan ÖNCE DUR); onarım metinleri (Göz at kilidi, veri sayfası, kayıttaki
//      lisans sunucusu, özette kip); satıcı hesabı / lisans "yapılacak"ı ölçülür
// NEGATİF SONDA (✓K, her koşumda): §2–§11 yüklemleri bellekte bozulmuş kopyalara koşar (mutasyonun
//   UYGULANDIĞI ölçülür); §1 için kurulum-ortak.ps1'in bozulmuş kopyası harness'e verilir (pwsh varsa).
//   ÜÇ SONUÇ: kaynak okunamazsa ÖLÇÜLEMEDİ (kırmızı), pwsh yoksa §1 ATLANIR (beyanlı, TEKSERP_STRICT'te kırmızı).
// =============================================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { psTara, type PsTarama } from "./lib/ps-tarama";
import { atlamaDefteri } from "./lib/atlama";

const TEKS = join(__dirname, "..");
const KOK = join(TEKS, "..");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const defter = atlamaDefteri(() => fail++);

const YOL = {
  kurulum: "deploy/kurulum/kurulum.ps1",
  ortak: "deploy/kurulum/kurulum-ortak.ps1",
  kaldir: "deploy/kurulum/kaldir.ps1",
  onOlcum: "deploy/kurulum/on-olcum.ps1",
  iss: "deploy/kurulum/tekserp-kurulum.iss",
  sema: "deploy/kurulum/cevap-semasi.json",
  ornek: "deploy/kurulum/ornek-cevap.json",
  is: ".github/workflows/kurulum-windows.yml",
  pgOrnegi: "deploy/pg/pg-ornegi.json",
  pgSablon: "deploy/pg/pg-sablon.mjs",
} as const;
type Ad = keyof typeof YOL;
type Kaynaklar = Record<Ad, string>;

function oku(rel: string): string | undefined {
  try {
    return readFileSync(join(KOK, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
/** PowerShell işlevinin YORUMSUZ kod satırları (string içerikleri korunur). */
function psGovde(t: PsTarama, ad: string): string | null {
  const f = t.fonksiyonlar.find((x) => x.ad === ad);
  if (!f) return null;
  return t.satirlar
    .filter((s) => s.no >= f.bas && s.no <= f.son)
    .map((s) => s.kod)
    .join("\n");
}
/** Pascal işlevi/prosedürü: başlıktan sütun 0'daki `end;`e kadar. */
function pasGovde(iss: string, ad: string): string | null {
  const satirlar = iss.split("\n");
  const i = satirlar.findIndex((l) => new RegExp(`^(function|procedure) ${ad}\\b`).test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < satirlar.length && satirlar[j] !== "end;") j++;
  return satirlar.slice(i, j + 1).join("\n");
}
/** Satır → kapsayan Pascal işlevinin adı ([Code] içinde; yoksa null). */
function pasKapsayan(iss: string): Array<{ no: number; satir: string; islev: string | null }> {
  const cikti: Array<{ no: number; satir: string; islev: string | null }> = [];
  let islev: string | null = null;
  let kodda = false;
  iss.split("\n").forEach((l, i) => {
    if (/^\[Code\]/.test(l)) kodda = true;
    else if (/^\[\w+\]/.test(l)) kodda = false;
    const m = /^(?:function|procedure) (\w+)/.exec(l);
    if (m) islev = m[1]!;
    const kod = l.replace(/\/\/.*$/, "");
    if (kodda) cikti.push({ no: i + 1, satir: kod, islev });
    if (l === "end;") islev = null;
  });
  return cikti;
}
function duzlestir(o: unknown, onek = ""): string[] {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return [onek];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => duzlestir(v, onek ? `${onek}.${k}` : k));
}
/**
 * Pascal'daki `Result := '...' + Ifade + '...';` JSON kurucusunu ŞABLONA çevirir: ÜST DÜZEY literaller aynen,
 * aradaki her ifade (parantez içindeki literaller dahil — `Olc('paketDosya')`) `0` (bir JSON değeri), #13#10
 * boşluk. Sonuç JSON.parse ile ayrıştırılır → alan kümesi.
 */
function pascalJsonSablonu(govde: string): string | null {
  const bas = govde.indexOf("Result := '");
  if (bas < 0) return null;
  let i = bas + "Result := ".length;
  let out = "";
  let ara = "";
  let derinlik = 0;
  const araCevir = (a: string): string => (a.replace(/#\d+/g, " ").replace(/\+/g, " ").trim() ? "0" : " ");
  while (i < govde.length) {
    const c = govde[i]!;
    if (c === "'") {
      let lit = "";
      i++;
      for (;;) {
        if (i >= govde.length) return null;
        if (govde[i] === "'" && govde[i + 1] === "'") {
          lit += "'";
          i += 2;
        } else if (govde[i] === "'") {
          i++;
          break;
        } else lit += govde[i++];
      }
      if (derinlik > 0) ara += `'${lit}'`;
      else {
        out += araCevir(ara) + lit;
        ara = "";
      }
      continue;
    }
    if (c === "(") derinlik++;
    else if (c === ")") derinlik--;
    else if (c === ";" && derinlik === 0) break;
    ara += c;
    i++;
  }
  out += araCevir(ara);
  return out;
}
/** Satırdaki her eşleşen çağrının parantez içi argüman metni (iç içe parantez ve '..' literal bilinir). */
function cagriArgumanlari(satir: string, desen: RegExp): string[] {
  const out: string[] = [];
  for (const m of satir.matchAll(desen)) {
    let i = (m.index ?? 0) + m[0].length;
    let d = 1;
    let lit = false;
    const bas = i;
    while (i < satir.length && d > 0) {
      const c = satir[i]!;
      if (c === "'") lit = !lit;
      else if (!lit && c === "(") d++;
      else if (!lit && c === ")") d--;
      i++;
    }
    out.push(satir.slice(bas, i - 1));
  }
  return out;
}
function sira(metin: string, parcalar: string[]): number[] {
  return parcalar.map((p) => metin.indexOf(p));
}
function artan(d: number[]): boolean {
  return d.every((x, i) => x >= 0 && (i === 0 || x > d[i - 1]!));
}

// ---------------------------------------------------------------------------
// Ölçüm (saf: kaynak metinlerinden bulgu listesi) — sondalar bunu bozulmuş kopyalara koşar
// ---------------------------------------------------------------------------
type Bulgular = Record<string, string[]>;
const SIR_DEGERI = /(SaticiSayfasi\.Values\[[1-4]\]|YedekSayfasi\.Values\[[12]\])/;
const SIR_ISLEVLERI = new Set(["NextButtonClick", "SirlarKos", "ShouldSkipPage", "AsamalariKos"]);
const D6_BETIKLERI: Record<string, string> = { "backend-hizmeti.ps1": "BackendHizmetBetigi", "guncelleyici-hizmeti.ps1": "GuncelleyiciHizmetBetigi" };
const KORUNAN = /yapilandirma|pg-setup|lisans|backups|yedek-anahtar|\bveri\b|logs|kurulum\\|pgveri|ornek\.json|veriDizini/;
const ASAMA_SIRASI = ["Paket", "PostgreSQL", "Backend", "Hizmetler", "Sirlar", "Dogrulama"];

function olc(k: Kaynaklar): Bulgular {
  const b: Bulgular = {};
  const ekle = (bolum: string, m: string): void => {
    (b[bolum] ??= []).push(m);
  };
  const kur = psTara(k.kurulum);
  const ort = psTara(k.ortak);
  const kal = psTara(k.kaldir);
  const kodSatirlari = (t: PsTarama): Array<{ no: number; kod: string; islev: string | null }> =>
    t.satirlar.map((s) => ({ no: s.no, kod: s.kod, islev: t.fonksiyonlar.find((f) => s.no >= f.bas && s.no <= f.son)?.ad ?? null }));

  // §2 — alan kümeleri
  let semaAnahtar: string[] = [];
  try {
    const sema = JSON.parse(k.sema) as { alanlar: Record<string, unknown> };
    semaAnahtar = Object.keys(sema.alanlar).sort();
  } catch (e) {
    ekle("§2", `cevap-semasi.json ayrıştırılamadı: ${(e as Error).message}`);
  }
  try {
    const ornek = duzlestir(JSON.parse(k.ornek)).sort();
    const fazla = ornek.filter((x) => !semaAnahtar.includes(x));
    const eksik = semaAnahtar.filter((x) => !ornek.includes(x));
    if (fazla.length || eksik.length) ekle("§2", `ornek-cevap.json ≠ şema (fazla: ${fazla.join(", ") || "-"} · eksik: ${eksik.join(", ") || "-"})`);
  } catch (e) {
    ekle("§2", `ornek-cevap.json ayrıştırılamadı: ${(e as Error).message}`);
  }
  const cj = pasGovde(k.iss, "CevapJson");
  const sablon = cj ? pascalJsonSablonu(cj) : null;
  if (!sablon) ekle("§2", "sihirbazın CevapJson kurucusu bulunamadı");
  else {
    try {
      const iss = duzlestir(JSON.parse(sablon)).sort();
      const fazla = iss.filter((x) => !semaAnahtar.includes(x));
      const eksik = semaAnahtar.filter((x) => !iss.includes(x));
      if (fazla.length || eksik.length) ekle("§2", `sihirbazın cevabı ≠ şema (fazla: ${fazla.join(", ") || "-"} · eksik: ${eksik.join(", ") || "-"})`);
    } catch (e) {
      ekle("§2", `sihirbazın cevabı geçerli JSON değil: ${(e as Error).message}`);
    }
    if (SIR_DEGERI.test(cj!)) ekle("§3", "CevapJson sır alanı (parola/PIN/yedek parolası) yazıyor");
  }

  // §3 — sır hijyeni: sihirbaz
  const pas = pasKapsayan(k.iss);
  for (const s of pas) {
    if (SIR_DEGERI.test(s.satir) && !SIR_ISLEVLERI.has(s.islev ?? "")) ekle("§3", `sır alanı izinli işlevin dışında (${s.islev ?? "?"}:${s.no})`);
    for (const arg of cagriArgumanlari(s.satir, /\b(Log|Exec|SaveStringToFile|MsgBox|SuppressibleMsgBox|Hata)\(/g))
      if (SIR_DEGERI.test(arg) || /\b(Girdi|MusteriAnahtari|Cikti)\b/.test(arg)) ekle("§3", `sır bir günlük/komut/dosya/ileti çağrısında (${s.islev ?? "?"}:${s.no})`);
    if (/\bWinWriteFile\(/.test(s.satir) && s.islev !== "BoruIleKos" && !/^function WinWriteFile/.test(s.satir)) ekle("§3", `STDIN yazımı BoruIleKos dışında (${s.islev}:${s.no})`);
    if (/\bBoruIleKos\(/.test(s.satir) && !/^function BoruIleKos/.test(s.satir) && s.islev !== "SirlarKos" && s.islev !== "BoruSinamasi") ekle("§3", `BoruIleKos beklenmeyen yerden (${s.islev}:${s.no})`);
    if (/\bMusteriAnahtari :=/.test(s.satir) && !/MusteriAnahtari := ''/.test(s.satir) && s.islev !== "SirlarKos") ekle("§3", `müşteri anahtarı SirlarKos dışında atanıyor (${s.islev}:${s.no})`);
  }
  const ak = pasGovde(k.iss, "AsamalariKos") ?? "";
  for (const l of ak.split("\n")) if (SIR_DEGERI.test(l) && !/Values\[\d\] <> ''/.test(l)) ekle("§3", "AsamalariKos sır alanını boşluk denetimi dışında kullanıyor");
  const sk = pasGovde(k.iss, "SirlarKos") ?? "";
  if (!/BoruIleKos\(/.test(sk) || !/Girdi := '';/.test(sk)) ekle("§3", "SirlarKos sırları BoruIleKos ile göndermiyor ya da girdiyi temizlemiyor");
  // §3 — sır hijyeni: orkestratör
  for (const s of kodSatirlari(kur)) {
    const ciplak = kur.satirlar[s.no - 1]!.ciplak;
    const nk = /NodeKos\s+\$\w+\s+@\(([^)]*)\)/.exec(s.kod);
    if (nk && /\$(g\.\w+|girdi\b|\w*(parola|sifre|pin)\w*)/i.test(nk[1]!)) ekle("§3", `NodeKos argv'sinde sır değişkeni (satır ${s.no})`);
    const env = /\$env:(\w+)\s*=/.exec(ciplak);
    if (env && !(env[1] === "PGPASSWORD" && s.islev === "PsqlStdin")) ekle("§3", `ortam değişkenine yazım (${env[1]}, ${s.islev ?? "üst düzey"}:${s.no})`);
    if (/SetEnvironmentVariable/.test(s.kod) && s.islev !== "NodeKos") ekle("§3", `SetEnvironmentVariable NodeKos dışında (${s.islev}:${s.no})`);
    if (/\$script:SirSatiri\s*=\s*"SIR:/.test(s.kod) && s.islev !== "AsamaSirlar") ekle("§3", `SIR satırı AsamaSirlar dışında kuruluyor (satır ${s.no})`);
    if (/\[Console\]::In\.ReadToEnd\(\)/.test(s.kod) && s.islev !== "AsamaSirlar") ekle("§3", `STDIN AsamaSirlar dışında okunuyor (satır ${s.no})`);
  }
  for (const s of kodSatirlari(ort)) {
    const env = /\$env:(\w+)\s*=/.exec(ort.satirlar[s.no - 1]!.ciplak);
    if (env) ekle("§3", `ortak işlevlerde ortam değişkenine yazım (${env[1]}:${s.no})`);
  }
  const ini = psGovde(kur, "SonucIniYaz") ?? "";
  if (!ini) ekle("§3", "SonucIniYaz yok (sihirbazın sonuç INI'si)");
  if (/SirSatiri|\$g\./.test(ini)) ekle("§3", "sonuç INI'si sır satırına/girdisine dokunuyor");
  if (!/Maskele/.test(ini)) ekle("§3", "sonuç INI'si değerleri Maskele'den geçirmiyor");
  if ((k.kurulum.match(/Write-Output \$script:SirSatiri/g) ?? []).length !== 1) ekle("§3", "SIR satırı tam bir yerden (KOŞU sonu) basılmalı");
  if (!/\$sonuc\["musteriAnahtari"\] = \$true/.test(psGovde(kur, "AsamaSirlar") ?? "")) ekle("§3", "sonuçta müşteri anahtarı BAYRAK olmalı (değeri değil)");

  // §4 — sıra
  const hepsi = /"Hepsi"\s*\{([\s\S]*?)\n\s{4}\}/.exec(k.kurulum)?.[1] ?? "";
  if (!artan(sira(hepsi, ["AsamaOnKosul", "AsamaPaket", "AsamaPostgreSQL", "AsamaBackend", "AsamaHizmetler", "AsamaDogrulama"])) || /AsamaSirlar/.test(hepsi))
    ekle("§4", "Hepsi sırası OnKosul→Paket→PostgreSQL→Backend→Hizmetler→Dogrulama değil (ya da sessiz kip Sirlar koşuyor)");
  const paket = psGovde(kur, "AsamaPaket") ?? "";
  if (!/BackendHizmetBetigi \$kok \$d @\("-Uygula", "-YalnizIskelet"\)/.test(paket)) ekle("§4", "Paket aşaması iskeleti (-Uygula -YalnizIskelet) kurmuyor");
  for (const a of ["AsamaOnKosul", "AsamaPaket"]) if (/\b(EnvYaz|SirDosyasiYaz|DpapiKoru)\b/.test(psGovde(kur, a) ?? "")) ekle("§4", `${a} iskeletten ÖNCE sır yazıyor`);
  const hiz = psGovde(kur, "AsamaHizmetler") ?? "";
  if (!artan(sira(hiz, ['BackendHizmetBetigi $kok $d @("-Uygula")', 'GuncelleyiciHizmetBetigi $kok $d $C @("-Uygula")', 'Start-Service -Name "$($d.adlar.backend)"', 'Start-Service -Name "$($d.adlar.guncelleyici)"'])))
    ekle("§4", "Hizmetler sırası: backend -Uygula → güncelleyici -Uygula → backend başlat → güncelleyici başlat değil");
  const hazir = pasGovde(k.iss, "PrepareToInstall") ?? "";
  if (!/AsamaKos\(TmpKurulum\('deploy\\kurulum\\kurulum\.ps1'\), 'OnKosul'/.test(hazir)) ekle("§4", "OnKosul PrepareToInstall'da ({tmp} kopyasından, dosyalardan ÖNCE) koşmuyor");
  const adlar = [...(pasGovde(k.iss, "AsamaAdi") ?? "").matchAll(/(\d): Result := '(\w+)'/g)].map((m) => `${m[1]}=${m[2]}`);
  if (adlar.join(",") !== ASAMA_SIRASI.map((a, i) => `${i + 2}=${a}`).join(",")) ekle("§4", `sihirbazın aşama tablosu ${adlar.join(",")} (beklenen ${ASAMA_SIRASI.join("→")})`);
  if (!/for I := 2 to 7 do/.test(ak) || !/CurStep = ssPostInstall then AsamalariKos/.test(pasGovde(k.iss, "CurStepChanged") ?? "")) ekle("§4", "aşamalar ssPostInstall'da 2..7 sırasıyla koşmuyor");
  for (const [i, a] of ASAMA_SIRASI.entries()) if (!new RegExp(`;\\s+${i + 12} ${a}\\b|· ${i + 12} ${a}\\b`).test(k.iss)) ekle("§4", `çıkış kodu tablosunda ${i + 12} ${a} yok`);
  if (!/Result := 10 \+ HataAsamasi/.test(pasGovde(k.iss, "GetCustomSetupExitCode") ?? "")) ekle("§4", "GetCustomSetupExitCode 10 + aşama değil");

  // §5 — tek çağrı noktası
  for (const s of kodSatirlari(kur)) {
    for (const [betik, islev] of Object.entries(D6_BETIKLERI)) {
      if (new RegExp(`Join-Path[^\\n]*hizmet\\\\${betik.replace(".", "\\.")}`).test(s.kod) && s.islev !== islev) ekle("§5", `${betik} ${islev} dışında çağrılıyor (${s.islev ?? "üst düzey"}:${s.no})`);
    }
    if (/hizmet-kur\b/.test(s.kod)) ekle("§5", `kurulum hizmet kaydı yazıyor (hizmet-kur, satır ${s.no})`);
    if (/New-Service\b|"create"/.test(s.kod)) ekle("§5", `kurulum hizmet oluşturuyor (satır ${s.no})`);
    const bc = /BackendHizmetBetigi \$kok \$d (@\([^)]*\))/.exec(s.kod);
    if (bc && !['@("-Uygula", "-YalnizIskelet")', '@("-Uygula")', "@()"].includes(bc[1]!)) ekle("§5", `BackendHizmetBetigi beklenmeyen argümanla: ${bc[1]}`);
  }
  if ((k.kurulum.match(/& \$betik @arg/g) ?? []).length !== 2) ekle("§5", "D6 betikleri tam iki noktadan (& $betik @arg) çağrılmalı");

  // §6 — kaldırma veriyi korur
  for (const s of kodSatirlari(kal)) {
    if (/Remove-Item/.test(s.kod)) {
      if (!/Remove-Item -LiteralPath \$(p|y) /.test(s.kod)) ekle("§6", `Remove-Item izinli program yolu dışında (satır ${s.no})`);
      if (KORUNAN.test(s.kod)) ekle("§6", `Remove-Item korunan bir yolu adlandırıyor (satır ${s.no})`);
    }
    if (/\[IO\.Directory\]::Delete\(/.test(s.kod) && (!/ReparseMi/.test(s.kod) || /Delete\([^)]*,/.test(s.kod))) ekle("§6", `bağlantı silme ReparseMi'siz ya da özyinelemeli (satır ${s.no})`);
  }
  const prog = /\$programDizinleri = ([^\n]*)/.exec(k.kaldir)?.[1] ?? "";
  if (!/"surumler"/.test(prog) || !/"guncelleyici"/.test(prog) || /yapilandirma|pg-setup|backups|lisans|logs|kurulum/.test(prog)) ekle("§6", `program dizini listesi beklenen değil: ${prog}`);
  if (!/\^\[0-9\]\{2\}\\\.\[0-9\]\{1,3\}-\[0-9\]\{1,3\}\$/.test(k.kaldir)) ekle("§6", "pgsql\\<sürüm>-<derleme> deseni daraltılmamış");
  const silme = /AdimDene "program dizini[\s\S]*?\n {2}\}\n/.exec(k.kaldir)?.[0] ?? "";
  if (!/ReparseMi \$p/.test(silme) || !/ReparsePoint/.test(silme)) ekle("§6", "program dizini silinmeden önce kendisi ve içi bağlantı için ölçülmüyor");

  // §7 — .env yalnız EnvYaz'dan
  for (const s of kodSatirlari(kur)) {
    if (/\$envYolu/.test(s.kod) && /(MetinYaz|Set-Content|Out-File|Add-Content|WriteAllText|AppendAllText|WriteAllLines)\b/.test(s.kod)) ekle("§7", `.env EnvYaz dışından yazılıyor (satır ${s.no})`);
  }
  if (!/EnvSatiriGecerli \$satir/.test(psGovde(kur, "EnvYaz") ?? "")) ekle("§7", "EnvYaz satırları EnvSatiriGecerli'den geçirmiyor");

  // §8 — setup.exe içeriği
  const kaynaklar = [...k.iss.matchAll(/^Source: "([^"]+)"; DestDir: "([^"]+)"/gm)].map((m) => ({ src: m[1]!, dst: m[2]! }));
  const gerekli = new Set<string>(["kurulum.ps1", "kurulum-ortak.ps1", "on-olcum.ps1", "kaldir.ps1", "cevap-semasi.json", "ornek-cevap.json", "..\\pg\\pg-sablon.mjs"]);
  for (const t of [k.kurulum, k.onOlcum]) for (const m of t.matchAll(/Join-Path \$PG_DIZINI "([^"]+)"/g)) gerekli.add(`..\\pg\\${m[1]}`);
  try {
    const pgo = JSON.parse(k.pgOrnegi) as { yapilandirma: { confSablonu: string; hbaSablonu: string } };
    for (const r of [pgo.yapilandirma.confSablonu, pgo.yapilandirma.hbaSablonu]) gerekli.add(`..\\pg\\${r.replace(/^deploy\/pg\//, "").replace(/\//g, "\\")}`);
  } catch {
    ekle("§8", "pg-ornegi.json okunamadı (şablon yolları ölçülemedi)");
  }
  for (const m of k.pgSablon.matchAll(/from '\.\/(lib\/[^']+)'/g)) gerekli.add(`..\\pg\\${m[1]!.replace(/\//g, "\\")}`);
  for (const g of gerekli) if (!kaynaklar.some((x) => x.src === g)) ekle("§8", `setup.exe içeriğinde yok: ${g}`);
  for (const x of kaynaklar) {
    if (x.src.startsWith("{#")) continue;
    const bek = x.src.startsWith("..\\pg\\lib\\") ? "{app}\\kurulum\\deploy\\pg\\lib" : x.src.startsWith("..\\pg\\") ? "{app}\\kurulum\\deploy\\pg" : "{app}\\kurulum\\deploy\\kurulum";
    if (x.dst !== bek) ekle("§8", `${x.src} → ${x.dst} (depo düzeninin aynası ${bek} olmalı: pg-sablon.mjs KOK'u ve $PSScriptRoot\\..\\pg buna bağlı)`);
  }
  if (!/^Source: "\{#DogrulayiciExe\}"; DestDir: "\{app\}\\kurulum\\araclar"; DestName: "tekserp-guncelleyici\.exe"/m.test(k.iss)) ekle("§8", "kurulumun KENDİ doğrulayıcısı {app}\\kurulum\\araclar\\tekserp-guncelleyici.exe değil");
  if (!/Join-Path \$PSScriptRoot "\.\.\\\.\.\\araclar\\tekserp-guncelleyici\.exe"/.test(k.kurulum)) ekle("§8", "kurulum.ps1 varsayılan doğrulayıcı yolu setup düzeniyle uyuşmuyor");
  for (const [d, v] of [["PrivilegesRequired", "admin"], ["ArchitecturesInstallIn64BitMode", "x64compatible"], ["ArchitecturesAllowed", "x64compatible"], ["UninstallFilesDir", "{app}\\kurulum\\kaldirici"]] as const)
    if (!new RegExp(`^${d}=${v.replace(/[\\{}]/g, "\\$&")}$`, "m").test(k.iss)) ekle("§8", `[Setup] ${d}=${v} değil`);
  // Inno derleme kuralı (CI ölçtü 2026-10-01: ISCC çıkış 2): AppId sabit içeriyorsa UsePreviousLanguage=no ŞART.
  if (/^AppId=.*\{/m.test(k.iss) && !/^UsePreviousLanguage=no$/m.test(k.iss)) ekle("§8", "AppId {code:} ile türüyor ama UsePreviousLanguage=no yok (ISCC derlemez)");
  if (!/^\[UninstallRun\]\nFilename: "\{sys\}\\WindowsPowerShell\\v1\.0\\powershell\.exe"; Parameters: "[^"]*""\{app\}\\kurulum\\deploy\\kurulum\\kaldir\.ps1"" -Kok ""\{app\}"""/m.test(k.iss)) ekle("§8", "kaldırıcı kaldir.ps1'i (64-bit PowerShell, -Kok {app}) çağırmıyor");
  for (const s of pas) {
    const ex = /\bExec\(([^,]+),/.exec(s.satir);
    if (ex && !/^(PowerShellYolu|ExpandConstant\('\{sys\}\\icacls\.exe'\))$/.test(ex[1]!.trim())) ekle("§8", `Exec beklenmeyen programla (${s.islev}:${s.no}): ${ex[1]}`);
  }
  if (!/ExpandConstant\('\{sys\}\\WindowsPowerShell\\v1\.0\\powershell\.exe'\)/.test(pasGovde(k.iss, "PowerShellYolu") ?? "")) ekle("§8", "PowerShellYolu 64-bit {sys} değil");
  if (/\{syswow64\}|\{sysnative\}/.test(k.iss)) ekle("§8", "32-bit/sysnative yol kullanılıyor");
  // Sessiz kip (thinkpad-1 D8): çıplak MsgBox /SUPPRESSMSGBOXES ile bastırılmaz → sessiz kurulum soruda asılı kalır.
  // Çıplak MsgBox yalnız NextButtonClick'te; o da sessiz kipte İLK iş kısa devre yapar.
  const nbc = pasGovde(k.iss, "NextButtonClick") ?? "";
  const sessizDal = /^\s*Result := True;\s*\n(?:\s*\/\/[^\n]*\n)*\s*if Sessiz then\s*\n\s*begin\s*\n([\s\S]*?)\n\s*end;/m.exec(nbc.split("begin").slice(1).join("begin"));
  if (!sessizDal || !/\bExit;/.test(sessizDal[1]!) || /MsgBox/.test(sessizDal[1]!)) ekle("§8", "NextButtonClick sessiz kipte kısa devre yapmıyor (ilk deyim if Sessiz then begin … Exit; end;) — MsgBox sessiz kurulumu asar");
  else if (!/SayfalariOlcumleDoldur/.test(sessizDal[1]!)) ekle("§8", "sessiz kısa devre sayfaları ölçümle doldurmuyor — boş veri dizini sayfası Inno yol denetiminde kurulumu durdurur");
  for (const s of pas) if (/(?<!Suppressible)MsgBox\(/.test(s.satir) && s.islev !== "NextButtonClick") ekle("§8", `çıplak MsgBox NextButtonClick dışında (${s.islev}:${s.no}) — sessiz kipte bastırılmaz`);
  // Ağaç kilidi (thinkpad-1 D8, ölçüldü): (OI)(CI) izni /T ile dosyalara giderse dosyanın DACL'i BOŞ kalır.
  const kil = pasGovde(k.iss, "Kilitle") ?? "";
  const kilGrant = kil.split("\n").find((l) => /inheritance:r/.test(l)) ?? "";
  if (!kilGrant || /\+ Ek \+|\/T\b/.test(kilGrant)) ekle("§8", "Kilitle (OI)(CI) iznini /T ile ağaca veriyor — dosyaların DACL'i boş kalır");
  if (!/'\\\*'\) \+ ' \/reset \/T/.test(kil)) ekle("§8", "Kilitle ağaçta alt öğeleri /reset ile mirasa bağlamıyor");
  // Sınıf kuralı (yönetici 2026-10-01): sessiz kipte HİÇBİR kutu kullanıcı beklemez — her MsgBox/SuppressibleMsgBox ya
  // aynı satırda `not WizardSilent`/`not Sessiz` koşulunda ya da işlevinde ondan ÖNCE sessiz kısa devre (Exit) altında.
  for (const s of pas) {
    if (!/MsgBox\(/.test(s.satir) || !s.islev) continue;
    if (/\bnot (WizardSilent|Sessiz)\b/.test(s.satir)) continue;
    const g = pasGovde(k.iss, s.islev) ?? "";
    const once = g.slice(0, Math.max(0, g.indexOf(s.satir.trim())));
    if (!/if (Sessiz|WizardSilent) then\s*(?:begin[\s\S]*?\bExit;[\s\S]*?end;|Exit;)/.test(once)) ekle("§8", `sessiz dalı olmayan kutu (${s.islev}:${s.no}) — sessiz kurulum kullanıcı bekler`);
  }

  // §9 — CI
  const is = k.is;
  if (!/push:\n\s+branches: \[main\]/.test(is) || !/pull_request:\n\s+branches: \[main\]/.test(is) || !/workflow_dispatch:/.test(is)) ekle("§9", "tetikler main push + PR + workflow_dispatch değil");
  if (!/cargo build --release --locked -p tekserp-guncelleyici/.test(is) || !/testCapasi -ne \$false/.test(is) || !/TEKSERP_TEST_CAPASI/.test(is)) ekle("§9", "doğrulayıcı üretim derlemesi (testCapasi + test çapası baytı) ölçülmüyor");
  if ((is.match(/& \$env:ISCC /g) ?? []).length !== 2 || !/\/DBORU_SINAMASI/.test(is) || !/"\/DDogrulayiciExe=\$dog"/.test(is)) ekle("§9", "iki ISCC derlemesi (asıl + /DBORU_SINAMASI, doğrulayıcı CI'dan) yok");
  if (!/\/SINAMA=\$rapor/.test(is) || !/\^BORU=TAMAM/.test(is) || !/\^OLCUM=TAMAM x64Surec=1/.test(is)) ekle("§9", "boru öz-sınaması koşulup sonucu (BORU=TAMAM + OLCUM x64) ölçülmüyor");
  if (!/shell: powershell[\s\S]{0,200}kurulum\.harness\.ps1/.test(is)) ekle("§9", "harness Windows PowerShell 5.1'de koşmuyor");
  if (!/-Asama OnKosul -Cevap \$cevap -Kaynak \$d -Kuru/.test(is) || !/backend paketi/.test(is)) ekle("§9", "orkestratör kuru koşusu (beklenen DUR) yok");
  // §11 — sihirbaz deneyimi: denetim penceresi, hafif açılış, eski paket iki kapıda, onarım metinleri, yapılacaklar ölçülür
  const okk = pasGovde(k.iss, "OnOlcumKipli") ?? "";
  const iPen = okk.indexOf("DenetimPenceresiAc("), iKos = okk.indexOf("OlcumKos("), iSerbest = okk.indexOf("Pencere.Free");
  if (iPen < 0 || iKos < 0 || iPen > iKos || iSerbest < iKos || !/if not Sessiz then\s*\n\s*begin[\s\S]*?DenetimPenceresiAc\(/.test(okk))
    ekle("§11", "ön ölçüm 'Sistem denetleniyor' penceresi ölçümden ÖNCE açılıp SONRA kapanmıyor (ya da sessiz kipte açılıyor) — kullanıcı boş ekranda bekler");
  for (const s of pas) {
    if (/\bOlcumKos\(/.test(s.satir) && !/^function OlcumKos/.test(s.satir) && s.islev !== "OnOlcumKipli") ekle("§11", `OlcumKos pencere yolunun dışından çağrılıyor (${s.islev}:${s.no})`);
    if (/on-olcum\.ps1/.test(s.satir) && s.islev !== "OlcumKos") ekle("§11", `on-olcum.ps1 OlcumKos dışından koşuyor (${s.islev}:${s.no})`);
  }
  const isu = pasGovde(k.iss, "InitializeSetup") ?? "";
  if (!/OnOlcumKipli\('C:\\TeksERP', not Sessiz\)/.test(isu) || /\bOnOlcum\(/.test(isu)) ekle("§11", "açılış ölçümü görünür kipte HAFİF değil — sihirbaz CIM/port/kök ölçümü bitene dek açılmaz");
  const ooSatir = k.onOlcum.split("\n");
  const hafifDal = ooSatir.findIndex((l) => l.includes('if ($Hafif) { $o["hafif"] = 1 } else {'));
  if (hafifDal < 0) ekle("§11", "on-olcum.ps1'de Hafif dalı yok");
  ooSatir.forEach((l, i) => {
    if (/^\s*#/.test(l) || i >= hafifDal) return;
    if (/Get-CimInstance|Get-NetTCPConnection|PortDinleniyorMu|PgHizmetPortlari|HaricPortlar|KuruluSurumAdaylari/.test(l) && !/if \(-not \$Hafif\)/.test(l)) ekle("§11", `on-olcum.ps1 ağır ölçüm Hafif dalının dışında (satır ${i + 1}) — açılış yavaşlar`);
  });
  const onk = psGovde(kur, "AsamaOnKosul") ?? "";
  const iEngel = onk.indexOf("EskiPaketEngeli"), iDur = onk.indexOf("if ($engel) { Dur $engel }"), iPlanYaz = onk.indexOf("DurumYaz $kok $plan");
  if (iEngel < 0 || iDur < 0 || iPlanYaz < 0 || iDur > iPlanYaz || !/EnYeniSurum \(KuruluSurumAdaylari \$kok \$ad\.veriKoku\)/.test(onk))
    ekle("§11", "OnKosul gerçek kurulu sürümü ölçüp eski pakette DurumYaz'dan ÖNCE durmuyor");
  if (!/\$e = EskiPaketEngeli \$ku /.test(k.onOlcum) || !/EnYeniSurum \(KuruluSurumAdaylari \$kok \$veriKoku\)/.test(k.onOlcum)) ekle("§11", "ön ölçüm gerçek kurulu sürümü / eski paket engelini ölçmüyor");
  if (!/if Olc\('eskiPaket'\) = 'eski' then/.test(pasGovde(k.iss, "OlcumEngelleri") ?? "")) ekle("§11", "sihirbaz eski paket engelini göstermiyor (kurulum ilerlerdi)");
  const sod = pasGovde(k.iss, "SayfalariOlcumleDoldur") ?? "";
  if (!/VeriSayfasi\.Buttons\[0\]\.Enabled := not \(Onarim or Yarim\)/.test(sod)) ekle("§11", "onarımda veri dizini 'Göz at' düğmesi kilitli değil");
  if (!/if Onarim then VeriSayfasi\.SubCaptionLabel\.Caption := 'ONARIM/.test(sod)) ekle("§11", "onarımda veri sayfası 'dizin boş olmalı' diyor");
  if (!/GelismisSayfasi\.Values\[2\] := Olc\('oncekiLisansSunucusu'\)/.test(sod)) ekle("§11", "onarımda gelişmiş sayfası kayıttaki lisans sunucusunu doldurmuyor");
  if (!/'Kip: ' \+ KipMetni/.test(pasGovde(k.iss, "UpdateReadyMemo") ?? "")) ekle("§11", "özette kip (ONARIM) yok");
  const dog = psGovde(kur, "AsamaDogrulama") ?? "";
  if (!/"isSystemAccount"/.test(dog) || !/if \(\$saticiVar\)/.test(dog)) ekle("§11", "satıcı hesabı 'yapılacak' listesine ÖLÇÜLMEDEN giriyor (onarımda hesap zaten var)");
  if (!/hak\.jws/.test(dog) || /^\s*\$acik \+= "lisans:/m.test(dog)) ekle("§11", "lisans 'yapılacak' listesine etkinlik ölçülmeden giriyor");
  return b;
}

// ---------------------------------------------------------------------------
// §1 harness (pwsh)
// ---------------------------------------------------------------------------
function pwshVar(): boolean {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8", timeout: 60_000 });
  return !r.error && r.status === 0 && Number((r.stdout ?? "").trim()) >= 7;
}
function harness(ortak?: string): { kod: number | null; satirlar: string[] } {
  const arg = ["-NoProfile", "-NonInteractive", "-File", join(KOK, "deploy", "test", "kurulum.harness.ps1")];
  if (ortak) arg.push("-Ortak", ortak);
  const r = spawnSync("pwsh", arg, { encoding: "utf8", timeout: 180_000 });
  return { kod: r.status, satirlar: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).map((s) => s.trimEnd()) };
}
/** D8d: kaldırılıp ESKİ kitle yeniden kurulum — gerçek kurulu sürüm (bayat kurulum.json değil) + eski paket engeli. */
const KURULU_KONTROLLERI = ["kurulu.yalniz-kayit", "kurulu.gecmisin-SON-satiri", "kurulu.bayat-kayit-yerine-guncelleyici", "kurulu.current-baglantisi", "kurulu.eski-paket-DUR"];
const CEVAP_KONTROLLERI = ["ornek-gecerli", "varsayilanlar", "surum-zorunlu", "surum-yanlis", "bilinmeyen-alan", "sir-alan-red", "sir-adi-dar", "tur-sayi", "sayi-aralik", "tur-mantik", "tur-yol", "desen", "secenek-liste", "bos", "sema-sirsiz"];
function durum(satirlar: string[], ad: string): "OK" | "HATA" | "YOK" {
  if (satirlar.includes(`OK ${ad}`)) return "OK";
  if (satirlar.some((s) => s.startsWith(`HATA ${ad}:`))) return "HATA";
  return "YOK";
}

// ---------------------------------------------------------------------------
// KOŞU
// ---------------------------------------------------------------------------
const okunan: Partial<Kaynaklar> = {};
const eksik: string[] = [];
for (const [ad, rel] of Object.entries(YOL) as Array<[Ad, string]>) {
  const m = oku(rel);
  if (m === undefined) eksik.push(rel);
  else okunan[ad] = m;
}
check("§0 kaynaklar okundu (ÖLÇÜLEMEDİ değil)", eksik.length === 0, eksik.length ? `okunamadı: ${eksik.join(", ")}` : `${Object.keys(YOL).length} dosya`);
if (eksik.length === 0) {
  const k = okunan as Kaynaklar;

  // §1
  console.log("\n§1 harness — kurulum-ortak.ps1 saf işlevleri gerçek kabukta");
  if (!pwshVar()) defter.atla("§1 harness", "pwsh 7 yok", CEVAP_KONTROLLERI.length + 7 + KURULU_KONTROLLERI.length);
  else {
    const h = harness();
    const vek = JSON.parse(readFileSync(join(KOK, "deploy/pg/pg-sablon-vektorleri.json"), "utf8")) as { port: Array<{ ad: string }> };
    const surumVek = (JSON.parse(readFileSync(join(TEKS, "native/test-vektorleri/guncelleme-karar.json"), "utf8")) as { kayitlar: Array<{ vektor: { tur: string; ad: string } }> }).kayitlar
      .filter((v) => v.vektor.tur === "surum-karsilastir")
      .map((v) => `surum.${v.vektor.ad}`);
    const trAtla = h.satirlar.some((s) => s.startsWith("ATLA cevap@tr-TR"));
    const beklenen = [
      ...CEVAP_KONTROLLERI.map((c) => `cevap.${c}`),
      ...(trAtla ? [] : CEVAP_KONTROLLERI.map((c) => `cevap.${c}@tr-TR`)),
      ...vek.port.map((v) => `port.${v.ad}`),
      "port.vektor-kumesi-bos-degil",
      "env.sade-kabul",
      "env.tirnak-bosluk-diyez-tersbolu-red",
      "json.ascii-gidis-donus",
      "maske.kayitli-sir",
      "maske.url-kimligi",
      ...surumVek,
      "surum.vektor-kumesi-bos-degil",
      ...KURULU_KONTROLLERI,
    ];
    if (trAtla) defter.atla("§1 tr-TR kültürü", "pwsh kültür verisi yok (InvariantGlobalization)", CEVAP_KONTROLLERI.length);
    const kotu = beklenen.filter((a) => durum(h.satirlar, a) !== "OK");
    check(`§1 ⭐ harness: ${beklenen.length} kontrolün HEPSİ OK (cevap şeması iki kültürde · portSec ${vek.port.length} D4 vektörü · .env · JSON · maske · sürüm önceliği ${surumVek.length} güncelleyici vektörü · gerçek kurulu sürüm + eski paket engeli)`, h.kod === 0 && kotu.length === 0,
      kotu.length ? kotu.map((a) => `${a}=${durum(h.satirlar, a)}`).join(" · ") : `çıkış ${h.kod}`);
  }

  // §2–§9
  const b = olc(k);
  const BOLUMLER: Array<[string, string]> = [
    ["§2", "cevap şeması ↔ sihirbaz ↔ örnek: alan kümeleri birebir, sihirbazın cevabı geçerli JSON"],
    ["§3", "sır hijyeni: parola/PIN/yedek parolası yalnız doğrulama + boru; argv/ortam/cevap/günlük/INI'de yok"],
    ["§4", "sıra: OnKosul (dosyalardan önce) → Paket (iskelet SIRDAN önce) → PostgreSQL → Backend → Hizmetler → Sirlar → Dogrulama; çıkış kodları"],
    ["§5", "tek çağrı noktası: D6 betikleri yalnız iki işlevden; kurulum hizmet kaydı yazmaz"],
    ["§6", "kaldırma veriyi korur: yalnız program dizinleri, bağlantı özyinelemesiz"],
    ["§7", ".env yalnız EnvYaz'dan (sade biçim kapısı)"],
    ["§8", "setup.exe içeriği orkestratörün ihtiyacını karşılar · yönetici · 64-bit · kaldırıcı"],
    ["§9", "CI: tetikler, doğrulayıcı üretim derlemesi, iki derleme, boru öz-sınaması, PS 5.1, kuru koşu"],
    ["§11", "sihirbaz deneyimi: ölçüm görünür + açılış hafif · eski paket iki kapıda · onarım metinleri · ölçülen yapılacaklar"],
  ];
  console.log("");
  for (const [bolum, ne] of BOLUMLER) check(`${bolum} ⭐ ${ne}`, !(b[bolum]?.length), (b[bolum] ?? []).join(" · "));

  // ✓K — statik sondalar
  console.log("\n§10 negatif sondalar (bozulmuş kopyalar)");
  type Sonda = { ad: string; dosya: Ad; eski: string; yeni: string; bolum: string; parca: string };
  const SONDALAR: Sonda[] = [
    { ad: "S1 sihirbaz cevabına satıcı parolası yazıyor", dosya: "iss", eski: `'  "provaKabul": ' + JsonMantik(ProvaKabul) + #13#10 +`, yeni: `'  "provaKabul": ' + JsonMantik(ProvaKabul) + ', "parola": ' + JsonMetin(SaticiSayfasi.Values[1]) + #13#10 +`, bolum: "§3", parca: "CevapJson sır" },
    { ad: "S2 sihirbaz cevabı şemada olmayan alan yazıyor", dosya: "iss", eski: `'  "v": 1,' + #13#10 +`, yeni: `'  "v": 1, "fazla": 1,' + #13#10 +`, bolum: "§2", parca: "fazla: fazla" },
    { ad: "S3 sihirbaz cevabı şema alanını unutuyor", dosya: "iss", eski: `', "defenderDislamasi": true },'`, yeni: `' },'`, bolum: "§2", parca: "eksik: pg.defenderDislamasi" },
    { ad: "S4 parola günlüğe yazılıyor", dosya: "iss", eski: `  Ekran := YedekSecimSayfasi.SelectedValueIndex = 1;`, yeni: `  Ekran := YedekSecimSayfasi.SelectedValueIndex = 1;\n  Log('parola ' + SaticiSayfasi.Values[1]);`, bolum: "§3", parca: "günlük/komut/dosya/ileti" },
    { ad: "S5 parola komut satırında (Exec)", dosya: "iss", eski: `    ' -Kaynak ' + ArgYol(ExpandConstant('{src}')) + ' -Sonuc ' + ArgYol(Ini) + Ek, '', SW_HIDE, ewWaitUntilTerminated, Kod) then`, yeni: `    ' -Kaynak ' + ArgYol(ExpandConstant('{src}')) + ' -Sonuc ' + ArgYol(Ini) + Ek + SaticiSayfasi.Values[1], '', SW_HIDE, ewWaitUntilTerminated, Kod) then`, bolum: "§3", parca: "izinli işlevin dışında (AsamaKos" },
    { ad: "S6 orkestratör parolayı argv'ye koyuyor", dosya: "kurulum", eski: `NodeKos $node @("dist\\tools\\superadmin-olustur.cjs", "--kurulum-stdin")`, yeni: `NodeKos $node @("dist\\tools\\superadmin-olustur.cjs", "--kurulum-stdin", $g.saticiParolasi)`, bolum: "§3", parca: "NodeKos argv'sinde sır" },
    { ad: "S7 orkestratör parolayı ortama koyuyor", dosya: "kurulum", eski: `  $ham = $null\n`, yeni: `  $ham = $null\n  $env:SATICI_PAROLASI = $g.saticiParolasi\n`, bolum: "§3", parca: "ortam değişkenine yazım (SATICI_PAROLASI" },
    { ad: "S8 sonuç INI'si sır satırını yazıyor", dosya: "kurulum", eski: `  & $tek "gunluk" $s["gunluk"]`, yeni: `  & $tek "gunluk" $s["gunluk"]\n  & $tek "anahtar" $script:SirSatiri`, bolum: "§3", parca: "sonuç INI'si sır" },
    { ad: "S9 Hepsi sırası bozuk (Backend PostgreSQL'den önce)", dosya: "kurulum", eski: "AsamaPaket; AsamaPostgreSQL; AsamaBackend;", yeni: "AsamaPaket; AsamaBackend; AsamaPostgreSQL;", bolum: "§4", parca: "Hepsi sırası" },
    { ad: "S10 Paket aşaması iskeletten ÖNCE sır yazıyor", dosya: "kurulum", eski: `  JunctionKur $current $hedef\n`, yeni: `  JunctionKur $current $hedef\n  EnvYaz (Join-Path $kok "yapilandirma\\.env") "A=b"\n`, bolum: "§4", parca: "AsamaPaket iskeletten ÖNCE sır" },
    { ad: "S11 backend güncelleyiciden sonra kaydediliyor", dosya: "kurulum", eski: `  [void](BackendHizmetBetigi $kok $d @("-Uygula"))\n  [void](GuncelleyiciHizmetBetigi $kok $d $C @("-Uygula"))`, yeni: `  [void](GuncelleyiciHizmetBetigi $kok $d $C @("-Uygula"))\n  [void](BackendHizmetBetigi $kok $d @("-Uygula"))`, bolum: "§4", parca: "Hizmetler sırası" },
    { ad: "S12 sihirbaz aşama tablosu kaydı (Backend↔PostgreSQL)", dosya: "iss", eski: "    3: Result := 'PostgreSQL';\n    4: Result := 'Backend';", yeni: "    3: Result := 'Backend';\n    4: Result := 'PostgreSQL';", bolum: "§4", parca: "aşama tablosu" },
    { ad: "S13 ikinci çağrı noktası (D6 betiği doğrudan)", dosya: "kurulum", eski: `  $acik = @()\n`, yeni: `  & (Join-Path $kok "current\\hizmet\\backend-hizmeti.ps1") -Kok $kok\n  $acik = @()\n`, bolum: "§5", parca: "backend-hizmeti.ps1 BackendHizmetBetigi dışında" },
    { ad: "S14 kurulum hizmet kaydı yazıyor (hizmet-kur)", dosya: "kurulum", eski: `  $acik = @()\n`, yeni: `  & "$kok\\current\\runtime\\tekserp-hizmet.exe" hizmet-kur --ad x\n  $acik = @()\n`, bolum: "§5", parca: "hizmet-kur" },
    { ad: "S15 kaldırma yapılandırmayı siliyor", dosya: "kaldir", eski: `  AdimDene "yedekle.ps1" {`, yeni: `  Remove-Item -LiteralPath (Join-Path $kok "yapilandirma") -Recurse -Force\n  AdimDene "yedekle.ps1" {`, bolum: "§6", parca: "Remove-Item" },
    { ad: "S16 bağlantı özyinelemeli siliniyor", dosya: "kaldir", eski: `if (ReparseMi $c) { [IO.Directory]::Delete($c); Ok`, yeni: `if (ReparseMi $c) { [IO.Directory]::Delete($c, $true); Ok`, bolum: "§6", parca: "özyinelemeli" },
    { ad: "S17 .env EnvYaz'ı atlıyor", dosya: "kurulum", eski: `    EnvYaz $envYolu (($satirlar -join "\`n") + "\`n")`, yeni: `    MetinYaz $envYolu (($satirlar -join "\`n") + "\`n")`, bolum: "§7", parca: "EnvYaz dışından" },
    { ad: "S18 setup içeriğinden pg_hba şablonu düşmüş", dosya: "iss", eski: `Source: "..\\pg\\pg_hba.conf.sablon"; DestDir: "{app}\\kurulum\\deploy\\pg"; Flags: ignoreversion\n`, yeni: "", bolum: "§8", parca: "pg_hba.conf.sablon" },
    { ad: "S19 kaldırıcı kaldir.ps1'i çağırmıyor", dosya: "iss", eski: `kaldir.ps1"" -Kok ""{app}"""`, yeni: `kaldir.ps1"""`, bolum: "§8", parca: "kaldırıcı" },
    { ad: "S20 yönetici olmadan kurulum", dosya: "iss", eski: "PrivilegesRequired=admin", yeni: "PrivilegesRequired=lowest", bolum: "§8", parca: "PrivilegesRequired" },
    { ad: "S23 UsePreviousLanguage düştü (AppId {code:} iken ISCC derlemez)", dosya: "iss", eski: "UsePreviousLanguage=no\n", yeni: "", bolum: "§8", parca: "UsePreviousLanguage" },
    { ad: "S24 NextButtonClick sessiz kısa devresi düştü (prova sorusu sessiz kurulumu asar)", dosya: "iss", eski: "    Exit;\n  end;\n  if CurPageID = wpSelectDir then", yeni: "  end;\n  if CurPageID = wpSelectDir then", bolum: "§8", parca: "sessiz kipte kısa devre" },
    { ad: "S26 sessiz kısa devre sayfaları doldurmuyor (boş veri dizini Inno yol denetiminde durdurur)", dosya: "iss", eski: "    if CurPageID = wpSelectDir then SayfalariOlcumleDoldur;\n", yeni: "", bolum: "§8", parca: "sayfaları ölçümle doldurmuyor" },
    { ad: "S27 hata kutusu sessiz kipte de gösteriliyor (sessiz dal düştü)", dosya: "iss", eski: "  if not WizardSilent then SuppressibleMsgBox(Metin, mbCriticalError, MB_OK, IDOK);", yeni: "  SuppressibleMsgBox(Metin, mbCriticalError, MB_OK, IDOK);", bolum: "§8", parca: "sessiz dalı olmayan kutu (Hata" },
    { ad: "S28 Kilitle (OI)(CI) iznini /T ile ağaca veriyor (dosya DACL'i boş)", dosya: "iss", eski: "*S-1-5-32-544:(OI)(CI)F /Q', '', SW_HIDE", yeni: "*S-1-5-32-544:(OI)(CI)F' + Ek + ' /Q', '', SW_HIDE", bolum: "§8", parca: "Kilitle (OI)(CI) iznini /T" },
    { ad: "S25 çıplak MsgBox sihirbaz dışı işlevde", dosya: "iss", eski: "function Kok: String;\nbegin\n", yeni: "function Kok: String;\nbegin\n  MsgBox('x', mbInformation, MB_OK);\n", bolum: "§8", parca: "çıplak MsgBox NextButtonClick dışında" },
    { ad: "S29 ön ölçüm penceresi düştü (ilk pencere ölçüm boyunca görünmez)", dosya: "iss", eski: "      Pencere := DenetimPenceresiAc(Ayrinti);", yeni: "      Pencere := nil;", bolum: "§11", parca: "'Sistem denetleniyor' penceresi" },
    { ad: "S30 ölçüm pencere yolunun dışından (InitializeSetup çıplak OlcumKos)", dosya: "iss", eski: "  if not OnOlcumKipli('C:\\TeksERP', not Sessiz) then Exit;", yeni: "  if OlcumKos('C:\\TeksERP', False) <> '' then Exit;", bolum: "§11", parca: "OlcumKos pencere yolunun dışından" },
    { ad: "S31 açılışta TAM ölçüm (sihirbaz CIM/port bitene dek açılmaz)", dosya: "iss", eski: "OnOlcumKipli('C:\\TeksERP', not Sessiz)", yeni: "OnOlcum('C:\\TeksERP')", bolum: "§11", parca: "HAFİF değil" },
    { ad: "S32 on-olcum CIM ölçümü Hafif dalının dışında", dosya: "onOlcum", eski: 'if (-not $Hafif) { $o["ramMB"]', yeni: 'if ($true) { $o["ramMB"]', bolum: "§11", parca: "Hafif dalının dışında" },
    { ad: "S33 OnKosul eski pakette durmuyor", dosya: "kurulum", eski: "    if ($engel) { Dur $engel }\n", yeni: "", bolum: "§11", parca: "OnKosul gerçek kurulu sürümü" },
    { ad: "S34 sihirbaz eski paket engelini göstermiyor", dosya: "iss", eski: "  if Olc('eskiPaket') = 'eski' then", yeni: "  if False then", bolum: "§11", parca: "eski paket engelini göstermiyor" },
    { ad: "S35 onarımda 'Göz at' açık", dosya: "iss", eski: "  VeriSayfasi.Buttons[0].Enabled := not (Onarim or Yarim);\n", yeni: "", bolum: "§11", parca: "Göz at" },
    { ad: "S36 onarımda veri sayfası 'boş olmalı' diyor", dosya: "iss", eski: "  if Onarim then VeriSayfasi.SubCaptionLabel.Caption := 'ONARIM", yeni: "  if False then VeriSayfasi.SubCaptionLabel.Caption := 'ONARIM", bolum: "§11", parca: "dizin boş olmalı" },
    { ad: "S37 gelişmiş sayfası kayıttaki lisans sunucusunu doldurmuyor", dosya: "iss", eski: "    if Olc('oncekiLisansOkundu') = '1' then GelismisSayfasi.Values[2] := Olc('oncekiLisansSunucusu');\n", yeni: "", bolum: "§11", parca: "kayıttaki lisans sunucusunu" },
    { ad: "S38 özette kip yok", dosya: "iss", eski: "  S := 'Kip: ' + KipMetni + NewLine +\n    'Kök: '", yeni: "  S := 'Kök: '", bolum: "§11", parca: "özette kip" },
    { ad: "S39 satıcı hesabı yapılacağı ölçülmeden", dosya: "kurulum", eski: '  if ($saticiVar) { Ok "satici (superadmin) hesabi var" }\n  elseif (', yeni: "  if (", bolum: "§11", parca: "satıcı hesabı 'yapılacak'" },
    { ad: "S40 lisans yapılacağı etkinlik ölçülmeden", dosya: "kurulum", eski: '  else { $acik += "lisans:', yeni: '  $acik += "lisans:', bolum: "§11", parca: "lisans 'yapılacak'" },
    { ad: "S21 CI boru sonucunu ölçmüyor", dosya: "is", eski: `if ($r -notmatch "(?m)^BORU=TAMAM\\r?$")`, yeni: `if ($false)`, bolum: "§9", parca: "boru öz-sınaması" },
    { ad: "S22 CI test çapalı doğrulayıcıyı kabul ediyor", dosya: "is", eski: `$k.testCapasi -ne $false`, yeni: `$false`, bolum: "§9", parca: "doğrulayıcı üretim derlemesi" },
  ];
  for (const s of SONDALAR) {
    const kopya: Kaynaklar = { ...k };
    if (!kopya[s.dosya].includes(s.eski)) {
      check(`✓K ${s.ad}`, false, "MUTASYON UYGULANMADI (desen kaynakta yok — sonda bayat)");
      continue;
    }
    kopya[s.dosya] = kopya[s.dosya].replace(s.eski, () => s.yeni);
    const sb = olc(kopya);
    const hit = (sb[s.bolum] ?? []).some((m) => m.includes(s.parca));
    check(`✓K ${s.ad} → ${s.bolum} KIRMIZI`, hit, hit ? "" : `bulgu: ${JSON.stringify(sb[s.bolum] ?? [])}`);
  }

  // ✓K — harness sondaları (kurulum-ortak.ps1'in bozulmuş kopyası)
  if (pwshVar()) {
    type HSonda = { ad: string; eski: string; yeni: string; kontrol: string };
    const HSONDALAR: HSonda[] = [
      { ad: "H1 sır adı listesinden 'parola' düştü", eski: "'(parola|password|", yeni: "'(password|", kontrol: "cevap.sir-alan-red" },
      { ad: "H2 yol türü boşluğa izin veriyor", eski: "'^[A-Za-z]:\\\\[\\x21-\\x7E]*$'", yeni: "'^[A-Za-z]:\\\\[\\x20-\\x7E]*$'", kontrol: "cevap.tur-yol" },
      { ad: "H3 şemada olmayan alan sessizce geçiyor", eski: `if (-not $alanlar.ContainsKey($k)) { $hatalar += "semada olmayan alan: '$k'" }`, yeni: "", kontrol: "cevap.bilinmeyen-alan" },
      { ad: "H4 istenen port meşgulken sessiz başka port", eski: `if ($dolu.ContainsKey([int]$istenen)) { return @{ hata = "istenen port $istenen mesgul - baska port verin ya da bos birakin" } }`, yeni: "", kontrol: "port.istenen port mesgul: HATA, sessiz baska port yok" },
      { ad: "H5 .env tırnağa izin veriyor", eski: `'^[A-Z_][A-Z0-9_]*=[^\\s"''#\\\\]*$'`, yeni: `'^[A-Z_][A-Z0-9_]*=[^\\s''#\\\\]*$'`, kontrol: "env.tirnak-bosluk-diyez-tersbolu-red" },
      { ad: "H6 JSON ASCII dışını kaçırmıyor", eski: "$k -gt 0x7E", yeni: "$k -gt 0xFFFF", kontrol: "json.ascii-gidis-donus" },
      { ad: "H7 sır adı kültüre bağlı küçültülüyor (tr-TR 'I')", eski: "$seg.ToLowerInvariant()", yeni: "$seg.ToLower()", kontrol: "cevap.sir-alan-red@tr-TR" },
      { ad: "H8 ön sürüm sayısal kimliği sözlükle kıyaslanıyor (rc.10 < rc.2)", eski: "if ($ps -and $qs) { $c = ([double]$p).CompareTo([double]$q) }", yeni: "if ($ps -and $qs) { $c = [string]::CompareOrdinal($p, $q) }", kontrol: "surum.ön sürüm sayısal kimlik" },
      { ad: "H9 güncelleyicinin durumu okunmuyor (bayat kurulum.json kazanır)", eski: `$a += @{ surum = "$($j.kuruluSurum)"; kaynak = "guncelleyici durum.json" }`, yeni: "", kontrol: "kurulu.bayat-kayit-yerine-guncelleyici" },
      { ad: "H10 geçmişin İLK satırı okunuyor (geri alınmış sürüm kurulu sanılır)", eski: "Where-Object { $_.Trim() }) | Select-Object -Last 1", yeni: "Where-Object { $_.Trim() }) | Select-Object -First 1", kontrol: "kurulu.gecmisin-SON-satiri" },
      { ad: "H11 eski paket engeli düştü (yeni kurulu sürüme eski paket)", eski: "  if ($c -gt 0) { return \"bu kokte kurulu surum", yeni: "  if ($c -gt 1) { return \"bu kokte kurulu surum", kontrol: "kurulu.eski-paket-DUR" },
    ];
    const asil = readFileSync(join(KOK, YOL.ortak), "utf8");
    const dizin = mkdtempSync(join(tmpdir(), "kurulum-sonda-"));
    try {
      for (const h of HSONDALAR) {
        if (!asil.includes(h.eski)) {
          check(`✓K ${h.ad}`, false, "MUTASYON UYGULANMADI (desen kaynakta yok — sonda bayat)");
          continue;
        }
        const dosya = join(dizin, "kurulum-ortak.ps1");
        writeFileSync(dosya, asil.replace(h.eski, () => h.yeni));
        const r = harness(dosya);
        const d = durum(r.satirlar, h.kontrol);
        if (h.kontrol.endsWith("@tr-TR") && r.satirlar.some((s) => s.startsWith("ATLA cevap@tr-TR"))) {
          defter.atla(`✓K ${h.ad}`, "tr-TR kültür verisi yok", 1);
          continue;
        }
        check(`✓K ${h.ad} → harness '${h.kontrol}' HATA`, d === "HATA" && r.kod === 1, `durum ${d} · çıkış ${r.kod}`);
      }
      // Pozitif kontrol: bozulmamış KOPYA aynı harness'te yeşil (sonda düzeneğinin kendisi geçerli).
      const dosya = join(dizin, "kurulum-ortak.ps1");
      copyFileSync(join(KOK, YOL.ortak), dosya);
      const r = harness(dosya);
      check("✓K düzenek: bozulmamış kopya harness'te yeşil (sonda dosyası gerçekten yükleniyor)", r.kod === 0, `çıkış ${r.kod}`);
    } finally {
      rmSync(dizin, { recursive: true, force: true });
    }
  } else defter.atla("✓K harness sondaları", "pwsh 7 yok", 12);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
