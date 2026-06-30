-- Cihaz türü (Tablet/Telefon/PC) — yeni cihazlar hep "tablet" görünmesin diye.
-- Sadece görsel/etiket; davranış değişmez. Manuel migration (psql + resolve --applied).
ALTER TABLE "devices" ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'TABLET';
