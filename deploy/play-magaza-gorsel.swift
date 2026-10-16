// Play mağaza görselleri — yalnız macOS'un kendi çizim katmanıyla (AppKit), dış font/asset indirmeden.
//   swift deploy/play-magaza-gorsel.swift ikon  <kaynak.png> <cikti.png>                 # 512x512 RGBA (32 bit)
//   swift deploy/play-magaza-gorsel.swift one   <logo.png> <cikti.png> <ad> [halka]      # 1024x500 öne çıkan görsel (24 bit)
//   swift deploy/play-magaza-gorsel.swift maske <girdi.png> <cikti.png> <x,y,w,h>...     # opak kutu (geri çözülemez; 24 bit)
// Maske kutuları görüntü PİKSELİ cinsindendir, sol üst köşe kökenli. Kutu düz dolgu çizer, bulanıklık değildir.
import AppKit

func tuval(_ w: Int, _ h: Int) -> NSBitmapImageRep {
  NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 32)!
}
func ciz(_ r: NSBitmapImageRep, _ blok: () -> Void) {
  NSGraphicsContext.saveGraphicsState()
  let c = NSGraphicsContext(bitmapImageRep: r)!
  c.imageInterpolation = .high
  NSGraphicsContext.current = c
  blok()
  NSGraphicsContext.restoreGraphicsState()
}
func yaz(_ r: NSBitmapImageRep, _ yol: String) {
  try! r.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: yol))
}
// Öne çıkan görsel ve ekran görüntüsü: Play 24 bit PNG (alfasız) ister.
func yazOpak(_ r: NSBitmapImageRep, _ yol: String) {
  let w = r.pixelsWide, h = r.pixelsHigh
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.draw(r.cgImage!, in: CGRect(x: 0, y: 0, width: w, height: h))
  let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: yol) as CFURL, "public.png" as CFString, 1, nil)!
  CGImageDestinationAddImage(d, ctx.makeImage()!, nil)
  guard CGImageDestinationFinalize(d) else { fatalError("yazılamadı: \(yol)") }
}
func oku(_ yol: String) -> NSImage {
  guard let i = NSImage(contentsOfFile: yol) else { fatalError("okunamadı: \(yol)") }
  return i
}
func renk(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
  NSColor(deviceRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}

let a = CommandLine.arguments
guard a.count >= 4 else { fatalError("kullanım: ikon|one|maske ...") }

switch a[1] {
case "ikon":
  let r = tuval(512, 512)
  ciz(r) { oku(a[2]).draw(in: NSRect(x: 0, y: 0, width: 512, height: 512)) }
  yaz(r, a[3])

case "one":
  let (W, H): (CGFloat, CGFloat) = (1024, 500)
  let r = tuval(1024, 500)
  let ad = a.count > 4 ? a[4] : "TeksERP"
  let altin = a.count > 5 && a[5] == "halka"
  ciz(r) {
    NSGradient(starting: renk(0x141A29), ending: renk(0x2B3F5C))!.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: 25)
    // Logo: sol yarı, dikeyde ortalı.
    let L: CGFloat = 330
    let lx: CGFloat = 92, ly = (H - L) / 2
    if altin {
      let halka = NSBezierPath(ovalIn: NSRect(x: lx - 6, y: ly - 6, width: L + 12, height: L + 12))
      halka.lineWidth = 10
      renk(0xC9A227).setStroke()
      halka.stroke()
    }
    let p: CGFloat = altin ? 44 : 0
    oku(a[2]).draw(in: NSRect(x: lx + p, y: ly + p, width: L - 2 * p, height: L - 2 * p))
    // Ad: sağ yarı, tek satır, genişliğe sığacak boyut.
    let alan: CGFloat = W - 500 - 60
    var boyut: CGFloat = 96
    var oz: [NSAttributedString.Key: Any] = [:]
    var olcu = NSSize.zero
    repeat {
      oz = [.font: NSFont.systemFont(ofSize: boyut, weight: .bold), .foregroundColor: NSColor.white, .kern: -1]
      olcu = (ad as NSString).size(withAttributes: oz)
      boyut -= 2
    } while olcu.width > alan
    let tx: CGFloat = 500
    let ty = (H - olcu.height) / 2 + 10
    (ad as NSString).draw(at: NSPoint(x: tx, y: ty), withAttributes: oz)
    // İnce vurgu çizgisi (marka rengi).
    (altin ? renk(0xC9A227) : renk(0x6FA8DC)).setFill()
    NSBezierPath(rect: NSRect(x: tx + 4, y: ty - 18, width: 120, height: 6)).fill()
  }
  yazOpak(r, a[3])

case "maske":
  guard let kaynak = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: a[2]))) else { fatalError("okunamadı") }
  let w = kaynak.pixelsWide, h = kaynak.pixelsHigh
  let r = tuval(w, h)
  ciz(r) {
    kaynak.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
    renk(0x8A93A3).setFill()
    for k in a.dropFirst(4) {
      let s = k.split(separator: ",").map { CGFloat(Double($0)!) }
      // Görüntü kökeni sol üst → AppKit sol alt.
      NSBezierPath(roundedRect: NSRect(x: s[0], y: CGFloat(h) - s[1] - s[3], width: s[2], height: s[3]), xRadius: 6, yRadius: 6).fill()
    }
  }
  yazOpak(r, a[3])

default:
  fatalError("bilinmeyen kip: \(a[1])")
}
