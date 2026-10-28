-- D2 inceleme bulgusu 2: toplu satır ekleme ucu (`POST /irsaliyeler/:id/satirlar`) kayıt yaratır ama token taşımıyordu;
-- zaman aşımı tekrarı 500 satırı ikiliyordu. Parti kimliği satır başına aynı `clientToken`; replay başlık satırı
-- kilidinin ardından okunur (K′), bu yüzden UNIQUE değil düz indeks. ADDITIVE ve idempotent.
ALTER TABLE "customer_delivery_note_lines" ADD COLUMN IF NOT EXISTS "clientToken" UUID;
CREATE INDEX IF NOT EXISTS "customer_delivery_note_lines_clientToken_idx" ON "customer_delivery_note_lines"("clientToken");
