// ScreenChrome stilleri — dosya boyu tavanı için bileşenden ayrıldı (davranış aynı).
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  appbar: { backgroundColor: '#0f172a' },
  // RN Paper Appbar.Content title bazı sürümlerde center hizalar; sola sabitle.
  // flexShrink: makine çipi yanına sığsın diye başlık gerekirse kısalır.
  title: { color: '#fff', fontWeight: '700', textAlign: 'left', flexShrink: 1 },
  // Başlık + makine çipi yan yana.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Content view'i sola hizala — title kenara dayalı. paddingLeft 4: ufak nefes
  // payı, ev/back ikonuna yakın dursun (telefonda sağdaki aksiyon butonları için yer açar).
  // flex: 1 de vererek available space'i kaplamasını garanti edelim.
  // justifyContent: 'center' ekleyerek dikeyde ortalayalım.
  appbarContent: { alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 4, flex: 1 },
  // Baştaki ikonsuz düzen (tablet): içerik padding'iyle (16) hizalı başlık.
  appbarContentNoLead: { paddingLeft: 16 },
  // Profil tetiği — kendini belli eden DOLU marka-indigo buton (diğer soluk
  // pill'lerden ayrışır); ölçüler aynı (radius 10 + paddingV 9 → eş boy).
  userTrigger: {
    borderRadius: 10,
    backgroundColor: '#4f46e5',
    borderWidth: 1,
    borderColor: '#818cf8',
    overflow: 'hidden',
    marginHorizontal: 4,
  },
  userTriggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  // Ad gizliyken (telefon) yatay iç boşluk dikeyle eşitlenir → 36×36 KARE buton.
  // Metin için ayarlanmış 12px yatay boşluk tek ikonla 42×36 dikdörtgen bırakıyor
  // ve "yazısı silinmiş buton" gibi duruyordu.
  userTriggerIconOnly: { paddingHorizontal: 9 },
  userTriggerName: { color: '#fff', fontWeight: '700', fontSize: 13, maxWidth: 160 },
  // Menü ilk satırı — giriş yapan operatörün adı (kim olduğun). Menü yüzeyi beyaz →
  // koyu metin. Ad + (varsa) @kullanıcı-adı alt satır.
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    maxWidth: 340,
  },
  menuHeaderText: { flexShrink: 1 },
  menuHeaderName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  menuHeaderSub: { fontSize: 13, color: '#64748b', marginTop: 1 },
  // Menü maddeleri — saha dokunma hedefi (min 56dp kuralı) + büyük yazı.
  menuItem: { height: 58, maxWidth: 340 },
  menuItemTitle: { fontSize: 17 },
  content: { flex: 1 },
});
