// =============================================================================
// TeksERP — SATICI (SÜPERADMİN) HESABI: aktör seçimi
// =============================================================================
// ⚠️ 2026-09-04 — GİZLİLİK KALDIRILDI (kullanıcı kararı).
//
// Bu dosya eskiden satıcı hesabını sistemin HER yüzeyinden gizliyordu: kullanıcı
// listelerinden süzülüyor, audit satırlarında "Sistem Bakımı"/"sistem" takma
// adıyla görünüyor, `/api/admin/users/:id` çağrısı 404 dönüyordu. Gerekçe uzak
// erişimdeki PIN/kart zinciriydi.
//
// KARAR DEĞİŞTİ: en yetkili hesap DB'den görevlendirilen GERÇEK bir kişidir ve
// her yerden görünür olacaktır. Gizlilik, iz sürmeyi de imkânsız kılıyordu —
// hesabın ayak izi audit'te takma adla duruyor, kendi yetkilerini göremiyordu.
// Bir yetkinin kim tarafından kullanıldığı, o yetki en genişken EN ÇOK gerekir.
//
// ⚠️ `User.isSystemAccount` KOLONU DURUYOR ve işlevini SÜRDÜRÜR — kaldırılan
// şey GİZLEME, YETKİ DEĞİL. Kolon hâlâ şunları sürüyor:
//   · `getEffectivePermissions` → `["*"]` (tam yetki)
//   · `flagWriteGuard` üçüncü dalı (modül anahtarlarını yalnız o yazabilir)
//   · ayar şifresi (`requireSettingsPassword`) muafiyeti
//   · ayar şifresi YÖNETİMİ uçlarının kapısı
// Yani hesap görünürdür ama yetkisi hâlâ ondadır.
//
// Bekçi: `scripts/test_superadmin_visible.ts` — gizlemenin GERİ GELMEDİĞİNİ
// ölçer (eski `test_superadmin_hidden_single_source.ts`in tersi).
// =============================================================================

/**
 * Audit/oturum yüzeylerinde aktör seçimi.
 *
 * `isSystemAccount` yanıtta KALIR: arayüz "bu kişi en yetkili hesap" rozetini
 * ondan çizer. Eskiden bu alan bilerek DÜŞÜRÜLÜYORDU (takma adı anlamsız
 * kılmasın diye); gizlilik kalkınca düşürmenin bir işlevi kalmadı.
 */
export const ACTOR_SELECT = {
  id: true,
  username: true,
  fullName: true,
  isSystemAccount: true,
} as const;
