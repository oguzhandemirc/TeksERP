// =============================================================================
// TeksERP — Bildirim uçları (`/api/bildirim/*`, plan §3.9 + §5.6 F1)
// =============================================================================
// İçeriksiz SSE zili (`/zil`) + uzun yoklama (`/bekle`) + gelen kutusu okuma/işaretleme. Uçlar kişisel:
// verifyToken yeter (izin kodu YOK), satır kapsamı servisteki `userId`. Bayrak kapalı → özet dışı 409
// `BILDIRIM_KAPALI`. `/zil` sıkıştırmadan muaftır (app.ts filtresi), `/zil` + `/bekle` gecikme ölçümünden.
// =============================================================================
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import * as c from "../controllers/bildirim.controller";
import * as t from "../controllers/bildirim-tercih.controller";

const router = Router();
router.use(verifyToken);

/**
 * @openapi
 * /api/bildirim/zil:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'İçeriksiz SSE zil akışı (text/event-stream) — `merhaba {epoch,rev,alarmRev}`, sonra `zil {k,rev,alarmRev}`, 25 sn `: ping`'
 *     description: 'Akış bildirim İÇERİĞİ taşımaz; istemci zili duyunca `/api/bildirim/ozet` ve `/api/bildirim` okur. Kullanıcı başı 5 akış (6.''da en eski kapanır), genel 500.'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "SSE akışı", content: { text/event-stream: { schema: { type: string } } } }
 *       401: { description: Oturum yok }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *       503: { description: Genel bağlantı tavanı dolu (BILDIRIM_ZIL_DOLU) ya da sunucu kapanıyor }
 */
router.get("/zil", c.getBellStream);

/**
 * @openapi
 * /api/bildirim/bekle:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Uzun yoklama (SSE kurulamazsa) — bilinen sürüm güncelse ≤25 sn bekler, zil gelince hemen döner'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: rev, required: false, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: alarmRev, required: false, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: epoch, required: false, schema: { type: integer, minimum: 0 } }
 *     responses:
 *       200: { description: "{epoch, rev, alarmRev, degisti}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/bekle", c.getWait);

/**
 * @openapi
 * /api/bildirim/ozet:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Zil özeti — `{enabled, okunmamis, alarmAcik, vardiyaBitis, epoch, rev, alarmRev}` (vardiyaBitis: süren vardiyanın bitişi ya da null); bayrak kapalı → `{enabled:false}`'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Özet }
 */
router.get("/ozet", c.getSummary);

/**
 * @openapi
 * /api/bildirim/katalog:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Kişinin görebildiği bildirim türleri (F1 — tercihsiz)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{turler: [{kod, ad, grup, kilit, kanallar, kapsam}], hucreler, yetkiDisi} — yetkiDisi: modülü açık ama izni olmayan tür sayısı" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/katalog", c.getCatalog);

/**
 * @openapi
 * /api/bildirim:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Gelen kutusu listesi — liste, cursor ve `sayi` aynı where''den; izni gitmiş tür görünmez'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sekme, required: false, schema: { type: string, enum: [tumu, okunmamis, alarmlar, ertelenen] } }
 *       - { in: query, name: cursor, required: false, schema: { type: string } }
 *       - { in: query, name: limit, required: false, schema: { type: integer, minimum: 1, maximum: 100 } }
 *       - { in: query, name: "filter[tur]", required: false, schema: { type: string }, description: "Katalog tür kodları (CSV)" }
 *       - { in: query, name: "filter[ozet]", required: false, schema: { type: string, enum: ["true", "false"] }, description: "Gün özeti satırları (ozet bayrağı)" }
 *       - { in: query, name: "filter[tablet]", required: false, schema: { type: string, enum: ["true", "false"] }, description: "Satırın tablet kanalı (sessiz saat sunucuda çözülmüş)" }
 *       - { in: query, name: "filter[kanal]", required: false, schema: { type: string, enum: [TABLET_SES] }, description: "Katalogda bu kanalı taşıyan türler" }
 *     responses:
 *       200: { description: "{items, nextCursor, sayi, epoch, rev, alarmRev}; satırda ozet, kanalTablet, sesli (kanalTablet ∧ kişinin ses ayarı)" }
 *       400: { description: Geçersiz sekme/imleç/süzgeç }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/", c.getList);

// ---- F4 tercih katmanı (plan §5.6) — `/:id/...`dan ÖNCE bağlanır ------------------
const ADMIN = requireAnyPermission("settings:notifications", "admin:settings");

/**
 * @openapi
 * /api/bildirim/tercihler:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Kişinin çözülmüş tercih hücreleri (tür × kanal: durum, kilit, kaynak, kapsam) + kendi sapma satırları'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{hucreler, satirlar}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Tam gövde; seyrek yazılır (yalnız varsayılandan sapan/kapsamlı satır). Kilitli türde uygulama içini kapatmak 409'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tercihler]
 *             properties:
 *               tercihler:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [tur, kanal, acik]
 *                   properties:
 *                     tur: { type: string }
 *                     kanal: { type: string, enum: [UYGULAMA, OZET, MASAUSTU, TABLET_SES, PATRON_PUSH] }
 *                     acik: { type: boolean }
 *                     kapsam: { type: object, description: "yalnizTakip · istasyonlar ('BENIM' | uuid[]) · esik — yalnız UYGULAMA, yalnız türün beyan ettiği anahtarlar" }
 *     responses:
 *       200: { description: "{hucreler, satirlar}" }
 *       400: { description: "Görülemeyen tür (NOTIFICATION_KIND_NOT_VISIBLE) · kanal (NOTIFICATION_CHANNEL_INVALID) · kapsam (NOTIFICATION_SCOPE_INVALID)" }
 *       409: { description: "Kilitli tür (NOTIFICATION_KIND_LOCKED) · gelen kutusu kapalı (BILDIRIM_KAPALI)" }
 */
