// =============================================================================
// BEKÇİ — BACKEND GÜNCELLEME DURUMU (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.1 · §3.2 · §5)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts guncelleme_durumu   (DB'siz; saf + geçici dizin + statik)
//
// NE ÖLÇER:
//   §1 güncelleyici kökü: açık değişken mutlak → o · göreli → ölçülemedi · Windows'ta ProgramData · başka
//      platformda yok
//   §2 dosya okuma: yok → yok · BOM + tanınmayan alanlı durum → geçerli · bozuk JSON → ölçülemedi · sembolik
//      bağ ve tavan aşan boy → ölçülemedi (izlenmez) · biçimsiz KESİN blok yalnız kendini düşürür · geçmişte
//      bozuk satır atlanır
//   §3 ⭐ D2 VEKTÖRLERİ — güncelleyicinin yedi senaryoda GERÇEKTEN yazdığı dosyalar
//      (`native/test-vektorleri/guncelleyici-durum/<senaryo>/durum/`): rapor `bekleyen`/`son` = dosyanın kesin
//      blokları, bayt bayt; D2'nin ölçtüğü iki fark: kurulu sürüm güncelken GUNCEL/SURUM_GUNCEL · geri dönmüş
//      sürümde ONAY_BEKLIYOR
//   §4 canlılık (kalp atışı): taze → CALISIYOR · eşik aşıldı → OLCULEMEDI ("yanıt vermiyor") · alan yok /
//      gelecekte → ölçülemedi · HATA → DURDU · eşik tavanı
//   §5 rapor: güncelleyici yoksa alan gitmez · ölçülemeyen de raporlanır · KATI şema · serbest metin yok ·
//      şemadan geçmeyen rapor fırlatmaz, düşer
//   §6 panel görünümü: kira yok/kiradaki politika/K1/varsayılan · geçmiş (backend + PG satırı) en yeni önce ·
//      yerel ayrıntı · karar · onayın kullanıldığı
//   §7 ⭐ eylemler (`approvalActions` — panel düğmeleri ve POST kapısı AYNI yüklem)
//   §8 bağlantı (statik): uçlar izinli ve bağlı · yoklama gövdesi raporu yayar · yoklama niyeti tazeler
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UpdateReportSchema, msToIso, signDownloadToken, type LeaseDoc } from "../src/lib/license/protocol";
import {
  UPDATER_DIR_ENV,
  readUpdater,
  readUpdaterHistory,
  readUpdaterStatus,
  resolveUpdaterDir,
  type UpdaterRead,
  type UpdaterStatusDoc,
} from "../src/lib/license/updater-ipc";
import {
  LIVENESS_THRESHOLD_MAX_S,
  buildUpdateReport,
  historyItem,
  lastResult,
  pendingUpdate,
  updateStatusFrom,
  updaterLiveness,
  updaterProcess,
} from "../src/services/update-status.service";
import { approvalActions, type ApprovalActionInput, type UpdateApprovalView } from "../src/services/helpers/update-approval-rules.helper";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { anahtarUret } from "./lib/lisans-fikstur";

