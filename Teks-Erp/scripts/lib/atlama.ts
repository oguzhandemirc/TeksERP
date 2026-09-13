// =============================================================================
// ATLAMA DEFTERİ — bir kontrol koşmadıysa bunu SAYI ile, sayamıyorsak
// "BİLİNMİYOR" ile söyleriz; asla sessizce değil.
// =============================================================================
//
// ⭐ NEDEN VAR (ölçüldü 2026-09-13, 510 bekçi tarandı):
//    `atla()` **8 dosyada KOPYA** ve **4 farklı biçimde** basıyor; 8'inden
//    yalnız **1'i** `TEKSERP_STRICT`e uyuyor. Atlamanın dört sınıfı var ve
//    üçü koşucuya hiç ulaşmıyor:
//      ① beyan eden ............ 12 dosya  (`Sonuç: …, N atlandı` → koşucu sayar)
//      ② basan, sayılmayan ..... 31 dosya  (mesaj var, toplam yok)
//      ③ atlamayı YEŞİL sayan ... 6 dosya / 7 site
//      ④ erken `return` ......... kaç kontrol düştüğü BİLİNEMEZ
//
// ⚠️ ③ EN KÖTÜ SINIF ve kapsam kaybı burada SIFIR DEĞİL, EKSİDİR:
//    `check("şablon testi atlandı (permission yok)", true)` — atlama gizlenmiyor,
//    **GEÇTİ olarak sayılıyor**. Yani *kapsanmayan şey, kapsanmış gibi sayılarak
//    yeşili ARTIRIYOR.* Bir ölçümün yanlış yöne bozulması eksik kalmasından
//    kötüdür, çünkü güven de artar.
//
// ⚠️ ④ BU ALETLE DE KAPANMAZ, yalnız GÖRÜNÜR OLUR. Erken `return`den sonraki
//    kontroller hiç doğmaz; sayıları **yapısal olarak bilinemez**. Bugün
//    `0 atlandı` ile `bilinmeyen sayıda atlandı` AYNI şeyi basıyor.
//      ⇒ *"N atlandı" sessizce N'i BİLDİĞİMİZİ iddia eder. ④'te bilmiyoruz;
//         oraya 0 yazmak aynı yalanın küçük puntolusudur.*
//    Bu yüzden `adet` **`"?"` olabilir** ve `"?"` bir toplama GİRMEZ — ayrı
//    beyan edilir. Bir sayının yerine "bilinmiyor" yazabilmek, o sayıyı
//    uydurmamanın tek yoludur.
//
// ⚠️ `kirmiziyaCevir` BİLEREK ZORUNLU. Strict altında atlama kırmızıdır, ama
//    yardımcı çağıranın `fail` sayacına erişemez. İsteğe bağlı olsaydı, bir
//    bekçi "KIRMIZI" basıp `exit 0` döndürebilirdi — *basılmayan dalın yeşili*
//    sınıfının en sinsi hâli. API ŞEKLİYLE fail-closed.
// =============================================================================

/**
 * STRICT koşum — `TEKSERP_STRICT=1`. "Yeşil = kapsandı" iddiası ancak bu
 * anahtarla kurulur: ön koşul YOKLUĞU da kırmızıya döner.
 *
 * ⚠️ Anahtarın EVİ burasıdır ve TEKTİR. İkinci bir strict bayrağı doğarsa iki
 * koşum iki farklı şey iddia eder; `http-bekci-kapisi.ts` bunu buradan ithal
 * eder, kendi kopyasını tutmaz.
 */
export function strictMi(): boolean {
  return process.env.TEKSERP_STRICT === "1";
}

/** `Sonuç:` satırının koşucu tarafından okunan eki. */
export const BILINMEYEN_BEYAN = "BİLİNMEYEN sayıda atlanan bölüm VAR";

export interface AtlamaDefteri {
  /**
   * Bir bölüm koşmadı.
   * @param adet kaç KONTROL düştü. Erken `return` gibi sayılamayan yerde `"?"`.
   *             Varsayılan 1 — çünkü en az bu çağrının kendisi bir kontroldür.
   */
  atla(label: string, sebep: string, adet?: number | "?"): void;
  /** Sayılabilen atlanan KONTROL adedi (`"?"` buraya girmez). */
  readonly sayi: number;
  /** En az bir yerde adet bilinmiyor mu? */
  readonly bilinmeyenVar: boolean;
  /** `=== Sonuç: …` satırına eklenecek parça (baştaki virgül dâhil, yoksa ""). */
  ozetEki(): string;
}

/**
 * @param kirmiziyaCevir strict altında çağrılır; çağıran KENDİ `fail` sayacını
 *        artırmalıdır. Zorunlu olmasının gerekçesi başlıkta.
 */
export function atlamaDefteri(kirmiziyaCevir: (mesaj: string) => void): AtlamaDefteri {
  let sayi = 0;
  let bilinmeyenVar = false;

  return {
    atla(label: string, sebep: string, adet: number | "?" = 1): void {
      const mesaj = `${label} — ${sebep}`;
      if (strictMi()) {
        // Strict'te atlama bir ARIZADIR: paket kararı bu koşumdan verilecekse
        // "ölçmedim" ile "ölçtüm, geçti" aynı sayıya çıkamaz.
        console.log(`  ✗ ATLAMA KIRMIZI — ${mesaj} (TEKSERP_STRICT=1)`);
        kirmiziyaCevir(mesaj);
        return;
      }
      if (adet === "?") bilinmeyenVar = true;
      else sayi += adet;
      const kac = adet === "?" ? "bilinmeyen sayıda kontrol" : `${adet} kontrol`;
      console.log(`⏭️  ATLANDI — ${mesaj}\n      ↳ ${kac} koşmadı`);
    },
    get sayi() {
      return sayi;
    },
    get bilinmeyenVar() {
      return bilinmeyenVar;
    },
    ozetEki(): string {
      // ⚠️ İKİSİ AYRI BEYANDIR, toplanmaz. `3 atlandı` sayının bilindiğini
      // iddia eder; bilinmeyen bölüm o iddiaya karışamaz.
      const p: string[] = [];
      if (sayi > 0) p.push(`${sayi} atlandı`);
      if (bilinmeyenVar) p.push(BILINMEYEN_BEYAN);
      return p.length ? `, ${p.join(", ")}` : "";
    },
  };
}
