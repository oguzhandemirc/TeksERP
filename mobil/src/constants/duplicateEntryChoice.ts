/**
 * MÜKERRER GİRİŞ — İKİ SEÇENEĞİN TEK KAYNAĞI (2026-08-06).
 *
 * KK1'de aynı kumaş + aynı metraj + aynı en arka arkaya kaydedilince sunucu 409
 * döner ve operatöre tek bir karar bırakılır: elindeki fiziksel top, ekrandaki
 * barkodun topu MU (o zaman yeni kayıt olmamalı, yalnız etiket basılmalı), yoksa
 * aynı ölçüde başka bir top mu (o zaman stoka bir kayıt daha girmeli).
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * Metinler modalın içinde gömülüyken şu hata yazıldı:
 *
 *      [AYNI · Etiket Bas]      [AYRI · Kaydet]
 *
 * "AYNI" ile "AYRI" TEK HARF farkla ayrışır. Ekranı okuyan kişi çoğu zaman
 * Türkçeyi zayıf bilir (sahada yabancı uyruklu işçi olağan), eldivenlidir ve
 * parlak atölye ışığında bakar. Bu iki kelime o koşulda ayırt EDİLEMEZ — ve
 * yanlış seçim ya envanterde hayalet top doğurur ya da gerçek bir topu kayda
 * hiç sokmaz. İkisi de SESSİZDİR; hiçbir hata mesajı üretmez.
 *
 * Metinler ve renkler burada, çünkü kural artık MEKANİK korunuyor:
 * `duplicateEntryChoice.test.ts` benzeşmeyi ÖLÇER (düzenleme mesafesi, ortak
 * kelime, kontrast oranları, GRİ TON ayrımı). Modala gömülü bir dizeyi ya da
 * ham bir hex'i hiçbir test koruyamazdı.
 *
 * ── ⚠️ SAYMA ÇERÇEVESİ REDDEDİLDİ: "Elinde kaç top var? [1] [2]" ────────────
 * İlk tasarım buydu ve cazipti (rakam dilden bağımsız). YANLIŞ olduğu için
 * düşürüldü — iki ayrı yoldan:
 *   1. Tipik vaka: 1. top ölçüldü, etiketlendi, palete kondu; operatör ŞİMDİ
 *      2. topu tutuyor. "Elinde kaç top var?" sorusuna DÜRÜSTÇE "1" cevabını
 *      verir → yeni kayıt açılmaz → ikinci top stoka hiç girmez. Bu, kopyanın
 *      aynadaki ikizi olan EKSİK STOK'tur ve kopyadan kötüdür.
 *   2. Aynı ölçüde 3., 4., 5. top tekstilde OLAĞANDIR (aynı partiden eşit
 *      metrajlı toplar meşru olarak arka arkaya girilir). Üçüncü topta modal
 *      yine açılır ve "1 mi 2 mi" sorusunun İKİ CEVABI DA gerçek dışıdır.
 * Ekrandaki rakam bu yüzden bir SAYIM değil DEĞİŞİM'dir ("+1"): kaç top olursa
 * olsun bu karar stoka tam olarak bir kayıt ekler ya da hiç eklemez.
 *
 * ── ⚠️ SİSTEM "BU TOP ZATEN KAYITLI" DİYEMEZ ───────────────────────────────
 * POSSIBLE_DUPLICATE dalında elindeki topun kaydı YAZILMAMIŞTIR (yazılan, az
 * önceki toptur). Başlıkta bunu iddia etmek "UI yalan söylemesin" kuralının
 * ihlalidir ve daha kötüsü: B'yi seçmesi gereken operatör ekranın en büyük
 * yazısını yalanlamak zorunda kalır — Türkçesi zayıf biri bunu yapmaz, otoriteye
 * uyar. Kimlik iddiası bu yüzden KARTIN İÇİNDE, OPERATÖRÜN AĞZINDAN kurulur.
 *
 * ── DÖRT BAĞIMSIZ AYIRT EDİCİ (renk bunlardan yalnız BİRİ) ──────────────────
 *   1. ROZET  — yazıcı glifi / "+1", dolu zemin üstünde. Kartın en yüksek
 *      kontrastlı öğesi (%18 saydam çip ölçüldü: kart zemininden 1.4:1 —
 *      parlak ışıkta görünmüyordu; asıl buluşun en okunmaz yerde durması saçmaydı).
 *   2. FİİL   — "BAS" / "EKLE". Ortak kök, ortak ek, kafiye yok.
 *   3. KONUM  — üstteki hep kâğıt, alttaki hep kayıt.
 *   4. RENK   — projenin sözleşmesi (CLAUDE.md, "buton rengi SONUCU söyler"):
 *               MAVİ = yalnız kâğıt basar, veriye dokunmaz.
 *               AMBER = YENİ bir stok kaydı doğurur.
 *
 * ── ⚠️ KUTUP TERSLEMESİ: HUE DEĞİL, PARLAKLIK AYIRIR ───────────────────────
 * İlk hâlde iki kart da KOYU dolgu + beyaz metindi (mavi-700 / amber-700). Hue
 * ayrımı mükemmeldi (protanopide ΔE00 65, deuteranopide 71) ama GRİ TONDA fark
 * yalnız 1.33:1 idi — yani parlak güneşte doygunluk yıkandığında geriye "aynı
 * iki gri dikdörtgen" kalıyordu. Çözüm hue'ya dokunmadan kutbu terslemek:
 *   A = KOYU kart (mavi-700) + açık içerik      → parlaklık 0.107
 *   B = AÇIK kart (amber-500) + koyu içerik     → parlaklık 0.439
 * Gri ton ayrımı 1.33 → 3.12. Ek kazanç: koyu metin amber-500 üstünde 8.31:1
 * verir (beyaz metnin amber-700 üstündeki 5.02'sinden iyi) ve hi-vis amber
 * zaten sektörün uyarı rengidir. Bekçi bu ayrımı SAYIYLA kilitler — yeni bir
 * renk denerken iki dolgunun gri-ton kontrastı 3:1'in altına düşemez.
 *
 * ── YENİ METİN YAZARKEN ─────────────────────────────────────────────────────
 *  • BÜYÜK HARFLERİ LİTERAL YAZ, `textTransform:'uppercase'` KULLANMA: cihaz
 *    yerel ayarı tr değilse "ETİKET" → noktasız "ETIKET" olur.
 *  • En fazla 18 karakter (yan yana düzene dönülürse buton ≈203dp'de keser;
 *    ölçülmüş gerçek: aynı ekranda "Etiketi Söktüm, İpta…" diye kesildi).
 *  • İki seçenek ORTAK BELİRGİN KELİME taşımaz — "YENİ" arayan göz onu yanlış
 *    kartta bulmasın. Kart İÇİNDE kök sabit ("BAS" → "basılır"), kartlar
 *    ARASINDA kök farklı.
 *  • OLUMSUZLAMA YOK: "açılmaz / açılır" çifti AYNI/AYRI ile aynı hata sınıfıdır
 *    (fark tek ek) ve olumsuzlama okunmadan atlanır.
 *  • ÇOK ANLAMLI FİİL YOK: "kâğıt çıkar" hem "kâğıt çıkar (sonuç)" hem "kâğıdı
 *    çıkar! (emir)" okunur — üstelik kartın başlığı zaten emir kipinde.
 *  • "Stok" kökünü ÇEKİMLEME: doğru yazım "stoka"dır ("stoğa" değil) ve k→ğ
 *    yumuşamasını yeni öğrenen biri için ikisi FARKLI kelimedir.
 *  • ALFA/OPAKLIK İLE METİN HİYERARŞİSİ KURMA: alt metinler ana metinle aynı
 *    renktedir, fark punto ve ağırlıktan gelir. Saydam beyaz alt metin ölçüldü:
 *    amber üstünde 4.51:1 ile AA'yı 0.01 payla geçiyor, %10 perde parlamasında
 *    3.37'ye düşüyordu — hem de yeni stok doğuran kartın TEK uyarı cümlesinde.
 */
