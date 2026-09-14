// =============================================================================
// KAPI SEMAFORU — makine genelinde en çok N eşzamanlı ağır kapı (zero-dep)
// =============================================================================
// ⭐ NEDEN VAR (ölçüldü 2026-09-13, d5; 24 GB / 10 çekirdek; 1e hükmü): bir
//    backend kapısı (tsc + eslint ×2) tepe 3,5 GB, boşta 43 sn. Eşzamanlı:
//      N=1 43 sn · N=2 52 · N=3 74 (9,4 GB, paging yok) · N=4 130 (RSS platoda,
//      paging) · N=6 332 sn (swap +1,1 GB, load 20) — gecenin 470–767 sn'si bu.
//    Semafor 3: altı kapı 74/74/74/148/148/148 (en kötü 148 ↔ 332); tam
//    serileştirme N=2'de kötü (86 ↔ 52). "İniş penceresi tek sahipli" kuralı
//    kapı KOŞUMUNA "üç sahipli" olarak iner — ölçüm bunu söylüyor.
//    ⚠️ 3 → 4 (1e hükmü 2026-09-14 03:30, saha defteri): sarmalayıcı (`agir-is.mjs`)
//    benimsenip KAPI-DIŞI tsc/eslint/test de bu havuzdan geçince kuyruk BAĞLAYICI
//    oldu — 03:00–03:27: 108 alım, 26 bekleme, toplam 2.226 sn, max 268 sn; load
//    ort 16,8 (CPU değil kuyruk). 4. slot load'u ~20→27'ye taşır (tsc ≈ +%30) ama
//    268 sn'lik beklemeleri keser. YENİDEN ÖLÇÜM 2026-09-21: defterden bekleme
//    toplamı ↔ adım süresi toplamı; hangisi büyürse kapasite o yöne oynar.
//
// MEKANİZMA: os.tmpdir()/tekserp-kapi-semafor/slot-{0..N-1} — slot bir DİZİNDİR
//    (`mkdir` atomik: iki hook aynı slotu alamaz), içinde `pid` dosyası.
//    ⚠️ ÖLÜ KİLİT TUZAĞI: öldürülen kapı (OOM · Ctrl-C · SIGKILL) slotu bırakamaz.
//    Bu yüzden her girişte önce SÜPÜRME: pid'i ölü (ESRCH) olan slot silinir.
//    ZAMAN AŞIMI YOK — asılı kalan ≠ ölü; yavaş bir kapıyı süpürmek iki kapıyı
//    aynı slota sokar. Bekleyen "⏳ N kapı önde (≈M sn)" basar, 30 sn'de bir yeniler.
// =============================================================================
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const KAPASITE = 4; // 3 → 4, 2026-09-14 (yeniden ölçüm 2026-09-21) — gerekçe başlıkta
/** Tek kapının boşta ölçülmüş süresi — bekleme tahmini için. */
const TEK_KAPI_SN = 46;
// Sonda kendi kökünü verir (gerçek kapıların semaforuna dokunmasın); üretimde env YOK.
const KOK = process.env.TEKSERP_SEMAFOR_KOK ?? join(tmpdir(), "tekserp-kapi-semafor");

function canliMi(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM"; // başka kullanıcının süreci — canlı say
  }
}

/** Ölü pid taşıyan ya da pid'siz slotları siler; kalan canlı slot sayısını döner. */
export function supur() {
  mkdirSync(KOK, { recursive: true });
  let canli = 0;
  for (const ad of readdirSync(KOK)) {
    if (!ad.startsWith("slot-")) continue;
    const p = join(KOK, ad, "pid");
    let pid = NaN;
    try {
      pid = Number(readFileSync(p, "utf8").trim());
    } catch {
      /* pid yok — yarım kalmış giriş */
    }
    if (Number.isFinite(pid) && canliMi(pid)) canli++;
    else rmSync(join(KOK, ad), { recursive: true, force: true });
  }
  return canli;
}

function dene() {
  for (let i = 0; i < KAPASITE; i++) {
    const slot = join(KOK, `slot-${i}`);
    try {
      mkdirSync(slot); // atomik — EEXIST ise dolu
      writeFileSync(join(slot, "pid"), `${process.pid}\n`);
      return slot;
    } catch (e) {
      if (!(e && e.code === "EEXIST")) throw e;
    }
  }
  return null;
}

function bekle(ms) {
  const t = Date.now() + ms;
  while (Date.now() < t) {
    /* senkron bekleme — hook zaten sıralı */
  }
}

/**
 * Slot alır (gerekirse bekler) ve serbest bırakma fonksiyonu döner.
 * Süreç nasıl biterse bitsin slot düşer (`exit`); öldürülürse sonraki hook süpürür.
 */
export function slotAl(yaz = (m) => process.stderr.write(m)) {
  let slot = null;
  let uyardi = 0;
  const basladi = Date.now();
  for (;;) {
    const canli = supur();
    slot = dene();
    if (slot) break;
    const simdi = Date.now();
    if (simdi - uyardi >= 30_000) {
      const gecen = Math.round((simdi - basladi) / 1000);
      yaz(
        `⏳ kapı semaforu: ${canli} kapı önde (kapasite ${KAPASITE}) — ≈${TEK_KAPI_SN} sn (tek kapı boşta)` +
          (gecen ? ` · ${gecen} sn geçti` : "") +
          "\n",
      );
      uyardi = simdi;
    }
    bekle(2_000);
  }
  const birak = () => {
    if (slot) rmSync(slot, { recursive: true, force: true });
    slot = null;
  };
  process.on("exit", birak);
  return birak;
}

/** Sonda ve teşhis için: kök dizin. */
export const SEMAFOR_KOK = KOK;
