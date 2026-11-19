// =============================================================================
// BEKÇİ — BİLDİRİM YÖNETİM: profil tercih kilidi + kişi kartı yönetici tercihleri (2026-11-19) — HTTP, süreç içi
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_yonetim
// =============================================================================
//   §1 ⭐ kilitli profil üyesinin uygulama-içi PUT'u 409 `NOTIFICATION_PREFS_LOCKED`; değişmeyen tam gövde + yan kanal
//      değişikliği 200; gövdede olmayan ve kilitten önce yazılmış uygulama-içi satır KORUNUR; GET `tercihKilidi`
//   §2 ⭐ birleşim fail-closed: kilitli + kilitsiz profil → kilitli; yalnız kilitsiz profil üyesi serbest; kilit
//      kalkınca ya da üyelikten çıkınca serbest
//   §3 varsayılana dön: önizleme satırı `kilitli`, POST uygulama-içi satırı 409
//   §4 yönetici özeti: gizli tür gerekçeli, kaynak profil/kişisel; izinsiz 403
//   §5 ⭐ yönetici yazımı: kişinin göremediği türü açamaz 400; tür kilidi 409; kilitli kişiye yazar (seyrek);
//      null kişisel satırı kaldırır; audit satırı (kim, kimin için, hangi tür); izinsiz 403
//
// NEGATİF SONDALAR: bkz. arşiv 2026-11 "bildirim-yonetim" (her biri md5 ile birebir geri alındı).
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); fikstür bulduğu değere döner. Yalnız kendi kullanıcı/profil satırına dokunur.
// =============================================================================
import prisma from "../src/lib/prisma";
import { BildirimFikstur, type FiksturKullanici } from "./lib/bildirim-http-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const fx = new BildirimFikstur(`byon-${ek}`);
const profileCodes: string[] = [];

const YEDEK = "sistem.yedek-basarisiz"; // kilit HER_ZAMAN · system:backups
const ESITLEME = "sistem.esitleme-gecikti"; // kilit YOK · admin:users · varsayılan HERKES
const TERMIN = "siparis.termin-yaklasti"; // order:read
const SERTIFIKA = "kalite.sertifika-suresi-doluyor"; // certificate:read — kişide YOK

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const code = (r: { json: Json }) => r.json?.error?.details?.code ?? r.json?.details?.code;

async function profil(m: FiksturKullanici, ad: string, uyeler: string[]): Promise<string> {
  const kod = `BY${ad}${ek}`.toUpperCase().slice(0, 40);
  profileCodes.push(kod);
  const p = await fx.istek(m.token, "POST", "/api/bildirim/profiller", { kod, ad: `${ad} ${ek}` });
  const id = p.json?.data?.id as string;
  await fx.istek(m.token, "PUT", `/api/bildirim/profiller/${id}/uyeler`, { userIds: uyeler });
  return id;
}

/** Sunucunun çözdüğü hücrelerden tam gövde (panelin `draftToBody`ının sadeleşmiş eşi). */
function fullBody(hucreler: Json[]): Json[] {
  const out: Json[] = [];
  for (const h of hucreler) {
    for (const k of h.kanallar) {
      if (k.durum === "GIZLI") continue;
      const it: Json = { tur: h.kind, kanal: k.kanal, acik: k.durum === "ACIK" };
      if (k.kanal === "UYGULAMA" && k.kapsam) {
        const { schemaVersion: _v, ...rest } = k.kapsam;
        it.kapsam = rest;
      }
      out.push(it);
    }
  }
  return out;
}

const prefRows = (userId: string) =>
  prisma.notificationPreference.findMany({ where: { userId }, select: { id: true, kind: true, channel: true, enabled: true } });

