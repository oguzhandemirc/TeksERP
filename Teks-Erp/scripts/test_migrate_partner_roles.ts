// =============================================================================
// GÖÇ BEKÇİSİ — `migrate_partner_roles.ts` (D2)
// =============================================================================
// Koşum: npx tsx scripts/test_migrate_partner_roles.ts
//
// NEDEN BU BEKÇİ VAR: göç betiğini KULLANICI, FABRİKADA, BİR KEZ koşacak. Yanlış
// çalışırsa geri dönüş yolu "yedekten restore"dur. Yani betiğin doğruluğu sahada
// DEĞİL burada ölçülmek zorunda.
//
// ÜÇ SENARYO + İKİ DEĞİŞMEZ:
//   ① BAĞSIZ profil        → yeni kart + bağ + ROL BAYRAKLARI
//   ② BAĞLI profil         → dokunulmaz (idempotentliğin temeli)
//   ③ HESAPLI profil, kartın hesabı VAR → hareketler taşınır, BAKİYE TOPLANIR
//   ④ AD ÇAKIŞMASI         → ÖNERİ satırı, BAĞLAMAZ
//   ⑤ İKİNCİ KOŞUM         → 0 değişiklik
//
// ⚠️ ASIL DEĞİŞMEZ BAKİYEDİR: "hareket taşındı" bir sayıdır, "bakiye önce = sonra"
// bir KURALDIR. Hareket sayısını ölçen ama bakiyeyi ölçmeyen bir bekçi, taşımanın
// yarısını yapan bir betiği yeşil geçirir.
//
// ⚠️ ROL BAYRAĞI AYRICA ÖLÇÜLÜR (ve bu kol ölçüldükten sonra yazıldı): bayraklar
// API gövdesinden YAZILAMAZ; gövdeye konsaydı `sanitizeWriteData` onları SESSİZCE
// düşürür ve betik "çalışıyor" görünürdü. Kart üretimi bayrakları Prisma ile
// doğrudan yazar; kol o yazımın gerçekten olduğunu ölçer.
// =============================================================================
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { CariKind, CompanyType, Currency } from "@prisma/client";
// ⚠️ `toLocaleUpperCase("tr")` YASAK (yasak listesi) — katlama TEK KAYNAKTAN.
import { upperTr } from "../src/utils/tr-case";
import { readFileSync } from "node:fs";
import { cocukOrtami, fixtureHedefEngeli, hedefDbAdi, YAZILMASI_YASAK_DB } from "./lib/hedef-db-kapisi";
import { COCUKLAR } from "./lib/cari-cocuk-baglari";

const engel = fixtureHedefEngeli();
if (engel) { console.error(`\n⛔ DURDURULDU — ${engel}\n`); process.exit(1); }
console.log(`🎯 Hedef: ${hedefDbAdi()}\n`);

const PRE = `TESTGOC-${Date.now().toString(36).toUpperCase()}`;
/** ⚠️ ÇAKIŞMASIZ vergi no: sabit bir numara ortamdaki başka bir kartla çakışır ve
 *  kart üretimi 409 verir (ölçüldü 2026-09-17: sabit numaralı fikstür, ortamda
 *  aynı numarayı taşıyan bir kart bulununca göçü ORTASINDA düşürdü). */
const VERGI_NO = String(Date.now()).slice(-10);
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

/** Göç betiğini koştur. ⚠️ `cocukOrtami`: kaçış anahtarı MİRAS KALMAZ. */
function goc(...ek: string[]): string {
  const r = spawnSync("npx", ["tsx", join(__dirname, "migrate_partner_roles.ts"), ...ek], {
    encoding: "utf8", env: cocukOrtami(), timeout: 180_000,
  });
  const cikti = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // ⚠️ ÇOCUĞUN DÜŞTÜĞÜ SESSİZ KALMASIN: çıkış kodu 0 değilse ya da hiç çıktı
  // yoksa, bunu ölçen kol "rapor satırı yok" diye YANLIŞ hikâye anlatırdı.
  if (r.status !== 0 || cikti.trim() === "") {
    console.error(`   ⚠️ göç çocuğu: exit=${r.status} signal=${r.signal ?? "-"} çıktı=${cikti.length}B`);
    if (r.error) console.error(`   ⚠️ hata: ${r.error.message}`);
    console.error(cikti.split("\n").slice(-6).map((l) => `      | ${l}`).join("\n"));
  }
  return cikti;
}

