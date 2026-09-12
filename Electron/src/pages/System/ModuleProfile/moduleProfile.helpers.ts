// =============================================================================
// SİSTEM PROFİLİ — SAF KATMAN
// =============================================================================
// Ekranın verdiği üç karar burada, bileşenin DIŞINDA yaşıyor: profil farkını
// PATCH gövdesine çevirmek · bir modülü kapatmanın gizleyeceği ekranları
// listelemek · bağımlılık okunu çözmek. Üçü de bir bileşen içindeki `map`/`&&`
// zinciri olarak yazılabilirdi ve tersine çevrilmeleri HİÇBİR TESTİ KIRMAZDI —
// projenin yazılı deseni bu yüzden saf yüklem (`yarn-regime.ts`,
// `settings-groups.ts`, `orders-regime.ts`).
// =============================================================================
import {
  MODULE_DEPENDENCIES,
  MODULE_FIELD_BY_SETTING_KEY,
  MODULE_LABELS,
  type ModuleFlagKey,
} from "@/lib/module-flags";
import type { ModuleProfileDiffRow } from "@/services/moduleProfileService";
import type { ScreenEntry } from "@/services/screenCatalogService";

/**
 * Sunucunun hesapladığı farkı `PATCH /api/feature-flags` gövdesine çevirir.
 *
 * ⚠️ TANINMAYAN ANAHTAR SESSİZCE ATLANMAZ, ayrı listeye düşer. Sunucu bir gün
 * sekizinci modülü döndürürse (panel aynası henüz güncellenmemişken) gövdeye
 * hiçbir şey yazmamak ile "yazdım" demek arasındaki fark, kullanıcının profili
 * uyguladığını sanıp EKSİK bir kuruluma kalmasıdır. Çağıran bunu ekranda söyler.
 */
export function diffToFlagPatch(rows: ModuleProfileDiffRow[]): {
  patch: Partial<Record<ModuleFlagKey, boolean>>;
  unknownKeys: string[];
} {
  const patch: Partial<Record<ModuleFlagKey, boolean>> = {};
  const unknownKeys: string[] = [];
  for (const r of rows) {
    const field = MODULE_FIELD_BY_SETTING_KEY[r.key];
    if (!field) {
      unknownKeys.push(r.key);
      continue;
    }
    patch[field] = r.to;
  }
  return { patch, unknownKeys };
}

/**
 * Fark satırının okunabilir hâli — onay diyaloğu "N kayıt etkilenecek" gibi
 * soyut bir sayı BASMAZ (yıkıcı işlem onayı kuralı), her satırı adıyla yazar.
 */
export function describeDiffRow(row: ModuleProfileDiffRow): string {
  const field = MODULE_FIELD_BY_SETTING_KEY[row.key];
  const ad = field ? MODULE_LABELS[field] : row.key;
  return `${ad}: ${row.from ? "Açık" : "Kapalı"} → ${row.to ? "Açık" : "Kapalı"}`;
}

/**
 * Bu modülü kapatınca gizlenecek ekranlar — MASAÜSTÜ ve TABLET AYRI.
 *
 * ⚠️ TABLET AYRI AMA ANILIR: eskiden yalnız `app === "desktop"` süzülüyordu ve
 * ekran "gizlenen ekranlar (9)" yazıp beş TABLET ekranını (KK1 · Kurşun ·
 * Tambur · Hızlı İş Emri · Kurşun Dağıtım) hiç anmıyordu — oysa hepsi
 * `requireProductionEnabled` arkasında ve modül kapanınca 403 alır. Satıcı,
 * üretimi kapatınca tabletin de duracağını bu ekrandan öğrenemiyordu
 * (P5 doğrulamasının bulgusu). Sayılar ayrı tutulur çünkü kapatma kararının
 * sahadaki bedeli farklıdır: masaüstü ekranı kaybolur, TABLET DURUR.
 *
 * ⚠️ Tablet listesi bugün YALNIZ bilgilendirmedir: mobil ekranların modül
 * koşulu henüz istemcide uygulanmıyor (P1'in açık kalanı) — ekranlar
 * görünmeye devam eder ama backend 403 verir.
 */
export function screensHiddenByModule(
  screens: ScreenEntry[],
  moduleKey: ModuleFlagKey,
): { desktop: string[]; mobile: string[] } {
  const ait = screens.filter((s) => s.modul === moduleKey);
  return {
    desktop: ait.filter((s) => s.app === "desktop").map((s) => s.title),
    mobile: ait.filter((s) => s.app !== "desktop").map((s) => s.title),
  };
}

/**
 * Bu modül KAPANIRSA birlikte kapanması gereken modüller (bağımlılık zinciri).
 *
 * ⚠️ YÖN ÖNEMLİ: `MODULE_DEPENDENCIES` "bağımlı → ön koşul" yazar
 * (`iplikEnabled: "ticaretEnabled"`). Ekranda gösterilmesi gereken şey TERSİDİR:
 * Ticaret'i kapatmak İplik'i de götürür. Haritayı doğrudan okumak, kullanıcıya
 * kapatma sırasını TERS söylerdi.
 */
export function modulesThatDependOn(moduleKey: ModuleFlagKey): ModuleFlagKey[] {
  // ⚠️ GEÇİŞLİ KAPANIŞ (2026-09-12, devere): zincir üç halkaya çıktı
  // (devere → iplik → ticaret). Yalnız DOĞRUDAN bağımlıyı döndürmek, "Ticaret'i
  // kapatırsan İplik de kapanır" derken Devere'yi SUSARDI — kullanıcı iki adım
  // sonra 400 yerdi. Kapanış BFS ile alınır; tablo çevrimsizdir (ön koşul
  // zinciri), `gorulen` yine de sonsuz döngüye karşı tutulur.
  const girisler = Object.entries(MODULE_DEPENDENCIES) as [ModuleFlagKey, ModuleFlagKey][];
  const out: ModuleFlagKey[] = [];
  const kuyruk: ModuleFlagKey[] = [moduleKey];
  while (kuyruk.length > 0) {
    const cur = kuyruk.shift()!;
    for (const [dependent, requires] of girisler) {
      if (requires !== cur || out.includes(dependent)) continue;
      out.push(dependent);
      kuyruk.push(dependent);
    }
  }
  return out;
}

/** Bu modülün AÇILABİLMESİ için önce açık olması gereken modül (varsa). */
export function moduleRequires(moduleKey: ModuleFlagKey): ModuleFlagKey | undefined {
  return MODULE_DEPENDENCIES[moduleKey];
}

/**
 * camelCase alan → DB ayar anahtarı (haritanın TERS yönü).
 *
 * ⚠️ Değişiklik geçmişi için gerekli: `SYSTEM_SETTING` audit satırlarında
 * `recordId` AYAR ANAHTARIDIR (`production.enabled`), API alanı değil. Elle
 * string kurmak (`field.replace("Enabled", ".enabled")`) `depoMultiEnabled`
 * için `depoMulti.enabled` üretir ve geçmiş listesi SESSİZCE BOŞ döner —
 * "hiç değiştirilmemiş" yalanı.
 */
export function settingKeyOfModule(field: ModuleFlagKey): string | null {
  const hit = Object.entries(MODULE_FIELD_BY_SETTING_KEY).find(([, v]) => v === field);
  return hit?.[0] ?? null;
}