export interface DuplicateEntryChoice {
  /** Kart solundaki rozet — ikon YA DA metin taşır, ikisi birden değil. */
  badgeIcon?: string;
  /** Rozet metni (ikon yerine). Sayım değil DEĞİŞİM: "+1". */
  badgeText?: string;
  /** Rozetin altındaki küçük başlık — rozetin neyi ölçtüğünü sabitler. */
  badgeCaption: string;
  /** Kartın ana metni — kısa emir kipi, diğerine benzemeyen. */
  label: string;
  /** Tek satır sonuç cümlesi: basınca NE OLACAK (edilgen, tek anlamlı). */
  sublabel: string;
  /** Kart dolgusu. */
  color: string;
  /** Kart kenarlığı — açık dolgunun beyaz sayfada kenarı kaybolmasın. */
  borderColor: string;
  /** Kart üstündeki TÜM metin (başlık + alt satır aynı renk; hiyerarşi puntoda). */
  textColor: string;
  /** Rozet dolgusu — kart kutbunun TERSİ. */
  badgeBg: string;
  /** Rozet içeriği (glif/rakam/başlık). */
  badgeFg: string;
  /**
   * Pasif durum perdesi. ⚠️ `opacity` DEĞİL: opaklık tüm alt ağacı BEYAZA doğru
   * kompoze eder ve koyu karttaki beyaz metnin kontrastı 5.0 → 2.3'e düşer, hem
   * de tam operatörün ekrana kilitlendiği anda (baskı sürerken). Perde kartın
   * KUTBUNU izler: koyu kartta siyah, açık kartta beyaz — ikisi de metin
   * kontrastını KORUR ya da artırır.
   */
  scrim: string;
  /** Ekran okuyucu için tam cümle. */
  a11y: string;
}

