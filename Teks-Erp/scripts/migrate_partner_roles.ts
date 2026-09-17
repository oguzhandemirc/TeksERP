// =============================================================================
// İŞ ORTAĞI ROL MODELİ — GÖÇ (D2, 2026-09-17)
// =============================================================================
// Koşum:  npx tsx scripts/migrate_partner_roles.ts            (KURU — varsayılan)
//         npx tsx scripts/migrate_partner_roles.ts --apply --canli-onay
//         … --baglan=<subId>:<custId>   (kullanıcı onaylı bağ, tekrarlanabilir)
//
// NE YAPAR (faz planı §D2):
//   (a) BAĞSIZ fason profilleri (`Subcontractor.customerId IS NULL`) için iş ortağı
//       kartı (`Customer`) üretir ve profili karta bağlar. Kod BACKEND üretir
//       (`MUS+GGAAYY+NNNN`) — elle kod YOK, `customer.service` tek yazardır.
//   (b) Fasona bağlı cari hesabı (`CariAccount.subcontractorId`) profilin kartına
//       taşır; kartın zaten hesabı varsa HAREKETLER o hesaba taşınır (defter satırı
//       SİLİNMEZ), bakiyeler TOPLANIR, eski hesap pasife çekilir.
//   (c) Etkilenen HER kaydı raporlar — kuru koşumda da, `--apply` sonrasında da.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ İKİ ŞEY BU BETİĞİN TASARIMINI BELİRLEDİ, İKİSİ DE ÖLÇÜLDÜ:
//
// ① `CariBalance` ONBİRİNCİ ÇOCUKTUR ve REPOINT'LENEMEZ. PK'sı `(cariId, currency)`;
//    hedef hesapta aynı para biriminde satır varsa `cariId` güncellemesi PK
//    çakışmasına düşer. Doğru işlem TOPLAMAdır — alan `applyCariBalanceTx`in
//    (`upsert` + `increment`) yürüttüğü denormalize bir toplamdır, yani deltaların
//    toplamı. Birleştirmede para birimi başına toplanır, kaynak satır silinir.
//    ⇒ *Bir ilişkiyi "çocuk" diye saymak yetmez; çocuğun KİMLİĞİ nedir diye sorulur.*
//
// ② HESAP ÇEVİRME TEK UPDATE OLMAK ZORUNDA. İki DB CHECK birlikte zorluyor:
//      `cari_accounts_party_xor`          → customerId + subcontractorId TAM BİRİ dolu
//      `cari_accounts_kind_matches_party` → kind ile dolu taraf tutarlı
//    "Önce customerId yaz, sonra subcontractorId'yi null'la" ARADA ihlal eder.
//    `customerId` + `subcontractorId: null` + `kind` AYNI ifadede yazılır.
//
// ⚠️ TOMBSTONE PROFİLE KART ÜRETİLMEZ (`mergedIntoId` dolu): birleştirilmiş profil
//    kendi kimliğini bırakmıştır; ona kart üretmek ölü bir kimliği diriltirdi.
//    Aynı sebeple `nameFold` eşleşmesinde tombstone kartlar ADAY DEĞİLDİR.
//
// ⚠️ AD ÇAKIŞMASINDA OTOMATİK BAĞLAMA YOK. Aynı katlanmış adı taşıyan bir kart
//    varsa betik ÖNERİ satırı basar ve DOKUNMAZ; bağ ancak `--baglan=<subId>:<custId>`
//    ile, kullanıcının kararıyla kurulur. "Aynı ada sahip" ile "aynı firma" AYNI ŞEY
//    DEĞİLDİR ve yanlış bağ, iki firmanın defterini birleştirir — geri alınamaz.
//
// ⚠️ İDEMPOTENT: ikinci koşum 0 değişiklik bildirir. Göç betiği bir kez koşan bir
//    komut değil, gerektiğinde tekrar koşulabilen bir DURUM İDDİASIdır.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { CariKind, Prisma } from "@prisma/client";
import { CustomerService } from "../src/services/customer.service";
import { AuditService } from "../src/services/audit.service";
import { resolveCompanyType, type PartnerRoles } from "../src/services/helpers/partner-roles.helper";
import { fixtureHedefEngeli, hedefDbAdi, YAZILMASI_YASAK_DB } from "./lib/hedef-db-kapisi";
import { COCUKLAR } from "./lib/cari-cocuk-baglari";

