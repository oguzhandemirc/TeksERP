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
//   §12 lisans satıcısı KANALDAN (D8e, yönetici K1=A): boş alan = paketin kanalı (PAKET.json backendLisansSunucusu =
//      kanallar.json backend.lisansSunucusu); karar TEK işlevde (kurulum-ortak.ps1 LisansSunucusuKarari: OnKosul kararı +
//      .env satırı + Dogrulama ölçümü; harness §1 vektörleri); farklı elle değer ENGELLEMEZ, UYARIR (özet + günlük + sonuç);
//      onarımda kayıttaki .env korunur; satır yalnız derleme varsayılanından farklıysa (gecis.ps1 ile aynı kural).
//      BEYANLI İSTİSNA: PAKET.json'da alan yoksa (eski paket) bugünkü davranış + uyarı — fail-closed DEĞİL, eski paketler
//      bu alanı hiç taşımadı (harness `lisans.eski-paket-uyarir-durmaz`).
//   §13 onarım/kurulum güvenliği (D8e-3b, yönetici F1–F4B, thinkpad-1 bulguları 2026-10-02): F1 ağ ayarı onarım/devamda
//      KAYITTAN (tek okuyucu `KayitliAgAyari`: kurulum.json ag > durum.json ag > cevap-onceki.json > cevap.json; sihirbaz Ağ
//      sayfasını doldurur, özet ETKİLİ değeri yazar, OnKosul `AgKarari` ile korur, Hizmetler kuralı karardan kurar, setup
//      önceki cevabı saklar) · F2 kanal hizmeti BAŞKA köke bağlıysa ya da ölçülemezse engel/DUR (`HizmetKokEngelleri`,
//      fail-closed; ön ölçüm + OnKosul aynı işlev) · F3 eski paket TEK girişten (`EskiPaketOlcumu`) ve engel ön ölçüm
//      SAYFASINDA görünür · F4-B geçişle kurulmuş düzen ayrı sınıf GECISLI (`GecisliDuzen`: geçiş günlüğü + current), DURUR,
//      yabancı klasör eski mesajla; metin runbook (docs/ops/GECIS-PM2-HIZMET.md §5/§7) ile tutarlı.
//   §14 saat eşitlemesi (karar 2026-10-02): karar TEK saf işlevde (kurulum-ortak.ps1 SaatEsitlemeKarari; harness §1
//      `saat.*` vektörleri) — etki alanındaki makineye DOKUNULMAZ, dışında W32Time otomatik + NTP (kayıtlı sunucu korunur);
//      uygulayıcı (kurulum.ps1 SaatEsitlemesi) PartOfDomain'i ölçer, DOKUNMA'da yazmadan döner, w32tm yalnız NTP_AC'de ve
//      yalnız orada, sonucu YENİDEN ölçer, kurulamazsa UYARI (DUR değil), önceki ayar durum/kurulum.json'a (onarım ezmez);
//      /resync · Set-Date yok; kaldırma dokunmaz ve önceki ayarın yerini söyler; sihirbaz özeti söyler.
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
  gecisRunbook: "docs/ops/GECIS-PM2-HIZMET.md",
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
  // PIN özeti hizmetin anahtar halkasıyla yazılmalı: araç sürüm dizininde koştuğu için lisans deposu ortamdan verilir.
  const saticiAraci = kodSatirlari(kur).filter((s) => /NodeKos\s+\$\w+\s+@\("dist\\tools\\superadmin-olustur\.cjs"/.test(s.kod));
  if (saticiAraci.length === 0) ekle("§3", "satıcı hesabı aracı çağrısı bulunamadı (ölçülemedi)");
  for (const s of saticiAraci) {
    if (!/LICENSE_DIR\s*=\s*\(Join-Path \$kok "lisans"\)/.test(s.kod)) ekle("§3", `satıcı hesabı aracı lisans deposunu hizmetle aynı yerden almıyor (LICENSE_DIR, satır ${s.no})`);
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
  // Nokta-kaynak edilen komşu betikler (kanal adları TEK kaynak hizmet\kanal-adlari.ps1 - geçiş aynısını paketten okur).
  const noktaKaynak = new Set<string>();
  for (const t of [k.kurulum, k.onOlcum]) for (const m of t.matchAll(/^\. \(Join-Path \$PSScriptRoot "\.\.\\(hizmet\\[^"]+)"\)/gm)) { gerekli.add(`..\\${m[1]}`); noktaKaynak.add(m[1]!.split("\\")[0]!); }
  // on-olcum ve OnKosul {tmp} kopyasından koşar: nokta-kaynak edilen komşu dizin GeciciDosyalariAc'ta da açılmalı
  // (thinkpad-1 D8e: hizmet\ açılmadı → on-olcum çıkış 1, sihirbaz hiç açılmadı).
  const gecici = pasGovde(k.iss, "GeciciDosyalariAc") ?? "";
  if (noktaKaynak.size === 0) ekle("§8", "kurulum.ps1/on-olcum.ps1'de ..\\hizmet\\ nokta-kaynağı bulunamadı (ölçüm deseni bayat)");
  for (const d of noktaKaynak) if (!gecici.includes(`ExtractTemporaryFiles('{app}\\kurulum\\deploy\\${d}\\*');`)) ekle("§8", `GeciciDosyalariAc ${d}\\ dizinini {tmp}'e açmıyor — on-olcum/OnKosul onu nokta-kaynak eder`);
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
    const bek = x.src.startsWith("..\\pg\\lib\\") ? "{app}\\kurulum\\deploy\\pg\\lib" : x.src.startsWith("..\\pg\\") ? "{app}\\kurulum\\deploy\\pg" : x.src.startsWith("..\\hizmet\\") ? "{app}\\kurulum\\deploy\\hizmet" : "{app}\\kurulum\\deploy\\kurulum";
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
    if (/Get-CimInstance|Get-NetTCPConnection|PortDinleniyorMu|PgHizmetPortlari|HaricPortlar|KuruluSurumAdaylari|EskiPaketOlcumu|GecisliDuzen|HizmetKokEngelleri|KayitliAgAyari/.test(l) && !/if \(-not \$Hafif\)/.test(l)) ekle("§11", `on-olcum.ps1 ağır ölçüm Hafif dalının dışında (satır ${i + 1}) — açılış yavaşlar`);
  });
  const onk = psGovde(kur, "AsamaOnKosul") ?? "";
  const iEngel = onk.indexOf("EskiPaketOlcumu"), iDur = onk.indexOf("if ($engel) { Dur $engel }"), iPlanYaz = onk.indexOf("DurumYaz $kok $plan");
  if (iEngel < 0 || iDur < 0 || iPlanYaz < 0 || iDur > iPlanYaz || !/\$ep = EskiPaketOlcumu \$kok \$ad\.veriKoku /.test(onk))
    ekle("§11", "OnKosul gerçek kurulu sürümü ölçüp eski pakette DurumYaz'dan ÖNCE durmuyor");
  if (!/\$ep = EskiPaketOlcumu \$kok \$adlar\.veriKoku /.test(k.onOlcum) || !/\$o\["eskiPaket"\] = \$ep\.sinif/.test(k.onOlcum)) ekle("§11", "ön ölçüm gerçek kurulu sürümü / eski paket engelini ölçmüyor");
  if (!/if Olc\('eskiPaket'\) = 'eski' then/.test(pasGovde(k.iss, "OlcumEngelleri") ?? "")) ekle("§11", "sihirbaz eski paket engelini göstermiyor (kurulum ilerlerdi)");
  const sod = pasGovde(k.iss, "SayfalariOlcumleDoldur") ?? "";
  if (!/VeriSayfasi\.Buttons\[0\]\.Enabled := not \(Onarim or Yarim\)/.test(sod)) ekle("§11", "onarımda veri dizini 'Göz at' düğmesi kilitli değil");
  if (!/if Onarim then VeriSayfasi\.SubCaptionLabel\.Caption := 'ONARIM/.test(sod)) ekle("§11", "onarımda veri sayfası 'dizin boş olmalı' diyor");
  if (!/GelismisSayfasi\.Values\[2\] := Olc\('oncekiLisansSunucusu'\)/.test(sod)) ekle("§11", "onarımda gelişmiş sayfası kayıttaki lisans sunucusunu doldurmuyor");
  if (!/'Kip: ' \+ KipMetni/.test(pasGovde(k.iss, "UpdateReadyMemo") ?? "")) ekle("§11", "özette kip (ONARIM) yok");
  const dog = psGovde(kur, "AsamaDogrulama") ?? "";
  if (!/"isSystemAccount"/.test(dog) || !/if \(\$saticiVar\)/.test(dog)) ekle("§11", "satıcı hesabı 'yapılacak' listesine ÖLÇÜLMEDEN giriyor (onarımda hesap zaten var)");
  if (!/hak\.jws/.test(dog) || /^\s*\$acik \+= "lisans:/m.test(dog)) ekle("§11", "lisans 'yapılacak' listesine etkinlik ölçülmeden giriyor");
  // §12 — lisans satıcısı kanaldan: tek karar işlevi, boş alan = kanal, farklı değer UYARI (engel değil)
  if (!psGovde(ort, "LisansSunucusuKarari")) ekle("§12", "kurulum-ortak.ps1'de LisansSunucusuKarari yok (tek karar)");
  for (const [ad, metin] of [["kurulum.ps1", k.kurulum], ["on-olcum.ps1", k.onOlcum]] as const) {
    if (/function LisansSunucusuKarari\b/.test(metin)) ekle("§12", `LisansSunucusuKarari'nın ikinci kopyası (${ad})`);
  }
  if (!/LisansSunucusuKarari \(\[string\]\$k\.backendLisansSunucusu\) \(\[string\]\$k\.lisansSunucusuVarsayilan\) \(\[string\]\$C\["lisans\.saticiAdresi"\]\) \$lisKayit /.test(onk))
    ekle("§12", "OnKosul lisans satıcısını paketin kanal değerinden (PAKET.json backendLisansSunucusu) türetmiyor");
  if (!/foreach \(\$x in \$lis\.uyarilar\) \{ Uyar \$x \}/.test(onk)) ekle("§12", "OnKosul lisans uyarısını günlüğe/sonuca yazmıyor (Uyar)");
  if (!/lisans = \[ordered\]@\{ etkili = \$lis\.etkili; kaynak = \$lis\.kaynak; yaz = \$lis\.yaz/.test(onk)) ekle("§12", "plan lisans kararını taşımıyor (.env karardan yazılamaz)");
  const pgA = psGovde(kur, "AsamaPostgreSQL") ?? "";
  if (!/if \(\$d\.lisans\.yaz -eq \$true\) \{ \$satirlar \+= "LICENSE_SERVER_URL=\$\(\$d\.lisans\.etkili\)" \}/.test(pgA)) ekle("§12", ".env LICENSE_SERVER_URL kurulumun kararından (durum lisans.yaz/etkili) yazılmıyor");
  if (/LICENSE_SERVER_URL=\$\(\$C\[/.test(k.kurulum)) ekle("§12", ".env LICENSE_SERVER_URL ham cevaptan yazılıyor (boş alan kanalı almaz)");
  if (!/\$lm = LisansSunucusuKarari /.test(dog) || !/foreach \(\$x in \$lm\.uyarilar\) \{ Uyar \$x \}/.test(dog)) ekle("§12", "Dogrulama yazılan .env'in lisans satıcısını ölçmüyor (uyarı sonuca/kurulum.json'a düşmez)");
  if (!/\$o\["paketLisans"\] = "\$\(\$k\.backendLisansSunucusu\)"/.test(k.onOlcum) || !/\$o\["paketLisansVarsayilan"\] = "\$\(\$k\.lisansSunucusuVarsayilan\)"/.test(k.onOlcum))
    ekle("§12", "ön ölçüm paketin kanal lisans satıcısını sihirbaza vermiyor (paketLisans)");
  if ((sod.match(/GelismisSayfasi\.Values\[2\] := Olc\('paketLisans'\)/g) ?? []).length < 3) ekle("§12", "gelişmiş sayfası lisans sunucusunu paketin kanalıyla doldurmuyor (yeni kurulum · yeni köke dönüş · kayıtsız devam)");
  const loz = pasGovde(k.iss, "LisansOzeti") ?? "";
  if (!/Kanal := Olc\('paketLisans'\);/.test(loz) || !/else if Etkili = '' then Etkili := Kanal;/.test(loz)) ekle("§12", "özet boş alanı paketin kanalı olarak göstermiyor");
  if (!/else if Lowercase\(Etkili\) <> Lowercase\(Kanal\) then/.test(loz) || !/'UYARI: lisans sunucusu paketin kanalından FARKLI - beklenen ' \+ Kanal/.test(loz)) ekle("§12", "özet kanal kaydından farklı lisans sunucusunu UYARMIYOR (beklenen/girilen)");
  if (!/'UYARI: paket lisans sunucusunun kanal değerini taşımıyor \(eski ya da kanal dışı paket\)/.test(loz)) ekle("§12", "özet eski paketi (kanal değeri yok) uyarmıyor");
  if (!/S := S \+ LisansOzeti\(NewLine\);/.test(pasGovde(k.iss, "UpdateReadyMemo") ?? "")) ekle("§12", "özet sayfası etkili lisans sunucusunu yazmıyor (LisansOzeti)");

  // §13 — D8e-3b (2026-10-02): tek girişler kurulum-ortak.ps1'de; ön ölçüm ve OnKosul AYNI işlevi çağırır (elle kopya yok)
  const TEK_GIRIS = ["EskiPaketOlcumu", "GecisliDuzen", "HizmetKokEngelleri", "HizmetKokKarari", "KayitliAgAyari", "AgKarari"];
  for (const f of TEK_GIRIS) {
    if (!psGovde(ort, f)) ekle("§13", `kurulum-ortak.ps1'de ${f} yok (tek giriş)`);
    for (const [ad, metin] of [["kurulum.ps1", k.kurulum], ["on-olcum.ps1", k.onOlcum]] as const) if (new RegExp(`function ${f}\\b`).test(metin)) ekle("§13", `${f}'nın ikinci kopyası (${ad})`);
  }
  // F3: eski paket TEK girişten; iki yol çekirdek işlevleri doğrudan çağırmaz
  for (const [ad, t] of [["kurulum.ps1", kur], ["on-olcum.ps1", psTara(k.onOlcum)]] as const)
    for (const s of t.satirlar) if (/\b(EskiPaketEngeli|KuruluSurumAdaylari|EnYeniSurum)\b/.test(s.kod)) ekle("§13", `${ad} eski paketi tek giriş (EskiPaketOlcumu) dışından ölçüyor (satır ${s.no})`);
  const sod13 = pasGovde(k.iss, "SayfalariOlcumleDoldur") ?? "";
  if (!/Engel := OlcumEngelleri;/.test(sod13) || !/RichEditViewer\.Lines\.Text := 'ENGEL[^\n]*\+ Engel \+/.test(sod13)) ekle("§13", "ön ölçüm sayfası engelleri göstermiyor (yalnız 'Sonraki'de çıkar — eski paket/yabancı kök sayfada 'ONARIM … veri korunur' der)");
  // F4-B: geçişli düzen ayrı sınıf; OnKosul yabancı klasör kuralından ÖNCE durur, yabancı mesajı aynen kalır
  const iGecis = onk.indexOf("if ($gd) { Dur $gd.metin }"), iYabanci = onk.indexOf('Dur "kok bos degil ve TeksERP kurulumu degil');
  if (!/\$gd = GecisliDuzen \$kok/.test(onk) || iGecis < 0 || iYabanci < 0 || iGecis > iYabanci) ekle("§13", "OnKosul geçişle kurulmuş düzeni tanımadan 'yabancı klasör' diyor (F4-B)");
  if (!/\$gd = GecisliDuzen \$kok/.test(k.onOlcum) || !/if \(\$gd\) \{ \$o\["gecisli"\] = 1;[^\n]*\}\s*\n\s*else \{ \$o\["kokYabanci"\]/.test(k.onOlcum)) ekle("§13", "ön ölçüm geçişli düzeni tanımıyor ya da onu yabancı klasör de sayıyor (F4-B)");
  const eng13 = pasGovde(k.iss, "OlcumEngelleri") ?? "";
  if (!/Gecisli := Olc\('gecisli'\) = '1';/.test(pasGovde(k.iss, "OnOlcumKipli") ?? "") || !/if Gecisli then\s*\n\s*Result := Result \+ '- Bu klasör pm2 → hizmet geçişiyle kurulmuş/.test(eng13)) ekle("§13", "sihirbaz geçişli düzeni engel olarak göstermiyor (F4-B)");
  if (!/else if Gecisli then Result := 'GEÇİŞLİ KURULUM/.test(pasGovde(k.iss, "KipMetni") ?? "")) ekle("§13", "kip geçişli düzende 'yeni kurulum' diyor (F4-B)");
  const gm = psGovde(ort, "GecisliDuzen") ?? "";
  for (const [ne, metin] of [["sihirbaz", eng13], ["GecisliDuzen", gm]] as const)
    if (!/GECIS-PM2-HIZMET\.md/.test(metin) || !/-GeriAl/.test(metin) || !/onarmaz/.test(metin)) ekle("§13", `${ne} geçişli düzen metni runbook'u (GECIS-PM2-HIZMET.md, -GeriAl, 'onarmaz') anmıyor`);
  if (!/Onarım setup\.exe ile YAPILMAZ[\s\S]{0,200}setup bu kurulumu tanır ve durur[\s\S]{0,200}gecis\.ps1 -GeriAl/.test(k.gecisRunbook)) ekle("§13", "runbook §7 geçişli düzenin setup'la onarılmadığını/durduğunu anlatmıyor — mesaj ile runbook ayrıştı");
  // F2: kanal hizmetinin kökü — ön ölçüm (engel) ve OnKosul (DUR, DurumYaz'dan ÖNCE) aynı işlevle
  if (!/\$hk = HizmetKokEngelleri \$adlar \$kok\r?$/m.test(k.onOlcum) || !/\$o\["hizmetKokSayisi"\] = \$hk\.Count/.test(k.onOlcum)) ekle("§13", "ön ölçüm kanal hizmetlerinin kökünü ölçmüyor (F2)");
  const iHk = onk.indexOf("if ($hk.Count) { Dur"), iHkCagri = onk.indexOf("$hk = HizmetKokEngelleri $ad $kok");
  if (iHkCagri < 0 || iHk < iHkCagri || iHk > iPlanYaz) ekle("§13", "OnKosul başka köke bağlı kanal hizmetinde DurumYaz'dan ÖNCE durmuyor (F2)");
  if (!/N := StrToIntDef\(Olc\('hizmetKokSayisi'\), 0\);\s*\n\s*for I := 1 to N do/.test(eng13) || !/köküne bağlı; bu klasöre kurulum\/onarım yapılamaz/.test(eng13) || !/ölçülemedi; kurulum\/onarım yapılamaz/.test(eng13)) ekle("§13", "sihirbaz kanal hizmeti kök engelini (başka kök / ölçülemedi) göstermiyor (F2)");
  // F1: ağ ayarı onarım/devamda kayıttan
  if (!/\$ag = KayitliAgAyari \$kok /.test(k.onOlcum) || !/\$o\["oncekiAgIzinli"\]/.test(k.onOlcum) || !/\$o\["oncekiAgProfiller"\]/.test(k.onOlcum) || !/\$o\["oncekiAgMdns"\]/.test(k.onOlcum)) ekle("§13", "ön ölçüm kayıttaki ağ ayarını sihirbaza vermiyor (F1)");
  if (!/AgSayfasi\.Values\[0\] := Pos\('100\.64\.0\.0\/10', Olc\('oncekiAgIzinli'\)\) > 0;/.test(sod13) || !/AgSayfasi\.Values\[1\] := Pos\('Domain', Olc\('oncekiAgProfiller'\)\) > 0;/.test(sod13) || !/AgSayfasi\.Values\[3\] := Olc\('oncekiAgMdns'\) = '1';/.test(sod13)) ekle("§13", "sihirbaz onarımda Ağ sayfasını kayıttan doldurmuyor (varsayılan LocalSubnet Tailscale'i daraltır) (F1)");
  const agoz = pasGovde(k.iss, "AgOzeti") ?? "";
  if (!/AgOzeti\(NewLine\)/.test(pasGovde(k.iss, "UpdateReadyMemo") ?? "") || !/if Olc\('oncekiAgIzinli'\) <> '' then Izinli := Olc\('oncekiAgIzinli'\);/.test(agoz) || !/UYGULANMAZ/.test(agoz)) ekle("§13", "özet ETKİLİ ağ erişimini (onarımda kayıttaki) yazmıyor ya da sayfa farkını uyarmıyor (F1)");
  if (!/if \(\$onarim -or \$yarim\) \{ \$agKayit = KayitliAgAyari \$kok /.test(onk) || !/\$agK = AgKarari \$C \$script:CevapHam \$agKayit /.test(onk) || !/foreach \(\$x in \$agK\.uyarilar\) \{ Uyar \$x \}/.test(onk) || !/ag = \$agK\.ag/.test(onk)) ekle("§13", "OnKosul ağ ayarını kayıttan korumuyor (sessiz onarım varsayılana düşer) (F1)");
  if (!/-RemoteAddress @\(\$ag\.izinliAdresler\)/.test(hiz) || /-RemoteAddress @\(\$C\[/.test(hiz) || !/\$d\.ag/.test(hiz)) ekle("§13", "Hizmetler güvenlik duvarı kuralını OnKosul kararından değil ham cevaptan kuruyor (F1)");
  if (!/ag = \$\(if \(\$d\.PSObject\.Properties\["ag"\]\)/.test(dog)) ekle("§13", "kurulum.json uygulanan ağ ayarını kaydetmiyor (sonraki onarımın kaydı) (F1)");
  const iOnceki = hazir.indexOf("cevap-onceki.json', False)"), iYeni = hazir.indexOf("SaveStringToFile(KurulumCevabi");
  if (iOnceki < 0 || iYeni < 0 || iOnceki > iYeni || !/if \(Onarim or Yarim\) and FileExists\(KurulumCevabi\) then/.test(hazir)) ekle("§13", "setup onarımda önceki cevabı yenisini yazmadan saklamıyor (eski kurulumların tek ağ kaydı) (F1)");
  // §14 saat eşitlemesi (karar 2026-10-02): etki alanına DOKUNMA, dışında W32Time NTP; saat elle ayarlanmaz
  const se = psGovde(kur, "SaatEsitlemesi") ?? "";
  if (!se) ekle("§14", "kurulum.ps1'de SaatEsitlemesi işlevi yok");
  if (!/\$k = SaatEsitlemeKarari \(\[bool\]\$cs\.PartOfDomain\) /.test(se) || !/Get-CimInstance Win32_ComputerSystem/.test(se)) ekle("§14", "SaatEsitlemesi kararı etki alanı üyeliğini (PartOfDomain) ölçerek vermiyor");
  const iDokunma = se.indexOf('if ($k.eylem -ceq "DOKUNMA") {'), iDonus = se.indexOf("return", iDokunma), iYaz = se.indexOf("Set-Service");
  if (iDokunma < 0 || iDonus < 0 || iYaz < 0 || iDonus > iYaz) ekle("§14", "DOKUNMA kararında (etki alanı / zaten NTP) hizmete yazmadan dönmüyor");
  if (!/if \(\$k\.eylem -ceq "NTP_AC"\) \{\s*\n\s*\$r = NativeKos "w32tm\.exe" @\("\/config", "\/manualpeerlist:\$\(\$k\.sunucu\)", "\/syncfromflags:manual", "\/update"\)/.test(se)) ekle("§14", "w32tm /config yalnız NTP_AC kararında, kararın sunucusuyla koşmuyor");
  if (!/\$olc = SaatEsitlemeKarari \$false \$son\.tip/.test(se) || !/if \(\$olc\.eylem -ceq "DOKUNMA" -and \$son\.calisiyor\) \{ Ok /.test(se)) ekle("§14", "uygulama sonrası sonuç yeniden ÖLÇÜLMÜYOR (tip + otomatik + çalışıyor)");
  if (/\bDur\b/.test(se)) ekle("§14", "saat eşitlemesi kurulumu DURDURUYOR (karar: yalnız UYARI)");
  if (!/if \(-not \$d\.PSObject\.Properties\["saat"\]\) \{/.test(se)) ekle("§14", "onarım ilk kurulumun önceki saat ayarı kaydını eziyor");
  const iSaatCagri = hiz.indexOf("SaatEsitlemesi $d"), iHizBitti = hiz.indexOf('AsamaBitti $d "Hizmetler"');
  if (iSaatCagri < 0 || iHizBitti < 0 || iSaatCagri > iHizBitti) ekle("§14", "Hizmetler aşaması SaatEsitlemesi'ni (durum kaydından önce) çağırmıyor");
  if (!/saat = \$\(if \(\$d\.PSObject\.Properties\["saat"\]\) \{ \$d\.saat \}/.test(dog)) ekle("§14", "kurulum.json saat kaydını (önceki ayar) taşımıyor");
  // w32tm yalnız SaatEsitlemesi'nde; /resync ve elle saat ayarı hiçbir kurulum betiğinde yok
  for (const [ad, t] of [["kurulum.ps1", kur], ["kurulum-ortak.ps1", ort], ["kaldir.ps1", kal]] as const)
    for (const s of kodSatirlari(t))
      if (/w32tm/i.test(s.kod) && !(ad === "kurulum.ps1" && s.islev === "SaatEsitlemesi")) ekle("§14", `${ad}:${s.no} w32tm SaatEsitlemesi dışında`);
  for (const ad of ["kurulum", "ortak", "kaldir", "onOlcum"] as const)
    if (/\/resync|Set-Date|\bSetSystemTime\b|\bSetLocalTime\b/i.test(k[ad].split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"))) ekle("§14", `${YOL[ad]} saati elle ayarlıyor (/resync · Set-Date · SetSystemTime)`);
  if (/W32Time|w32tm/i.test(kal.satirlar.map((s) => s.kod).join("\n")) || !/saat\.onceki/.test(k.kaldir)) ekle("§14", "kaldırma saat eşitlemesine dokunuyor ya da önceki ayarın yerini söylemiyor (karar: geri alınmaz)");
  if (!/'Saat eşitlemesi: etki alanına bağlı değilse Windows saati NTP ile otomatik eşitlenir; etki alanındaysa dokunulmaz'/.test(pasGovde(k.iss, "UpdateReadyMemo") ?? "")) ekle("§14", "sihirbaz özeti saat eşitlemesini söylemiyor");
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
/** D8e: lisans satıcısı kanaldan (kurulum-ortak.ps1 LisansSunucusuKarari) — eski paket beyanlı istisna dahil. */
const LISANS_KONTROLLERI = ["bos-alan-kanaldan", "uretim-kanali-satir-yazmaz", "esit-elle-uyarisiz", "farkli-elle-UYARI", "farkli-elle-yazilir", "eski-paket-uyarir-durmaz", "onarim-kayit-korunur", "onarim-satirsiz-varsayilan-UYARI", "onarim-cevap-uygulanmaz"].map((c) => `lisans.${c}`);
const KURULU_KONTROLLERI = ["kurulu.yalniz-kayit", "kurulu.gecmisin-SON-satiri", "kurulu.bayat-kayit-yerine-guncelleyici", "kurulu.current-baglantisi", "kurulu.eski-paket-DUR"];
/** D8e-3b: eski paket tek giriş · geçişli düzen · kanal hizmetinin kökü · ağ ayarı kayıttan. */
const D8E3B_KONTROLLERI = ["eskipaket.olcum-tek-giris", "gecisli.duzen-tanir", "gecisli.tek-isaret-yetmez-yabanci-eski-mesaj", "ag.kayit-eski-cevaptan", "ag.kayit-oncelik", "ag.kayit-gecersiz-yok-sayilir", "ag.onarim-sessiz-kayit-korunur", "ag.onarim-cevap-uygulanmaz", "ag.yeni-kurulum-cevaptan", "hizmetkok.ayni-kok-gecer", "hizmetkok.baska-kok-durur", "hizmetkok.okunamaz-durur", "hizmetkok.uc-hizmet-olculur"];
/** Saat eşitlemesi kararı (2026-10-02): etki alanı DOKUNMA · zaten NTP DOKUNMA · hizmet otomatik · kapalı → NTP · önceki kayıtta. */
const SAAT_KONTROLLERI = ["etki-alani-dokunmaz", "zaten-ntp-dokunmaz", "ntp-hizmet-otomatik", "kapali-ntp-acar", "onceki-kayda-girer"].map((c) => `saat.${c}`);
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
  if (!pwshVar()) defter.atla("§1 harness", "pwsh 7 yok", CEVAP_KONTROLLERI.length + 7 + KURULU_KONTROLLERI.length + LISANS_KONTROLLERI.length + D8E3B_KONTROLLERI.length + SAAT_KONTROLLERI.length);
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
      ...LISANS_KONTROLLERI,
      ...D8E3B_KONTROLLERI,
      ...SAAT_KONTROLLERI,
    ];
    if (trAtla) defter.atla("§1 tr-TR kültürü", "pwsh kültür verisi yok (InvariantGlobalization)", CEVAP_KONTROLLERI.length);
    const kotu = beklenen.filter((a) => durum(h.satirlar, a) !== "OK");
    check(`§1 ⭐ harness: ${beklenen.length} kontrolün HEPSİ OK (cevap şeması iki kültürde · portSec ${vek.port.length} D4 vektörü · .env · JSON · maske · sürüm önceliği ${surumVek.length} güncelleyici vektörü · gerçek kurulu sürüm + eski paket engeli · lisans satıcısı ${LISANS_KONTROLLERI.length} karar vektörü · D8e-3b ${D8E3B_KONTROLLERI.length}: eski paket tek giriş · geçişli düzen · hizmet kökü · ağ kaydı · saat eşitlemesi ${SAAT_KONTROLLERI.length})`, h.kod === 0 && kotu.length === 0,
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
    ["§12", "lisans satıcısı kanaldan: tek karar işlevi · boş alan = kanal (ön doldurma + özet) · farklı değer UYARI · .env karardan · Dogrulama ölçer"],
    ["§13", "onarım/kurulum güvenliği (D8e-3b): F1 ağ ayarı kayıttan (ön doldurma · özet etkili · OnKosul korur · kural karardan · önceki cevap saklanır) · F2 başka köke bağlı / ölçülemeyen kanal hizmeti engel+DUR · F3 eski paket tek giriş + sayfada engel · F4-B geçişli düzen GECISLI, DUR"],
    ["§14", "saat eşitlemesi: etki alanına dokunmaz · dışında W32Time NTP + otomatik · w32tm yalnız NTP_AC · sonuç yeniden ölçülür · UYARI, DUR değil · önceki ayar kayıtta · /resync yok · kaldırma dokunmaz · özet söyler"],
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
    { ad: "S37 gelişmiş sayfası kayıttaki lisans sunucusunu doldurmuyor", dosya: "iss", eski: "GelismisSayfasi.Values[2] := Olc('oncekiLisansSunucusu')", yeni: "GelismisSayfasi.Values[2] := ''", bolum: "§11", parca: "kayıttaki lisans sunucusunu" },
    { ad: "S38 özette kip yok", dosya: "iss", eski: "  S := 'Kip: ' + KipMetni + NewLine +\n    'Kök: '", yeni: "  S := 'Kök: '", bolum: "§11", parca: "özette kip" },
    { ad: "S39 satıcı hesabı yapılacağı ölçülmeden", dosya: "kurulum", eski: '  if ($saticiVar) { Ok "satici (superadmin) hesabi var" }\n  elseif (', yeni: "  if (", bolum: "§11", parca: "satıcı hesabı 'yapılacak'" },
    { ad: "S40 lisans yapılacağı etkinlik ölçülmeden", dosya: "kurulum", eski: '  else { $acik += "lisans:', yeni: '  $acik += "lisans:', bolum: "§11", parca: "lisans 'yapılacak'" },
    { ad: "S41 satıcı hesabı aracı lisans deposunu ortamdan almıyor (PIN başka anahtarla özetlenir)", dosya: "kurulum", eski: `; LICENSE_DIR = (Join-Path $kok "lisans") }`, yeni: " }", bolum: "§3", parca: "lisans deposunu hizmetle aynı yerden" },
    { ad: "S42 setup içeriğinden kanal-adlari.ps1 düşmüş (AdlariCoz çekirdeği)", dosya: "iss", eski: `Source: "..\\hizmet\\kanal-adlari.ps1"; DestDir: "{app}\\kurulum\\deploy\\hizmet"; Flags: ignoreversion\n`, yeni: "", bolum: "§8", parca: "kanal-adlari.ps1" },
    { ad: "S43 OnKosul türetmeyi atlıyor (cevap boşsa kanal yok)", dosya: "kurulum", eski: "LisansSunucusuKarari ([string]$k.backendLisansSunucusu) ([string]$k.lisansSunucusuVarsayilan) ", yeni: "LisansSunucusuKarari \"\" ([string]$k.lisansSunucusuVarsayilan) ", bolum: "§12", parca: "kanal değerinden" },
    { ad: "S44 .env ham cevabı yazıyor (boş alan = backend varsayılanı, eski davranış)", dosya: "kurulum", eski: `    if ($d.lisans.yaz -eq $true) { $satirlar += "LICENSE_SERVER_URL=$($d.lisans.etkili)" }`, yeni: `    if ($C["lisans.saticiAdresi"]) { $satirlar += "LICENSE_SERVER_URL=$($C['lisans.saticiAdresi'])" }`, bolum: "§12", parca: "ham cevaptan" },
    { ad: "S45 OnKosul lisans uyarısını yutuyor", dosya: "kurulum", eski: "  foreach ($x in $lis.uyarilar) { Uyar $x }\n", yeni: "", bolum: "§12", parca: "Uyar" },
    { ad: "S46 Dogrulama lisans satıcısını ölçmüyor", dosya: "kurulum", eski: "    foreach ($x in $lm.uyarilar) { Uyar $x }\n", yeni: "", bolum: "§12", parca: "Dogrulama yazılan .env" },
    { ad: "S47 karar işlevinin ikinci kopyası (on-olcum)", dosya: "onOlcum", eski: "$o = [ordered]@{}\n", yeni: "$o = [ordered]@{}\nfunction LisansSunucusuKarari { }\n", bolum: "§12", parca: "ikinci kopyası" },
    { ad: "S48 ön ölçüm kanal değerini vermiyor", dosya: "onOlcum", eski: `$o["paketLisans"] = "$($k.backendLisansSunucusu)"`, yeni: `$o["paketLisans"] = ""`, bolum: "§12", parca: "paketLisans" },
    { ad: "S49 sihirbaz yeni kurulumda alanı kanalla doldurmuyor", dosya: "iss", eski: "  else if GelismisSayfasi.Values[2] = '' then GelismisSayfasi.Values[2] := Olc('paketLisans');\nend;", yeni: "end;", bolum: "§12", parca: "doldurmuyor" },
    { ad: "S50 özet farklı değeri uyarmıyor", dosya: "iss", eski: "  else if Lowercase(Etkili) <> Lowercase(Kanal) then", yeni: "  else if False then", bolum: "§12", parca: "UYARMIYOR" },
    { ad: "S51 özet boş alanı kanal saymıyor", dosya: "iss", eski: "  else if Etkili = '' then Etkili := Kanal;", yeni: "  else if False then Etkili := Kanal;", bolum: "§12", parca: "boş alanı" },
    { ad: "S53 {tmp}'e hizmet\\ açılmıyor (ön ölçüm kanal-adlari.ps1'i bulamaz)", dosya: "iss", eski: "    ExtractTemporaryFiles('{app}\\kurulum\\deploy\\hizmet\\*');\n", yeni: "", bolum: "§8", parca: "{tmp}'e açmıyor" },
    { ad: "S52 özet LisansOzeti'ni çağırmıyor (eski 'varsayılan' metni)", dosya: "iss", eski: "  S := S + LisansOzeti(NewLine);", yeni: "  S := S + 'Lisans sunucusu: varsayılan' + NewLine;", bolum: "§12", parca: "LisansOzeti" },
    { ad: "S54 F1 sihirbaz onarımda Ağ sayfasını kayıttan doldurmuyor (Tailscale düşer)", dosya: "iss", eski: "    if Olc('oncekiAgIzinli') <> '' then AgSayfasi.Values[0] := Pos('100.64.0.0/10', Olc('oncekiAgIzinli')) > 0;\n", yeni: "", bolum: "§13", parca: "Ağ sayfasını kayıttan" },
    { ad: "S55 F1 özet sayfanın seçimini yazıyor (etkili kayıt değil)", dosya: "iss", eski: "    if Olc('oncekiAgIzinli') <> '' then Izinli := Olc('oncekiAgIzinli');\n", yeni: "", bolum: "§13", parca: "ETKİLİ ağ erişimini" },
    { ad: "S56 F1 OnKosul ağ kaydını okumuyor (sessiz onarım LocalSubnet'e daralır)", dosya: "kurulum", eski: "  if ($onarim -or $yarim) { $agKayit = KayitliAgAyari $kok $script:CevapSemasi }\n", yeni: "", bolum: "§13", parca: "ağ ayarını kayıttan korumuyor" },
    { ad: "S57 F1 Hizmetler kuralı ham cevaptan kuruyor", dosya: "kurulum", eski: "-RemoteAddress @($ag.izinliAdresler)", yeni: '-RemoteAddress @($C["api.izinliAdresler"])', bolum: "§13", parca: "ham cevaptan kuruyor" },
    { ad: "S58 F1 setup önceki cevabı saklamıyor", dosya: "iss", eski: "      if not FileCopy(KurulumCevabi, Kok + '\\kurulum\\cevap-onceki.json', False) then\n", yeni: "      if False then\n", bolum: "§13", parca: "önceki cevabı" },
    { ad: "S59 F2 OnKosul başka köke bağlı hizmette durmuyor", dosya: "kurulum", eski: '  if ($hk.Count) { Dur ((@($hk) | ForEach-Object { $_.metin }) -join " | ") }\n', yeni: "", bolum: "§13", parca: "DurumYaz'dan ÖNCE durmuyor (F2)" },
    { ad: "S60 F2 ön ölçüm hizmet kökünü ölçmüyor", dosya: "onOlcum", eski: "$hk = HizmetKokEngelleri $adlar $kok\n", yeni: "$hk = @()\n", bolum: "§13", parca: "kökünü ölçmüyor (F2)" },
    { ad: "S61 F2 sihirbaz hizmet kökü engelini göstermiyor", dosya: "iss", eski: "  N := StrToIntDef(Olc('hizmetKokSayisi'), 0);\n", yeni: "  N := 0;\n", bolum: "§13", parca: "kök engelini" },
    { ad: "S62 F3 ön ölçüm sayfası engeli göstermiyor (yalnız Sonraki'de)", dosya: "iss", eski: "' + #13#10 + Engel + #13#10 + OlcumOzeti", yeni: "' + #13#10 + OlcumOzeti", bolum: "§13", parca: "engelleri göstermiyor" },
    { ad: "S63 F3 ön ölçüm eski paketi tek giriş dışından ölçüyor", dosya: "onOlcum", eski: '      if ($o["paketSurum"] -and $ep.sinif) { $o["eskiPaket"] = $ep.sinif }', yeni: '      if ($o["paketSurum"] -and (EskiPaketEngeli $ep.kurulu "$($o["paketSurum"])")) { $o["eskiPaket"] = $ep.sinif }', bolum: "§13", parca: "tek giriş (EskiPaketOlcumu) dışından" },
    { ad: "S64 F4-B OnKosul geçişli düzeni yabancı sayıyor", dosya: "kurulum", eski: "    if ($gd) { Dur $gd.metin }\n", yeni: "", bolum: "§13", parca: "geçişle kurulmuş düzeni tanımadan" },
    { ad: "S65 F4-B ön ölçüm geçişli düzeni tanımıyor", dosya: "onOlcum", eski: "      $gd = GecisliDuzen $kok\n", yeni: "      $gd = $null\n", bolum: "§13", parca: "geçişli düzeni tanımıyor" },
    { ad: "S66 F4-B sihirbaz geçişli engelini göstermiyor", dosya: "iss", eski: "  if Gecisli then\n    Result := Result + '- Bu klasör pm2", yeni: "  if False then\n    Result := Result + '- Bu klasör pm2", bolum: "§13", parca: "engel olarak göstermiyor" },
    { ad: "S67 saat: PartOfDomain ölçülmeden karar", dosya: "kurulum", eski: "$k = SaatEsitlemeKarari ([bool]$cs.PartOfDomain) ", yeni: "$k = SaatEsitlemeKarari $false ", bolum: "§14", parca: "PartOfDomain" },
    { ad: "S68 saat: DOKUNMA kararında hizmete yazılıyor", dosya: "kurulum", eski: "    else { Ok \"saat: Windows Time zaten NTP ile esitliyor ($($k.sunucu)) - DOKUNULMADI\" }\n    return\n", yeni: "    else { Ok \"saat: Windows Time zaten NTP ile esitliyor ($($k.sunucu)) - DOKUNULMADI\" }\n", bolum: "§14", parca: "yazmadan dönmüyor" },
    { ad: "S69 saat: w32tm NTP_AC kapısı dışında", dosya: "kurulum", eski: "if ($k.eylem -ceq \"NTP_AC\") {", yeni: "if ($true) {", bolum: "§14", parca: "yalnız NTP_AC" },
    { ad: "S70 saat: sonuç yeniden ölçülmüyor", dosya: "kurulum", eski: "$olc = SaatEsitlemeKarari $false $son.tip", yeni: "$olc = $k; $null = $son.tip", bolum: "§14", parca: "yeniden ÖLÇÜLMÜYOR" },
    { ad: "S71 saat: Hizmetler çağırmıyor", dosya: "kurulum", eski: "  SaatEsitlemesi $d\n", yeni: "", bolum: "§14", parca: "çağırmıyor" },
    { ad: "S72 saat: kurulum /resync ile saati zorluyor", dosya: "kurulum", eski: "\"/syncfromflags:manual\", \"/update\")", yeni: "\"/syncfromflags:manual\", \"/update\"); NativeKos \"w32tm.exe\" @(\"/resync\")", bolum: "§14", parca: "saati elle ayarlıyor" },
    { ad: "S73 saat: kaldırma eşitlemeyi kapatıyor", dosya: "kaldir", eski: "  # 4) Korunanlar - adlariyla.\n", yeni: "  Set-Service -Name W32Time -StartupType Manual\n  # 4) Korunanlar - adlariyla.\n", bolum: "§14", parca: "kaldırma saat eşitlemesine dokunuyor" },
    { ad: "S74 saat: onarım önceki ayar kaydını eziyor", dosya: "kurulum", eski: "if (-not $d.PSObject.Properties[\"saat\"]) {", yeni: "if ($true) {", bolum: "§14", parca: "eziyor" },
    { ad: "S75 saat: sihirbaz özeti söylemiyor", dosya: "iss", eski: "  S := S + 'Saat eşitlemesi:", yeni: "  S := S + 'Saat:", bolum: "§14", parca: "özeti saat" },
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
      { ad: "H12 boş alan kanalı almıyor (türetme kaldırıldı)", eski: "  } elseif ($kan) { $etkili = $kan; $kaynak = \"kanal\" }", yeni: "  }", kontrol: "lisans.bos-alan-kanaldan" },
      { ad: "H13 farklı elle değer uyarısı düştü", eski: "  } elseif ($etkili -cne $kan) {", yeni: "  } elseif ($false) {", kontrol: "lisans.farkli-elle-UYARI" },
      { ad: "H14 eski/kanal-dışı paket fail-closed değil ama UYARI düştü", eski: "$u += \"paket lisans saticisinin", yeni: "$null = \"paket lisans saticisinin", kontrol: "lisans.eski-paket-uyarir-durmaz" },
      { ad: "H15 üretim kanalında varsayılana eşit satır yazılıyor (gecis.ps1 kuralı)", eski: "-and ($etkili -cne $vars)", yeni: "", kontrol: "lisans.uretim-kanali-satir-yazmaz" },
      { ad: "H16 F1 kayıt okuyucu eski kurulumun cevabını okumuyor (Tailscale düşer)", eski: ', @("kurulum\\cevap.json", "api"))', yeni: ")", kontrol: "ag.kayit-eski-cevaptan" },
      { ad: "H17 F1 onarımda cevap/varsayılan kayda yeğleniyor (erişim daralır)", eski: "    if ($kayit -and $null -ne $kayit[$a]) {", yeni: "    if ($false) {", kontrol: "ag.onarim-sessiz-kayit-korunur" },
      { ad: "H18 F2 başka köke bağlı hizmet geçiyor", eski: "    if (-not (YolKokAltinda $y $kok)) {", yeni: "    if ($false) {", kontrol: "hizmetkok.baska-kok-durur" },
      { ad: "H19 F2 ImagePath okunamazken geçiyor (fail-open)", eski: `  if (-not $p.Count -or "$($p[0])" -cnotmatch '^[A-Za-z]:\\\\') {`, yeni: "  if ($false) {", kontrol: "hizmetkok.okunamaz-durur" },
      { ad: "H20 F2 önek tuzağı (C:\\TeksERP ⊂ C:\\TeksERP-testfabrika)", eski: '$y.StartsWith($k + "\\", [StringComparison]::Ordinal)', yeni: "$y.StartsWith($k, [StringComparison]::Ordinal)", kontrol: "hizmetkok.baska-kok-durur" },
      { ad: "H21 F3 tek giriş eski paketi sınıflamıyor", eski: '  if ($e) { $s = $(if ((SurumKarsilastir $ku.surum $paketSurum) -eq 1)', yeni: '  if ($false) { $s = $(if ((SurumKarsilastir $ku.surum $paketSurum) -eq 1)', kontrol: "eskipaket.olcum-tek-giris" },
      { ad: "H22 F4-B tek işaret (yalnız geçiş günlüğü) GECISLI sayılıyor", eski: '  if (-not (ReparseMi (Join-Path $kok "current"))) { return $null }', yeni: "", kontrol: "gecisli.tek-isaret-yetmez-yabanci-eski-mesaj" },
      { ad: "H23 saat: etki alanındaki makineye dokunuluyor", eski: "  if ($etkiAlaninda) { return", yeni: "  if ($false) { return", kontrol: "saat.etki-alani-dokunmaz" },
      { ad: "H24 saat: kayıtlı NTP sunucusu ezilip varsayılana dönülüyor", eski: "$sunucu = $(if ($onceki.ntpSunucu) { $onceki.ntpSunucu } else", yeni: "$sunucu = $(if ($false) { $onceki.ntpSunucu } else", kontrol: "saat.kapali-ntp-acar" },
      { ad: "H25 saat: zaten NTP olan makine yeniden yapılandırılıyor", eski: "  if ($esitler -and $otomatik) { return", yeni: "  if ($false) { return", kontrol: "saat.zaten-ntp-dokunmaz" },
      { ad: "H26 saat: yalnız hizmeti elle başlayan NTP makinesi açılmıyor", eski: "  if ($esitler) { return [ordered]@{ eylem = \"HIZMET_OTOMATIK\"", yeni: "  if ($esitler) { return [ordered]@{ eylem = \"DOKUNMA\"", kontrol: "saat.ntp-hizmet-otomatik" },
      { ad: "H11 eski paket engeli düştü (yeni kurulu sürüme eski paket)", eski: "  if ($c -gt 0) { return \"bu kokte kurulu surum", yeni: "  if ($c -gt 1) { return \"bu kokte kurulu surum", kontrol: "kurulu.eski-paket-DUR" },
    ];
    // Ham dosya (CRLF çıkışında da): desenler TEK satırlık olmalı — "\n" içeren desen CRLF ağaçta bayat görünür.
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
  } else defter.atla("✓K harness sondaları", "pwsh 7 yok", 27);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
