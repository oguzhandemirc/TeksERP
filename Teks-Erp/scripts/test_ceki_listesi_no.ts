// =============================================================================
// BEKÇİ — ÇEKİ LİSTESİ NO BASIMDA DOĞAR, AYNI İÇERİK AYNI NUMARA
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts ceki_listesi_no
//
// ⭐ NEDEN (2026-09-23, kullanıcı kararı "küçük yaz, bir köşeye koy"): Paketleme / Çuvallar →
//    "Çeki Listesi" kâğıdı hiçbir kayda bağlı değildi ve numarasızdı; CL serisi yalnız hiçbir
//    istemcinin çağırmadığı iş emri ucunda doğuyordu. Numara render'da üretilemez (doğuşta
//    materyalize edilir) → kâğıt ilk basıldığında bir `Manifest` (SACK_SELECTION) satırı doğar.
//
// NE ÖLÇER (HTTP — gerçek app, gerçek zod, gerçek yetki):
//   ① ilk basım 201 + CL numarası seri biçiminde + DB satırı SACK_SELECTION, workOrderId NULL
//   ② aynı içerik (farklı seçim sırası, yeni token) → 200 reused, AYNI numara, AYNI anlık görüntü
//   ③ farklı çuval kümesi → YENİ numara; eski satır yerinde (iptal edilmez)
//   ④ aynı küme ama içerik değişti (çuval notu) → YENİ numara
//   ⑤ token tekrarı (içerik değişmiş olsa da) → İLK denemenin sonucu
//   ⑥ eşzamanlı iki özdeş basım → TEK satır, iki yanıt aynı numara
//   ⑦ dönen snapshot = DB snapshot (kâğıt kayıttan çizilir)
//   ⑧ gövde sözleşmesi: token'sız 400
//   ⑨ yarış yüklemi pg adaptörünün GERÇEK P2002 biçimiyle (zamandan bağımsız)
//   ⑩ müşteri belgesindeki kumaş/renk (gelen belge E3): gelen belgesiz topun grubu bugünkü BEŞ alanla
//      (anahtar değişmez → aynı CL yeniden basılır); satırlı topun ve Tambur çocuğunun grubu metni taşır,
//      ayrı gruptur; metin yalnız doluyken anahtar olur
//
// NEGATİF SONDA (2026-09-23, ölçüldü): `recordSackPickList` içindeki contentKey araması
//    kaldırılınca ② ve ⑥ KIRMIZI (aynı içerik yeni numara aldı); geri alınınca yeşil.
// ⭐ YARIŞ (2026-09-23, iniş ağacında 201/409): pg adaptörü `meta.target` vermez → `p2002TargetsCode`
//    içerik çakışmasını "hedef bilinmiyor → retry" sayıp 5 turda 409'la bitiriyordu. ⑥ artık altı
//    eşzamanlı istek (yük altında 1/3 koşumda kırmızıydı); ⑨ yüklemi zamandan bağımsız ölçer. Negatif
//    sonda: adaptör okuması kaldırılınca ⑨ ×2 KIRMIZI.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { ensureTestAdmin } from "./fixture-test-user";
import { Prisma } from "@prisma/client";
import { p2002TargetsCode } from "../src/utils/barcode-retry";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const MARK = `TEST-CKL${Date.now().toString(36).slice(-5).toUpperCase()}`;
const olusanCariler: string[] = [];
const olusanCuvallar: string[] = [];
const olusanListeler: string[] = [];
const olusanToplar: string[] = [];
const olusanUrunler: string[] = [];
const olusanBelgeler: string[] = [];

type Baski = { id: string; manifestNo: string; snapshot: unknown; reused: boolean };