const KOK = path.resolve(__dirname, "..");
const VEKTOR = path.join(KOK, "native", "test-vektorleri", "guncelleyici-durum");
const SIMDI = Date.parse("2026-10-01T10:00:00.000Z");
const SAAT = 3_600_000;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Taze kalp atışlı asgari durum dosyası. */
const doc = (over: Partial<UpdaterStatusDoc> = {}): UpdaterStatusDoc => ({
  v: 1,
  durum: "BEKLIYOR",
  guncelleyiciSurum: "0.1.0",
  sonCanlilik: msToIso(SIMDI - 30_000),
  canlilikEsigiSn: 180,
  ...over,
});
const ok = (d: UpdaterStatusDoc, history: UpdaterRead["history"] = []): UpdaterRead => ({ status: { kind: "ok", doc: d }, history });
const satir = (over: Record<string, unknown> = {}) => ({
  v: 1, islemId: randomUUID(), onayId: null, urun: "backend", kaynakSurum: "2.13.1", surum: "2.14.0", sonuc: "BASARILI", hataKodu: null,
  ayrintiKodu: null, veriGeriYuklendi: false, basladi: "2026-09-30T23:00:00.000Z", bitti: "2026-09-30T23:12:00.000Z",
  gocSayisi: { once: 380, sonra: 384 }, yedek: null,
  onay: { onayId: randomUUID(), surum: "2.14.0", zamanlama: "HEMEN", kullaniciId: randomUUID(), ad: "Ayşe Yılmaz", zaman: "2026-09-30T22:58:00Z" },
  ...over,
});
const sonuc = (over: Record<string, unknown> = {}) => ({
  kayitId: randomUUID(), hedefSurum: "2.14.0", kaynakSurum: "2.13.1", sonuc: "GERI_DONDU", kod: "SAGLIK_HATASI",
  baslangic: "2026-09-30T23:00:00.000Z", bitis: "2026-09-30T23:05:00.000Z", veriGeriYuklendi: true, ...over,
});

function kok(): void {
  console.log("\n§1 güncelleyici kökü");
  check("§1a açık değişken mutlak → o dizin", resolveUpdaterDir({ [UPDATER_DIR_ENV]: "/tmp/gnc" }, "darwin").dir === "/tmp/gnc");
  const goreli = resolveUpdaterDir({ [UPDATER_DIR_ENV]: "gnc" }, "win32");
  check("§1b göreli değişken → ölçülemedi (yanlış dizinde 'yok' denmez)", goreli.invalid && goreli.dir === null);
  const win = resolveUpdaterDir({ ProgramData: "C:\\ProgramData" }, "win32");
  check("§1c Windows'ta %ProgramData%\\TeksERP\\guncelleme", !win.invalid && (win.dir ?? "").includes("TeksERP") && (win.dir ?? "").endsWith("guncelleme"));
  check("§1d başka platformda değişken yoksa kök yok", resolveUpdaterDir({}, "darwin").dir === null && !resolveUpdaterDir({}, "darwin").invalid);
  check("§1e göreli kökle okuma → durum ölçülemedi", readUpdater({ [UPDATER_DIR_ENV]: "gnc" }, "darwin").status.kind === "invalid");
}