/**
 * ⚠️ SERVİS BURADA KURULUR, `routes`TAN IMPORT EDİLMEZ (ölçüldü 2026-09-17):
 * `routes/customer.routes` express router'ını ve dört alt route dosyasını
 * çeker; script o zinciri import edince ilk `console.log`a BİLE ulaşmadan
 * asılıyordu (5 dk timeout, 0 satır çıktı). Bir CLI betiğinin HTTP katmanına
 * ihtiyacı yoktur.
 * ⇒ *Bir servisi route dosyasından almak, o route'un bütün yan etkilerini de
 *   almaktır; betik yalnız servisi ister.*
 *
 * Yapılandırma `customer.routes`takinin İŞLEVSEL alt kümesidir: kod üretimi ve
 * doğrulamalar için gereken alanlar (arama alanları betikte kullanılmaz).
 */
const customerService = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "müşteri",
});

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");
/** `--baglan=<subId>:<custId>` — kullanıcının onayladığı bağlar. */
const ELLE_BAGLAR = new Map<string, string>(
  process.argv
    .filter((a) => a.startsWith("--baglan="))
    .map((a) => a.slice("--baglan=".length).split(":"))
    .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]) && Boolean(p[1]))
    .map(([s, c]) => [s, c]),
);

// ── HEDEF BEYANI ve KAPILAR ─────────────────────────────────────────────────
// ⚠️ BU BETİK FABRİKADA KOŞAR — `fixtureHedefEngeli`yi SERT KAPI yapmak onu
// amacından ederdi. Katmanlar bu yüzden şöyle:
//   • hedef her koşumda ADIYLA basılır (kuru koşumda da),
//   • `--apply` + fixture OLMAYAN hedef → `--canli-onay` ŞART (ikinci bilinçli adım),
//   • üretim adları (`YAZILMASI_YASAK_DB`) → `--canli-onay` ile bile RED.
// ⇒ *Bir kapının sertliği, betiğin MEŞRU kullanımıyla ölçülür: meşru kullanımı
//   imkânsız kılan kapı, ilk sıkışmada susturulur.*
console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
if (YAZILMASI_YASAK_DB.has(hedefDbAdi())) {
  console.error(`\n⛔ DURDURULDU — '${hedefDbAdi()}' üretim/kopya adı; bu betik oraya YAZMAZ.\n`);
  process.exit(1);
}
const fixtureDisi = fixtureHedefEngeli();
if (APPLY && fixtureDisi && !CANLI_ONAY) {
  console.error(`\n⛔ --apply DURDURULDU — hedef fixture kalıbında değil.`);
  console.error(`   ${fixtureDisi}`);
  console.error(`   Fabrikada bilerek koşuyorsan: --apply --canli-onay\n`);
  process.exit(1);
}
if (APPLY && fixtureDisi) {
  console.warn(`⚠️  CANLI HEDEFTE GÖÇ — ${hedefDbAdi()} (--canli-onay ile)\n`);
}

// ── RAPOR ───────────────────────────────────────────────────────────────────
interface Satir { tur: string; detay: string }
const rapor: Satir[] = [];
let degisiklik = 0;
const yaz = (tur: string, detay: string, sayilir = true): void => {
  rapor.push({ tur, detay });
  if (sayilir) degisiklik++;
};

/**
 * Profilden kart alanları — YALNIZ API'nin yazdığı alanlar.
 * ⚠️ `phone → contactPhone`: adlar iki tabloda FARKLI.
 *
 * ⚠️ ROL BAYRAKLARI BURADA DEĞİL (ölçüldü 2026-09-17): `isSubcontractorRole` API
 * gövdesinden YAZILAMAZ (D1 kararı) ve `sanitizeWriteData` tanımadığı anahtarı
 * SESSİZCE DÜŞÜRÜR — gövdeye koysaydık kod derlenir, koşar ve bayrak hiç
 * yazılmazdı. Kart doğduktan SONRA Prisma ile doğrudan yazılır (aşağıda).
 * ⇒ *Bir alanın gövdeye konabilmesi, yazılacağı anlamına gelmez; sessiz allowlist
 *   tam olarak burada ısırır.*
 */
