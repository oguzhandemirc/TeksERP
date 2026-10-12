-- GÜVENLİK BİLDİRİMİ (Bölge 7 B3): iki bildirim olayı. ADDITIVE — tablo/satır değişmez; gönderici bu olayları işletme
-- sohbetine değil yalnız güvenlik hedeflerine yollar (`GUVENLIK_TELEGRAM_CHAT_ID` · `GUVENLIK_EPOSTA_ALICI`), yoksa KAPALI.

ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUVENLIK_OLAYI';
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUVENLIK_OZETI';
