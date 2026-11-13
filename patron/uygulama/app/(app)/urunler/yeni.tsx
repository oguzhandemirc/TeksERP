// Yeni ürün (V5c, yalnız ERP): ad + tür; kod fabrikada doğar (STK-…), birim türden. Yapı alanları (en, gramaj…) panelde.
// Deneme kimliği `clientToken` olarak gider (yeni fabrika tekrara ilk kartı döner); eski fabrikada belirsiz tekrardaki ad
// mükerreri "önceki deneme" iletisine çevrilir.
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { ApiError } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import { tanimEkleHatasi } from "../../../src/lib/duzenleme";
import { URUN_TURLERI, urunGovdesi, type UrunFormu } from "../../../src/lib/urun";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Card, Field, Muted } from "../../../src/ui/kit";
import { QuickChip } from "../../../src/ui/siparis/parts";
import { space } from "../../../src/ui/tokens";
import { useWrite } from "../../../src/ui/useWrite";

export default function NewItem() {
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const [f, setF] = useState<UrunFormu>({ ad: "", tur: "FABRIC" });
  const [formError, setFormError] = useState<string | null>(null);
  const built = urunGovdesi(f);
  const belirsiz = useRef(false);
  const send = useCallback(async (id: string) => {
    if (!built.ok) throw new Error(built.error);
    try {
      const r = await yazici.urunEkle(id, built.body);
      belirsiz.current = false;
      return r;
    } catch (err) {
      const once = belirsiz.current;
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      throw tanimEkleHatasi(err, once, "Ürün");
    }
  }, [yazici, built]);
  const w = useWrite(send);
  if (!islemVar("urun.ekle", permissions)) return <Screen title="Yeni ürün" module="urunler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) {
      invalidate(["urun"]);
      router.back();
    }
  }
  const shown = formError ?? w.error;
  return (
    <Screen title="Yeni ürün" module="urunler" back>
      <Card domain="stok">
        <Field label="Ad" value={f.ad} onChangeText={(v) => setF((o) => ({ ...o, ad: v }))} testID="urun-ad" placeholder="Örn. POPLIN 120" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {URUN_TURLERI.map((x) => <QuickChip key={x.key} label={`${x.label} (${x.birim})`} selected={f.tur === x.key} onPress={() => setF((o) => ({ ...o, tur: x.key }))} testID={`urun-tur-${x.key}`} />)}
        </View>
      </Card>
      {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
      {shown ? <Banner tone="error" text={shown} testID="urun-hata" /> : null}
      <Button label={belirsiz.current && shown ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="urun-gonder" />
    </Screen>
  );
}
