// =============================================================================
// DAĞITIM — İKİ YÖNLÜ DOSYA (Faz 3d). Parça tavanı bekçide 1 MB (PARCA_AZAMI_MB=1). Ölçülen:
//   §1 yükleme isteği (/y): belirteç bir kez; sayfa nonce'lu CSP + no-referrer; durum görünümü iç veri taşımaz
//   §2 kapılar: uzantı/MIME allowlist (415) · dosya tavanı (413) · kota (413 KOTA_ASILDI) · işlem kimliği çakışması (409)
//   §3 parça bütünlüğü: özet/boyut tutmayan parça 422; aynı sıra aynı özet idempotent, farklı özet 422
//   §4 sürdürme: aynı işlem kimliği aynı oturumu + alınan parçaları döndürür; eksik parçada tamamlama 409
//   §5 tamamlama: birleşik gövde = kaynak; defter DOSYA_YUKLENDI; parçalar silinir; tekrar aynı dosya (idempotent)
//   §6 birleşik özet beyanla tutmazsa 422 + oturum TERK + kota iadesi
//   §7 GİDEN: portaldan parçalı yükle → paylaşım bağlantısı → /d ile iner; portal gövde indirmesi
//   §8 iptal: açık oturum TERK, parçaları silinir, /y 410
//   §9 tarayıcı betiği: artımlı SHA-256 Node'la birebir; yükleyici betiği derlenir
// Koşum: npx tsx scripts/test_dagitim_yukleme.ts   (yalnız *_test DB)
// =============================================================================
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { SHA256_JS, UPLOAD_JS } from "../src/http/upload-page-script";
import { dagitimOrtamiKur, genelIstek, sha256 } from "./lib/dagitim-ortam";
import { hedefDbKapisi, kapat, kontrol, portalIstek, sonuc } from "./lib/test-ortam";

const MB = 1024 * 1024;