async function bolum1(a: FiksturKullanici, m: FiksturKullanici): Promise<string> {
  console.log("=== §1 profil tercih kilidi ===");
  const put = (tercihler: unknown[]) => fx.istek(a.token, "PUT", "/api/bildirim/tercihler", { tercihler });
  const once = await put([{ tur: ESITLEME, kanal: "UYGULAMA", acik: false }]);
  check("§1 ön koşul: kilitten önce kişisel kapatma yazılır", once.status === 200, `${once.status}`);
  const pid = await profil(m, "Kilit", [a.id]);
  const varsayilan = await fx.istek(m.token, "GET", "/api/bildirim/profiller");
  const satir = (varsayilan.json?.data?.items ?? []).find((p: Json) => p.id === pid);
  check("§1a yeni profilin tercih kilidi varsayılan KAPALI (bugünkü davranış)", satir?.tercihKilidi === false, JSON.stringify(satir?.tercihKilidi));
  const serbest = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  check("§1b kilitsiz profilde GET tercihKilidi.kilitli=false", serbest.json?.data?.tercihKilidi?.kilitli === false, JSON.stringify(serbest.json?.data?.tercihKilidi));
  const yetkisiz = await fx.istek(a.token, "PATCH", `/api/bildirim/profiller/${pid}`, { tercihKilidi: true });
  check("§1c izinsiz kişi profil kilidini açamaz → 403", yetkisiz.status === 403, `${yetkisiz.status}`);
  const kilit = await fx.istek(m.token, "PATCH", `/api/bildirim/profiller/${pid}`, { tercihKilidi: true });
  check("§1d yönetici kilidi açar (PATCH tercihKilidi)", kilit.status === 200 && kilit.json?.data?.tercihKilidi === true, `${kilit.status}`);
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  const tk = g.json?.data?.tercihKilidi;
  check("§1e GET tercihKilidi: kilitli + profil adı + donan kanallar", tk?.kilitli === true && tk?.profiller?.length === 1 && JSON.stringify(tk?.kanallar) === '["UYGULAMA","OZET"]', JSON.stringify(tk));
  const r1 = await put([{ tur: ESITLEME, kanal: "UYGULAMA", acik: true }]);
  check("§1f ⭐ kilitli üye uygulama-içini değiştiremez → 409 NOTIFICATION_PREFS_LOCKED", r1.status === 409 && code(r1) === "NOTIFICATION_PREFS_LOCKED", `${r1.status} ${code(r1)}`);
  const r2 = await put([{ tur: TERMIN, kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } }]);
  check("§1g kapsam eklemek de uygulama-içi değişikliktir → 409", r2.status === 409 && code(r2) === "NOTIFICATION_PREFS_LOCKED", `${r2.status} ${code(r2)}`);
  const body = fullBody(g.json?.data?.hucreler ?? []);
  const masa = body.find((it) => it.kanal === "MASAUSTU");
  if (masa) masa.acik = !masa.acik;
  const r3 = await put(body);
  const rows = await prefRows(a.id);
  check("§1h değişmeyen tam gövde + yan kanal (masaüstü) değişikliği → 200", r3.status === 200 && !!masa, `${r3.status} masaustu=${masa?.tur}`);
  check("§1i kilitten önceki uygulama-içi satır korunur", rows.some((r) => r.kind === ESITLEME && r.channel === "UYGULAMA" && !r.enabled), JSON.stringify(rows));
  const r4 = await put(masa ? [{ tur: masa.tur, kanal: "MASAUSTU", acik: !masa.acik }] : []);
  const rows2 = await prefRows(a.id);
  check("§1j gövdede olmayan uygulama-içi satır kilitliyken SİLİNMEZ", r4.status === 200 && rows2.some((r) => r.kind === ESITLEME && r.channel === "UYGULAMA"), `${r4.status} ${JSON.stringify(rows2)}`);
  const ayar = await fx.istek(a.token, "PUT", "/api/bildirim/ayarlar", { sessizBaslangic: null, sessizBitis: null, sessizKanallar: [], ozetSaati: null, ses: false });
  check("§1k sessiz saat/ses ayarı kilitten etkilenmez → 200", ayar.status === 200, `${ayar.status}`);
  return pid;
}

