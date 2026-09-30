// =============================================================================
// BEKÇİ — BACKEND GÜNCELLEME DURUMU (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.1 · §3.2 · §5)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts guncelleme_durumu   (DB'siz; saf + geçici dizin + statik)
//
// NE ÖLÇER:
//   §1 güncelleyici kökü: açık değişken mutlak → o · göreli → ölçülemedi · Windows'ta ProgramData · başka
//      platformda yok
//   §2 dosya okuma: yok → yok · BOM + tanınmayan alanlı durum → geçerli · bozuk JSON → ölçülemedi ·
//      sembolik bağ ve tavan aşan boy → ölçülemedi (izlenmez) · geçmişte bozuk satır atlanır
//   §3 eşleme: süreç YOK/OLCULEMEDI/DURDU/CALISIYOR · bekleyen: uygulanıyor → KUR · dondurma/K1 →
//      DONDURULDU · güncelleyici red kodları rapor sözlüğüne · onay bekleyen / pencere bekleyen ·
//      kurulu sürümle aynı aday bekleyen değil
//   §4 son deneme: HATA → BASARISIZ + kod (yoksa BILINMEYEN) · PG işlemi rapora girmez · UUID olmayan /
//      ters zamanlı satır atlanır · en yeni backend denemesi seçilir
//   §5 rapor: güncelleyici yoksa YOK (alan gitmez) · KATI şemadan geçer · serbest metin (ileti, onaylayan)
//      taşımaz · şemadan geçmeyen rapor FIRLATMAZ, düşer
//   §6 panel görünümü: kira yok → politika null · kiradaki politika + sıradaki mutlak aralık + K1 + backend/
//      belirteci · geçmiş en yeni önce
//   §7 bağlantı (statik): uç izinli ve bağlı · yoklama gövdesi raporu yayar · indirme belirteci ucu backend
//      ürününü kabul eder
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UpdateReportSchema, msToIso, signDownloadToken, type LeaseDoc } from "../src/lib/license/protocol";
import { UPDATER_DIR_ENV, readUpdater, readUpdaterHistory, readUpdaterStatus, resolveUpdaterDir, type UpdaterRead, type UpdaterStatusDoc } from "../src/lib/license/updater-ipc";
import { attemptOf, buildUpdateReport, lastAttempt, pendingUpdate, updateStatusFrom, updaterProcess } from "../src/services/update-status.service";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { anahtarUret } from "./lib/lisans-fikstur";