function kartVerisi(p: { name: string; taxNumber: string | null; phone: string | null; address: string | null; isActive: boolean }): Record<string, unknown> {
  return {
    name: p.name,
    taxNumber: p.taxNumber,
    contactPhone: p.phone,
    address: p.address,
    isActive: p.isActive,
  };
}

/**
 * Yeni kartın ROLLERİ — fason profili karşılığı kart TEDARİKÇİ + FASON rolüyle
 * doğar; MÜŞTERİ rolü YOK (bu firmadan mal alıyoruz, ona satmıyoruz).
 * `type` ELLE yazılmaz: `resolveCompanyType` tek yazardır (D1).
 */
const YENI_KART_ROLLERI: PartnerRoles = { isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true };

async function main(): Promise<void> {
  console.log(APPLY ? "── MOD: UYGULA (--apply) ──" : "── MOD: KURU KOŞUM (varsayılan) ──\n");

  // ═══ (a) BAĞSIZ PROFİLLER ═══════════════════════════════════════════════
  const bagsiz = await prisma.subcontractor.findMany({
    where: { customerId: null },
    select: { id: true, code: true, name: true, nameFold: true, taxNumber: true, phone: true, address: true, isActive: true, mergedIntoId: true },
    orderBy: { code: "asc" },
  });
  console.log(`(a) bağsız fason profili: ${bagsiz.length}`);

  for (const p of bagsiz) {
    if (p.mergedIntoId) {
      yaz("ATLANDI", `profil ${p.code} "${p.name}" — birleştirilmiş (tombstone), kart üretilmez`, false);
      continue;
    }
    const elleHedef = ELLE_BAGLAR.get(p.id);
    // ⚠️ VERGİ NO ÇAKIŞMASI — ÖNERİ, ÇÖKME DEĞİL (ölçüldü 2026-09-17): kart üretimi
    // aynı vergi numarasını ikinci bir müşteride REDDEDER (409). İlk yazımda bu
    // istisna bütün göçü ORTASINDA düşürüyordu: bir kısım profil kart almış, bir
    // kısmı almamış oluyordu — göç betiği için EN KÖTÜ SONUÇ budur.
    // ⇒ *Bir göçte tekil bir kaydın reddi, diğer kayıtların göçünü durdurmaz;
    //   durdurursa operatör "yarısı yapılmış" bir veritabanıyla kalır.*
    // Ayrıca vergi no eşleşmesi, ad eşleşmesinden DAHA GÜÇLÜ bir "aynı firma"
    // kanıtıdır — bu yüzden kendi ÖNERİ sınıfı var.
    const vergiSahibi = !elleHedef && p.taxNumber
      ? await prisma.customer.findFirst({
          where: { taxNumber: p.taxNumber, mergedIntoId: null },
          select: { id: true, code: true, name: true, subcontractor: { select: { id: true } } },
        })
      : null;
    if (vergiSahibi) {
      yaz("ÖNERİ (vergi no)",
        `profil ${p.code} "${p.name}" ↔ kart ${vergiSahibi.code} "${vergiSahibi.name}" (AYNI VERGİ NO ${p.taxNumber})` +
        (vergiSahibi.subcontractor ? " — ⚠️ kart ZATEN bir profile bağlı; vergi no düzeltilmeli" : ` — bağlamak için: --baglan=${p.id}:${vergiSahibi.id}`),
        false);
      continue;
    }
    // Aday kart: AYNI katlanmış ad, tombstone DEĞİL, henüz profili OLMAYAN.
    const aday = p.nameFold
      ? await prisma.customer.findFirst({
          where: { nameFold: p.nameFold, mergedIntoId: null, subcontractor: null },
          select: { id: true, code: true, name: true },
        })
      : null;

    if (elleHedef) {
      const hedef = await prisma.customer.findUnique({
        where: { id: elleHedef },
        select: { id: true, code: true, name: true, mergedIntoId: true, subcontractor: { select: { id: true } } },
      });
      if (!hedef) { yaz("HATA", `--baglan ${p.code}: kart ${elleHedef} YOK`, false); continue; }
      if (hedef.mergedIntoId) { yaz("HATA", `--baglan ${p.code}: kart ${hedef.code} birleştirilmiş (tombstone)`, false); continue; }
      if (hedef.subcontractor) { yaz("HATA", `--baglan ${p.code}: kart ${hedef.code} zaten bir profile bağlı`, false); continue; }
      yaz("BAĞ (elle onaylı)", `profil ${p.code} "${p.name}" → kart ${hedef.code} "${hedef.name}"`);
      if (APPLY) {
        await prisma.subcontractor.update({ where: { id: p.id }, data: { customerId: hedef.id } });
        await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "SUBCONTRACTOR", recordId: p.id, newData: { customerId: hedef.id, kaynak: "migrate_partner_roles --baglan" } });
      }
      continue;
    }

    if (aday) {
      // ⚠️ ÖNERİ, İŞLEM DEĞİL: aynı ad aynı firma DEMEK DEĞİLDİR.
      yaz("ÖNERİ", `profil ${p.code} "${p.name}" ↔ kart ${aday.code} "${aday.name}" (aynı ad) — bağlamak için: --baglan=${p.id}:${aday.id}`, false);
      continue;
    }

    yaz("YENİ KART", `profil ${p.code} "${p.name}" → yeni kart (kod backend üretir)`);
    if (APPLY) {
      const sonuc = await customerService.create(kartVerisi(p));
      const kartId = String((sonuc.data as { id?: string }).id ?? "");
      if (!kartId) throw new Error(`Kart üretilemedi: ${p.code}`);
      await prisma.customer.update({
        where: { id: kartId },
        data: { ...YENI_KART_ROLLERI, type: resolveCompanyType(YENI_KART_ROLLERI) },
      });
      await prisma.subcontractor.update({ where: { id: p.id }, data: { customerId: kartId } });
      await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "SUBCONTRACTOR", recordId: p.id, newData: { customerId: kartId, kaynak: "migrate_partner_roles" } });
    }
  }

  await hesaplariTasi();

  // ═══ (c) RAPOR ══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}\nRAPOR — ${APPLY ? "UYGULANDI" : "KURU KOŞUM (hiçbir şey yazılmadı)"}`);
  if (rapor.length === 0) console.log("  (etkilenen kayıt YOK — göç zaten uygulanmış)");
  for (const r of rapor) console.log(`  ${r.tur.padEnd(18)} ${r.detay}`);
  // ── ÖZET: prova beklentisiyle KARŞILAŞTIRILABİLİR sayılar ────────────────
  // ⚠️ Rapor satırları okunur ama SAYILMAZ; provayı koşan kişi "8 kart bekliyordum,
  // 8 mi çıktı" sorusunu tek bakışta cevaplayabilmeli.
  const say = (t: string): number => rapor.filter((r) => r.tur === t).length;
  const roller = await prisma.customer.groupBy({ by: ["isCustomerRole", "isSupplierRole", "isSubcontractorRole"], _count: true });
  const rolToplam = (anahtar: "isCustomerRole" | "isSupplierRole" | "isSubcontractorRole"): number =>
    roller.filter((r) => r[anahtar]).reduce((a, r) => a + r._count, 0);
  console.log(`\n  ÖZET`);
  console.log(`    yeni kart          : ${say("YENİ KART")}`);
  console.log(`    elle bağ           : ${say("BAĞ (elle onaylı)")}`);
  console.log(`    öneri (ad)         : ${say("ÖNERİ")}`);
  console.log(`    öneri (vergi no)   : ${say("ÖNERİ (vergi no)")}`);
  console.log(`    atlanan (tombstone): ${say("ATLANDI")}`);
  console.log(`    hesap çevrildi     : ${say("HESAP ÇEVRİLDİ")}`);
  console.log(`    hesap birleşti     : ${say("HESAP BİRLEŞTİ")}`);
  console.log(`    zaten birleşmiş    : ${say("ZATEN BİRLEŞTİRİLMİŞ")}`);
  console.log(`    hata               : ${say("HATA")}`);
  console.log(`    kart rolleri (M/T/F): ${rolToplam("isCustomerRole")}/${rolToplam("isSupplierRole")}/${rolToplam("isSubcontractorRole")}`);
  console.log(`\n  DEĞİŞİKLİK: ${degisiklik}${degisiklik === 0 ? "  ⇒ idempotent (ikinci koşum)" : ""}`);
  console.log(`${"═".repeat(70)}\n`);
}