/** Elindeki top ZATEN kayıtlı: yeni kayıt yok, var olanın etiketi basılır. */
export const DUPLICATE_CHOICE_SAME: DuplicateEntryChoice = {
  badgeIcon: 'printer',
  badgeCaption: 'KÂĞIT',
  label: 'ETİKET BAS',
  sublabel: 'Kayıtlı topun etiketi basılır',
  color: '#1d4ed8', // colors.infoDark (blue-700) — beyaz metinle 6.70:1
  borderColor: '#1e3a8a', // blue-900
  textColor: '#ffffff',
  badgeBg: '#ffffff',
  badgeFg: '#1d4ed8',
  scrim: 'rgba(15,23,42,0.30)',
  a11y: 'Bu top zaten kayıtlı. Etiketini yeniden bas. Yeni kayıt oluşmaz.',
};

/** Elindeki top BAŞKA bir top: stoka bir kayıt daha girer. */
export const DUPLICATE_CHOICE_NEW: DuplicateEntryChoice = {
  badgeText: '+1',
  badgeCaption: 'STOK',
  label: 'YENİ TOP EKLE',
  sublabel: 'Stoka 1 top daha eklenir',
  color: '#f59e0b', // colors.warning (amber-500) — koyu metinle 8.31:1
  borderColor: '#b45309', // colors.warningDark (amber-700)
  textColor: '#0f172a',
  badgeBg: '#92400e', // amber-800 — dolgu üstünde 3.30:1 (metin dışı, ≥3 ✓)
  badgeFg: '#ffffff', // amber-800 üstünde 7.09:1
  scrim: 'rgba(255,255,255,0.45)',
  a11y: 'Bu başka bir top. Stoka bir top daha eklenir.',
};