const KOK = path.resolve(__dirname, "..");
const SIMDI = Date.parse("2026-10-01T10:00:00.000Z");
const SAAT = 3_600_000;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const doc = (over: Partial<UpdaterStatusDoc> = {}): UpdaterStatusDoc => ({ v: 1, durum: "BEKLIYOR", guncelleyiciSurum: "0.1.0", ...over });
const ok = (d: UpdaterStatusDoc, history: UpdaterRead["history"] = []): UpdaterRead => ({ status: { kind: "ok", doc: d }, history });
const satir = (over: Record<string, unknown> = {}) => ({
  v: 1, islemId: randomUUID(), niyetId: "n1", urun: "backend", kaynakSurum: "2.13.1", surum: "2.14.0", sonuc: "BASARILI", hataKodu: null,
  basladi: "2026-09-30T23:00:00.000Z", bitti: "2026-09-30T23:12:00.000Z", gocSayisi: { once: 380, sonra: 384 }, yedek: null,
  onay: { kullaniciId: randomUUID(), ad: "Ayşe Yılmaz", zaman: "2026-09-30T22:58:00Z", planlanan: null }, ...over,
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
    fs.rmSync(f);
    const hedef = path.join(d, "baska.json");
    fs.writeFileSync(hedef, JSON.stringify(doc()));
    fs.symlinkSync(hedef, f);
    check("§2e sembolik bağ İZLENMEZ → ölçülemedi", readUpdaterStatus(d).kind === "invalid");
    fs.writeFileSync(path.join(d, "durum", "gecmis.jsonl"), [JSON.stringify(satir()), "{yarım", JSON.stringify({ v: 1 }), JSON.stringify(satir({ surum: "2.14.1" }))].join("\n") + "\n");
    const h = readUpdaterHistory(d);
    check("§2f geçmiş: bozuk/eksik satır atlanır, sıra eskiden yeniye", h.length === 2 && h[1]!.surum === "2.14.1");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function esleme(): void {
  console.log("\n§3 eşleme");
  check("§3a süreç: yok → YOK · ölçülemedi → OLCULEMEDI",
    updaterProcess({ status: { kind: "missing" }, history: [] }).durum === "YOK" && updaterProcess({ status: { kind: "invalid", reason: "x" }, history: [] }).durum === "OLCULEMEDI");
  check("§3b süreç: HATA (insan gerekir) → DURDU · diğer → CALISIYOR + sürüm",
    updaterProcess(ok(doc({ durum: "HATA" }))).durum === "DURDU" && updaterProcess(ok(doc())).durum === "CALISIYOR" && updaterProcess(ok(doc())).surum === "0.1.0");
  const p = (over: Partial<UpdaterStatusDoc>) => pendingUpdate(doc({ surum: "2.14.0", kuruluSurum: "2.13.1", ...over }));
  check("§3c uygulanıyor → KUR", p({ durum: "UYGULANIYOR" })?.karar === "KUR");
  const donuk = p({ durum: "BEKLIYOR", politika: { kip: "DONDUR", izin: false, neden: "POLITIKA_DONDUR" } });
  check("§3d politika dondur → DONDURULDU/POLITIKA", donuk?.karar === "DONDURULDU" && donuk.neden === "POLITIKA");
  const k1 = p({ durum: "HAZIR", politika: { kip: "OTOMATIK", izin: false, neden: "YAPTIRIM_DONUK" } });
  check("§3e K1 → DONDURULDU/YAPTIRIM", k1?.karar === "DONDURULDU" && k1.neden === "YAPTIRIM");
  const eski = p({ durum: "BEKLIYOR", hataKodu: "KAYNAK_SURUM_ESKI", politika: { kip: "OTOMATIK", izin: true, neden: null } });
  check("§3f red kodu rapor sözlüğüne: KAYNAK_SURUM_ESKI → UYGUN_DEGIL/KAYNAK_SURUM_ESKI · PG_BUYUK_SURUM → PG_ANA_SURUM",
    eski?.karar === "UYGUN_DEGIL" && eski.neden === "KAYNAK_SURUM_ESKI" && p({ hataKodu: "PG_BUYUK_SURUM" })?.neden === "PG_ANA_SURUM");
  const bilinmeyen = p({ hataKodu: "YENI_BIR_KOD" });
  check("§3g tanınmayan kod → UYGUN_DEGIL + kodun kendisi (tel deseniyle)", bilinmeyen?.karar === "UYGUN_DEGIL" && bilinmeyen.neden === "YENI_BIR_KOD");
  check("§3h hazır + onaylı + planlanmamış → ONAY_BEKLIYOR · planlanmış → PENCERE_BEKLIYOR",
    p({ durum: "HAZIR", politika: { kip: "ONAYLI", izin: true, neden: null } })?.karar === "ONAY_BEKLIYOR" &&
    p({ durum: "HAZIR", planlanan: "2026-10-01T23:00:00.000Z", politika: { kip: "ONAYLI", izin: true, neden: null } })?.karar === "PENCERE_BEKLIYOR" &&
    p({ durum: "INDIRILIYOR", politika: { kip: "OTOMATIK", izin: true, neden: null } })?.karar === "PENCERE_BEKLIYOR");
  check("§3i aday kurulu sürümle aynı · biçimsiz sürüm · sonuçlanmış durum → bekleyen YOK",
    p({ surum: "2.13.1" }) === null && p({ surum: "2.14" }) === null && p({ durum: "BASARILI" }) === null);
}

function denemeler(): void {
  console.log("\n§4 son deneme");
  const hata = attemptOf(satir({ sonuc: "HATA", hataKodu: "GOC_HATASI", veriGeriYuklendi: true }) as never);
  check("§4a HATA → BASARISIZ + kod + veri geri yüklendi", hata?.sonuc === "BASARISIZ" && hata.kod === "GOC_HATASI" && hata.veriGeriYuklendi);
  check("§4b kodsuz başarısızlık → BILINMEYEN · başarılı → kod null",
    attemptOf(satir({ sonuc: "GERI_DONDU", hataKodu: null }) as never)?.kod === "BILINMEYEN" && attemptOf(satir() as never)?.kod === null);
  check("§4c PG işlemi rapora girmez — sürümü backend biçimine benzese de (urun pg, 16.15.4)",
    attemptOf(satir({ urun: "pg", surum: "16.15" }) as never) === null && attemptOf(satir({ urun: "pg", surum: "16.15.4" }) as never) === null);
  check("§4d UUID olmayan kimlik · ters zaman → atlanır",
    attemptOf(satir({ islemId: "islem-1" }) as never) === null && attemptOf(satir({ bitti: "2026-09-30T22:00:00.000Z" }) as never) === null);
  const son = lastAttempt([satir({ surum: "2.13.0" }), satir({ surum: "2.14.0" }), satir({ urun: "pg", surum: "16.16" })] as never);
  check("§4e en yeni BACKEND denemesi seçilir (sondaki PG satırı atlanır)", son?.hedefSurum === "2.14.0");
}

function rapor(): void {
  console.log("\n§5 rapor");
  check("§5a güncelleyici yoksa rapor YOK (alan gitmez)", buildUpdateReport({ status: { kind: "missing" }, history: [] }, DEFAULT_FACTORY_TIMEZONE) === null);
  const olculemedi = buildUpdateReport({ status: { kind: "invalid", reason: "x" }, history: [] }, DEFAULT_FACTORY_TIMEZONE);
  check("§5b ölçülemeyen güncelleyici de raporlanır (OLCULEMEDI)", olculemedi?.guncelleyici.durum === "OLCULEMEDI" && olculemedi.bekleyen === null);
  const tam = buildUpdateReport(
    ok(doc({ durum: "HAZIR", surum: "2.15.0", kuruluSurum: "2.14.0", mesaj: "GIZLI-ILETI C:\\TeksERP", politika: { kip: "ONAYLI", izin: true, neden: null } }), [satir() as never]),
    "Europe/Berlin",
  );
  const metin = JSON.stringify(tam);
  check("§5c ⭐ rapor KATI şemadan geçer, dilim fabrikanınki", tam !== null && UpdateReportSchema.safeParse(tam).success && tam.saatDilimi === "Europe/Berlin");
  check("§5d ⭐ serbest metin YOK: ileti, onaylayan adı, yol", !metin.includes("GIZLI-ILETI") && !metin.includes("Ayşe") && !metin.includes("TeksERP"));
  let atti = false;
  let bozuk: unknown = "yok";
  try {
    bozuk = buildUpdateReport(ok(doc()), "Europe Istanbul");
  } catch {
    atti = true;
  }
  check("§5e şemadan geçmeyen rapor fırlatmaz, düşer (yoklama bu yüzden düşmez)", !atti && bozuk === null);
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
  const read = ok(doc({ durum: "HAZIR", surum: "2.15.0", kuruluSurum: "2.14.0" }), [satir({ surum: "2.13.0" }), satir({ surum: "2.14.0" })] as never);
  const yok = updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6a kira yok → politika null, kanal null, belirteç yok", yok.politika === null && yok.kanal === null && !yok.indirmeBelirteci && yok.sonrakiPencere === null);
  const aralik = { baslangic: msToIso(SIMDI + 14 * SAAT), bitis: msToIso(SIMDI + 17 * SAAT) };
  const kira = {
    kanal: { kod: "deneme-kanal" },
    bitis: msToIso(SIMDI + 30 * 24 * SAAT),
    yaptirim: { kademe: "K1", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: true },
    guncelleme: {
      kip: "OTOMATIK",
      pencere: { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: DEFAULT_FACTORY_TIMEZONE },
      araliklar: [{ baslangic: msToIso(SIMDI - 20 * SAAT), bitis: msToIso(SIMDI - 17 * SAAT) }, aralik],
      hedefSurum: null,
    },
  } as unknown as LeaseDoc;
  const v = updateStatusFrom({ lease: kira, tokens: [{ yolOneki: onek, belirtec }], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6b kiradaki politika (kaynak KIRA) + sıradaki mutlak aralık (geçmiş aralık atlanır)",
    v.politika?.kip === "OTOMATIK" && v.politika.kaynak === "KIRA" && v.sonrakiPencere?.baslangic === aralik.baslangic);
  check("§6c K1 → donuk · backend/ belirteci elde · kanal kiradan", v.donuk && v.indirmeBelirteci && v.kanal === "deneme-kanal");
  const varsayilan = updateStatusFrom({ lease: { ...kira, guncelleme: undefined } as LeaseDoc, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  check("§6d kirada alan yok → VARSAYILAN (ONAYLI, pencere yok)", varsayilan.politika?.kaynak === "VARSAYILAN" && varsayilan.politika.kip === "ONAYLI");
  check("§6e bekleyen + yerel durum + geçmiş en yeni önce", v.bekleyen?.surum === "2.15.0" && v.yerel?.durum === "HAZIR" && v.gecmis[0]?.hedefSurum === "2.14.0" && v.gecmis.length === 2);
}

function baglanti(): void {
  console.log("\n§7 bağlantı (statik)");
  const oku = (rel: string) => fs.readFileSync(path.join(KOK, rel), "utf8");
  const rota = oku("src/routes/update.routes.ts");
  check("§7a uç kimlik + license:view ∨ license:manage ister, swagger'da",
    /router\.use\(verifyToken, requireAnyPermission\("license:view", "license:manage"\)\)/.test(rota) && rota.includes(" * /api/guncelleme/durum:"));
  check("§7b router /api/guncelleme altına bağlı", /app\.use\("\/api\/guncelleme", updateRoutes\)/.test(oku("src/app.ts")));
  check("§7c yoklama gövdesi raporu yayar", /\.\.\.updateReportField\(\)/.test(oku("src/services/license-sync.service.ts")));
  check("§7d indirme belirteci ucu ürün listesini protokolden alır (backend dahil)", /urun: z\.enum\(DOWNLOAD_PRODUCTS\)/.test(oku("src/routes/license.routes.ts")));
}

function main(): void {
  console.log("=== BACKEND GÜNCELLEME DURUMU ===");
  kok();
  dosyalar();
  esleme();
  denemeler();
  rapor();
  panel();
  baglanti();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
