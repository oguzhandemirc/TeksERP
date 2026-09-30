// =============================================================================
// BEKÇİ — SÖZLEŞME KABUL METNİ TEK KAYNAKTAN (Ek-7) + kabul belgesi doğrulayıcısı — DB GEREKMEZ
// Çalıştır: npx tsx scripts/run-all-tests.ts lisans_kabul_metni
// =============================================================================
// NEDEN: panelde gösterilen metin, kabul kaydındaki özet ve satıcının tanıdığı metin AYNI metin olmalı
// ("gösterilen metin ile kaydedilen özet ayrışır" riski). Tek kaynak hukuk belgesidir (docs/hukuk/KABUL-METNI.md
// §2); üretici (`scripts/kabul-metni-uret.ts`) protokol kataloğunu ve backend metnini ondan yazar.
// ÖLÇÜLENLER: §1 belge okunur (kimlik · §2 bloğu · kutular) · §2 ⭐ üretilmiş iki dosya belgeyle BAYT-EŞİT (belge
// değişip üretici koşulmadıysa KIRMIZI) · §3 katalog kuralı (aynı → aynı · yeni kimlik sona · taslak yerinde ·
// yayımlanmış metin değişemez · eski kimliğe dönülemez) · §4 ekran blokları metni KAYIPSIZ taşır · §5 kabul
// belgesi doğrulayıcısı (YOK · IMZA · SEMA · METIN · KUTU) · §6 tel sözleşmesi (opsiyonel alan, typ, satıcı kodu).
// ⭐ KALICI SONDA ✓K (her koşumda): mutasyonlu belge kopyası — metin değişince §2'nin karşılaştırıcısı ısırır,
// kimlik satırı/§2 bloğu/kutular silinince okuyucu fırlatır (sessiz boş metin üretilmez).
// =============================================================================
import { readFileSync } from "node:fs";
import {
  ACCEPTANCE_TEXTS,
  ActivateRequestSchema,
  TYP,
  VENDOR_ERROR_CODES,
  acceptanceTextDigest,
  installationKeyId,
  signAcceptance,
  signJws,
  verifyAcceptance,
  type AcceptanceDoc,
  type AcceptanceTextEntry,
} from "../src/lib/license/protocol";
import { currentAcceptanceText, parseAcceptanceBlocks, type AcceptanceBlock } from "../src/lib/license/acceptance-text";
import {
  KABUL_BELGESI,
  KATALOG_DOSYASI,
  METIN_DOSYASI,
  beklenenCiktilar,
  kabulKaynagiOku,
  kabulKaynaginiCoz,
  katalogGuncelle,
  type KabulKaynagi,
} from "./lib/kabul-metni-kaynak";
import { kurulumAnahtariUret } from "./lib/lisans-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
function firlatir(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Blokları metne geri kurar: kayıpsız ayrıştırma bu dönüşümü birebir verir. */
function geriKur(bloklar: readonly AcceptanceBlock[], metin: string): string {
  const satirlar = metin.split("\n");
  const alanlar = satirlar.find((s) => s.startsWith("Ad Soyad:")) ?? "";
  const dugmeler = satirlar.find((s) => s.startsWith("[ **")) ?? "";
  return bloklar
    .map((b) => {
      if (b.tur === "paragraf") return b.satirlar.join("\n");
      if (b.tur === "liste") return b.maddeler.map((m) => `- ${m}`).join("\n");
      if (b.tur === "kutu") return `☐ **${b.no}.** ${b.metin}`;
      return b.tur === "alanlar" ? alanlar : dugmeler;
    })
    .join("\n\n");
}

function kaynakBolumu(k: KabulKaynagi): void {
  console.log("\n§1 — belge okunur");
  check("§1a metin kimliği okundu (KM-yıl.n[-taslak])", /^KM-\d{4}\.\d+(-taslak)?$/.test(k.kimlik), k.kimlik);
  check("§1b §2 bloğu dolu, alıntı işareti düştü, NFC", k.metin.length > 500 && !k.metin.split("\n").some((s) => s.startsWith(">")) && k.metin === k.metin.normalize("NFC"), `${k.metin.length} karakter`);
  check("§1c kutular 1…n sırayla", k.kutular.length >= 1 && k.kutular.every((n, i) => n === String(i + 1)), k.kutular.join(","));
}

function uretimBolumu(k: KabulKaynagi): void {
  console.log("\n§2 — ⭐ üretilmiş dosyalar belgeyle bayt-eşit");
  const hedef = beklenenCiktilar(k);
  check("§2a protokol kataloğu belgeden üretilmiş hâliyle aynı", readFileSync(KATALOG_DOSYASI, "utf8") === hedef.katalog, "fark varsa: npx tsx scripts/kabul-metni-uret.ts");
  check("§2b backend metni belgeden üretilmiş hâliyle aynı", readFileSync(METIN_DOSYASI, "utf8") === hedef.metin);
  const t = currentAcceptanceText();
  check("§2c çalışma zamanı metni = belge (kimlik · özet · kutular) ve katalogun SON satırı", t.kimlik === k.kimlik && t.ozet === k.ozet && t.kutular.join() === k.kutular.join() && t.katalogda);
  const kimlikler = ACCEPTANCE_TEXTS.map((a) => a.kimlik);
  check("§2d katalogda kimlik tekil, özet 64 onaltılık, kutu listesi dolu", new Set(kimlikler).size === kimlikler.length && ACCEPTANCE_TEXTS.every((a) => /^[0-9a-f]{64}$/.test(a.ozet) && a.kutular.length > 0));
  // ✓K: belgedeki tek kelime değişirse karşılaştırıcı ısırır.
  const belge = readFileSync(KABUL_BELGESI, "utf8");
  const mutasyon = kabulKaynaginiCoz(belge.replace("tersine mühendislikle incelenemez", "tersine mühendislikle incelenebilir"));
  const mutHedef = beklenenCiktilar(mutasyon);
  check("§2e ✓K belgede metin değişince özet değişir ve üretilmiş dosyalar 'uyuşmuyor' der", mutasyon.ozet !== k.ozet && mutHedef.metin !== hedef.metin && mutHedef.katalog !== hedef.katalog);
  check("§2f ✓K kimlik satırı yoksa okuyucu fırlatır", firlatir(() => kabulKaynaginiCoz(belge.replace(/Metin kimliği: `[^`]+`/, "Metin kimliği: yok"))) !== null);
  check("§2g ✓K §2 başlığı yoksa fırlatır", firlatir(() => kabulKaynaginiCoz(belge.replace("## 2. Ekran metni", "## İki. Ekran metni"))) !== null);
  check("§2h ✓K kutusuz metin fırlatır", firlatir(() => kabulKaynaginiCoz(belge.replace(/☐/g, "[ ]"))) !== null);
}

function katalogBolumu(k: KabulKaynagi): void {
  console.log("\n§3 — katalog kuralı");
  const a: AcceptanceTextEntry = { kimlik: "KM-2025.1", ozet: "a".repeat(64), kutular: ["1", "2"] };
  const tas: AcceptanceTextEntry = { kimlik: "KM-2025.2-taslak", ozet: "b".repeat(64), kutular: ["1", "2"] };
  const g = (kimlik: string, ozet: string): KabulKaynagi => ({ kimlik, ozet, metin: "x", kutular: ["1", "2"] });
  check("§3a aynı metin → katalog değişmez", JSON.stringify(katalogGuncelle([a], g(a.kimlik, a.ozet))) === JSON.stringify([a]));
  check("§3b yeni kimlik sona eklenir (eskiler tanınmaya devam)", katalogGuncelle([a], g("KM-2025.3", "c".repeat(64))).map((x) => x.kimlik).join() === "KM-2025.1,KM-2025.3");
  check("§3c SON satırdaki taslağın metni değişirse yerinde güncellenir", katalogGuncelle([a, tas], g(tas.kimlik, "d".repeat(64))).at(-1)?.ozet === "d".repeat(64));
  check("§3d ⭐ yayımlanmış (taslak olmayan) metin değişemez → fırlatır", firlatir(() => katalogGuncelle([a], g(a.kimlik, "e".repeat(64)))) !== null);
  check("§3e eski bir kimliğe dönülemez → fırlatır", firlatir(() => katalogGuncelle([a, tas], g(a.kimlik, a.ozet))) !== null);
  check("§3f belgenin bugünkü kimliği katalogda son", ACCEPTANCE_TEXTS.at(-1)?.kimlik === k.kimlik);
}

function blokBolumu(k: KabulKaynagi): void {
  console.log("\n§4 — ekran blokları metni kayıpsız taşır");
  const bloklar = parseAcceptanceBlocks(k.metin);
  const doluSatirlar = (m: string): string => m.split("\n").filter((s) => s.trim() !== "").join("\n");
  check("§4a ⭐ bloklardan geri kurulan metin = kanonik metin, satır satır (panel hiçbir satırı düşürmez/değiştirmez)", doluSatirlar(geriKur(bloklar, k.metin)) === doluSatirlar(k.metin));
  const turler = bloklar.map((b) => b.tur);
  check("§4b madde listesi · 4 kutu · ad/unvan alanı · düğme satırı tanındı", turler.includes("liste") && turler.filter((t) => t === "kutu").length === k.kutular.length && turler.includes("alanlar") && turler.includes("dugmeler"), turler.join(","));
  check("§4c ✓K karışık paragraf sırayla bölünür, tanınmayan biçim paragraf kalır (kaybolmaz)", parseAcceptanceBlocks("tuhaf **satır**\n\n- a\nb").map((b) => b.tur).join() === "paragraf,liste,paragraf");
}

function belgeBolumu(k: KabulKaynagi): void {
  console.log("\n§5 — kabul belgesi doğrulayıcısı (satıcının kapısı)");
  const kur = kurulumAnahtariUret();
  const katalog: AcceptanceTextEntry[] = [{ kimlik: k.kimlik, ozet: k.ozet, kutular: k.kutular }];
  const yuk = (ek: Partial<AcceptanceDoc> = {}): AcceptanceDoc => ({
    v: 1,
    kabulId: "0b0f7b1e-6a52-4c50-9a4c-3f0e1d2c3b4a",
    metin: { kimlik: k.kimlik, ozet: k.ozet },
    kutular: [...k.kutular],
    kabulEden: { kullaniciId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", ad: "Ayşe Yılmaz", unvan: "Genel Müdür" },
    zaman: new Date().toISOString(),
    istemci: { tur: "panel", surum: "1.5.0" },
    sunucuSurum: "2.13.0",
    ...ek,
  });
  const dogrula = (t: string | undefined) => verifyAcceptance(t, { publicKeyX: kur.x, texts: katalog });
  const neden = (t: string | undefined): string => {
    const r = dogrula(t);
    return r.ok ? "OK" : r.neden;
  };
  check("§5a geçerli belge → OK (metin + kutular)", neden(signAcceptance({ payload: yuk(), privateKey: kur.privateKey })) === "OK");
  check("§5b belge yok / boş → YOK", neden(undefined) === "YOK" && neden("") === "YOK");
  check("§5c başka kurulumun anahtarı → IMZA", neden(signAcceptance({ payload: yuk(), privateKey: kurulumAnahtariUret().privateKey })) === "IMZA");
  const kid = installationKeyId(kur.x);
  check("§5d başka belge türü (typ) → IMZA", neden(signJws({ typ: TYP.ISTEK, kid, payload: yuk(), privateKey: kur.privateKey })) === "IMZA");
  check("§5e şema dışı (unvan 1 harf) → SEMA", neden(signJws({ typ: TYP.KABUL, kid, payload: yuk({ kabulEden: { kullaniciId: yuk().kabulEden.kullaniciId, ad: "Ayşe", unvan: "X" } }), privateKey: kur.privateKey })) === "SEMA");
  check("§5f tanınmayan metin (özet başka) → METIN", neden(signAcceptance({ payload: yuk({ metin: { kimlik: k.kimlik, ozet: acceptanceTextDigest("başka metin") } }), privateKey: kur.privateKey })) === "METIN");
  check("§5g eksik kutu → KUTU; fazla kutu → KUTU", neden(signAcceptance({ payload: yuk({ kutular: k.kutular.slice(0, -1) }), privateKey: kur.privateKey })) === "KUTU" && neden(signAcceptance({ payload: yuk({ kutular: [...k.kutular, "11"] }), privateKey: kur.privateKey })) === "KUTU");
  check("§5h imzalayıcı şema dışı yükü İMZALAMAZ (fırlatır)", firlatir(() => signAcceptance({ payload: { ...yuk(), kutular: [] }, privateKey: kur.privateKey })) !== null);
}

function telBolumu(): void {
  console.log("\n§6 — tel sözleşmesi");
  const govde = {
    v: 1,
    kod: "TKS-7K3M-9QRT-2XWZ-4HJN",
    acikAnahtar: "A".repeat(43),
    parmakIzi: { f1: null, f2: null, f3: null, f4: null, f5: null },
    ortam: { platform: "win32", mimari: "x64", isletimSistemi: "Windows", nodeSurum: "v24.18.0", uygulamaSurum: "2.13.0", derlemeTarihi: null, konteyner: false },
  };
  check("§6a etkinleştirme gövdesi `kabul` alanı OPSİYONEL (v:1 uyumu — eski gövde şemadan geçer, satıcı iş kuralıyla reddeder)", ActivateRequestSchema.safeParse(govde).success && ActivateRequestSchema.safeParse({ ...govde, kabul: "a.b.c" }).success);
  check("§6b `kabul` metin değilse KATI gövde reddeder", !ActivateRequestSchema.safeParse({ ...govde, kabul: 42 }).success);
  check("§6c belge türü kayıtlı ve tekil (tekserp-kabul)", TYP.KABUL === "tekserp-kabul" && Object.values(TYP).filter((t) => t === TYP.KABUL).length === 1);
  check("§6d satıcı hata kodu KABUL_GEREKLI protokolde (fabrika TR mesajla tanır)", (VENDOR_ERROR_CODES as readonly string[]).includes("KABUL_GEREKLI"));
}

function main(): void {
  const k = kabulKaynagiOku();
  kaynakBolumu(k);
  uretimBolumu(k);
  katalogBolumu(k);
  blokBolumu(k);
  belgeBolumu(k);
  telBolumu();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
