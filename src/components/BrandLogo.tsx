export default function BrandLogo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`brand ${className}`}>
      <span className="brand-glyph" style={{ width: size, height: size }} aria-hidden />
      <span className="brand-word">TradeReady<span className="brand-dot">.</span></span>
    </span>
  );
}
