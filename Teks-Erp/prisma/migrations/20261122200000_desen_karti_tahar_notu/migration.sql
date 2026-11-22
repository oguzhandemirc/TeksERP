-- Devere/levent S8: desen kartında tahar düzeni notu — yalnız EKLEME (boş bırakılabilir kolon).
-- Eski kayıt NULL alır (= bugünkü görünüm; basımda "Tahar" satırı çıkmaz). Uzunluk VarChar(300) servis ikizidir.
ALTER TABLE "weave_designs" ADD COLUMN "drawingInNote" VARCHAR(300);