router.get("/tercihler", t.getPreferences);
router.put("/tercihler", t.putPreferences);

/**
 * @openapi
 * /api/bildirim/tercihler/onizleme:
 *   post:
 *     tags: [Bildirim]
 *     summary: '"Haftada ~N bildirim" önizlemesi (son 30 fabrika günü; veri yoksa katalog tahmini). YAZMAZ; gövde verilirse taslağa göre'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { tercihler: { type: array, items: { type: object } } } }
 *     responses:
 *       200: { description: "{haftalik, enCok: [{kind, sayi}], kaynak: olcum|tahmin}" }
 *       400: { description: Geçersiz taslak }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/tercihler/onizleme", t.postPreferencePreview);

/**
 * @openapi
 * /api/bildirim/tercihler/varsayilana-don/onizleme:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Varsayılana dönüşte silinecek kendi tercih satırları (yazmaz; kayıt başına seçim için)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{satirlar: [{id, tur, ad, kanal, acik, kapsam}]}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/tercihler/varsayilana-don/onizleme", t.postResetPreview);

/**
 * @openapi
 * /api/bildirim/tercihler/varsayilana-don:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Seçilen kendi tercih satırlarını siler (tür varsayılana döner); başkasının satırı etkilenmez'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [ids], properties: { ids: { type: array, minItems: 1, items: { type: string, format: uuid } } } }
 *     responses:
 *       200: { description: "{silinen}" }
 *       400: { description: Geçersiz gövde }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/tercihler/varsayilana-don", t.postReset);

/**
 * @openapi
 * /api/bildirim/ayarlar:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Kişisel bildirim ayarları — sessiz saat (fabrika saati), susturulan kanallar, gün özeti saati, ses'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{sessizBaslangic, sessizBitis, sessizKanallar, ozetSaati, ses}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Kişisel ayarları yazar (tam gövde)'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessizBaslangic, sessizBitis, sessizKanallar, ozetSaati, ses]
 *             properties:
 *               sessizBaslangic: { type: string, nullable: true, example: "22:00" }
 *               sessizBitis: { type: string, nullable: true, example: "07:00" }
 *               sessizKanallar: { type: array, items: { type: string, enum: [MASAUSTU, TABLET_SES, PATRON_PUSH] } }
 *               ozetSaati: { type: integer, nullable: true, minimum: 0, maximum: 23 }
 *               ses: { type: boolean }
 *     responses:
 *       200: { description: Ayarlar }
 *       400: { description: Geçersiz gövde }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/ayarlar", t.getSettings);
router.put("/ayarlar", t.putSettings);

/**
 * @openapi
 * /api/bildirim/takip/{tur}/{id}:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Kaydı takip ediyor muyum (sipariş · iş emri · dokuma işi)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: tur, required: true, schema: { type: string, enum: [siparis, is-emri, dokuma-isi] } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{takip, durum, neden}" }
 *       404: { description: Kayıt görülemiyor (FOLLOW_TARGET_NOT_FOUND) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Takip et (bırakılmışsa yeniden takip)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: tur, required: true, schema: { type: string, enum: [siparis, is-emri, dokuma-isi] } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{takip, durum, neden}" }
 *       404: { description: Kayıt görülemiyor (FOLLOW_TARGET_NOT_FOUND) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *   delete:
 *     tags: [Bildirim]
 *     summary: 'Takibi bırak (durum geçişi TAKIP → BIRAKTI; oluşturan otomatiği bir daha ezmez)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: tur, required: true, schema: { type: string, enum: [siparis, is-emri, dokuma-isi] } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{takip, durum, neden}" }
 *       404: { description: Kayıt görülemiyor (FOLLOW_TARGET_NOT_FOUND) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.get("/takip/:tur/:id", t.getFollow);
router.put("/takip/:tur/:id", t.putFollow);
router.delete("/takip/:tur/:id", t.deleteFollow);

/**
 * @openapi
 * /api/bildirim/profiller:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Bildirim profilleri (yönetici) — hücreler ve üyelerle; `arsiv=1` arşivlileri de getirir'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: arsiv, required: false, schema: { type: string, enum: ["1", "true"] } }
 *     responses:
 *       200: { description: "{items}" }
 *       403: { description: Yetki yok }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Profil oluştur (clientToken ile idempotent)'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [kod, ad], properties: { kod: { type: string, maxLength: 40 }, ad: { type: string, maxLength: 120 }, clientToken: { type: string, format: uuid } } }
 *     responses:
 *       201: { description: Profil }
 *       400: { description: Geçersiz gövde }
 *       403: { description: Yetki yok }
 *       409: { description: "Kod kullanımda (NOTIFICATION_PROFILE_CODE_TAKEN) · token çakışması · gelen kutusu kapalı" }
 */
