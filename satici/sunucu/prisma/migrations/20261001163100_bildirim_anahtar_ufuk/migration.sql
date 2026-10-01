-- Lisans v2 · L2-3: iki bildirim olayı (YALNIZ EKLER; değer eklemek var olan satırı değiştirmez).
--   ANAHTAR_SURESI_BITIYOR — K4: ALT · ara imzacı · İNDİRME sertifikasının bitişine 30/15/7/1 gün kaldı (tören günü)
--   UZUN_UFUK_VERILDI     — K2: 400 günü aşan ya da süresiz çevrimdışı ufuklu HAK
ALTER TYPE "BildirimOlayi" ADD VALUE 'ANAHTAR_SURESI_BITIYOR';
ALTER TYPE "BildirimOlayi" ADD VALUE 'UZUN_UFUK_VERILDI';
