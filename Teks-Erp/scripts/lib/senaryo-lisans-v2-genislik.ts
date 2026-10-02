// SENARYO L — L40: yetenek düşüşü / genişlik kapısı. Arşiv `## 2026-10-01 — Lisans v2 genişlik kapısı (yetenek düşüşü)`
// (karar + meşru geri dönüş) · tasarım §2.1 (yeni biçim yalnız `hak-ara` bildirene) · §4.2. Yetenekli alıcı GERÇEK fabrika
// (V); yeteneği düşmüş alıcı aynı kurulumun anahtarıyla (durmuş V'nin lisans klasöründen) ham imzalı yoklamadır — gövde V'nin
// son gerçek yoklamasıdır, yalnız `yetenekler` ve elde tutulan HAK değişir.
import { REQUEST_HEADER, msToIso, signRequest } from "../../src/lib/license/protocol";
import type { LisansDetayi } from "./senaryo-lisans-istemci";
import type { SahteMakine } from "./senaryo-lisans-surec";
import { nedenOzeti } from "./senaryo-lisans-v2-duzenek";
import { guncelAraImzaci, type G4Baglami } from "./senaryo-lisans-v2-g4";
import { HamKurulum, hamGonder, jwsYuku, type HamYanit } from "./senaryo-lisans-v2-ham";
import { kur, type AdimYuzu, type RolFabrika } from "./senaryo-lisans-v2-merdiven";

type Makineli = RolFabrika & { readonly parmakIzi: SahteMakine };
interface KokTalebi {
  hakId: string;
  acil: boolean;
  durum: string;
}

const V_ETKEN = { f1: "5e0a00010000400080000000000056f1", f2: "5E0A0002-0000-4000-8000-0000000056F2", f3: "SENARYO-V-DISK-01", f4: "SENARYOV-SYS-01" };
const ozet = (y: { status: number; kod?: string }): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;
const tamam = (d: LisansDetayi): boolean => d.durum.gecerlilik === "GECERLI" && d.durum.uygulananKademe === "NORMAL";

/** Yanıttaki HAK'ın sürümü ve imzacısı (yoksa "yok"); kiranın bağlandığı HAK sürümü. */
function yanitOzeti(y: HamYanit): { hak: string; kiraSurum: number | null } {
  const h = jwsYuku(y.json.hak);
  const k = jwsYuku(y.json.kira);
  const hak = y.json.hak ? `s${String(h.surum)}:${typeof h.imzaciSertifikasi === "string" ? "ARA" : "KOK"}` : "yok";
  return { hak, kiraSurum: typeof k.hakSurum === "number" ? k.hakSurum : null };
}

async function kokTalebi<F extends RolFabrika>(b: G4Baglami<F>, hakId: string): Promise<KokTalebi | null> {
  const l = await b.portal.istek("GET", "/kok-kuyrugu?durum=BEKLIYOR&limit=200");
  return ((l.veri.items ?? []) as KokTalebi[]).find((t) => t.hakId === hakId) ?? null;
}

async function yerelMudahale<F extends RolFabrika>(b: G4Baglami<F>, dbId: string): Promise<string[]> {
  const u = ((await b.detayKurulum(dbId)).kopyaUyarilari as Array<{ tur: string; durum: string; ayrinti?: { nedenler?: string[] } }>).find((x) => x.tur === "YEREL_MUDAHALE" && x.durum === "ACIK");
  return u?.ayrinti?.nedenler ?? [];
}

async function zincirUcu<F extends RolFabrika>(b: G4Baglami<F>, dbId: string): Promise<string | null> {
  const r = await b.db(b.saticiDbUrl).query<{ u: string | null }>(`SELECT "sonKiraId" AS u FROM kurulum WHERE id = $1`, [dbId]);
  return r.rows[0]?.u ?? null;
}