router.get("/profiller", ADMIN, t.getProfiles);
router.post("/profiller", ADMIN, t.postProfile);

/**
 * @openapi
 * /api/bildirim/profiller/aday-kullanicilar:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Profil üye seçicisinin aday kişileri (aktif, silinmemiş, sistem hesabı olmayan)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items: [{ id, ad, kullaniciAdi }] }" }
 *       403: { description: Yetki yok }
 *       409: { description: Gelen kutusu kapalı }
 */
router.get("/profiller/aday-kullanicilar", ADMIN, t.getProfileCandidates);

/**
 * @openapi
 * /api/bildirim/profiller/{id}:
 *   patch:
 *     tags: [Bildirim]
 *     summary: 'Profil adını değiştir'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [ad], properties: { ad: { type: string, maxLength: 120 } } }
 *     responses:
 *       200: { description: Profil }
 *       403: { description: Yetki yok }
 *       404: { description: Profil yok }
 *       409: { description: Arşivli profil (NOTIFICATION_PROFILE_ARCHIVED) }
 *   delete:
 *     tags: [Bildirim]
 *     summary: 'Profili arşivle (durum geçişi; çözüme katılmaz; üyesi olan profil arşivlenemez)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Profil }
 *       403: { description: Yetki yok }
 *       404: { description: Profil yok }
 *       409: { description: "Zaten arşivli (NOTIFICATION_PROFILE_ARCHIVED) · üyesi var, canlı referanslı (NOTIFICATION_PROFILE_IN_USE)" }
 */
router.patch("/profiller/:id", ADMIN, t.patchProfile);
router.delete("/profiller/:id", ADMIN, t.deleteProfile);

/**
 * @openapi
 * /api/bildirim/profiller/{id}/hucreler:
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Profil hücrelerini değiştir (tür → ACIK/KAPALI/KILITLI; verilmeyen tür profilde yok)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [hucreler], properties: { hucreler: { type: array, items: { type: object, required: [tur, durum], properties: { tur: { type: string }, durum: { type: string, enum: [ACIK, KAPALI, KILITLI] } } } } } }
 *     responses:
 *       200: { description: Profil }
 *       400: { description: Tanınmayan tür (NOTIFICATION_KIND_UNKNOWN) }
 *       403: { description: Yetki yok }
 *       404: { description: Profil yok }
 *       409: { description: Arşivli profil (NOTIFICATION_PROFILE_ARCHIVED) }
 */
router.put("/profiller/:id/hucreler", ADMIN, t.putProfileCells);