function dosyalar(): void {
  console.log("\n§2 dosya okuma");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gnc-durum-"));
  try {
    check("§2a durum dosyası yok → yok", readUpdaterStatus(d).kind === "missing");
    fs.mkdirSync(path.join(d, "durum"));
    const f = path.join(d, "durum", "durum.json");
    fs.writeFileSync(f, "\uFEFF" + JSON.stringify({ ...doc({ durum: "HAZIR", surum: "2.14.0" }), yeniAlan: 1 }));
    const r = readUpdaterStatus(d);
    check("§2b BOM + tanınmayan alan → geçerli (ileri uyum), alan atılır", r.kind === "ok" && r.doc.surum === "2.14.0" && !("yeniAlan" in r.doc));
    fs.writeFileSync(f, "{bozuk");
    check("§2c bozuk JSON → ölçülemedi", readUpdaterStatus(d).kind === "invalid");
    fs.writeFileSync(f, JSON.stringify(doc({ mesaj: "x".repeat(70 * 1024) })));
    check("§2d tavan aşan boy → ölçülemedi", readUpdaterStatus(d).kind === "invalid");
    fs.writeFileSync(f, JSON.stringify({ ...doc({ durum: "HAZIR" }), bekleyen: { surum: "../../x", karar: "KUR", neden: null }, son: { kayitId: "yok" } }));
    const blok = readUpdaterStatus(d);
    check("§2e biçimsiz KESİN blok dosyayı düşürmez; blok yok sayılır (bekleyen/son null)",
      blok.kind === "ok" && pendingUpdate(blok.doc) === null && lastResult(blok.doc) === null);
    fs.rmSync(f);
    const hedef = path.join(d, "baska.json");
    fs.writeFileSync(hedef, JSON.stringify(doc()));
    fs.symlinkSync(hedef, f);
    check("§2f sembolik bağ İZLENMEZ → ölçülemedi", readUpdaterStatus(d).kind === "invalid");
    fs.writeFileSync(path.join(d, "durum", "gecmis.jsonl"), [JSON.stringify(satir()), "{yarım", JSON.stringify({ v: 1 }), JSON.stringify(satir({ surum: "2.14.1" }))].join("\n") + "\n");
    const h = readUpdaterHistory(d);
    check("§2g geçmiş: bozuk/eksik satır atlanır, sıra eskiden yeniye", h.length === 2 && h[1]!.surum === "2.14.1");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

interface Beklenen {
  readonly durum: string;
  readonly bekleyen: { surum: string; karar: string; neden: string | null } | null;
  readonly son: { sonuc: string; kod: string | null; veri: boolean } | null;
  readonly karar: { karar: string; neden: string | null };
}

/** D2'nin yedi senaryosu (`export_scenarios`, dal dagitim/d2-guncelleyici 971cca68) — dosyalar bayt-eşit kopya. */
const SENARYOLAR: Readonly<Record<string, Beklenen>> = {
  basarili: { durum: "BASARILI", bekleyen: { surum: "2.13.0", karar: "GUNCEL", neden: "SURUM_GUNCEL" }, son: { sonuc: "BASARILI", kod: null, veri: false }, karar: { karar: "GUNCEL", neden: "SURUM_GUNCEL" } },
  dondur: { durum: "BEKLIYOR", bekleyen: null, son: null, karar: { karar: "DONDURULDU", neden: "POLITIKA" } },
  "geri-dondu": { durum: "GERI_DONDU", bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null }, son: { sonuc: "GERI_DONDU", kod: "SAGLIK_HATASI", veri: true }, karar: { karar: "KUR", neden: "PENCERE" } },
  "kaynak-eski": { durum: "BEKLIYOR", bekleyen: { surum: "2.13.0", karar: "UYGUN_DEGIL", neden: "KAYNAK_SURUM_ESKI" }, son: null, karar: { karar: "UYGUN_DEGIL", neden: "KAYNAK_SURUM_ESKI" } },
  "onay-bekliyor": { durum: "HAZIR", bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null }, son: null, karar: { karar: "ONAY_BEKLIYOR", neden: null } },
  "pencere-bekliyor": { durum: "HAZIR", bekleyen: { surum: "2.13.0", karar: "PENCERE_BEKLIYOR", neden: null }, son: null, karar: { karar: "PENCERE_BEKLIYOR", neden: null } },
  yaptirim: { durum: "BEKLIYOR", bekleyen: null, son: null, karar: { karar: "DONDURULDU", neden: "YAPTIRIM" } },
};

