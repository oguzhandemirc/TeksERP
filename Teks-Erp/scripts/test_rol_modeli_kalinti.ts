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
// eski istemci) bugün ÖLÇÜLEMEZ ve bu bir ihlal DEĞİLDİR — ama "ölçemedim" ile
// "temiz" aynı satıra düşerse kaldırma fazı ölçülmemiş bir zeminde açılır.
//
// ⚠️ KURULUM KOPYASINDA KOŞULUR (fabrika dump'ının kopyası). Fixture DB'de ①②③
// zaten 0'dır — orada yeşil olması "saha temiz" DEMEK DEĞİLDİR ve rapor bunu
// açıkça söyler: hedefin ADI her koşumda basılır.
// =============================================================================
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
  // ⚠️ BUGÜN ÖLÇÜLEMEZ ve bu ÖLÇÜLDÜ (2026-09-17): `Session` (`deviceType`,
  // `deviceId`, `lastSeenAt`) ve `Device` istemci SÜRÜMÜNÜ tutmuyor; şemada
  // `*version*` taşıyan altı alanın hiçbiri istemciye ait değil (`tokenVersion`
  // · `agentVersion` (toplayıcı) · `formulaVersion` ×2 · `TravelerCard.version`
  // · `PrintedDocument.version`). `client-policy` ucu da politikayı KODDAN
  // okur, istemcinin bildirdiği sürümü KAYDETMEZ.
  // ⇒ *Bir kapının koşulu "sahada X yok" ise, X'in sahada GÖRÜLDÜĞÜNÜ kaydeden
  //   bir yer olmalı; yoksa kapı ölçülemez ve ölçülemezlik BEYAN edilir.*
  kollar.set("④", "olculemedi");
  ATLAMA.atla("④ sahada 1.3.2 öncesi istemci",
    "ÖLÇÜLEMEDİ: istemci sürümü HİÇBİR YERDE kaydedilmiyor (`Session`/`Device` sürüm alanı yok, " +
    "`client-policy` istemcinin bildirdiğini saklamıyor) — kol açılması için oturum kaydına " +
    "`clientVersion` eklenmeli (ayrı dilim)", 1);

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
