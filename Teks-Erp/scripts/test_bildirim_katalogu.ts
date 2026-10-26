// =============================================================================
// BEKÇİ — BİLDİRİM KATALOĞU (bildirim v2, N0-KAT)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_katalogu
// =============================================================================
// NEDEN: `NOTIFICATION_CATALOG` görme süzgecinin (izin ∧ modül), derin bağlantının
// ve şablonun TEK kaynağıdır. Elle yazılır → ekran kataloğundan ayrışırsa bildirim
// ya göremeyen birine gider ya da açılmayan bir ekrana götürür; şablon beyansız alan
// okursa kullanıcı `—` görür. Bu bekçi kataloğu SCREEN_CATALOG + izin kataloğuna
// ve kendi beyanlarına karşı ölçer:
//   §1 panelEkran/tabletEkran SCREEN_CATALOG'da · §1b panelYol ekranın altında
//   §2 modul = panel ekranının modülü · §3 her izin konjonksiyonu ekranın `requires`ından
//   en az birini içerir · §4 kilitli tür varsayılan KAPALI olamaz · §5 yer tutucular ⇄
//   payloadAlanlari (iki yönlü) · §6 KOSUL/ALARM `cozuldu` dolu, pencere ≥0 · §7 param
//   şeması varsayılanla parse olur ve bilinmeyen anahtarı reddeder · §8 payload'da tutar/sır adı yok ·
//   §9 patron eşlemesi: her tür `NOTIFICATION_PATRON_MAP`te, `patronKind` bulut `KIND_RULES` anahtarı (dosya
//   metninden; paketler arası import yok), `null` gerekçeli.
// DB GEREKTİRMEZ.
//
// NEGATİF SONDA (2026-10-24, md5 ile birebir geri alındı):
//   S1 `sevkiyat.onay-bekliyor.panelEkran` → "yok/ekran"     ⇒ 4 ❌ (§1 · §1b · §2 · §3)
//   S2 `sistem.yedek-basarisiz.govde`e `{tutar}` eklendi      ⇒ 2 ❌ (§5 · §5c render)
//   S3 `sistem.yedek-basarisiz.varsayilan` → "KAPALI" (kilit HER_ZAMAN) ⇒ 1 ❌ (§4)
//   S4 (2026-10-25) eşlemede `patronKind: "yedek-yok"` (bulutta yok)    ⇒ 1 ❌ (§9b)
//   S5 (2026-10-25) eşlemeden `yazici.hata` satırı silindi             ⇒ 1 ❌ (§9)
//   S6 (2026-10-26) render'da `forText` yok sayıldı (String(v))      ⇒ 1 ❌ (§5d)
// =============================================================================
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_GRUPLARI,
  NOTIFICATION_KINDS,
  type NotificationCatalogEntry,
  type NotificationKind,
} from "../src/constants/notification-catalog";
import { NOTIFICATION_PATRON_MAP } from "../src/constants/notification-patron-map";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { placeholdersOf, renderNotification } from "../src/services/helpers/notification-render.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const girdiler: Array<[NotificationKind, NotificationCatalogEntry]> =
  NOTIFICATION_KINDS.map((k) => [k, NOTIFICATION_CATALOG[k] as NotificationCatalogEntry]);
const masaustu = new Map(SCREEN_CATALOG.filter((s) => s.app === "desktop").map((s) => [s.key, s]));
const mobil = new Map(SCREEN_CATALOG.filter((s) => s.app === "mobile").map((s) => [s.key, s]));
const izinKodlari = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));

/** İhlal listesi boşsa ✅, değilse ❌ + ilk ihlaller. */
function kural(label: string, ihlaller: string[], olculen: string): void {
  check(label, ihlaller.length === 0, ihlaller.length ? ihlaller.join(" · ") : olculen);
}

