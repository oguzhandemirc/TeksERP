-- Telegram sohbeti süper gruba taşındığında (Bot API 400 + `parameters.migrate_to_chat_id`) gönderici satırı
-- KALICI hata yapar ve YENİ sohbet kimliğini (yalnız sayı, sır DEĞİL) buraya yazar: portal ve nabız gösterir,
-- operatör sohbet kimliği dosyasını günceller. Kolon yalnız bu hata kodunda ve yalnız Telegram satırında dolar.
ALTER TABLE "bildirim" ADD COLUMN "yeniSohbetKimligi" VARCHAR(24);

ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_yeni_sohbet_bicimi"
  CHECK ("yeniSohbetKimligi" IS NULL OR ("yeniSohbetKimligi" ~ '^-?[0-9]{1,20}$' AND "kanal" = 'TELEGRAM' AND "sonHata" = 'TELEGRAM_SOHBET_TASINDI'));

-- Gönderici rolü yalnız bu kolonu EK olarak yazar (yetki kümesi: bildirim SELECT + durum kolonları UPDATE).
GRANT UPDATE ("yeniSohbetKimligi") ON "bildirim" TO "satici_bildirim";
