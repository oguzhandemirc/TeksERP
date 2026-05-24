-- =============================================================================
-- RollError.endMeter kolonunu kaldır.
-- =============================================================================
-- KK2/Kurşun operatörü hatayı sadece NOKTA olarak girer (startMeter); aralık
-- bilgisi (endMeter) artık tutulmuyor. Tambur operatörü ekranda bu nokta'yı
-- görüp fiziksel sarım esnasında kesim kararı verir. Kesim modeli:
-- cumulative length-based (operatör "X metre sardım, kestim" der; sayaç sıfırlanır).
-- =============================================================================

ALTER TABLE "roll_errors" DROP COLUMN "endMeter";