function main(): void {
  console.log("=== BİLDİRİM KATALOĞU ===\n");

  // ── §0 körlük zemini + kimlik ─────────────────────────────────────────────
  check("§0 katalog v1: 16 tür (A4 yazici.hata, D5 cihaz.halka-kaybi)", girdiler.length === 16, `${girdiler.length} tür`);
  kural("§0b `kod` = anahtar ve `<alan>.<tür>` kalıbında",
    girdiler.filter(([k, e]) => e.kod !== k || !/^[a-z0-9]+\.[a-z0-9-]+$/.test(k)).map(([k]) => k), "hepsi");
  kural("§0c `grup` beyanlı dokuz gruptan", girdiler.filter(([, e]) => !NOTIFICATION_GRUPLARI.includes(e.grup))
    .map(([k, e]) => `${k}: ${e.grup}`), "hepsi");
  kural("§0d ALARM ⇔ altTur null", girdiler.filter(([, e]) => (e.sinif === "ALARM") !== (e.altTur === null))
    .map(([k]) => k), `${girdiler.filter(([, e]) => e.sinif === "ALARM").length} ALARM`);

  // ── §1 ekran var ──────────────────────────────────────────────────────────
  kural("§1 ⭐ her `panelEkran` SCREEN_CATALOG masaüstü anahtarı",
    girdiler.filter(([, e]) => !masaustu.has(e.panelEkran)).map(([k, e]) => `${k}: ${e.panelEkran}`),
    `${masaustu.size} masaüstü ekranına karşı`);
  kural("§1a her `tabletEkran` SCREEN_CATALOG mobil anahtarı",
    girdiler.filter(([, e]) => e.tabletEkran !== undefined && !mobil.has(e.tabletEkran))
      .map(([k, e]) => `${k}: ${e.tabletEkran}`), `${girdiler.filter(([, e]) => e.tabletEkran).length} tablet ekranı`);
  kural("§1b `panelYol` ekranın adresi altında (`/<panelEkran>` + `/`·`?`·son)",
    girdiler.filter(([, e]) => {
      const kok = `/${e.panelEkran}`;
      return !(e.panelYol === kok || e.panelYol.startsWith(`${kok}/`) || e.panelYol.startsWith(`${kok}?`));
    }).map(([k, e]) => `${k}: ${e.panelYol} ⊄ /${e.panelEkran}`), "hepsi");

  // ── §2 modül = ekranın modülü ─────────────────────────────────────────────
  kural("§2 ⭐ `modul` = panel ekranının `modul`u",
    girdiler.filter(([, e]) => masaustu.get(e.panelEkran)?.modul !== e.modul)
      .map(([k, e]) => `${k}: ${e.modul} ≠ ${masaustu.get(e.panelEkran)?.modul ?? "(ekran yok)"}`), "hepsi");

  // ── §3 izin ↔ ekran requires ──────────────────────────────────────────────
  kural("§3 ⭐ her izin konjonksiyonu panel/tablet ekranının `requires`ından en az birini içerir",
    girdiler.flatMap(([k, e]) => {
      const req = new Set([...(masaustu.get(e.panelEkran)?.requires ?? []),
        ...(e.tabletEkran ? mobil.get(e.tabletEkran)?.requires ?? [] : [])]);
      return e.izinler.filter((konj) => !konj.some((c) => req.has(c))).map((konj) => `${k}: [${konj.join(", ")}]`);
    }), "hepsi");
  kural("§3b izinler ve varsayılan izin listesi İZİN KATALOĞUNDA",
    girdiler.flatMap(([k, e]) => [...e.izinler.flat(), ...(Array.isArray(e.varsayilan) ? e.varsayilan : [])]
      .filter((c) => !izinKodlari.has(c)).map((c) => `${k}: ${c}`)), "hepsi");
  kural("§3c her türün en az bir izin konjonksiyonu var, boş konjonksiyon yok",
    girdiler.filter(([, e]) => e.izinler.length === 0 || e.izinler.some((konj) => konj.length === 0)).map(([k]) => k), "hepsi");

  // ── §4 kilit ──────────────────────────────────────────────────────────────
  kural("§4 ⭐ kilitli tür (kilit ≠ YOK) varsayılan KAPALI olamaz",
    girdiler.filter(([, e]) => e.kilit !== "YOK" && e.varsayilan === "KAPALI").map(([k]) => k),
    `${girdiler.filter(([, e]) => e.kilit !== "YOK").length} kilitli tür`);
  kural("§4b kilitli türde `kilitGerekcesi` dolu, kilitsizde yok",
    girdiler.filter(([, e]) => (e.kilit !== "YOK") !== Boolean(e.kilitGerekcesi?.trim())).map(([k]) => k), "hepsi");

  // ── §5 yer tutucular ⇄ payloadAlanlari ────────────────────────────────────
  const sablonlar = (e: NotificationCatalogEntry): string[] =>
    [e.baslik, e.govde, e.cozuldu ?? "", e.panelYol, e.tekilKalibi];
  kural("§5 ⭐ şablon yer tutucuları ⊆ `payloadAlanlari` (başlık · gövde · çözüldü · yol · tekil kalıp)",
    girdiler.flatMap(([k, e]) => sablonlar(e).flatMap(placeholdersOf)
      .filter((a) => !e.payloadAlanlari.includes(a)).map((a) => `${k}: {${a}}`)), "hepsi");
  kural("§5b her beyanlı payload alanı bir şablonda kullanılır (ölü beyan yok)",
    girdiler.flatMap(([k, e]) => {
      const kullanilan = new Set(sablonlar(e).flatMap(placeholdersOf));
      return e.payloadAlanlari.filter((a) => !kullanilan.has(a)).map((a) => `${k}: ${a}`);
    }), "hepsi");
  const renderHata: string[] = [];
  for (const [k, e] of girdiler) {
    const dolu = Object.fromEntries(e.payloadAlanlari.map((a) => [a, `x${a}`]));
    for (const faz of ["OLAY", "ACILDI", "KAPANDI"] as const) {
      const r = renderNotification(k, dolu, faz);
      if ([r.baslik, r.govde, r.yol].some((s) => s.includes("—") || s.includes("{"))) renderHata.push(`${k}/${faz} dolu`);
    }
    const bos = renderNotification(k, {}, "OLAY");
    if (placeholdersOf(e.panelYol).length > 0 && bos.yol !== `/${e.panelEkran}`) renderHata.push(`${k} eksik yol: ${bos.yol}`);
    if (bos.baslik.includes("{") || bos.govde.includes("{")) renderHata.push(`${k} boş payload`);
  }
  kural("§5c render: dolu payload yer tutucusuz; eksik alan `—`, eksik yol ekran köküne düşer",
    renderHata, `${girdiler.length} tür × 4 render`);
  const lev = renderNotification("dokuma.levent-bitiyor", { tezgahNo: 1234, leventNo: 10.5, kalanGun: 0.8 }, "ACILDI");
  kural("§5d metinde sayı Türkçe ondalıkla (\"0,8\"), gruplamasız; yolda ham",
    lev.govde.includes("~0,8 gün") && lev.govde.startsWith("1234 ") && lev.yol.endsWith("search=10.5") ? [] : [lev.govde, lev.yol],
    "levent-bitiyor sayı payload");

  // ── §6 alt tür sözleşmesi ─────────────────────────────────────────────────
  kural("§6 ⭐ KOSUL ve ALARM'da `cozuldu` dolu; OLAY'da yok",
    girdiler.filter(([, e]) => (e.altTur === "OLAY") === Boolean(e.cozuldu?.trim())).map(([k]) => k), "hepsi");
  kural("§6b `pencereSn` tam sayı ≥ 0; pencere yalnız OLAY'da",
    girdiler.filter(([, e]) => !Number.isInteger(e.pencereSn) || e.pencereSn < 0
      || (e.altTur !== "OLAY" && e.pencereSn !== 0)).map(([k, e]) => `${k}: ${e.pencereSn}`), "hepsi");
  kural("§6c kanallar UYGULAMA'yı içerir, varsayılan kanallar ⊆ kanallar, TABLET_SES yalnız tablet ekranlı türde",
    girdiler.filter(([, e]) => !e.kanallar.includes("UYGULAMA")
      || e.varsayilanKanallar.some((c) => !e.kanallar.includes(c))
      || (e.kanallar.includes("TABLET_SES") && !e.tabletEkran)).map(([k]) => k), "hepsi");
  kural("§6d `tahminiHaftalik` ≥ 0, saklama okunmuş ≤ okunmamış",
    girdiler.filter(([, e]) => !(e.tahminiHaftalik >= 0) || e.saklama.okunmusGun > e.saklama.okunmamisGun).map(([k]) => k), "hepsi");

  // ── §7 param şeması ───────────────────────────────────────────────────────
  const paramli = girdiler.filter(([, e]) => e.paramSemasi !== undefined);
  check("§7z körlük zemini: param şemalı tür var", paramli.length >= 5, `${paramli.length} tür`);
  kural("§7 ⭐ param şeması boş nesneyi varsayılanlarla parse eder",
    paramli.filter(([, e]) => !e.paramSemasi!.safeParse({}).success).map(([k]) => k), "hepsi");
  kural("§7b param şeması katı: bilinmeyen anahtar reddedilir",
    paramli.filter(([, e]) => e.paramSemasi!.safeParse({ bilinmeyenAnahtar: 1 }).success).map(([k]) => k), "hepsi");

  // ── §8 sır/tutar ──────────────────────────────────────────────────────────
  const YASAK = /tutar|fiyat|bakiye|borc|alacak|parola|sifre|şifre|pin$|token|secret|password/i;
  kural("§8 payload alan adları tutar/sır taşımaz",
    girdiler.flatMap(([k, e]) => e.payloadAlanlari.filter((a) => YASAK.test(a)).map((a) => `${k}: ${a}`)), "hepsi");

  // ── §9 patron bulutu eşlemesi ─────────────────────────────────────────────
  const bulutMetni = readFileSync(resolve(__dirname, "../../patron/sunucu/src/catalog/notifications.ts"), "utf8");
  const kurallar = bulutMetni.slice(bulutMetni.indexOf("export const KIND_RULES"), bulutMetni.indexOf("export function catalogProblems"));
  const bulutTurleri = new Set([...kurallar.matchAll(/^ {2}"([a-z0-9-]+)": \{/gm)].map((m) => m[1]!));
  check("§9z körlük zemini: bulut kataloğu okundu", bulutTurleri.size >= 5 && bulutTurleri.has("yedek-basarisiz"), `${bulutTurleri.size} bulut türü`);
  const harita = NOTIFICATION_PATRON_MAP as Readonly<Record<string, { patronKind: string | null; neden?: string } | undefined>>;
  kural("§9 her fabrika türü patron eşlemesinde", NOTIFICATION_KINDS.filter((k) => !harita[k]), "hepsi");
  kural("§9b `patronKind` bulut `KIND_RULES` anahtarı ya da null + gerekçe",
    Object.entries(harita).flatMap(([k, m]) => (!m ? [] : m.patronKind === null ? (m.neden?.trim() ? [] : [`${k}: gerekçesiz null`])
      : bulutTurleri.has(m.patronKind) ? [] : [`${k}: ${m.patronKind}`])), "hepsi");
  kural("§9c eşlemede katalog dışı fabrika türü yok", Object.keys(harita).filter((k) => !(NOTIFICATION_KINDS as string[]).includes(k)), "hepsi");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