function vektorler(): void {
  console.log("\n§3 D2 vektörleri — güncelleyicinin gerçek dosyaları");
  const adlar = fs.existsSync(VEKTOR) ? fs.readdirSync(VEKTOR).sort() : [];
  check("§3a yedi senaryo dizini var ve beyanla birebir", JSON.stringify(adlar) === JSON.stringify(Object.keys(SENARYOLAR).sort()), adlar.join(","));
  for (const ad of Object.keys(SENARYOLAR).sort()) {
    const b = SENARYOLAR[ad]!;
    const dir = path.join(VEKTOR, ad);
    const read = readUpdater({ [UPDATER_DIR_ENV]: dir } as NodeJS.ProcessEnv, "linux");
    const ham = JSON.parse(fs.readFileSync(path.join(dir, "durum", "durum.json"), "utf8")) as Record<string, unknown> & { zaman: string };
    const simdi = Date.parse(ham.zaman) + 30_000;
    const rapor = buildUpdateReport(read, DEFAULT_FACTORY_TIMEZONE, simdi);
    const kesinBekleyen = ham.bekleyen ? (({ surum, karar, neden }) => ({ surum, karar, neden }))(ham.bekleyen as Beklenen["bekleyen"] & object) : null;
    const d = read.status.kind === "ok" ? read.status.doc : null;
    check(`§3 ${ad}: okuyucudan geçer, rapor KATI şemadan geçer, güncelleyici CALISIYOR`,
      d !== null && d.durum === b.durum && rapor !== null && UpdateReportSchema.safeParse(rapor).success && rapor.guncelleyici.durum === "CALISIYOR");
    check(`§3 ${ad}: ⭐ rapor.bekleyen = dosyanın kesin bekleyen'i (sezgisiz)`,
      JSON.stringify(rapor?.bekleyen ?? null) === JSON.stringify(kesinBekleyen) && JSON.stringify(rapor?.bekleyen ?? null) === JSON.stringify(b.bekleyen),
      JSON.stringify(rapor?.bekleyen ?? null));
    check(`§3 ${ad}: ⭐ rapor.son = dosyanın kesin son'u (bayt bayt)`,
      JSON.stringify(rapor?.son ?? null) === JSON.stringify(ham.son ?? null) &&
        (b.son === null ? rapor?.son === null : rapor?.son?.sonuc === b.son.sonuc && rapor.son.kod === b.son.kod && rapor.son.veriGeriYuklendi === b.son.veri));
    const v = updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.12.0", nowMs: simdi });
    check(`§3 ${ad}: panel kararı = dosyanın karar'ı`, v.karar?.karar === b.karar.karar && v.karar.neden === b.karar.neden, JSON.stringify(v.karar));
  }
  const guncel = buildUpdateReport(readUpdater({ [UPDATER_DIR_ENV]: path.join(VEKTOR, "basarili") } as NodeJS.ProcessEnv, "linux"), DEFAULT_FACTORY_TIMEZONE, Date.parse("2026-09-30T23:30:30.000Z"));
  check("§3b ⭐ D2 farkı 1: kurulu sürüm güncelken bekleyen GUNCEL/SURUM_GUNCEL (eski eşleme null derdi)", guncel?.bekleyen?.karar === "GUNCEL" && guncel.bekleyen.neden === "SURUM_GUNCEL");
  const geri = buildUpdateReport(readUpdater({ [UPDATER_DIR_ENV]: path.join(VEKTOR, "geri-dondu") } as NodeJS.ProcessEnv, "linux"), DEFAULT_FACTORY_TIMEZONE, Date.parse("2026-09-30T23:33:30.000Z"));
  check("§3c ⭐ D2 farkı 2: geri dönmüş sürümde bekleyen ONAY_BEKLIYOR (dosyanın karar'ı KUR dese de)", geri?.bekleyen?.karar === "ONAY_BEKLIYOR" && geri.son?.sonuc === "GERI_DONDU");
}

function canlilik(): void {
  console.log("\n§4 canlılık (kalp atışı)");
  const taze = updaterLiveness(doc(), SIMDI);
  check("§4a taze kalp atışı → CALISIYOR, gecikme sn", updaterProcess(ok(doc()), SIMDI).durum === "CALISIYOR" && taze.gecikmeSn === 30 && !taze.yanitVermiyor);
  const bayat = doc({ sonCanlilik: msToIso(SIMDI - 181_000) });
  check("§4b ⭐ eşik (180 sn) aşıldı → OLCULEMEDI + yanıt vermiyor", updaterProcess(ok(bayat), SIMDI).durum === "OLCULEMEDI" && updaterLiveness(bayat, SIMDI).yanitVermiyor);
  check("§4c eşik tam sınırda → canlı", updaterProcess(ok(doc({ sonCanlilik: msToIso(SIMDI - 180_000) })), SIMDI).durum === "CALISIYOR");
  check("§4d kalp atışı alanı yok ya da biçimsiz → OLCULEMEDI (canlı sayılmaz)",
    updaterProcess(ok(doc({ sonCanlilik: null })), SIMDI).durum === "OLCULEMEDI" && updaterProcess(ok(doc({ canlilikEsigiSn: null })), SIMDI).durum === "OLCULEMEDI" &&
    updaterProcess(ok(doc({ sonCanlilik: "dün" })), SIMDI).durum === "OLCULEMEDI");
  check("§4e kalp atışı 5 dk'dan fazla GELECEKTE → OLCULEMEDI (saat sapması)", updaterProcess(ok(doc({ sonCanlilik: msToIso(SIMDI + 6 * 60_000) })), SIMDI).durum === "OLCULEMEDI");
  check("§4f HATA (insan gerekir) → DURDU, kalp atışı bayat olsa da", updaterProcess(ok(doc({ durum: "HATA", sonCanlilik: msToIso(SIMDI - 9 * SAAT) })), SIMDI).durum === "DURDU");
  const ucuk = doc({ sonCanlilik: msToIso(SIMDI - 25 * SAAT), canlilikEsigiSn: 10 ** 9 });
  check("§4g eşik tavanı: uçuk eşik güncelleyiciyi sonsuza dek canlı GÖSTEREMEZ", updaterLiveness(ucuk, SIMDI).esikSn === LIVENESS_THRESHOLD_MAX_S && updaterProcess(ok(ucuk), SIMDI).durum === "OLCULEMEDI");
  check("§4h yok → YOK · okunamıyor → OLCULEMEDI",
    updaterProcess({ status: { kind: "missing" }, history: [] }, SIMDI).durum === "YOK" && updaterProcess({ status: { kind: "invalid", reason: "x" }, history: [] }, SIMDI).durum === "OLCULEMEDI");
}

