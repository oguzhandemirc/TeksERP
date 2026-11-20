-- YIKICI (kullanıcı onayı 2026-11-20): eski satıcı üzerinden destek talebi sistemi (3d-2) söküldü;
-- yerine Etkili Destek geldi (talepler merkezde durur, fabrikada tablo yok). Talepler ve satıcı
-- yanıtlarının yerel kopyası silinir; "ne oldu"nun sahibi satıcının defteriydi, yerelde raporlanan
-- sayı yoktu. DEFERRABLE FK'lara dokunulmaz (DropForeignKey satırları çıkarıldı); tabloların kendi
-- FK'ları DROP TABLE ile düşer.

-- DropTable
DROP TABLE IF EXISTS "support_ticket_replies";

-- DropTable
DROP TABLE IF EXISTS "support_tickets";

-- İzin katalogdan çıkarıldı; boot uzlaştırması yalnız EKLER, kaldırma bu bilinçli veri adımıdır.
-- Kullanıcı ve rol şablonu atamaları FK ON DELETE CASCADE ile düşer.
DELETE FROM "permissions" WHERE "code" = 'support:create';