async function bolum2(a: FiksturKullanici, c: FiksturKullanici, m: FiksturKullanici, kilitli: string): Promise<void> {
  console.log("\n=== §2 birleşim (fail-closed) ===");
  const acikProfil = await profil(m, "Serbest", [a.id, c.id]);
  const put = (u: FiksturKullanici, acik: boolean) => fx.istek(u.token, "PUT", "/api/bildirim/tercihler", { tercihler: [{ tur: ESITLEME, kanal: "UYGULAMA", acik }] });
  const r1 = await put(a, true);
  check("§2a ⭐ kilitli + kilitsiz profil üyesi → kilitli (409)", r1.status === 409 && code(r1) === "NOTIFICATION_PREFS_LOCKED", `${r1.status} ${code(r1)}`);
  const r2 = await put(c, false);
  check("§2b yalnız kilitsiz profil üyesi serbest → 200", r2.status === 200, `${r2.status} ${code(r2)}`);
  await fx.istek(m.token, "PATCH", `/api/bildirim/profiller/${kilitli}`, { tercihKilidi: false });
  const r3 = await put(a, false);
  check("§2c kilit kalkınca üye yazabilir → 200", r3.status === 200, `${r3.status} ${code(r3)}`);
  await fx.istek(m.token, "PATCH", `/api/bildirim/profiller/${kilitli}`, { tercihKilidi: true });
  const r4 = await put(a, true);
  await fx.istek(m.token, "PUT", `/api/bildirim/profiller/${kilitli}/uyeler`, { userIds: [] });
  const r5 = await put(a, true);
  check("§2d yeniden kilit 409; kilitli profilden çıkınca serbest 200", r4.status === 409 && r5.status === 200, `${r4.status}/${r5.status}`);
  await fx.istek(m.token, "PUT", `/api/bildirim/profiller/${acikProfil}/uyeler`, { userIds: [] });
}

async function bolum3(a: FiksturKullanici, m: FiksturKullanici, kilitli: string): Promise<void> {
  console.log("\n=== §3 varsayılana dön ===");
  await fx.istek(a.token, "PUT", "/api/bildirim/tercihler", { tercihler: [{ tur: ESITLEME, kanal: "UYGULAMA", acik: false }] });
  await fx.istek(m.token, "PUT", `/api/bildirim/profiller/${kilitli}/uyeler`, { userIds: [a.id] });
  const on = await fx.istek(a.token, "POST", "/api/bildirim/tercihler/varsayilana-don/onizleme");
  const s = (on.json?.data?.satirlar ?? []).find((r: Json) => r.tur === ESITLEME && r.kanal === "UYGULAMA");
  check("§3a önizleme satırı kilitli=true", on.status === 200 && s?.kilitli === true, JSON.stringify(s));
  const del = await fx.istek(a.token, "POST", "/api/bildirim/tercihler/varsayilana-don", { ids: [s?.id] });
  const kaldi = await prisma.notificationPreference.count({ where: { id: s?.id } });
  check("§3b uygulama-içi satırı varsayılana döndürmek → 409, satır yerinde", del.status === 409 && code(del) === "NOTIFICATION_PREFS_LOCKED" && kaldi === 1, `${del.status} ${code(del)} kaldi=${kaldi}`);
}

async function bolum4(a: FiksturKullanici, c: FiksturKullanici, m: FiksturKullanici): Promise<void> {
  console.log("\n=== §4 yönetici özeti ===");
  const g = await fx.istek(m.token, "GET", `/api/bildirim/kullanicilar/${a.id}/tercihler`);
  const d = g.json?.data;
  const sert = (d?.turler ?? []).find((t: Json) => t.tur === SERTIFIKA);
  const es = (d?.turler ?? []).find((t: Json) => t.tur === ESITLEME)?.kanallar?.find((k: Json) => k.kanal === "UYGULAMA");
  const gizliler = (d?.turler ?? []).filter((t: Json) => !t.gorur);
  check("§4a özet: göremediği tür gorur=false, kanalsız ve HER biri gerekçeli", g.status === 200 && sert?.gorur === false && gizliler.length > 0 && gizliler.every((t: Json) => (t.gizliNeden ?? "").length > 0 && t.kanallar.length === 0), `${g.status} ${JSON.stringify(sert?.gizliNeden)}`);
  const gc = await fx.istek(m.token, "GET", `/api/bildirim/kullanicilar/${c.id}/tercihler`);
  const yedekC = (gc.json?.data?.turler ?? []).find((t: Json) => t.tur === YEDEK);
  check("§4a2 izin eksikliği gerekçesi yetki adını söyler (çekirdek modül türü)", yedekC?.gorur === false && /yetki/.test(yedekC?.gizliNeden ?? ""), JSON.stringify(yedekC?.gizliNeden));
  check("§4b özet: kişisel satır + kaynak kullanici + tercih kilidi", es?.durum === "KAPALI" && es?.kaynak === "kullanici" && es?.kisisel?.acik === false && d?.tercihKilidi?.kilitli === true, JSON.stringify(es));
  const y = await fx.istek(c.token, "GET", `/api/bildirim/kullanicilar/${a.id}/tercihler`);
  check("§4c izinsiz özet → 403", y.status === 403, `${y.status}`);
}