function rapor(): void {
  console.log("\n§5 rapor");
  check("§5a güncelleyici yoksa rapor YOK (alan gitmez)", buildUpdateReport({ status: { kind: "missing" }, history: [] }, DEFAULT_FACTORY_TIMEZONE, SIMDI) === null);
  const olculemedi = buildUpdateReport({ status: { kind: "invalid", reason: "x" }, history: [] }, DEFAULT_FACTORY_TIMEZONE, SIMDI);
  check("§5b ölçülemeyen güncelleyici de raporlanır (OLCULEMEDI)", olculemedi?.guncelleyici.durum === "OLCULEMEDI" && olculemedi.bekleyen === null);
  const tam = buildUpdateReport(
    ok(doc({
      durum: "HAZIR", surum: "2.15.0", kuruluSurum: "2.14.0", mesaj: "GIZLI-ILETI C:\\TeksERP",
      bekleyen: { surum: "2.15.0", karar: "ONAY_BEKLIYOR", neden: null, ozet: "GIZLI-OZET", zorunlu: true },
      son: sonuc(), sonAyrinti: { urun: "backend", hataKodu: "SAGLIK_ZAMAN_ASIMI", mesaj: "GIZLI-AYRINTI" },
    }), [satir() as never]),
    "Europe/Berlin",
    SIMDI,
  );
  const metin = JSON.stringify(tam);
  check("§5c ⭐ rapor KATI şemadan geçer, dilim fabrikanınki", tam !== null && UpdateReportSchema.safeParse(tam).success && tam.saatDilimi === "Europe/Berlin");
  check("§5d ⭐ serbest metin YOK: ileti, özet, ayrıntı, onaylayan adı, yol",
    !metin.includes("GIZLI") && !metin.includes("Ayşe") && !metin.includes("TeksERP") && !metin.includes("SAGLIK_ZAMAN_ASIMI"));
  let atti = false;
  let bozuk: unknown = "yok";
  try {
    bozuk = buildUpdateReport(ok(doc()), "Europe Istanbul", SIMDI);
  } catch {
    atti = true;
  }
  check("§5e şemadan geçmeyen rapor fırlatmaz, düşer (yoklama bu yüzden düşmez)", !atti && bozuk === null);
  const bayat = buildUpdateReport(ok(doc({ sonCanlilik: msToIso(SIMDI - SAAT) })), DEFAULT_FACTORY_TIMEZONE, SIMDI);
  check("§5f yanıt vermeyen güncelleyici raporda OLCULEMEDI", bayat?.guncelleyici.durum === "OLCULEMEDI");
}

function kira(guncelleme: unknown, ek: Record<string, unknown> = {}): LeaseDoc {
  return {
    kanal: { kod: "deneme-kanal" },
    bitis: msToIso(SIMDI + 30 * 24 * SAAT),
    yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    guncelleme,
    ...ek,
  } as unknown as LeaseDoc;
}

