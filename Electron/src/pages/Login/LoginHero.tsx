export function LoginHero() {
  return (
    <div className="relative hidden flex-1 overflow-hidden bg-[#070b1a] md:flex">
      <div className="blob-1 absolute -top-40 -left-40 h-[640px] w-[640px] rounded-full bg-blue-600/45 blur-[120px]" />
      <div className="blob-2 absolute top-1/3 -right-40 h-[560px] w-[560px] rounded-full bg-indigo-500/40 blur-[120px]" />
      <div className="blob-3 absolute -bottom-40 left-1/4 h-[720px] w-[720px] rounded-full bg-teal-500/30 blur-[140px]" />

      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className="relative z-10 flex h-full w-full flex-col justify-between p-14 text-white">
        <div>
          <span className="text-sm font-medium tracking-[0.2em] text-white/70 uppercase">
            Adnan Şahin Tekstil
          </span>
        </div>

        <div className="space-y-5">
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">
            Tekstil üretiminin
            <br />
            <span className="bg-gradient-to-r from-sky-300 via-indigo-200 to-teal-200 bg-clip-text text-transparent">
              dijital omurgası.
            </span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-white/65">
            Sipariş, üretim, kalite ve sevkiyatın tek panelden yönetildiği
            kurumsal ERP platformu.
          </p>
        </div>

        <div className="flex items-center justify-between text-xs text-white/40">
          <span>
            © {new Date().getFullYear()}{" "}
            <a
              href="https://etkiliyazilim.com"
              target="_blank"
              rel="noopener noreferrer"
              className="app-no-drag underline-offset-4 transition hover:text-white/80 hover:underline"
            >
              Etkili Yazılım
            </a>
          </span>
          <span className="tracking-wider">v1.0</span>
        </div>
      </div>
    </div>
  );
}