// ============================================================ L40
export async function l40GenislikKapisi<F extends Makineli>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const ara = guncelAraImzaci();
  if (!ara) {
    a.kismi("L35'in ara imzacısı yok (L35 koşmadı ya da düştü) — ara imzalı daraltma basılamaz");
    return;
  }
  const k = await kur(b, a, "V", { parmakIzi: { makine: "5E0A0001-0000-4000-8000-0000000000F8", seri: "SENARYOV01", etkenler: { ...V_ETKEN } } });
  if (!k) return;
  const f = k.f;
  const dar = b.hakModulleri.filter((m) => m !== "depo.multiEnabled");
  const s2 = await b.portal.istek("POST", `/haklar/${k.hakId}/surum`, { imzaci: "ARA", imzaParolasi: ara.parola, sebep: "Senaryo L40 ara imzalı daraltma", moduller: dar });
  await f.istemci.yokla();
  const w = await f.istemci.bekle((d) => d.hak?.surum === 2 && tamam(d), 20_000);
  const pd = await b.detayKurulum(k.dbId);
  const surumler = (pd.hakSurumleri ?? []) as Array<{ surum: number; imzalayanKid: string }>;
  const kid = (s: number): string => surumler.find((v) => v.surum === s)?.imzalayanKid ?? "-";
  const yet = ((pd.kurulum as { yetenekler?: unknown } | undefined)?.yetenekler ?? []) as string[];
  a.kontrol(
    "yetenekli alıcı (`hak-ara` bildirir): sürüm 1 kök imzalı GENİŞ (3 modül) → sürüm 2 ARA imzalı DAR (depo.multiEnabled çıktı) → yoklamayla alır, NORMAL — arşiv genişlik kapısı 'hak-ara bildirene güncel sürüm' · §2.1",
    s2.status === 201 && kid(1) === b.kokKid && kid(2) === ara.kid && yet.includes("hak-ara") && w.ms !== null && w.detay.hak?.moduller.join(",") === dar.join(","),
    `sürüm 2 ${ozet(s2)} · imzacılar s1=${kid(1)} s2=${kid(2)} · yetenekler=[${yet.join(",")}] · fabrika s${String(w.detay.hak?.surum)} [${w.detay.hak?.moduller.join(",") ?? "-"}] ${w.detay.durum.hesaplananKademe} [${nedenOzeti(w.detay)}]`,
  );

  // Yetenek düşüşü: aynı kurulum anahtarı, V'nin son gerçek yoklama gövdesi; fabrika süreci durur (zincir yalnız ham istekle ilerler).
  const kayit = f.aktarici.sonKayit("/v1/yokla");
  await b.durdur(f);
  if (!kayit) {
    a.kismi("V'nin yoklama kaydı yok — yetenek düşüşü gövdesi kurulamadı");
    return;
  }
  const h = HamKurulum.klasorden(f.lisansDizini);
  const taban = JSON.parse(kayit.govde) as Record<string, unknown>;
  const yokla = async (o: { yetenekler: string[] | null; tutulan: number; sonKiraId: string | null; yol: boolean }): Promise<HamYanit> => {
    const simdi = b.saticiSimdi();
    const govde: Record<string, unknown> = { ...taban, sonKiraId: o.sonKiraId, hak: { hakId: k.hakId, surum: o.tutulan }, saat: { ...(taban.saat as object), duvar: msToIso(simdi), guvenilir: msToIso(simdi) } };
    delete govde.yetenekler;
    if (o.yetenekler) govde.yetenekler = o.yetenekler;
    const metin = JSON.stringify(govde);
    const imza = signRequest({ installationId: h.kurulumId, purpose: "yokla", body: metin, key: { privateKey: h.privateKey, nowMs: simdi }, ...(o.yol ? { path: "/v1/yokla" } : {}) });
    return hamGonder(b.saticiGenel, "/v1/yokla", metin, { [REQUEST_HEADER]: imza });
  };

  // (a) eksik yetenekli (parmak-izi-v2 · odenmis-tarih, `hak-ara` YOK), elinde DAR ara imzalı sürüm 2.
  const uc0 = await zincirUcu(b, k.dbId);
  const r1 = await yokla({ yetenekler: ["odenmis-tarih", "parmak-izi-v2"], tutulan: 2, sonKiraId: uc0, yol: true });
  const y1 = yanitOzeti(r1);
  const t1 = await kokTalebi(b, k.hakId);
  const n1 = await yerelMudahale(b, k.dbId);
  a.kontrol(
    "eksik yetenekli alıcı (hak-ara yok) + elinde dar sürüm 2: 200 ama HAK TESLİM EDİLMEZ (`hak: null` — ne ara imzalı s2 ne GENİŞ kök s1), kira elindeki güvenli sürüme (s2) bağlanır; güncel şartlar kök kuyruğunda BEKLIYOR, YEREL_MUDAHALE nedeni YETENEK_DUSUSU — arşiv genişlik kapısı karar + 'meşru geri dönüş (i)'",
    r1.status === 200 && y1.hak === "yok" && y1.kiraSurum === 2 && t1 !== null && n1.includes("YETENEK_DUSUSU"),
    `${ozet(r1)} hak=${y1.hak} kira→s${String(y1.kiraSurum)} · kök talebi=${t1 ? `${t1.durum} acil=${String(t1.acil)}` : "yok"} · yerel müdahale=[${n1.join(",")}]`,
  );

  // (b) yeteneksiz eski derleme (alan yok, yol yok) + elinde GENİŞ kök sürüm 1: güvenli bağ yok → kira verilmez.
  const uc1 = await zincirUcu(b, k.dbId);
  const bildirim0 = await acilBildirim(b, k.dbId);
  const r2 = await yokla({ yetenekler: null, tutulan: 1, sonKiraId: uc1, yol: false });
  const y2 = yanitOzeti(r2);
  const t2 = await kokTalebi(b, k.hakId);
  const uc2 = await zincirUcu(b, k.dbId);
  const bildirim1 = await acilBildirim(b, k.dbId);
  a.kontrol(
    "yeteneksiz alıcı + elinde GENİŞ kök sürüm 1: 403 KIRA_VERILMEDI, yanıtta HAK YOK (güncelden geniş eski kök teslim edilmez); zincir ucu değişmez; kök talebi ACİL + talep başına TEK KOK_IMZASI_ACIL bildirimi (kanal başına bir satır) — arşiv genişlik kapısı 'güvenli sürüm yoksa KİRA VERİLMEZ'",
    r2.status === 403 && r2.kod === "KIRA_VERILMEDI" && y2.hak === "yok" && uc2 === uc1 && t2?.acil === true && tekBildirim(bildirim0, bildirim1),
    `${ozet(r2)} hak=${y2.hak} · uç ${uc1 === uc2 ? "aynı" : "DEĞİŞTİ"} · kök talebi=${t2 ? `${t2.durum} acil=${String(t2.acil)}` : "yok"} · KOK_IMZASI_ACIL kanal başına [${bildirimOzeti(bildirim0)}] → [${bildirimOzeti(bildirim1)}]`,
  );
}

/** Kurulumun KOK_IMZASI_ACIL bildirim satırları, kanal başına (bir olay = kanal başına bir satır: e-posta + Telegram). */
async function acilBildirim<F extends RolFabrika>(b: G4Baglami<F>, dbId: string): Promise<Record<string, number>> {
  const l = await b.portal.istek("GET", "/bildirimler?olay=KOK_IMZASI_ACIL&limit=200");
  const out: Record<string, number> = {};
  for (const x of (l.veri.items ?? []) as Array<{ kurulumId?: string | null; kanal?: string }>) if (x.kurulumId === dbId) out[x.kanal ?? "?"] = (out[x.kanal ?? "?"] ?? 0) + 1;
  return out;
}
/** İki ölçüm arasında her kanalda TAM bir yeni satır (talep başına tek bildirim). */
function tekBildirim(once: Record<string, number>, sonra: Record<string, number>): boolean {
  const kanallar = Object.keys(sonra);
  return kanallar.length > 0 && kanallar.every((k) => sonra[k]! - (once[k] ?? 0) === 1);
}
const bildirimOzeti = (x: Record<string, number>): string => Object.entries(x).map(([k, n]) => `${k}=${n}`).join(" ") || "yok";