function panel(): void {
  console.log("\n§6 panel görünümü");
  const anahtar = anahtarUret("ind-gnc-bekci-1");
  const onek = "/deneme-kanal/backend/";
  const belirtec = signDownloadToken({
    payload: { v: 1, kanal: "deneme-kanal", yolOneki: onek, kurulumId: "3f0c2b1e-5a5d-4c1e-9d36-6f0c2b1e5a5d", exp: msToIso(SIMDI + SAAT) },
    key: { kid: anahtar.kid, privateKey: anahtar.privateKey },
    nowMs: SIMDI,
  });
  const pgSatiri = satir({ urun: "pg", surum: "16.15", hedefBackend: "2.14.0", kaynakSurum: "16.9", basladi: "2026-09-30T22:50:00.000Z", bitti: "2026-09-30T22:55:00.000Z" });
  const kullanilan = randomUUID();
  const read = ok(
    doc({
      durum: "GERI_DONDU", surum: "2.15.0", kuruluSurum: "2.14.0", hataKodu: "SAGLIK_ZAMAN_ASIMI", mesaj: "2.15.0 geri dönmüştü",
      bekleyen: { surum: "2.15.0", karar: "ONAY_BEKLIYOR", neden: null, zorunlu: true, ozet: "Önemli düzeltme", aralik: null, pgGuncellemesi: false },
      karar: { karar: "KUR", neden: "PENCERE", aralik: null, pgGuncellemesi: false },
      son: sonuc({ hedefSurum: "2.15.0", kaynakSurum: "2.14.0" }),
      sonAyrinti: { urun: "backend", hataKodu: "SAGLIK_ZAMAN_ASIMI", mesaj: "status UP olmadı" },
    }),
    [satir({ surum: "2.13.0" }), pgSatiri, satir({ surum: "2.14.0", onayId: kullanilan }), satir({ surum: "2.14.1", islemId: "islem-uuid-degil" })] as never,
  );
  const yok = updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6a kira yok → politika null, kanal null, belirteç yok, onay verilemez", yok.politika === null && yok.kanal === null && !yok.indirmeBelirteci && yok.sonrakiPencere === null && !yok.eylemler.hemen);
  const aralik = { baslangic: msToIso(SIMDI + 14 * SAAT), bitis: msToIso(SIMDI + 17 * SAAT) };
  const politika = {
    kip: "OTOMATIK",
    pencere: { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: DEFAULT_FACTORY_TIMEZONE },
    araliklar: [{ baslangic: msToIso(SIMDI - 20 * SAAT), bitis: msToIso(SIMDI - 17 * SAAT) }, aralik],
    hedefSurum: null,
  };
  const k1 = kira(politika, { yaptirim: { kademe: "K1", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: true } });
  const v = updateStatusFrom({ lease: k1, tokens: [{ yolOneki: onek, belirtec }], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6b kiradaki politika (kaynak KIRA) + sıradaki mutlak aralık (geçmiş aralık atlanır)",
    v.politika?.kip === "OTOMATIK" && v.politika.kaynak === "KIRA" && v.sonrakiPencere?.baslangic === aralik.baslangic);
  check("§6c K1 → donuk · backend/ belirteci elde · kanal kiradan · onay verilemez", v.donuk && v.indirmeBelirteci && v.kanal === "deneme-kanal" && !v.eylemler.hemen && v.eylemler.neden !== null);
  const varsayilan = updateStatusFrom({ lease: kira(undefined), tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6d kirada alan yok → VARSAYILAN (ONAYLI, pencere yok)", varsayilan.politika?.kaynak === "VARSAYILAN" && varsayilan.politika.kip === "ONAYLI");
  check("§6e bekleyen ayrıntısı (kritik + özet) + karar + yerel ayrıntı (iç kod + ileti)",
    v.bekleyen?.surum === "2.15.0" && v.bekleyen.zorunlu && v.bekleyen.ozet === "Önemli düzeltme" && v.karar?.karar === "KUR" &&
      v.yerel?.sonAyrinti?.hataKodu === "SAGLIK_ZAMAN_ASIMI" && v.yerel.sonAyrinti.mesaj === "status UP olmadı" && v.son?.kod === "SAGLIK_HATASI");
  const g = v.gecmis;
  check("§6f geçmiş en yeni önce; UUID'siz satır atlanır; PG satırı backend hedefiyle + PG sürümüyle",
    g.length === 3 && g[0]!.hedefSurum === "2.14.0" && g[1]!.urun === "pg" && g[1]!.hedefSurum === "2.14.0" && g[1]!.pgSurum === "16.15" && g[1]!.kaynakSurum === null && g[2]!.hedefSurum === "2.13.0");
  check("§6g geçmişin sonucu: HATA → BASARISIZ, kodsuz başarısızlık BILINMEYEN, iç kod ayrı",
    historyItem(satir({ sonuc: "HATA", hataKodu: "GOC_HATASI", ayrintiKodu: "GOC_ZAMAN_ASIMI" }) as never)?.sonuc === "BASARISIZ" &&
      historyItem(satir({ sonuc: "HATA", hataKodu: "GOC_HATASI", ayrintiKodu: "GOC_ZAMAN_ASIMI" }) as never)?.ayrintiKodu === "GOC_ZAMAN_ASIMI" &&
      historyItem(satir({ sonuc: "GERI_DONDU", hataKodu: null }) as never)?.kod === "BILINMEYEN");
  const onay = (id: string): Omit<UpdateApprovalView, "kullanildi"> => ({ onayId: id, surum: "2.14.0", zamanlama: "HEMEN", onaylayan: { id: randomUUID(), ad: "Ayşe" }, zaman: msToIso(SIMDI) });
  check("§6h onayın kullanıldığı geçmişteki onayId'den (kullanılmayan onay yürürlükte)",
    updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI, approval: onay(kullanilan) }).onay?.kullanildi === true &&
      updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI, approval: onay(randomUUID()) }).onay?.kullanildi === false);
  check("§6i canlılık görünümü panelde (son kalp atışı + eşik)", v.canlilik?.esikSn === 180 && v.canlilik.gecikmeSn === 30 && !v.canlilik.yanitVermiyor);
}