async function main(): Promise<void> {
  hedefDbKapisi();
  const d = await dagitimOrtamiKur({ PARCA_AZAMI_MB: "1" });
  const { prisma } = await import("../src/lib/prisma");
  try {
    const g = d.sunucu.genel;
    console.log("\n§1 yükleme isteği");
    const ist = await d.p("POST", "/dagitim/yukleme-istekleri", { musteriId: d.musteriId, gecerlilikSaat: 48, kotaMb: 5, azamiDosyaMb: 3, aciklama: "Hata ekran görüntülerini gönderin" });
    const b = String(ist.veri.belirtec ?? "");
    const istekId = (ist.veri.istek as { id: string }).id;
    kontrol("§1a 201 + belirteç + /y yolu", ist.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(b) && ist.veri.yol === `/y/${b}`, `${ist.status} ${ist.kod ?? ""}`);
    const y = (yol: string, o: Parameters<typeof genelIstek>[2] = {}) => genelIstek(g, `/y/${b}${yol}`, o);
    const jsonPost = (yol: string, govde: unknown) => y(yol, { yontem: "POST", govde: JSON.stringify(govde), basliklar: { "Content-Type": "application/json" } });
    const parca = (oid: string, i: number, veri: Buffer, ozet = sha256(veri)) => y(`/oturum/${oid}/parca/${i}`, { yontem: "PUT", govde: veri, basliklar: { "Content-Type": "application/octet-stream", "X-Parca-Sha256": ozet } });
    const sayfa = await y("");
    const csp = sayfa.basliklar.get("content-security-policy") ?? "";
    kontrol("§1b sayfa 200, nonce'lu betik, no-referrer", sayfa.status === 200 && /script-src 'nonce-/.test(csp) && sayfa.basliklar.get("referrer-policy") === "no-referrer" && sayfa.body.toString().includes("<script nonce="));
    const durum = await y("/durum");
    const dv = durum.json.data as Record<string, unknown>;
    kontrol("§1c durum: kota/tavan/parça/izinli; müşteri adı ve iç kimlik YOK", durum.status === 200 && dv.kotaBayt === 5 * MB && dv.parcaBayt === MB && !JSON.stringify(dv).includes(d.musteriId) && !JSON.stringify(dv).includes("Dağıtım Bekçi"));
    const bilinmeyen = await genelIstek(g, `/y/${randomBytes(24).toString("base64url")}/durum`);
    kontrol("§1d bilinmeyen yükleme belirteci 404", bilinmeyen.status === 404, `${bilinmeyen.status}`);

    console.log("\n§2 kapılar");
    const kaynak = randomBytes(Math.floor(2.5 * MB));
    const parcalar = [kaynak.subarray(0, MB), kaynak.subarray(MB, 2 * MB), kaynak.subarray(2 * MB)];
    const exe = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "arac.exe", boyut: 10, sha256: sha256(Buffer.from("x")) });
    const mime = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "rapor.pdf", boyut: 10, sha256: sha256(Buffer.from("x")), mime: "text/html" });
    const buyuk = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "video.mp4", boyut: 3 * MB + 1, sha256: sha256(Buffer.from("x")) });
    kontrol("§2a müşteri .exe yükleyemez 415 · MIME uyuşmazlığı 415 · tavan aşımı 413", exe.status === 415 && exe.kod === "DOSYA_TURU_YASAK" && mime.status === 415 && buyuk.status === 413 && buyuk.kod === "DOSYA_COK_BUYUK", `${exe.status}/${mime.status}/${buyuk.status}`);
    const token = randomUUID();
    const bas = { clientToken: token, dosyaAdi: "../../ekran/goruntu.zip", boyut: kaynak.length, sha256: sha256(kaynak) };
    const o = await jsonPost("/oturum", bas);
    const ov = o.json.data as { oturumId: string; parcaSayisi: number; dosyaAdi: string };
    kontrol("§2b oturum açıldı: 3 parça, ad yol bileşeni taşımaz", o.status === 200 && ov.parcaSayisi === 3 && ov.dosyaAdi === "goruntu.zip", `${o.status} ${o.kod ?? ""}`);
    const kullanilan = async () => Number((await prisma.yuklemeIstegi.findUniqueOrThrow({ where: { id: istekId } })).kullanilanBayt);
    kontrol("§2c kota beyan edilen boyutla rezerve edildi", (await kullanilan()) === kaynak.length);
    const cakisan = await jsonPost("/oturum", { ...bas, boyut: kaynak.length - 1 });
    kontrol("§2d aynı işlem kimliği başka gövdeyle → 409 ISLEM_KIMLIGI_CAKISTI", cakisan.status === 409 && cakisan.kod === "ISLEM_KIMLIGI_CAKISTI", `${cakisan.status}`);
    const ikinci = randomBytes(3 * MB);
    const kota = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "b.zip", boyut: ikinci.length, sha256: sha256(ikinci) });
    const kotaYet = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "c.zip", boyut: 2 * MB, sha256: sha256(randomBytes(8)) });
    kontrol("§2e kalan kotayı aşan oturum 413 KOTA_ASILDI (sığan açılır)", kota.status === 413 && kota.kod === "KOTA_ASILDI" && kotaYet.status === 200, `${kota.status}/${kotaYet.status}`);
    const yetimId = (kotaYet.json.data as { oturumId: string }).oturumId;

    console.log("\n§3 parça bütünlüğü");
    const yanlisOzet = await parca(ov.oturumId, 0, parcalar[0]!, sha256(Buffer.from("baska")));
    const kisa = await parca(ov.oturumId, 0, parcalar[0]!.subarray(1));
    const uzun = await parca(ov.oturumId, 2, Buffer.concat([parcalar[2]!, Buffer.from("fazla")]));
    const aralik = await parca(ov.oturumId, 3, parcalar[2]!);
    kontrol("§3a özet tutmayan 422 · kısa parça 422 · beklenenden uzun 413 · aralık dışı sıra 400", yanlisOzet.status === 422 && yanlisOzet.kod === "PARCA_BUTUNLUGU" && kisa.status === 422 && uzun.status === 413 && aralik.status === 400, `${yanlisOzet.status}/${kisa.status}/${uzun.status}/${aralik.status}`);
    const p0 = await parca(ov.oturumId, 0, parcalar[0]!);
    const p2 = await parca(ov.oturumId, 2, parcalar[2]!);
    const p0t = await parca(ov.oturumId, 0, parcalar[0]!);
    const p0f = await parca(ov.oturumId, 0, parcalar[1]!);
    kontrol("§3b doğru parçalar 200; aynı sıra aynı özet idempotent; farklı içerik 422", p0.status === 200 && p2.status === 200 && (p0t.json.data as { tekrar: boolean }).tekrar === true && p0f.status === 422, `${p0.status}/${p2.status}/${p0t.status}/${p0f.status}`);

    console.log("\n§4 sürdürme");
    const surdur = await jsonPost("/oturum", bas);
    const sv = surdur.json.data as { oturumId: string; alinanlar: number[] };
    kontrol("§4a aynı işlem kimliği → aynı oturum, alınanlar [0,2]", sv.oturumId === ov.oturumId && sv.alinanlar.join() === "0,2", JSON.stringify(sv.alinanlar));
    const erken = await jsonPost(`/oturum/${ov.oturumId}/tamamla`, {});
    kontrol("§4b eksik parçada tamamlama 409 (eksik: 1)", erken.status === 409 && JSON.stringify(erken.json.details).includes('"eksik":[1]'), `${erken.status}`);
    const baskaIstek = await genelIstek(g, `/y/${randomBytes(24).toString("base64url")}/oturum/${ov.oturumId}`);
    kontrol("§4c başka belirteçle oturum okunamaz (404)", baskaIstek.status === 404);

    console.log("\n§5 tamamlama");
    await parca(ov.oturumId, 1, parcalar[1]!);
    const tm = await jsonPost(`/oturum/${ov.oturumId}/tamamla`, {});
    const tv = tm.json.data as { dosyaId: string; sha256: string };
    const dosya = await prisma.dagitimDosyasi.findUniqueOrThrow({ where: { id: tv.dosyaId } });
    kontrol("§5a 200; GELEN dosya, özet kaynakla aynı, isteğe bağlı", tm.status === 200 && dosya.yon === "GELEN" && dosya.sha256 === sha256(kaynak) && dosya.yuklemeIstegiId === istekId, `${tm.status} ${tm.kod ?? ""}`);
    kontrol("§5b parça dizini silindi", !existsSync(path.join(d.dizin.dosya, "parca", ov.oturumId)));
    const tm2 = await jsonPost(`/oturum/${ov.oturumId}/tamamla`, {});
    kontrol("§5c tamamlama tekrarı aynı dosyayı döndürür (idempotent)", tm2.status === 200 && (tm2.json.data as { dosyaId: string }).dosyaId === tv.dosyaId);
    const ham = await portalIstek(d.sunucu.tailnet, `/portal/api/ham/dosyalar/${tv.dosyaId}`, { cerez: d.operator.cerez });
    const hamBody = await fetch(`${d.sunucu.tailnet}/portal/api/ham/dosyalar/${tv.dosyaId}`, { headers: { Cookie: d.operator.cerez } }).then(async (r) => Buffer.from(await r.arrayBuffer()));
    kontrol("§5d satıcı gelen dosyayı portaldan indirir, gövde birebir", ham.status === 200 && sha256(hamBody) === sha256(kaynak));
    const yuklendi = await prisma.dagitimDefteri.count({ where: { dosyaId: tv.dosyaId, olay: "DOSYA_YUKLENDI" } });
    kontrol("§5e defter DOSYA_YUKLENDI (bir kez)", yuklendi === 1, `${yuklendi}`);

    console.log("\n§6 birleşik özet tutmadı");
    const k2 = randomBytes(1000);
    const once = await kullanilan();
    const bozuk = await jsonPost("/oturum", { clientToken: randomUUID(), dosyaAdi: "d.txt", boyut: k2.length, sha256: sha256(Buffer.from("yanlis-beyan")) });
    const bozukId = (bozuk.json.data as { oturumId: string }).oturumId;
    await parca(bozukId, 0, k2);
    const bt = await jsonPost(`/oturum/${bozukId}/tamamla`, {});
    const bOturum = await prisma.yuklemeOturumu.findUniqueOrThrow({ where: { id: bozukId } });
    kontrol("§6a 422 PARCA_BUTUNLUGU + oturum TERK + kota iade", bt.status === 422 && bOturum.durum === "TERK" && (await kullanilan()) === once, `${bt.status} ${bOturum.durum}`);

    console.log("\n§7 GİDEN (bizden müşteriye)");
    const giden = randomBytes(Math.floor(1.5 * MB));
    const go = await d.p("POST", "/dagitim/giden-oturum", { musteriId: d.musteriId, dosyaAdi: "Kurulum Kılavuzu.pdf", boyut: giden.length, sha256: sha256(giden) }, d.operator.cerez);
    const gid = go.veri.oturumId as string;
    const put = (i: number, v: Buffer, cerez = d.operator.cerez) =>
      fetch(`${d.sunucu.tailnet}/portal/api/ham/giden-oturum/${gid}/parca/${i}`, { method: "PUT", headers: { Cookie: cerez, "Content-Type": "application/octet-stream", "X-Parca-Sha256": sha256(v) }, body: new Uint8Array(v) });
    const cerezsiz = await fetch(`${d.sunucu.tailnet}/portal/api/ham/giden-oturum/${gid}/parca/0`, { method: "PUT", body: new Uint8Array(giden.subarray(0, MB)) });
    const g0 = await put(0, giden.subarray(0, MB));
    const g1 = await put(1, giden.subarray(MB));
    const gt = await d.p("POST", `/dagitim/giden-oturum/${gid}/tamamla`, {}, d.operator.cerez);
    const gdurum = await d.p("GET", `/dagitim/giden-oturum/${gid}`);
    kontrol("§7a oturumsuz parça 401; portal parçalı yükleme + tamamlama 200", cerezsiz.status === 401 && g0.status === 200 && g1.status === 200 && gt.status === 200 && gdurum.veri.durum === "TAMAMLANDI", `${cerezsiz.status}/${g0.status}/${g1.status}/${gt.status}`);
    const gidenId = gt.veri.dosyaId as string;
    const pay = await d.p("POST", "/dagitim/baglantilar", { tur: "DOSYA", musteriId: d.musteriId, dosyaId: gidenId, gecerlilikSaat: 2, azamiIndirme: 1 });
    const indi = await genelIstek(g, `/d/${String(pay.veri.belirtec)}`, { yontem: "POST" });
    kontrol("§7b paylaşım bağlantısı → /d iner, gövde birebir, UTF-8 dosya adı", pay.status === 201 && indi.status === 200 && sha256(indi.body) === sha256(giden) && /filename\*=UTF-8''Kurulum%20K%C4%B1lavuzu\.pdf/.test(indi.basliklar.get("content-disposition") ?? ""), `${pay.status}/${indi.status}`);
    const gelenPaylas = await d.p("POST", "/dagitim/baglantilar", { tur: "DOSYA", musteriId: d.musteriId, dosyaId: tv.dosyaId, gecerlilikSaat: 2, azamiIndirme: 1 });
    kontrol("§7c müşteriden GELEN dosya geri paylaşılamaz (409)", gelenPaylas.status === 409, `${gelenPaylas.status}`);
    const liste = await d.p("GET", `/dagitim/dosyalar?musteriId=${d.musteriId}&yon=GIDEN`);
    kontrol("§7d dosya listesi yön süzmesi sunucuda; depo yolu dışarı çıkmaz", Array.isArray(liste.json.data) && (liste.json.data as { yon: string }[]).every((x) => x.yon === "GIDEN") && !JSON.stringify(liste.json.data).includes("govde/"));

    console.log("\n§8 iptal");
    await parca(yetimId, 0, randomBytes(MB));
    const ip = await d.p("POST", `/dagitim/yukleme-istekleri/${istekId}/iptal`, { sebep: "müşteri gönderdi, bağlantı kapansın" });
    const yetim = await prisma.yuklemeOturumu.findUniqueOrThrow({ where: { id: yetimId } });
    const sonra = await y("/durum");
    kontrol("§8a iptal 200: açık oturum TERK + parçaları silindi; /y 410", ip.status === 200 && yetim.durum === "TERK" && !existsSync(path.join(d.dizin.dosya, "parca", yetimId)) && sonra.status === 410, `${ip.status} ${yetim.durum} ${sonra.status}`);
    const defter = (await prisma.dagitimDefteri.findMany({ where: { istekId }, orderBy: { createdAt: "asc" } })).map((x) => x.olay);
    kontrol("§8b defter: VERILDI · DOSYA_YUKLENDI · YUKLEME_TERK · YUKLEME_ISTEGI_IPTAL", ["YUKLEME_ISTEGI_VERILDI", "DOSYA_YUKLENDI", "YUKLEME_TERK", "YUKLEME_ISTEGI_IPTAL"].every((x) => defter.includes(x)), defter.join(","));

    console.log("\n§9 tarayıcı betiği");
    const c: Record<string, unknown> = {};
    vm.runInNewContext(`${SHA256_JS}; this.Sha256 = Sha256;`, c);
    const Sha = c.Sha256 as new () => { update(b: Uint8Array): { hex(): string }; hex(): string };
    const farklar = [0, 1, 55, 56, 64, 65, 1000, 70_001].filter((n) => {
      const v = randomBytes(n);
      const s = new Sha();
      for (let i = 0; i < n; i += 997) s.update(v.subarray(i, i + 997));
      return s.hex() !== createHash("sha256").update(v).digest("hex");
    });
    kontrol("§9a artımlı SHA-256 Node ile birebir (8 boy, parçalı besleme)", farklar.length === 0, farklar.join(","));
    let derlendi = true;
    try {
      new vm.Script(UPLOAD_JS);
    } catch {
      derlendi = false;
    }
    kontrol("§9b yükleyici betiği sözdizimi geçerli", derlendi);
  } finally {
    await d.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
