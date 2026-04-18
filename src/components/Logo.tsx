export default function Logo({ size = 52 }: { size?: number }) {
  /*
    Lucide's Zap polygon (viewBox 0 0 24 24):
      points="13 2 3 14 12 14 11 22 21 10 12 10"
    Scaled ×1.5 and centered in 52×52 (offset +8 on both axes):
      center x = (12.5 + 39.5) / 2 = 26 ✓
      center y = (11   + 41  ) / 2 = 26 ✓
    evenodd rule punches the bolt as transparent negative space
    through the gradient blue square.
  */
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Kinvox mark"
    >
      <defs>
        <linearGradient id="squareGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>

      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="url(#squareGrad)"
        d="
          M10,2 H42 Q50,2 50,10 V42 Q50,50 42,50 H10 Q2,50 2,42 V10 Q2,2 10,2 Z
          M27.5,11 L12.5,29 L26,29 L24.5,41 L39.5,23 L26,23 Z
        "
      />

      {/* Rim-light: 1px highlight on top-right arc */}
      <path
        d="M10,2 H42 Q50,2 50,10"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
