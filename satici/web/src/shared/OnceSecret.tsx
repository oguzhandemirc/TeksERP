// BİR KEZ GÖSTERİLEN SIR — etkinleştirme kodu ve TOTP sırrı yalnız CANLI yanıtta gelir: bileşen
// durumunda yaşar (önbelleğe, yerel depoya, URL'ye yazılmaz), pencere kapanınca biter. Aynı işlem
// kimliğinin tekrar yanıtı sırrı taşımaz (`…Gosterilemez: true`) — o zaman yeniden üretmek gerekir.
import { QRCodeSVG } from "qrcode.react";
import { Button, Modal, ModalActions } from "./ui";

export function OnceSecretModal({
  title,
  secret,
  unavailable,
  qrValue,
  note,
  onClose,
}: {
  title: string;
  secret: string | null;
  /** Tekrar yanıtı: sır bu yanıtta yok. */
  unavailable: boolean;
  /** Doğrulayıcı uygulama için otpauth URI'si (varsa QR çizilir). */
  qrValue?: string | null;
  note: string;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {unavailable || !secret ? (
        <p className="error" role="alert">
          Bu yanıt bir tekrar yanıtıdır: sır yalnız ilk yanıtta gösterilir ve artık gösterilemez. Gerekirse yeniden üretin.
        </p>
      ) : (
        <>
          <p className="warn-box">Bu değer yalnız ŞİMDİ gösteriliyor; pencere kapanınca bir daha gösterilemez. {note}</p>
          {qrValue ? (
            <div className="qr" data-testid="totp-qr">
              <QRCodeSVG value={qrValue} size={192} marginSize={2} title="Doğrulayıcı uygulama QR kodu" />
            </div>
          ) : null}
          <p className="secret" data-testid="once-secret">
            <code>{secret}</code>
          </p>
        </>
      )}
      <ModalActions>
        <Button variant="primary" onClick={onClose}>
          Kaydettim, kapat
        </Button>
      </ModalActions>
    </Modal>
  );
}