// ── (b) CARİ HESAP TAŞIMA ───────────────────────────────────────────────────
/** Cari hesabı gösteren model+alan çiftleri — tek kaynak `lib/cari-cocuk-baglari.ts`. */

/** Bir hesabın para birimi bazında bakiyesi — taşıma öncesi/sonrası karşılaştırması için. */
async function bakiyeOzeti(cariIds: string[]): Promise<Map<string, string>> {
  const rows = await prisma.cariBalance.findMany({ where: { cariId: { in: cariIds } }, select: { currency: true, balance: true } });
  const toplam = new Map<string, Prisma.Decimal>();
  for (const r of rows) toplam.set(r.currency, (toplam.get(r.currency) ?? new Prisma.Decimal(0)).plus(r.balance));
  return new Map([...toplam].map(([k, v]) => [k, v.toFixed(2)]));
}

async function hesaplariTasi(): Promise<void> {
  const fasonHesaplar = await prisma.cariAccount.findMany({
    where: { subcontractorId: { not: null } },
    select: {
      id: true, kind: true, isActive: true, subcontractorId: true,
      subcontractor: { select: { id: true, code: true, name: true, customerId: true } },
    },
  });
  console.log(`(b) fasona bağlı cari hesap: ${fasonHesaplar.length}`);

  for (const h of fasonHesaplar) {
    const profil = h.subcontractor;
    if (!profil) { yaz("HATA", `hesap ${h.id}: profil çözülemedi`, false); continue; }
    // (a) kuru koşumda kart ÜRETMEDİ ⇒ bağ da yok. Bu bir arıza değil, kuru
    // koşumun doğasıdır ve BEYAN EDİLİR: rapor "kart üretildikten sonra" der.
    if (!profil.customerId) {
      yaz("SONRAKİ ADIM", `hesap ${h.id} — profil ${profil.code} henüz karta bağlı değil; kart üretildikten SONRA taşınır`, false);
      continue;
    }
    const kartHesabi = await prisma.cariAccount.findUnique({ where: { customerId: profil.customerId }, select: { id: true } });

    if (!kartHesabi) {
      // ── ÇEVİRME: tek UPDATE (dosya başlığı ②) ────────────────────────────
      yaz("HESAP ÇEVRİLDİ", `hesap ${h.id} (profil ${profil.code}) → kart ${profil.customerId}; kind SUBCONTRACTOR→CUSTOMER`);
      if (APPLY) {
        await prisma.cariAccount.update({
          where: { id: h.id },
          // ⚠️ ÜÇÜ BİR ARADA: `cari_accounts_party_xor` + `cari_accounts_kind_matches_party`
          // iki adımlık bir yazımı ARADA reddeder.
          data: { customerId: profil.customerId, subcontractorId: null, kind: CariKind.CUSTOMER },
        });
        await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: h.id, newData: { customerId: profil.customerId, subcontractorId: null, kind: "CUSTOMER", kaynak: "migrate_partner_roles" } });
      }
      continue;
    }

    // ── BİRLEŞTİRME: hareketler kart hesabına, bakiyeler TOPLANIR ──────────
    const sayim: Record<string, number> = {};
    for (const c of COCUKLAR) {
      sayim[`${c.model}.${c.alan}`] = await (prisma as any)[c.model].count({ where: { [c.alan]: h.id } });
    }
    const toplamHareket = Object.values(sayim).reduce((a, b) => a + b, 0);
    const kalanBakiye = await prisma.cariBalance.count({ where: { cariId: h.id } });
    // ⚠️ İDEMPOTENTLİK BURADA KAZANILIR (ölçüldü 2026-09-17): birleştirme SONRASI
    // eski hesap `subcontractorId`sini KORUR — koruyamazsa `cari_accounts_party_xor`
    // ihlal olur (customerId da null). Yani sorgu onu HER KOŞUMDA yeniden bulur.
    // Ayırt eden şey BAYRAK DEĞİL BOŞLUKtur: pasif + hiç çocuk + hiç bakiye =
    // taşınacak bir şey kalmamış, yani bu satır BİRLEŞMENİN İZİdir.
    // ⇒ *İdempotentlik "daha önce koştum" bayrağıyla değil, DURUMUN KENDİSİYLE
    //   ölçülür; bayrak kaybolur, durum kalır.*
    if (!h.isActive && toplamHareket === 0 && kalanBakiye === 0) {
      yaz("ZATEN BİRLEŞTİRİLMİŞ", `hesap ${h.id} (profil ${profil.code}) — pasif, çocuk yok, bakiye yok`, false);
      continue;
    }
    const oncesi = await bakiyeOzeti([h.id, kartHesabi.id]);
    yaz("HESAP BİRLEŞTİ",
      `hesap ${h.id} (profil ${profil.code}) → kart hesabı ${kartHesabi.id}; hareket ${toplamHareket} ` +
      `[${Object.entries(sayim).filter(([, n]) => n > 0).map(([m, n]) => `${m}:${n}`).join(" ") || "yok"}] ` +
      `bakiye önce {${[...oncesi].map(([c, v]) => `${c}:${v}`).join(" ") || "—"}}`);

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      for (const c of COCUKLAR) {
          await (tx as any)[c.model].updateMany({ where: { [c.alan]: h.id }, data: { [c.alan]: kartHesabi.id } });
      }
      // ⚠️ BAKİYE TOPLANIR, TAŞINMAZ (dosya başlığı ①).
      const kaynakBakiye = await tx.cariBalance.findMany({ where: { cariId: h.id } });
      for (const b of kaynakBakiye) {
        await tx.cariBalance.upsert({
          where: { cariId_currency: { cariId: kartHesabi.id, currency: b.currency } },
          create: { cariId: kartHesabi.id, currency: b.currency, balance: b.balance },
          update: { balance: { increment: b.balance } },
        });
      }
      await tx.cariBalance.deleteMany({ where: { cariId: h.id } });
      // ⚠️ DEFTER SATIRI SİLİNMEZ — eski hesap PASİFE çekilir ve izi kalır.
      await tx.cariAccount.update({ where: { id: h.id }, data: { isActive: false } });
      // ⚠️ DEFTER SATIRININ İÇERİĞİNE DOKUNULMAZ (ölçüldü 2026-09-17):
      // `CariTransaction`da `note` diye bir alan YOK; tek aday `description` ve o
      // KULLANICIYA GÖRÜNEN içeriktir (ekstrede basılır). Göç izini oraya yazmak,
      // muhasebecinin yazdığı açıklamanın yerine sistem metni koymak olurdu.
      // Taşımanın izi AUDIT'tedir (aşağıda, hesap başına: hedef hesap + hareket
      // sayısı). ⇒ *Bir satırın POINTER'ını taşımak ile İÇERİĞİNİ değiştirmek
      // ayrı işlerdir; göç yalnız ilkini yapar.*
    });
    const sonrasi = await bakiyeOzeti([h.id, kartHesabi.id]);
    const esit = JSON.stringify([...oncesi].sort()) === JSON.stringify([...sonrasi].sort());
    yaz(esit ? "BAKİYE EŞİT" : "⚠️ BAKİYE AYRIŞTI",
      `${[...sonrasi].map(([c, v]) => `${c}:${v}`).join(" ") || "—"} ${esit ? "(önce = sonra)" : "← İNCELE"}`, false);
    await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CARI_ACCOUNT", recordId: h.id, newData: { birlestirildi: kartHesabi.id, hareket: toplamHareket, kaynak: "migrate_partner_roles" } });
  }
}

main()
  .catch((e) => { console.error("\n💥 ÇÖKTÜ:", e); process.exitCode = 1; })
  .finally(async () => {
    // ⚠️ `$disconnect()` YETMEZ ve bu ÖLÇÜLDÜ (2026-09-17): çıplak bir prisma
    // import'u + `$disconnect()` sonrasında bile ÜÇ açık `Socket` kalıyor
    // (`src/lib/prisma` ayrıca bir `pg` havuzu kurar). Süreç kendiliğinden
    // çıkmaz — betik "asıldı" görünür; oysa işi bitmiştir.
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
