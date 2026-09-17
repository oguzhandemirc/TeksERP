// =============================================================================
// İŞ ORTAĞI ROL MODELİ — KALDIRMA FAZI KAPISI (Faz 2 · dilim B)
// =============================================================================
// Koşum: npx tsx scripts/test_rol_modeli_kalinti.ts
//
// BU BEKÇİ HİÇBİR ŞEY KALDIRMAZ. Tek sorusu var: *kaldırma fazı (D) AÇILABİLİR Mİ?*
// Kaldırma migration'ları (`cari_accounts.subcontractorId` DROP · iki CHECK ·
// `Customer.type` DROP) ancak dört kol da yeşilken yazılabilir; biri kırmızıysa
// kaldırma SAHADA VERİ KAYBI ya da kırık istemci demektir.
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: uyumlu · ihlal · ÖLÇÜLEMEDİ. Dördüncü kol (sahadaki
// eski istemci) 2026-09-17'ye kadar HİÇ ölçülemiyordu; `Session.clientVersion`
// inince ölçülebilir oldu — ama hâlâ üç sonuçludur ve ÖLÇÜLEMEDİ'si üç ayrı
// sebepten doğar: ① pencere henüz dolmadı (alan N gün önce eklendi, oysa ondan
// önceki her oturum NULL) · ② pencerede hiç oturum yok (körlük zemini: "kimse
// girmemiş" ≠ "eski istemci yok") · ③ oturumların bir kısmı sürümsüz. "Ölçemedim"
// ile "temiz" aynı satıra düşerse kaldırma fazı ölçülmemiş bir zeminde açılır.
//
// ⚠️ KURULUM KOPYASINDA KOŞULUR (fabrika dump'ının kopyası). Fixture DB'de ①②③
// zaten 0'dır — orada yeşil olması "saha temiz" DEMEK DEĞİLDİR ve rapor bunu
// açıkça söyler: hedefin ADI her koşumda basılır.
// =============================================================================
import fs from "fs";
import path from "path";

import { ClientType } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { resolveCompanyType } from "../src/services/helpers/partner-roles.helper";
import { atlamaDefteri } from "./lib/atlama";
import { fixtureHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));
/** Kol adı → sonucu; rapor sonundaki hüküm bundan doğar. */
const kollar = new Map<string, "uyumlu" | "ihlal" | "olculemedi">();

/** ④ kolunun ölçüm penceresini BAŞLATAN migration — alanın doğduğu an. */
const SURUM_ALANI_MIGRATION = "20260917090000_session_client_version";

/**
 * Kaldırma fazının istemci eşikleri (`docs/design/IS-ORTAGI-ROL-MODELI.md` §153):
 * rol modelini konuşan İLK sürümler. Eşik bir POLİTİKA değildir — `minVersion`
 * sahayı kilitler, bu tablo yalnız "kaldırma açılabilir mi" sorusunu cevaplar.
 * WEB panel Electron ile aynı kaynaktan doğar, eşiği de aynıdır.
 */
const ESIK: Record<ClientType, string> = {
  [ClientType.ELECTRON]: "1.3.2",
  [ClientType.WEB]: "1.3.2",
  [ClientType.MOBILE]: "1.0.7",
};