async function main() {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string } };
  };
  const bas = async (sackIds: string[], clientToken = randomUUID()) => {
    const r = await call("POST", "/api/shipping/sack-search/pick-list/print", { sackIds, clientToken });
    const d = r.body.data as unknown as Baski | undefined;
    if (d?.id) olusanListeler.push(d.id);
    return { status: r.status, d };
  };
  try {
    const cred = await ensureTestAdmin();
    const login = await call("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String(login.body.data?.token ?? "");
    check("login", login.status === 200 && token.length > 20, `status=${login.status}`);

    const cari = await call("POST", "/api/customers", { name: `${MARK} Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" });
    const cariId = String(cari.body.data?.id ?? "");
    olusanCariler.push(cariId);
    const cuval = async () => {
      const r = await call("POST", "/api/shipping/sacks", { customerId: cariId, clientToken: randomUUID() });
      const id = String(r.body.data?.id ?? "");
      olusanCuvallar.push(id);
      return id;
    };
    const [a, b] = [await cuval(), await cuval()];
    check("fikstür: iki çuval", Boolean(a && b), `${a.slice(0, 8)} ${b.slice(0, 8)}`);

    const seri = ((await call("GET", "/api/number-series")).body.data ?? []) as unknown as Array<{ key: string; prefix: string }>;
    const onek = seri.find((s) => s.key === "manifest")?.prefix ?? "?";

    // ① ilk basım
    const ilk = await bas([a, b]);
    check("① ilk basım 201 + reused=false", ilk.status === 201 && ilk.d?.reused === false, `status=${ilk.status}`);
    check("① numara serinin ön ekiyle", String(ilk.d?.manifestNo ?? "").startsWith(onek), `${ilk.d?.manifestNo} (ön ek ${onek})`);
    const satir = ilk.d ? await prisma.manifest.findUnique({ where: { id: ilk.d.id } }) : null;
    check("① DB: SACK_SELECTION, workOrderId NULL, contentKey dolu", satir?.sourceKind === "SACK_SELECTION" && satir.workOrderId === null && (satir.contentKey?.length ?? 0) === 64);

    // ② aynı içerik, ters sıra, yeni token
    const tekrar = await bas([b, a]);
    check("② aynı içerik → 200 reused, AYNI numara", tekrar.status === 200 && tekrar.d?.reused === true && tekrar.d?.manifestNo === ilk.d?.manifestNo, `${tekrar.d?.manifestNo}`);
    check("② aynı anlık görüntü", JSON.stringify(tekrar.d?.snapshot) === JSON.stringify(ilk.d?.snapshot));

    // ③ farklı küme
    const tek = await bas([a]);
    check("③ farklı küme → YENİ numara", tek.status === 201 && tek.d?.manifestNo !== ilk.d?.manifestNo, `${tek.d?.manifestNo}`);
    check("③ eski liste yerinde", Boolean(ilk.d && (await prisma.manifest.findUnique({ where: { id: ilk.d.id } }))));

    // ④ aynı küme, içerik değişti (çuval notu kâğıtta basılabilen alan)
    await prisma.sack.update({ where: { id: a }, data: { notes: `${MARK} not` } });
    const degisti = await bas([a, b]);
    check("④ içerik değişti → YENİ numara", degisti.status === 201 && degisti.d?.manifestNo !== ilk.d?.manifestNo, `${degisti.d?.manifestNo}`);

    // ⑤ token tekrarı → ilk denemenin sonucu (içerik o arada değişse de)
    const tok = randomUUID();
    const t1 = await bas([b], tok);
    await prisma.sack.update({ where: { id: b }, data: { notes: `${MARK} not2` } });
    const t2 = await bas([b], tok);
    check("⑤ token tekrarı → aynı kayıt", t1.d?.id === t2.d?.id && t2.d?.reused === true, `${t1.d?.manifestNo} / ${t2.d?.manifestNo}`);

    // ⑥ eşzamanlı özdeş basım
    await prisma.sack.update({ where: { id: a }, data: { notes: `${MARK} yaris` } });
    // YÜK: altı eşzamanlı özdeş basım — ikili yarış sahadaki "ikinci tık"ı nadiren yakalar (iniş
    // ağacında 201/409 ölçüldü 2026-09-23, tek oturum DB'sinde yeşildi).
    const yaris = await Promise.all(Array.from({ length: 6 }, () => bas([a])));
    const numaralar = new Set(yaris.map((y) => y.d?.manifestNo ?? `∅${y.status}`));
    const yarisSatiri = await prisma.manifest.count({ where: { manifestNo: { in: [...numaralar] } } });
    check("⑥ altı eşzamanlı özdeş → hepsi 2xx, aynı numara, tek satır", yaris.every((y) => y.status < 300) && numaralar.size === 1 && yarisSatiri === 1, `${yaris.map((y) => y.status).join("/")} ${[...numaralar].join(",")}`);

    // ⑦ dönen snapshot = DB
    const db = ilk.d ? await prisma.manifest.findUnique({ where: { id: ilk.d.id }, select: { snapshot: true } }) : null;
    check("⑦ dönen snapshot = DB snapshot", JSON.stringify(db?.snapshot) === JSON.stringify(ilk.d?.snapshot));

    // ⑨ ZAMANDAN BAĞIMSIZ: yarışın kaderini belirleyen yüklem, pg adaptörünün GERÇEK hata biçimiyle
    // (`meta.target` YOK, kısıt `driverAdapterError`da). İçerik çakışması retry EDİLMEZ (kazanan okunur),
    // numara çakışması edilir. ⑥ zamanlamaya bağlıdır ve her koşumda pencereyi yakalamaz.
    const adapterHatasi = (alan: string, kisit: string) => new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002", clientVersion: "test",
      meta: { modelName: "Manifest", driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "23505", originalMessage: `duplicate key value violates unique constraint "${kisit}"`, kind: "UniqueConstraintViolation", constraint: { fields: [`"${alan}"`] } } } },
    });
    check("⑨ içerik çakışması (adaptör biçimi) numara retry'ına GİRMEZ", p2002TargetsCode(adapterHatasi("contentKey", "manifests_contentKey_key"), "manifestNo") === false);
    check("⑨ token çakışması (adaptör biçimi) numara retry'ına GİRMEZ", p2002TargetsCode(adapterHatasi("clientToken", "manifests_clientToken_key"), "manifestNo") === false);
    check("⑨ numara çakışması (adaptör biçimi) retry EDİLİR", p2002TargetsCode(adapterHatasi("manifestNo", "manifests_manifestNo_key"), "manifestNo") === true);

    // ⑩ müşteri belgesindeki kumaş/renk (E3) — gelen belgesiz içerikte satır şekli bugünkü gibi kalır
    const urun = await prisma.item.create({ data: { code: `${MARK}-KUM`, name: `${MARK} süprem`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    olusanUrunler.push(urun.id);
    const grade = await roleGrade("FIRST");
    const wh = await fixtureWarehouseId();
    const actor = await testActorId();
    const top = async (sackId: string, suffix: string, parentRollId: string | null = null) => {
      // Fikstür: çuvaldaki top (paketleme yazımı servis boğazında; burada yalnız içerik okunur).
      const r = await prisma.roll.create({ data: { barcode: `${MARK}-${suffix}`, itemId: urun.id, initialQty: 50, currentQty: 50, status: "STOCK", warehouseId: wh, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, createdById: actor, sackId, parentRollId }, select: { id: true } });
      olusanToplar.push(r.id);
      return r.id;
    };
    const c = await cuval();
    await top(c, "T1");
    const dokum = async (ids: string[]) => ((await call("POST", "/api/shipping/sack-search/pick-list", { sackIds: ids })).body.data ?? []) as unknown as Array<{ id: string; contents: Array<Record<string, unknown>> }>;
    const once = await dokum([c]);
    const BES = ["itemName", "colorName", "width", "qty", "rollCount"];
    check("⑩ gelen belgesiz top: grup bugünkü BEŞ alan (anahtar değişmez)", once[0]?.contents.length === 1 && JSON.stringify(Object.keys(once[0].contents[0])) === JSON.stringify(BES), JSON.stringify(once[0]?.contents));
    const c1 = await bas([c]);
    const c2 = await bas([c]);
    check("⑩ gelen belgesiz içerik yeniden basımda AYNI CL", c1.status === 201 && c2.d?.reused === true && c2.d?.manifestNo === c1.d?.manifestNo, `${c1.d?.manifestNo} / ${c2.d?.manifestNo}`);
    // Satırlı top: gelen belge satırının rollId'si fikstür topuna bağlanır (onay yolu test_gelen_belge_onay / test_label_gelen_belge'de).
    const belge = await createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: cariId, senderText: `${MARK} GÖNDEREN`, lines: [{ senderRollNo: `${MARK}-R1`, meters: 50, itemText: "Süprem MÜŞTERİ", colorText: "Lacivert" }] }, actor);
    olusanBelgeler.push(belge.id);
    const ata = await top(c, "T2");
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: belge.id }, data: { rollId: ata } });
    await top(c, "T3", ata);
    const sonra = await dokum([c]);
    const gruplar = sonra[0]?.contents ?? [];
    const belgeli = gruplar.find((g) => g.deliveryNoteItemText === "Süprem MÜŞTERİ");
    const belgesiz = gruplar.find((g) => !("deliveryNoteItemText" in g));
    check("⑩ satırlı top + Tambur çocuğu AYRI grupta, metin + renk dolu, 2 top", gruplar.length === 2 && belgeli?.deliveryNoteColorText === "Lacivert" && belgeli?.rollCount === 2, JSON.stringify(gruplar));
    check("⑩ aynı çuvaldaki belgesiz topun grubu hâlâ BEŞ alan", belgesiz !== undefined && JSON.stringify(Object.keys(belgesiz)) === JSON.stringify(BES) && belgesiz.rollCount === 1, JSON.stringify(belgesiz));
    const c3 = await bas([c]);
    check("⑩ içerik metin kazandı → YENİ CL", c3.status === 201 && c3.d?.manifestNo !== c1.d?.manifestNo, `${c3.d?.manifestNo}`);

    // ⑧ sözleşme
    const tokensiz = await call("POST", "/api/shipping/sack-search/pick-list/print", { sackIds: [a] });
    check("⑧ token'sız 400", tokensiz.status === 400, `status=${tokensiz.status}`);
  } finally {
    await temizlik();
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/** Teardown: bu koşumun listeleri, çuvalları, carisi. */
async function temizlik(): Promise<void> {
  await prisma.manifest.deleteMany({ where: { id: { in: olusanListeler } } }).catch(() => undefined);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: olusanBelgeler } } }).catch(() => undefined);
  await prisma.roll.updateMany({ where: { id: { in: olusanToplar } }, data: { parentRollId: null } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { id: { in: olusanToplar } } }).catch(() => undefined);
  await prisma.item.deleteMany({ where: { id: { in: olusanUrunler } } }).catch(() => undefined);
  await prisma.sack.deleteMany({ where: { id: { in: olusanCuvallar.filter(Boolean) } } }).catch(() => undefined);
  await cleanupTestCustomers(olusanCariler.filter(Boolean)).catch(() => undefined);
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`); })
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exitCode ||= fail > 0 ? 1 : 0; });