function eylemler(): void {
  console.log("\n§7 eylemler (panel düğmeleri = POST kapısı)");
  const temel: ApprovalActionInput = {
    guncelleyici: { durum: "CALISIYOR", surum: "0.1.0" },
    politika: { kip: "ONAYLI" },
    donuk: false,
    bekleyen: { surum: "2.15.0", karar: "ONAY_BEKLIYOR", neden: null },
    yerelDurum: "HAZIR",
    son: null,
    sonrakiPencere: { baslangic: msToIso(SIMDI + SAAT), bitis: msToIso(SIMDI + 4 * SAAT) },
    onay: null,
  };
  const e = (over: Partial<ApprovalActionInput>) => approvalActions({ ...temel, ...over });
  const a = e({});
  check("§7a ONAYLI + onay bekliyor + pencere var → Şimdi kur + Bu gece kur, hedef aday", a.hemen && a.pencere && !a.geriAl && a.hedefSurum === "2.15.0" && a.neden === null);
  check("§7b pencere yok → yalnız Şimdi kur", e({ sonrakiPencere: null }).hemen && !e({ sonrakiPencere: null }).pencere);
  const otomatik = e({ politika: { kip: "OTOMATIK" }, bekleyen: { surum: "2.15.0", karar: "PENCERE_BEKLIYOR", neden: null } });
  check("§7c OTOMATIK + pencere bekliyor → yalnız Şimdi kur (pencere zaten kuracak)", otomatik.hemen && !otomatik.pencere && otomatik.hedefSurum === "2.15.0");
  const verildi: UpdateApprovalView = { onayId: randomUUID(), surum: "2.15.0", zamanlama: "PENCERE", onaylayan: { id: randomUUID(), ad: "Ayşe" }, zaman: msToIso(SIMDI), kullanildi: false };
  const b = e({ onay: verildi });
  check("§7d aynı sürüme PENCERE onayı yürürlükte → Bu gece kur yok, Şimdi kur + Geri al var", b.hemen && !b.pencere && b.geriAl);
  const kullanildi = e({ onay: { ...verildi, kullanildi: true } });
  check("§7e kullanılmış onay yürürlükte sayılmaz (geri dönmüş sürüme YENİ onay verilebilir)", kullanildi.pencere && !kullanildi.geriAl);
  check("§7f ⭐ DONDUR · K1 · kira yok → hiçbir onay (geri alma açık)",
    [e({ politika: { kip: "DONDUR" }, onay: verildi }), e({ donuk: true, onay: verildi }), e({ politika: null, onay: verildi })].every((x) => !x.hemen && !x.pencere && x.geriAl && x.neden !== null));
  check("§7g güncelleyici yok → hiçbir şey (niyet yazılacak yer yok)", !e({ guncelleyici: { durum: "YOK", surum: null } }).hemen && !e({ guncelleyici: { durum: "YOK", surum: null }, onay: verildi }).geriAl);
  const uygulaniyor = e({ yerelDurum: "UYGULANIYOR", bekleyen: { surum: "2.15.0", karar: "KUR", neden: null }, onay: verildi });
  check("§7h uygulanırken → hiçbir karar (geri alma da yok)", !uygulaniyor.hemen && !uygulaniyor.pencere && !uygulaniyor.geriAl);
  check("§7i uygun değil / güncel / aday yok → hedef yok, gerekçeli",
    ["UYGUN_DEGIL", "GUNCEL", "DONDURULDU"].every((k) => {
      const x = e({ bekleyen: { surum: "2.15.0", karar: k as never, neden: "KAYNAK_SURUM_ESKI" } });
      return !x.hemen && x.hedefSurum === null && (x.neden ?? "").length > 0;
    }) && e({ bekleyen: null }).neden === "Kurulacak yeni sürüm yok.");
  const hata = e({ yerelDurum: "HATA", bekleyen: null, son: { ...sonuc({ hedefSurum: "2.15.0" }), sonuc: "BASARISIZ" } as never });
  check("§7j geri dönüş de düştüyse (HATA) son denemenin sürümüne yeni onay verilebilir", hata.hemen && hata.pencere && hata.hedefSurum === "2.15.0");
}