/** Migration klasör adındaki damgayı (YYYYMMDDHHMMSS) tarihe çevir; klasör yoksa null. */
function migrationDamgasi(ad: string): Date | null {
  const dizin = path.resolve(__dirname, "../prisma/migrations", ad);
  if (!fs.existsSync(dizin)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(ad);
  if (!m) return null;
  const [, y, ay, g, s, d, sn] = m;
  return new Date(Date.UTC(+y, +ay - 1, +g, +s, +d, +sn));
}

/**
 * Sürüm kıyası (a<b → negatif). ⚠️ ÇÖZÜLEMEYEN ETİKET `null` DÖNER, 0 DEĞİL:
 * "1.3.2-rc1" gibi bir değeri sessizce "eşiğe eşit" saymak, kolun ihlali
 * GÖRMEDEN yeşil vermesi demekti (bu depoda tam bu sınıf birçok kez ısırdı).
 */
function surumKiyasla(a: string, b: string): number | null {
  const ayir = (v: string): number[] | null => {
    if (!/^\d+(\.\d+)*$/.test(v)) return null;
    return v.split(".").map(Number);
  };
  const pa = ayir(a), pb = ayir(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const fark = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (fark !== 0) return fark;
  }
  return 0;
}

async function main(): Promise<void> {
  console.log("=== İŞ ORTAĞI ROL MODELİ — KALINTI ÖLÇÜMÜ ===\n");
  // ⚠️ HEDEF ADIYLA BASILIR: bu bekçinin cevabı HEDEFE BAĞLIDIR. Fixture DB'de
  // yeşil olması sahanın temiz olduğunu söylemez ve rapor bunu gizlemez.
  const fixtureMi = fixtureHedefEngeli() === null;
  console.log(`🎯 Hedef: ${hedefDbAdi()}${fixtureMi ? "  (fixture — saha hükmü DEĞİL)" : "  (fixture kalıbı dışı — kurulum kopyası olabilir)"}\n`);

  // ── ① BAĞSIZ FASON PROFİLİ ───────────────────────────────────────────────
  // Tombstone HARİÇ: birleştirilmiş profil kendi kimliğini bırakmıştır, kart
  // beklenmez (göç betiği de ona kart üretmez — aynı ölçüt, tek yerde iki kez).
  const bagsiz = await prisma.subcontractor.findMany({
    where: { customerId: null, mergedIntoId: null },
    select: { code: true, name: true, isActive: true },
    orderBy: { code: "asc" },
  });
  kollar.set("①", bagsiz.length === 0 ? "uyumlu" : "ihlal");
  check("① BAĞSIZ fason profili YOK (tombstone hariç)", bagsiz.length === 0,
    bagsiz.length === 0 ? "0 profil" : bagsiz.map((b) => `${b.code}${b.isActive ? "" : "(pasif)"}`).join(", "));

  // ── ② FASONA BAĞLI CARİ HESAP ────────────────────────────────────────────
  // ⚠️ İKİ SINIF, TEK SAYI DEĞİL (ölçüldü 2026-09-17, D2 ile çelişki): göç,
  // birleştirdiği hesabı SİLMEZ — pasife çeker ve `subcontractorId`sini KORUR
  // (`cari_accounts_party_xor`: `customerId` de null olamaz). Yani hesabı
  // birleştirilmiş HER kurulumda bu sayı kalıcı olarak > 0'dır ve "0 olsun"
  // demek, göçün kendi izini ihlal saymaktır.
  //   • AKTİF fason hesabı → İHLAL: hâlâ kullanımda, kolon kaldırılamaz.
  //   • PASİF + çocuksuz + bakiyesiz → BİRLEŞME İZİ: kaldırma migration'ının
  //     DÜŞÜRECEĞİ satır. İhlal değil, ama sayısı RAPORLANIR — migration onu
  //     kaç satır sileceğini bilmeli.
  // ⇒ *Bir kaldırma kapısının ölçütü "hiç yok" değil, "kaldırılınca KAYIP YOK"tur.*
  const fasonHesap = await prisma.cariAccount.findMany({
    where: { subcontractorId: { not: null } },
    select: {
      id: true, isActive: true,
      subcontractor: { select: { code: true } },
      _count: { select: { transactions: true, invoices: true, payments: true, balances: true } },
    },
  });
  const doluMu = (h: (typeof fasonHesap)[number]): boolean =>
    h._count.transactions + h._count.invoices + h._count.payments + h._count.balances > 0;
  const canli = fasonHesap.filter((h) => h.isActive || doluMu(h));
  const iz = fasonHesap.filter((h) => !h.isActive && !doluMu(h));
  kollar.set("②", canli.length === 0 ? "uyumlu" : "ihlal");
  check("② KULLANIMDAKİ fason hesabı YOK (aktif ya da hareketli)", canli.length === 0,
    canli.length === 0
      ? `0 canlı · ${iz.length} birleşme izi (kaldırma migration'ı bu satırları düşürecek)`
      : canli.map((h) => `${h.subcontractor?.code ?? h.id}${h.isActive ? "(aktif)" : "(pasif ama HAREKETLİ)"}`).join(", "));

  // ── ③ `type` ⇄ BAYRAK TUTARLILIĞI ───────────────────────────────────────
  // ⚠️ TÜRETME KOPYALANMAZ: `resolveCompanyType` IMPORT edilir. SQL'de ikinci
  // bir türetme yazmak, kuralın iki tanımı demektir — biri değişir, öbürü
  // sessizce eski kalır ve bekçi YANLIŞ ŞEYİ onaylar.
  const kartlar = await prisma.customer.findMany({
    select: { code: true, type: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true },
  });
  const sapan = kartlar.filter((k) => k.type !== resolveCompanyType(k));
  kollar.set("③", sapan.length === 0 ? "uyumlu" : "ihlal");
  check("③ `Customer.type` BAYRAKLARDAN türetilmiş hâliyle tutarlı", sapan.length === 0,
    sapan.length === 0 ? `${kartlar.length} kart` : sapan.slice(0, 5).map((k) => `${k.code}: ${k.type}≠${resolveCompanyType(k)}`).join(", "));
  check("③z körlük zemini: ölçülecek kart VAR", kartlar.length > 0, `${kartlar.length} kart`);

  // ── ④ SAHADA ESKİ İSTEMCİ ────────────────────────────────────────────────
  // Artık ÖLÇÜLEBİLİR: `Session.clientVersion` (migration 20260917090000) giriş
  // anında istemcinin künye başlığından yazılır. Kol üç sonucu da üretebilir.
  //
  // ⚠️ PENCERE BAŞLANGICI ELLE YAZILMAZ — alanın eklendiği migration'ın KLASÖR
  // ADINDAN okunur. Elle sabit bir tarih yazsaydık, migration ertelenip başka
  // bir damgayla inince kol sessizce YANLIŞ bir pencereyi ölçerdi.
  //
  // ⚠️ ALAN EKLENMEDEN ÖNCEKİ HER OTURUM NULL'DUR. Bu yüzden damganın üstünden
  // 30 gün geçmeden hiçbir hüküm verilemez: pencere dolmamışken "kirli oturum
  // yok" demek, ölçülmemiş bir zemini temiz ilan etmektir.
  const pencereGun = 30;
  const alanDamgasi = migrationDamgasi(SURUM_ALANI_MIGRATION);
  const simdi = new Date();
  const pencereBasi = new Date(simdi.getTime() - pencereGun * 24 * 60 * 60 * 1000);

  if (alanDamgasi === null) {
    kollar.set("④", "olculemedi");
    ATLAMA.atla("④ sahada eski istemci",
      `ÖLÇÜLEMEDİ: \`${SURUM_ALANI_MIGRATION}\` migration klasörü YOK — pencere başlangıcı ` +
      "okunamıyor (alan bu kurulumda hiç inmemiş olabilir)", 1);
  } else if (alanDamgasi.getTime() > pencereBasi.getTime()) {
    const gun = Math.floor((simdi.getTime() - alanDamgasi.getTime()) / 86_400_000);
    kollar.set("④", "olculemedi");
    ATLAMA.atla("④ sahada eski istemci",
      `ÖLÇÜLEMEDİ: sürüm alanı ${gun} gün önce eklendi, ${pencereGun} günlük ölçüm penceresi ` +
      "HENÜZ DOLMADI — bu tarihten önceki tüm oturumlar NULL'dur, 'temiz' hükmü verilemez", 1);
  } else {
    // Penceredeki oturumlar: SON GÖRÜLME'ye göre (yoksa açılışa göre) — "sahada
    // hâlâ var mı" sorusu canlılığı sorar, ne zaman açıldığını değil.
    const oturumlar = await prisma.session.findMany({
      where: { OR: [{ lastSeenAt: { gte: pencereBasi } }, { lastSeenAt: null, createdAt: { gte: pencereBasi } }] },
      select: { deviceType: true, clientVersion: true, lastSeenAt: true, createdAt: true },
    });
    const surumsuz = oturumlar.filter((o) => o.clientVersion === null);
    const eski: string[] = [];
    const cozulemeyen: string[] = [];
    for (const o of oturumlar) {
      if (o.clientVersion === null) continue;
      const esik = ESIK[o.deviceType];
      const kiyas = surumKiyasla(o.clientVersion, esik);
      if (kiyas === null) cozulemeyen.push(`${o.deviceType}:${o.clientVersion}`);
      else if (kiyas < 0) eski.push(`${o.deviceType}:${o.clientVersion}<${esik}`);
    }
    const esikBeyani = Object.entries(ESIK).map(([k, v]) => `${k}≥${v}`).join(" · ");
    if (oturumlar.length === 0) {
      // ⚠️ KÖRLÜK ZEMİNİ: sıfır oturum "sahada eski istemci yok" DEĞİLDİR —
      // "kimse girmemiş"tir. Fixture DB'de tam olarak bu olur.
      kollar.set("④", "olculemedi");
      ATLAMA.atla("④ sahada eski istemci",
        `ÖLÇÜLEMEDİ: ${pencereGun} günlük pencerede HİÇ oturum yok — ölçülecek popülasyon boş`, 1);
    } else if (eski.length > 0) {
      kollar.set("④", "ihlal");
      check(`④ sahada eşiğin ALTINDA istemci YOK (${esikBeyani})`, false,
        `${eski.length} oturum: ${[...new Set(eski)].slice(0, 5).join(", ")}`);
    } else if (surumsuz.length > 0 || cozulemeyen.length > 0) {
      kollar.set("④", "olculemedi");
      ATLAMA.atla("④ sahada eski istemci",
        `ÖLÇÜLEMEDİ: ${surumsuz.length} oturum SÜRÜMSÜZ (künye başlığı göndermeyen istemci ya da ` +
        `alan inmeden önce açılmış oturum)` +
        (cozulemeyen.length > 0 ? ` · ${cozulemeyen.length} sürüm etiketi çözülemedi: ${[...new Set(cozulemeyen)].slice(0, 3).join(", ")}` : ""), 1);
    } else {
      kollar.set("④", "uyumlu");
      check(`④ sahada eşiğin ALTINDA istemci YOK (${esikBeyani})`, true,
        `${oturumlar.length} oturum, ${pencereGun} gün, 0 sürümsüz`);
    }
  }

  // ── HÜKÜM ───────────────────────────────────────────────────────────────
  const ihlal = [...kollar].filter(([, v]) => v === "ihlal").map(([k]) => k);
  const olculemedi = [...kollar].filter(([, v]) => v === "olculemedi").map(([k]) => k);
  console.log(`\n${"═".repeat(64)}`);
  if (ihlal.length > 0) console.log(`KALDIRMA FAZI: KAPALI — ihlal eden kol(lar): ${ihlal.join(", ")}`);
  else if (olculemedi.length > 0) console.log(`KALDIRMA FAZI: ÖLÇÜLEMEDİ — açık kol(lar): ${olculemedi.join(", ")} (diğerleri uyumlu)`);
  else console.log("KALDIRMA FAZI: AÇILABİLİR — dört kol da uyumlu");
  if (fixtureMi) console.log("⚠️ Bu hüküm FIXTURE hedefe aittir; saha kararı kurulum kopyasında koşularak verilir.");
  console.log("═".repeat(64));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
}

main()
  .catch((e) => { console.error("\n💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exit(fail > 0 ? 1 : 0);
  });