async function bolum5(a: FiksturKullanici, c: FiksturKullanici, m: FiksturKullanici): Promise<void> {
  console.log("\n=== §5 yönetici yazımı ===");
  const put = (u: FiksturKullanici, tercihler: unknown[]) => fx.istek(u.token, "PUT", `/api/bildirim/kullanicilar/${a.id}/tercihler`, { tercihler });
  const r1 = await put(m, [{ tur: SERTIFIKA, kanal: "UYGULAMA", acik: true }]);
  const yok = await prisma.notificationPreference.count({ where: { userId: a.id, kind: SERTIFIKA } });
  check("§5a ⭐ kişinin göremediği türü yönetici açamaz → 400 NOTIFICATION_KIND_NOT_VISIBLE, satır yok", r1.status === 400 && code(r1) === "NOTIFICATION_KIND_NOT_VISIBLE" && yok === 0, `${r1.status} ${code(r1)} n=${yok}`);
  const r2 = await put(m, [{ tur: YEDEK, kanal: "UYGULAMA", acik: false }]);
  check("§5b tür kilidi yöneticiyi de bağlar → 409 NOTIFICATION_KIND_LOCKED", r2.status === 409 && code(r2) === "NOTIFICATION_KIND_LOCKED", `${r2.status} ${code(r2)}`);
  const r3 = await put(m, [{ tur: ESITLEME, kanal: "UYGULAMA", acik: true }, { tur: TERMIN, kanal: "UYGULAMA", acik: false }]);
  const rows = await prefRows(a.id);
  const es = rows.find((r) => r.kind === ESITLEME && r.channel === "UYGULAMA");
  const te = rows.find((r) => r.kind === TERMIN && r.channel === "UYGULAMA");
  check("§5c kilitli kişiye yönetici yazar; seyrek (tabana eşit satır silinir, sapan yazılır)", r3.status === 200 && !es && te?.enabled === false, `${r3.status} ${JSON.stringify(rows)}`);
  let audit = null;
  for (let i = 0; i < 20 && !audit; i++) {
    audit = await prisma.systemLog.findFirst({ where: { tableName: "NOTIFICATION_PREFERENCE", recordId: a.id, userId: m.id }, select: { id: true, newData: true } });
    if (!audit) await new Promise((r) => setTimeout(r, 100));
  }
  check("§5d audit: yazan yönetici, hedef kişi, tür", !!audit && JSON.stringify(audit.newData).includes(TERMIN), JSON.stringify(audit?.newData ?? null).slice(0, 160));
  const r4 = await put(m, [{ tur: TERMIN, kanal: "UYGULAMA", acik: null }]);
  const te2 = await prisma.notificationPreference.count({ where: { userId: a.id, kind: TERMIN, channel: "UYGULAMA" } });
  check("§5e acik:null kişisel satırı kaldırır", r4.status === 200 && te2 === 0, `${r4.status} n=${te2}`);
  const r5 = await put(c, [{ tur: ESITLEME, kanal: "UYGULAMA", acik: false }]);
  check("§5f izinsiz yazım → 403", r5.status === 403, `${r5.status}`);
  const r6 = await fx.istek(m.token, "PUT", `/api/bildirim/kullanicilar/${a.id}/tercihler`, { tercihler: [{ tur: ESITLEME, kanal: "SMS", acik: true }] });
  check("§5g tanınmayan kanal → 400", r6.status === 400, `${r6.status}`);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim yönetim (profil tercih kilidi + kişi kartı) ===\n");
  try {
    await fx.ac();
    await fx.bayrak(true);
    const a = await fx.kullanici("a", ["system:backups", "admin:users", "order:read"]);
    const m = await fx.kullanici("m", ["settings:notifications"]);
    const c = await fx.kullanici("c", ["admin:users"]);
    const kilitli = await bolum1(a, m);
    await bolum2(a, c, m, kilitli);
    await bolum3(a, m, kilitli);
    await bolum4(a, c, m);
    await bolum5(a, c, m);
  } finally {
    if (profileCodes.length) await prisma.notificationProfile.deleteMany({ where: { code: { in: profileCodes } } });
    await fx.kapat();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("❌ beklenmeyen hata:", err);
  await fx.kapat().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