function baglanti(): void {
  console.log("\n§8 bağlantı (statik)");
  const oku = (rel: string) => fs.readFileSync(path.join(KOK, rel), "utf8");
  const rota = oku("src/routes/update.routes.ts");
  check("§8a uçlar kimlik + license:view ∨ license:manage ister, swagger'da",
    /router\.use\(verifyToken, requireAnyPermission\("license:view", "license:manage"\)\)/.test(rota) && rota.includes(" * /api/guncelleme/durum:") && rota.includes(" * /api/guncelleme/onay:"));
  check("§8b ⭐ onay ucu AYRICA license:manage ister", /router\.post\("\/onay", requirePermission\("license:manage"\)/.test(rota));
  check("§8c router /api/guncelleme altına bağlı", /app\.use\("\/api\/guncelleme", updateRoutes\)/.test(oku("src/app.ts")));
  const senk = oku("src/services/license-sync.service.ts");
  check("§8d yoklama gövdesi raporu yayar", /\.\.\.updateReportField\(\)/.test(senk));
  check("§8e ⭐ kabul edilen her kira yanıtı niyeti tazeler (belirteç güncelleyiciye)", (senk.match(/refreshUpdaterIntentQuietly\(\);/g) ?? []).length === 2);
  check("§8f indirme belirteci ucu ürün listesini protokolden alır (backend dahil)", /urun: z\.enum\(DOWNLOAD_PRODUCTS\)/.test(oku("src/routes/license.routes.ts")));
}

function main(): void {
  console.log("=== BACKEND GÜNCELLEME DURUMU ===");
  kok();
  dosyalar();
  vektorler();
  canlilik();
  rapor();
  panel();
  eylemler();
  baglanti();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