const kurulan = { sub: [] as string[], cust: [] as string[], cari: [] as string[] };

async function main(): Promise<void> {
  // ── §0 ÇOCUK TABLOSU ŞEMAYLA BİREBİR (İKİ YÖNLÜ) ─────────────────────────
  // ⚠️ BU KOL BİR ÇÖKMEDEN DOĞDU: tablo ELLE yazılmıştı ve `ChequeEvent`in bağı
  // `counterCariId` olduğu için betik `Unknown argument cariId` ile çöktü;
  // `Cheque.endorsedToCariId` ise hiç listede değildi — o sessizce eksik kalırdı
  // (bakiye doğru, bağ yanlış). ⇒ *Bir ilişki listesi elle yazılmaz, şemadan ölçülür.*
  {
    const sema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
    const semadaki = new Set<string>();
    for (const m of sema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const [, model, govde] = m;
      for (const a of govde!.matchAll(/^\s*(\w*[cC]ariId)\s+\S/gm)) {
        if (model === "CariBalance") continue; // TOPLANIR, taşınmaz (ayrı yol)
        semadaki.add(`${model![0]!.toLowerCase()}${model!.slice(1)}.${a[1]}`);
      }
    }
    const beyan = new Set(COCUKLAR.map((c) => `${c.model}.${c.alan}`));
    const eksik = [...semadaki].filter((x) => !beyan.has(x)).sort();
    const fazla = [...beyan].filter((x) => !semadaki.has(x)).sort();
    check("§0 ⭐ çocuk tablosu ŞEMAYLA BİREBİR (eksik bağ da, ölü bağ da kırmızı)",
      eksik.length === 0 && fazla.length === 0,
      [eksik.length ? `BEYANSIZ: ${eksik.join(", ")}` : "", fazla.length ? `ŞEMADA YOK: ${fazla.join(", ")}` : ""].filter(Boolean).join(" · ") || `${beyan.size} bağ`);
    check("§0z körlük zemini: şema taraması bir şey buldu", semadaki.size >= 8, `${semadaki.size} bağ`);
  }

  // ── §H `--apply` HEDEF KAPILARI ──────────────────────────────────────────
  // ⚠️ Bu betiği KULLANICI FABRİKADA koşacak ⇒ `fixtureHedefEngeli` SERT kapı
  // OLAMAZ (meşru kullanımı imkânsız kılan kapı ilk sıkışmada susturulur). Onun
  // yerine İKİ BİLİNÇLİ ADIM: fixture dışı hedefte `--apply` tek başına yetmez,
  // `--canli-onay` şarttır; üretim adları ise onayla BİLE geçmez.
  {
    const hedefle = (db: string, ...ek: string[]): { cikti: string; kod: number | null } => {
      const r = spawnSync("npx", ["tsx", join(__dirname, "migrate_partner_roles.ts"), ...ek], {
        encoding: "utf8", timeout: 120_000,
        env: cocukOrtami({ DATABASE_URL: `postgresql://u:p@localhost:55433/${db}` }),
      });
      return { cikti: `${r.stdout ?? ""}${r.stderr ?? ""}`, kod: r.status };
    };
    // ⚠️ FABRİKA DB ADI BURAYA YAZILMAZ (`test_kimlik_sizintisi §1` ısırdı ve
    // haklıydı): kolun ihtiyacı "fixture kalıbı DIŞINDA bir ad"dır, gerçek
    // fabrika adının kendisi DEĞİL. ⇒ *Bir sondanın gerçek bir kimliğe ihtiyacı
    // varsa, o kimliği yazmak yerine SINIFINI üret.*
    const FIXTURE_DISI_AD = "tekserp_gocsonda_kopya";
    const kuruFixtureDisi = hedefle(FIXTURE_DISI_AD);
    // ⚠️ ÇIKIŞ KODUNA BAKMIYORUZ ve sebebi ÖLÇÜLDÜ: sahte kimlikle (`u:p`) bağlantı
    // zaten `AuthenticationFailed` verir ve süreç 1 döner — bu KAPININ değil
    // BAĞLANTININ sonucudur. Kolun iddiası "kapı DURDURMADI"dır ve o, reddin
    // METNİNİN YOKLUĞUYLA ölçülür. ⇒ *Bir kapıyı çıkış koduyla ölçmek, aynı kodu
    // üreten her şeyi kapıya mal etmektir.*
    check("§H1 KURU koşum fixture dışı hedefte KAPIYA TAKILMAZ (hedefi ADIYLA basar)",
      kuruFixtureDisi.cikti.includes(FIXTURE_DISI_AD)
      && !kuruFixtureDisi.cikti.includes("--canli-onay")
      && !/üretim\/kopya adı/.test(kuruFixtureDisi.cikti),
      `exit=${kuruFixtureDisi.kod} (bağlantı hatası kapı DEĞİLDİR)`);
    const applyOnaysiz = hedefle(FIXTURE_DISI_AD, "--apply");
    check("§H2 ⭐ `--apply` fixture DIŞI hedefte `--canli-onay` OLMADAN DURDU",
      applyOnaysiz.kod === 1 && applyOnaysiz.cikti.includes("--canli-onay"), `exit=${applyOnaysiz.kod}`);
    const uretim = hedefle([...YAZILMASI_YASAK_DB][0] ?? "tekserp", "--apply", "--canli-onay");
    check("§H3 ⭐ ÜRETİM adı `--canli-onay` ile BİLE reddedildi",
      uretim.kod === 1 && /üretim\/kopya adı/.test(uretim.cikti), `exit=${uretim.kod}`);
  }

  // ── FİKSTÜR ───────────────────────────────────────────────────────────────
  const bagsiz = await prisma.subcontractor.create({
    data: { code: `${PRE}-A`, name: `${PRE} Bagsiz Fason`, taxNumber: VERGI_NO, phone: "05551112233", address: "Bagsiz Mah." },
    select: { id: true, code: true },
  });
  kurulan.sub.push(bagsiz.id);

  const bagliKart = await prisma.customer.create({
    data: { code: `${PRE}-C1`, name: `${PRE} Bagli Kart`, isCustomerRole: true, type: CompanyType.CUSTOMER },
    select: { id: true },
  });
  kurulan.cust.push(bagliKart.id);
  const bagli = await prisma.subcontractor.create({
    data: { code: `${PRE}-B`, name: `${PRE} Bagli Fason`, customerId: bagliKart.id },
    select: { id: true },
  });
  kurulan.sub.push(bagli.id);

  // ③ hesaplı: profilin hesabı VAR, kartın da hesabı VAR (birleştirme yolu)
  const hesapliKart = await prisma.customer.create({
    data: { code: `${PRE}-C2`, name: `${PRE} Hesapli Kart`, isCustomerRole: true, type: CompanyType.CUSTOMER },
    select: { id: true },
  });
  kurulan.cust.push(hesapliKart.id);
  const hesapli = await prisma.subcontractor.create({
    data: { code: `${PRE}-D`, name: `${PRE} Hesapli Fason`, customerId: hesapliKart.id },
    select: { id: true },
  });
  kurulan.sub.push(hesapli.id);
  const kartHesap = await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: hesapliKart.id }, select: { id: true } });
  const fasonHesap = await prisma.cariAccount.create({ data: { kind: CariKind.SUBCONTRACTOR, subcontractorId: hesapli.id }, select: { id: true } });
  kurulan.cari.push(kartHesap.id, fasonHesap.id);
  // ⚠️ AYNI PARA BİRİMİNDE İKİ BAKİYE — `CariBalance` PK'sı `(cariId, currency)`;
  // repoint edilseydi tam burada PK çakışması olurdu. Senaryonun TAM SEBEBİ bu.
  await prisma.cariBalance.create({ data: { cariId: kartHesap.id, currency: Currency.TRY, balance: "100.00" } });
  await prisma.cariBalance.create({ data: { cariId: fasonHesap.id, currency: Currency.TRY, balance: "250.00" } });
  await prisma.cariBalance.create({ data: { cariId: fasonHesap.id, currency: Currency.USD, balance: "40.00" } });

  // ④ ad çakışması: aynı ada sahip BAĞSIZ profil + kart
  const cakismaKart = await prisma.customer.create({
    data: { code: `${PRE}-C3`, name: `${PRE} Ayni Ad`, isCustomerRole: true, type: CompanyType.CUSTOMER },
    select: { id: true },
  });
  kurulan.cust.push(cakismaKart.id);
  const cakismaSub = await prisma.subcontractor.create({ data: { code: `${PRE}-E`, name: `${PRE} Ayni Ad` }, select: { id: true } });
  kurulan.sub.push(cakismaSub.id);

  // ── KURU KOŞUM ────────────────────────────────────────────────────────────
  const kuru = goc();
  check("§1 kuru koşum hiçbir şey YAZMAZ (bağsız profil hâlâ bağsız)",
    (await prisma.subcontractor.findUniqueOrThrow({ where: { id: bagsiz.id }, select: { customerId: true } })).customerId === null);
  check("§1b kuru koşum bağsız profili YENİ KART olarak raporladı",
    kuru.includes("YENİ KART") && kuru.includes(`${PRE}-A`), kuru.includes(`${PRE}-A`) ? "" : "rapor satırı yok");
  check("§4 ⭐ AD ÇAKIŞMASI: ÖNERİ satırı var ve BAĞLAMAZ",
    kuru.includes("ÖNERİ") && kuru.includes(`--baglan=${cakismaSub.id}:${cakismaKart.id}`),
    kuru.split("\n").filter((l) => l.includes("ÖNERİ")).join(" | ").slice(0, 120));

  // ── UYGULA ────────────────────────────────────────────────────────────────
  const oncekiBakiye = await toplamBakiye([kartHesap.id, fasonHesap.id]);
  goc("--apply");

  // ① bağsız → yeni kart + bayraklar
  const a = await prisma.subcontractor.findUniqueOrThrow({
    where: { id: bagsiz.id },
    select: { customerId: true, customer: { select: { code: true, name: true, taxNumber: true, contactPhone: true, address: true, isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true, type: true } } },
  });
  check("§2 ⭐ bağsız profil KART ile bağlandı", a.customerId !== null && a.customer !== null, a.customer?.code ?? "yok");
  // ⚠️ AD KARŞILAŞTIRMASI KATLANMIŞ (ölçüldü): `customerService.create`
  // `applyStringFields` ile adı KANONİK BÜYÜK HARFE çevirir ("Bagsiz Fason" →
  // "BAGSİZ FASON"). Bu servisin kuralıdır, göçün kusuru değil — ama operatör
  // kartı profil adının aynen kopyası sanmasın diye kol bunu ADIYLA ölçer.
  check("§2b kart alanları profilden kopyalandı (`phone → contactPhone`; ad SERVİS KANONİĞİNDE)",
    upperTr(a.customer?.name ?? "") === upperTr(`${PRE} Bagsiz Fason`)
    && a.customer?.taxNumber === VERGI_NO
    && a.customer?.contactPhone === "05551112233" && a.customer?.address === "Bagsiz Mah.",
    JSON.stringify({ ad: a.customer?.name, tel: a.customer?.contactPhone }));
  check("§2c kod BACKEND üretti (`MUS` öneki, elle kod YOK)",
    /^MUS\d{6}\d{4}$/.test(a.customer?.code ?? ""), a.customer?.code ?? "");
  check("§2d ⭐ ROL BAYRAKLARI YAZILDI (tedarikçi + fason, müşteri DEĞİL)",
    a.customer?.isSupplierRole === true && a.customer?.isSubcontractorRole === true && a.customer?.isCustomerRole === false,
    JSON.stringify({ m: a.customer?.isCustomerRole, t: a.customer?.isSupplierRole, f: a.customer?.isSubcontractorRole }));
  check("§2e `type` TÜRETİLDİ (`resolveCompanyType`; elle yazılmadı)",
    a.customer?.type === CompanyType.SUPPLIER, String(a.customer?.type));

  // ② bağlı profil dokunulmadı
  check("§3 BAĞLI profil dokunulmadı (kartı değişmedi)",
    (await prisma.subcontractor.findUniqueOrThrow({ where: { id: bagli.id }, select: { customerId: true } })).customerId === bagliKart.id);

  // ③ hesap birleşti
  const fh = await prisma.cariAccount.findUniqueOrThrow({ where: { id: fasonHesap.id }, select: { isActive: true, subcontractorId: true } });
  check("§5 ⭐ eski fason hesabı PASİFE çekildi (SİLİNMEDİ — defter satırı durur)",
    fh.isActive === false && fh.subcontractorId === hesapli.id, JSON.stringify(fh));
  const sonrakiBakiye = await toplamBakiye([kartHesap.id, fasonHesap.id]);
  check("§6 ⭐ BAKİYE TOPLAMI DEĞİŞMEDİ (önce = sonra)",
    JSON.stringify(oncekiBakiye) === JSON.stringify(sonrakiBakiye),
    `önce ${JSON.stringify(oncekiBakiye)} ↔ sonra ${JSON.stringify(sonrakiBakiye)}`);
  const kartTry = await prisma.cariBalance.findUnique({ where: { cariId_currency: { cariId: kartHesap.id, currency: Currency.TRY } }, select: { balance: true } });
  check("§6b ⭐ AYNI PARA BİRİMİ TOPLANDI (100 + 250 = 350), PK çakışması YOK",
    kartTry?.balance.toFixed(2) === "350.00", kartTry?.balance.toFixed(2) ?? "yok");
  const kartUsd = await prisma.cariBalance.findUnique({ where: { cariId_currency: { cariId: kartHesap.id, currency: Currency.USD } }, select: { balance: true } });
  check("§6c hedefte OLMAYAN para birimi taşındı (USD 40)", kartUsd?.balance.toFixed(2) === "40.00", kartUsd?.balance.toFixed(2) ?? "yok");
  check("§6d kaynak hesabın bakiye satırı KALMADI (toplandı, kopyalanmadı)",
    (await prisma.cariBalance.count({ where: { cariId: fasonHesap.id } })) === 0);

  // ④ ad çakışması hâlâ bağlanmamış
  check("§7 ⭐ AD ÇAKIŞMASI --apply'da da BAĞLANMADI (kullanıcı onayı şart)",
    (await prisma.subcontractor.findUniqueOrThrow({ where: { id: cakismaSub.id }, select: { customerId: true } })).customerId === null);

  // ⑤ ikinci koşum
  const ikinci = goc("--apply");
  check("§8 ⭐ İKİNCİ KOŞUM 0 DEĞİŞİKLİK (idempotent)",
    /DEĞİŞİKLİK: 0/.test(ikinci), ikinci.split("\n").find((l) => l.includes("DEĞİŞİKLİK:"))?.trim() ?? "satır yok");

  // ⑥ elle bağ
  const elle = goc("--apply", `--baglan=${cakismaSub.id}:${cakismaKart.id}`);
  check("§9 `--baglan` kullanıcı onayıyla BAĞLADI",
    (await prisma.subcontractor.findUniqueOrThrow({ where: { id: cakismaSub.id }, select: { customerId: true } })).customerId === cakismaKart.id,
    elle.split("\n").find((l) => l.includes("BAĞ (elle"))?.trim() ?? "");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function toplamBakiye(ids: string[]): Promise<Record<string, string>> {
  const rows = await prisma.cariBalance.findMany({ where: { cariId: { in: ids } }, select: { currency: true, balance: true } });
  const t: Record<string, number> = {};
  for (const r of rows) t[r.currency] = (t[r.currency] ?? 0) + Number(r.balance);
  return Object.fromEntries(Object.entries(t).sort().map(([k, v]) => [k, v.toFixed(2)]));
}

main()
  .catch((e) => { console.error("\n💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => {
    try {
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: kurulan.cari } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: kurulan.cari } } });
      const uretilen = await prisma.subcontractor.findMany({ where: { id: { in: kurulan.sub } }, select: { customerId: true } });
      await prisma.subcontractor.deleteMany({ where: { id: { in: kurulan.sub } } });
      const kartlar = [...kurulan.cust, ...uretilen.map((u) => u.customerId).filter((x): x is string => Boolean(x))];
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: kartlar } } });
      await prisma.customer.deleteMany({ where: { id: { in: kartlar } } });
    } catch (e) { console.error("⚠️ Temizlik hatası:", (e as Error).message); }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exit(fail > 0 ? 1 : 0);
  });
