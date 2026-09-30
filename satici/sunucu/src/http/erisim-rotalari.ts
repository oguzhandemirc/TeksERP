// ERİŞİM İZİN LİSTESİ — Cloudflare Access arkasındaki genel portal yoluna (ERİŞİM dinleyicisi) YALNIZ buradaki rotalar
// bağlanır (OPT-IN): listede olmayan istek gövdesi okunmadan 404; yeni rota ERİŞİM'e ancak bilinçli bir satırla açılır.
// Kök parolalı (`kokParolasi`) ve hassas izinli (roles.ts `TAILNET_ONLY_PERMISSIONS`: kullanıcı yönetimi, bayi anahtarı
// bağlama, yayıncı anahtarı kaydı) rota listeye GİREMEZ, tabloda
// olmayan satır da kalamaz — yönlendirici kurulurken düşer (portal-http.ts `erisimListesiBulgulari`).
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
  "GET /katalog",
  "GET /musteriler",
  "GET /musteriler/:id",
  "GET /tesisler",
  "GET /kurulumlar",
  "GET /kurulumlar/:id",
  "GET /haklar/:id",
  "GET /planli-eylemler",
  "GET /tasima-talepleri",
  "GET /kopya-uyarilari",
  "GET /kanallar",
  "GET /bayiler",
  "GET /bayiler/:id",
  "GET /denetim",
  "GET /anahtarlar",
  "GET /filo", // Dağıtım v2: kurulum × kurulu/kanal backend sürümü × politika × son güncelleme sonucu (salt okuma)
  "GET /kurulumlar/:id/guncelleme", // Dağıtım v2: politika · dilim · rapor · geçmiş (salt okuma)
  // müşteri · tesis · kurulum · HAK taslağı · etkinleştirme kodu
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
  "POST /kurulumlar/:id/etkinlestirme-kodu",
  // Dağıtım v2: güncelleme politikası (kök parolası taşımaz, güven kökü eklemez — operasyon ayarı)
  "POST /kurulumlar/:id/guncelleme-politikasi",
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
  "POST /kopya-uyarilari/:id/kapat",
  "POST /kurulumlar/:id/dr-geri-al",
  "POST /kurulumlar/:id/iptal",
  "POST /kurulumlar/:id/iptal-geri-al",
  // kanal · bayi (anahtar bağlama güven kökü ekler → yalnız tailnet/geri döngü, listede YOK)
  "POST /kanallar",
  "PATCH /kanallar/:id",
  "POST /bayiler",
  "POST /bayiler/:id/tavan",
  "POST /bayiler/:id/pasif",
  "POST /bayiler/:id/aktif",
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
  "POST /yayincilar/:id/pasif", // kayıt (POST /yayincilar) güven kökü ekler → yalnız tailnet/geri döngü
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
]);

/** /portal/api/ham — ham gövdeli dağıtım uçları (distribution-raw.ts). */
export const ERISIM_HAM_ROTALARI: ReadonlySet<string> = new Set(["PUT /giden-oturum/:id/parca/:sira", "GET /dosyalar/:id"]);
