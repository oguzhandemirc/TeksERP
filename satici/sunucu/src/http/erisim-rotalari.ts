// ERİŞİM İZİN LİSTESİ — Cloudflare Access arkasındaki genel portal yoluna (ERİŞİM dinleyicisi) YALNIZ buradaki rotalar
// bağlanır (OPT-IN): listede olmayan istek gövdesi okunmadan 404. Her tablo rotası için karar BİLİNÇLİDİR: ya bu listede
// ya `ERISIM_DISI_ROTALAR`da gerekçesiyle (bekçi §4a); tabloda olmayan satır kalamaz — yönlendirici kurulurken düşer
// (portal-http.ts `erisimListesiBulgulari`). İmza parolası taşıyan rotalarda yol kararı ayrıca imza boğazındadır.
// Anahtar "YÖNTEM /yol": rota tablosundaki yazımla birebir. Bekçi: scripts/test_erisim_kapisi.ts §4 · §6.

/** /portal/api — JSON rota tablosu (portal-routes.ts ve yaydığı tablolar) + oturum uçları (portal-http.ts). */
export const ERISIM_PORTAL_ROTALARI: ReadonlySet<string> = new Set([
  // oturum (kendi parolasını değiştirme dahil: parola girişte de Cloudflare'den geçer)
  "POST /oturum/ac",
  "POST /oturum/kapat",
  "GET /oturum",
  "POST /oturum/parola",
  // okuma
  "GET /pano",
  "GET /saglik", // sistem sağlığı kartı (sayı ve durum; sır yok)
  "GET /katalog",
  "GET /musteriler",
  "GET /musteriler/:id",
  "GET /tesisler",
  "GET /kurulumlar",
  "GET /kurulumlar/:id",
  "GET /haklar/:id",
  "GET /haklar/:id/imza-plani",
  "GET /kok-kuyrugu",
  "GET /iptal-belgeleri",
  "GET /planli-eylemler",
  "GET /tasima-talepleri",
  "GET /donanim-talepleri",
  "GET /kopya-uyarilari",
  "GET /kanallar",
  "GET /bayiler",
  "GET /bayiler/:id",
  "GET /denetim",
  "GET /anahtarlar",
  "GET /filo", // Dağıtım v2: kurulum × kurulu/kanal backend sürümü × politika × son güncelleme sonucu (salt okuma)
  "GET /kurulumlar/:id/guncelleme", // Dağıtım v2: politika · dilim · rapor · geçmiş (salt okuma)
  // müşteri · tesis · kurulum · HAK taslağı · imzalı HAK sürümü · etkinleştirme kodu
  "POST /musteriler",
  "PATCH /musteriler/:id",
  "POST /musteriler/:id/pasif",
  "POST /musteriler/:id/aktif",
  "POST /tesisler",
  "PATCH /tesisler/:id",
  "POST /tesisler/:id/pasif",
  "POST /tesisler/:id/aktif",
  "POST /kurulumlar",
  "PATCH /kurulumlar/:id",
  "POST /kurulumlar/:id/pasif",
  "POST /kurulumlar/:id/aktif",
  "POST /kurulumlar/:id/hak",
  "POST /haklar/:id/surum", // imza parolası (ara/kök) gövdede; yol kararı imza boğazında (signing-scope.ts)
  "POST /kurulumlar/:id/etkinlestirme-kodu",
  // Dağıtım v2: güncelleme politikası (kök parolası taşımaz, güven kökü eklemez — operasyon ayarı)
  "POST /kurulumlar/:id/guncelleme-politikasi",
  // kök kuyruğu talebinden vazgeçmek · ara imzacıyla toplu yeniden basım (ara imzacı parolası gövdede)
  "POST /kok-kuyrugu/:id/iptal",
  "POST /haklar/toplu-yeniden-bas",
  // yaptırım · planlı eylem · taksit
  "POST /kurulumlar/:id/yaptirim",
  "POST /kurulumlar/:id/agir-yaptirim",
  "POST /yaptirimlar/:id/geri-al",
  "POST /kurulumlar/:id/zorlama",
  "POST /kurulumlar/:id/uzat",
  "POST /kurulumlar/:id/gecerlilik",
  "POST /kurulumlar/:id/planli-eylem",
  "POST /planli-eylemler/:id/iptal",
  "POST /kurulumlar/:id/taksit-plani",
  "POST /taksit-kalemleri/:id/odeme",
  "POST /taksit-planlari/:id/kapat",
  // taşıma · kopya · DR · iptal
  "POST /tasima-talepleri/:id/onayla",
  "POST /tasima-talepleri/:id/reddet",
  "POST /donanim-talepleri/:id/onayla",
  "POST /donanim-talepleri/:id/reddet",
  "POST /kopya-uyarilari/:id/kapat",
  "POST /kurulumlar/:id/uzatma-dosyasi",
  "POST /kurulumlar/:id/dr-geri-al",
  "POST /kurulumlar/:id/iptal",
  "POST /kurulumlar/:id/iptal-geri-al",
  // kanal · bayi (bayi anahtarı bağlama güven kökü ekler — izni yalnız yönetici rolünde)
  "POST /kanallar",
  "PATCH /kanallar/:id",
  "POST /bayiler",
  "POST /bayiler/:id/tavan",
  "POST /bayiler/:id/pasif",
  "POST /bayiler/:id/aktif",
  "POST /bayiler/:id/anahtar",
  // dağıtım · sürümler · yayıncılar
  "GET /dagitim/derlemeler",
  "GET /dagitim/baglantilar",
  "POST /dagitim/baglantilar",
  "POST /dagitim/baglantilar/:id/iptal",
  "GET /dagitim/yukleme-istekleri",
  "POST /dagitim/yukleme-istekleri",
  "POST /dagitim/yukleme-istekleri/:id/iptal",
  "GET /dagitim/dosyalar",
  "GET /dagitim/defter",
  "POST /dagitim/giden-oturum",
  "GET /dagitim/giden-oturum/:id",
  "POST /dagitim/giden-oturum/:id/tamamla",
  "GET /surumler",
  "GET /yayincilar",
  "POST /yayincilar", // kayıt güven kökü ekler — izni yalnız yönetici rolünde
  "POST /yayincilar/:id/pasif",
  // destek kutusu
  "GET /destek",
  "GET /destek/:id",
  "GET /destek/:id/ek",
  "POST /destek/:id/yanitla",
  "POST /destek/:id/kapat",
  // bildirimler — kanal durumu + son bildirimler (bildirim:oku) · deneme bildirimi (bildirim:yonet); kanal sırrı taşımaz
  "GET /bildirimler",
  "GET /bildirimler/durum",
  "POST /bildirimler/deneme",
  // kullanıcı yönetimi (yalnız yönetici; yeni parola gövdede, TOTP sırrı yalnız ilk yanıtta — no-store)
  "GET /kullanicilar",
  "POST /kullanicilar",
  "POST /kullanicilar/:id/pasif",
  "POST /kullanicilar/:id/aktif",
  "POST /kullanicilar/:id/totp-sifirla",
  "POST /kullanicilar/:id/kilit-ac",
  "POST /kullanicilar/:id/parola",
]);

/**
 * ERİŞİM'e BİLİNÇLİ olarak açılmayan tablo rotaları — anahtar "YÖNTEM /yol", değer gerekçe. Bugün boş: satıcı portalının
 * her işlemi internet yolundan da yapılır. Yeni rota ya listeye ya buraya girer; ikisinde de yoksa bekçi kırmızı.
 */
export const ERISIM_DISI_ROTALAR: Readonly<Record<string, string>> = Object.freeze({});

/** /portal/api/ham — ham gövdeli dağıtım uçları (distribution-raw.ts). */
export const ERISIM_HAM_ROTALARI: ReadonlySet<string> = new Set(["PUT /giden-oturum/:id/parca/:sira", "GET /dosyalar/:id"]);