/**
 * @openapi
 * /api/bildirim/profiller/{id}/kilit-onizleme:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Taslak hücrelerde KILITLI olacak türlerde kendi uygulama-içi tercihini kapatmış üyeler (yazmaz)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [hucreler], properties: { hucreler: { type: array, items: { type: object } } } }
 *     responses:
 *       200: { description: "{etkilenen: [{userId, ad, turler}]}" }
 *       403: { description: Yetki yok }
 *       404: { description: Profil yok }
 */
router.post("/profiller/:id/kilit-onizleme", ADMIN, t.postProfileLockPreview);

/**
 * @openapi
 * /api/bildirim/profiller/{id}/uyeler:
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Profil üyelerini değiştir (profil izin VERMEZ)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [userIds], properties: { userIds: { type: array, items: { type: string, format: uuid } } } }
 *     responses:
 *       200: { description: Profil }
 *       400: { description: Kullanıcı yok (USER_NOT_FOUND) }
 *       403: { description: Yetki yok }
 *       404: { description: Profil yok }
 *       409: { description: Arşivli profil (NOTIFICATION_PROFILE_ARCHIVED) }
 */
router.put("/profiller/:id/uyeler", ADMIN, t.putProfileMembers);

/**
 * @openapi
 * /api/bildirim/fabrika-varsayilani:
 *   get:
 *     tags: [Bildirim]
 *     summary: 'Fabrika varsayılanı — tür başına durum (MIRAS/ACIK/KAPALI/KILITLI), eşikler, ek alıcılar'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{turler}" }
 *       403: { description: Yetki yok }
 *   put:
 *     tags: [Bildirim]
 *     summary: 'Verilen türlerin fabrika varsayılanını yazar; eşikler katalog şemasıyla doğrulanır'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [turler], properties: { turler: { type: array, items: { type: object, required: [tur, durum], properties: { tur: { type: string }, durum: { type: string, enum: [MIRAS, ACIK, KAPALI, KILITLI] }, esikler: { type: object }, ekAlicilar: { type: array, items: { type: string, format: uuid } } } } } } }
 *     responses:
 *       200: { description: "{turler}" }
 *       400: { description: "Tanınmayan tür · geçersiz eşik (NOTIFICATION_PARAMS_INVALID)" }
 *       403: { description: Yetki yok }
 */
router.get("/fabrika-varsayilani", ADMIN, t.getFactoryDefaults);
router.put("/fabrika-varsayilani", ADMIN, t.putFactoryDefaults);

/**
 * @openapi
 * /api/bildirim/tumunu-okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okunmamış sekmesinin tamamını okundu yap; dönen `ids` geri al için'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ids}" }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/tumunu-okundu", c.postReadAll);

/**
 * @openapi
 * /api/bildirim/geri-al-okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: '"Tümünü okundu"yu geri al — verilen kendi satırlarını yeniden okunmamış yapar'
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [ids], properties: { ids: { type: array, maxItems: 500, items: { type: string, format: uuid } } } }
 *     responses:
 *       200: { description: "{ids} — gerçekten geri alınanlar" }
 *       400: { description: Geçersiz gövde }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/geri-al-okundu", c.postUndoRead);

/**
 * @openapi
 * /api/bildirim/{id}/okundu:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okundu işaretle (atomik; zaten okunmuşsa `{degisti:false}`)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{degisti}" }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/okundu", c.postRead);

/**
 * @openapi
 * /api/bildirim/{id}/okunmadi:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Okunmadı işaretle (atomik; zaten okunmamışsa `{degisti:false}`)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{degisti}" }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/okunmadi", c.postUnread);

/**
 * @openapi
 * /api/bildirim/{id}/ertele:
 *   post:
 *     tags: [Bildirim]
 *     summary: 'Ertele — 1 saat · yarın sabah (fabrika günü 08:00) · vardiya sonu'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [sure], properties: { sure: { type: string, enum: ["1s", yarin-sabah, vardiya-sonu] } } }
 *     responses:
 *       200: { description: "{erteleBitis}" }
 *       400: { description: Geçersiz süre ya da süren vardiya yok (VARDIYA_YOK) }
 *       404: { description: Kişinin görünür satırı değil (BILDIRIM_YOK) }
 *       409: { description: Gelen kutusu kapalı (BILDIRIM_KAPALI) }
 */
router.post("/:id/ertele", c.postSnooze);

export default router;
