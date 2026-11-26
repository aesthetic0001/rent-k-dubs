// The ION light-rail car that crosses the landing, drawn as SVG.

/**
 * An ION light-rail car (Waterloo Region), side view, facing left: white body, a blue roof band
 * that sweeps down beside the raked windshield, dark tinted windows and doors, and black bellows
 * between four sections. An original drawing in the line's colours, without its logos.
 */
export function IonTrain({ className }: { className?: string }) {
  const blue = "var(--ion-blue)";
  const white = "#f6f7f5";
  const skirt = "#c9cdd3";
  const glass = "#141a2b";
  const seam = "#0c0f18";
  // Sections run between the bellows; each gets double doors.
  const bellows = [452, 852, 1252];
  const doors = [300, 560, 760, 980, 1160, 1400];
  const mullions = [230, 390, 500, 640, 700, 840, 900, 1060, 1100, 1240, 1300, 1480, 1540];

  return (
    <svg viewBox="0 0 1600 240" className={className} aria-hidden>
      <defs>
        <clipPath id="train-body">
          <path d="M1576 40 H176 C104 40 62 62 46 112 L32 170 Q28 204 60 204 H1576 Q1592 204 1592 188 V56 Q1592 40 1576 40 Z" />
        </clipPath>
        <linearGradient id="train-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--l-glow)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--l-glow)" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* pantograph and roof equipment */}
      <g stroke={seam} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M800 36 L836 14 L800 6" />
        <path d="M776 6 H840" />
      </g>
      <g fill="#d6dae0">
        <rect x="740" y="30" width="120" height="12" rx="4" />
        <rect x="300" y="32" width="110" height="10" rx="4" />
        <rect x="1100" y="32" width="110" height="10" rx="4" />
      </g>

      <g clipPath="url(#train-body)">
        <rect x="0" y="0" width="1600" height="240" fill={white} />
        {/* livery: blue roof band, tinted windows, white flanks, grey skirt */}
        <rect x="0" y="40" width="1600" height="22" fill={blue} />
        <rect x="150" y="72" width="1450" height="70" fill={glass} />
        <rect x="150" y="76" width="1450" height="62" fill="url(#train-glow)" />
        <rect x="0" y="192" width="1600" height="12" fill={skirt} />
        <g fill={white}>
          {mullions.map((x) => (
            <rect key={x} x={x} y="72" width="6" height="70" />
          ))}
        </g>

        {/* doors: dark glass leaves from the window band to the floor */}
        {doors.map((x) => (
          <g key={x}>
            <rect
              x={x}
              y="70"
              width="60"
              height="124"
              fill={glass}
              stroke="#3a4152"
              strokeWidth="3"
            />
            <rect x={x + 4} y="74" width="52" height="66" fill="url(#train-glow)" />
            <path d={`M${x + 30} 70 V194`} stroke="#3a4152" strokeWidth="3" />
          </g>
        ))}

        {/* cab: raked windshield with the blue band sweeping down beside it to the nose */}
        <path d="M0 44 H250 C176 60 124 110 104 204 H0 Z" fill={glass} />
        <path d="M0 48 H250 C176 64 124 114 104 210" stroke={blue} strokeWidth="26" fill="none" />
        <path d="M268 50 C192 66 138 116 120 210" stroke={blue} strokeWidth="22" fill="none" />
        <rect x="54" y="52" width="150" height="16" rx="2" fill="#2a2010" />
        {/* white nose cap, bumper and headlights */}
        <path d="M0 168 H96 L90 204 H0 Z" fill={white} />
        <rect x="0" y="194" width="92" height="10" fill={skirt} />
        <rect x="10" y="174" width="30" height="10" rx="4" fill="#fff1c4" />
        <rect x="46" y="174" width="18" height="10" rx="4" fill="#fff1c4" />

        {/* rear: the windows wrap round a rounded tail */}
        <rect x="1580" y="72" width="20" height="70" fill={glass} />
      </g>

      {/* bellows between sections */}
      {bellows.map((x) => (
        <g key={x}>
          <rect x={x} y="44" width="24" height="160" rx="3" fill={seam} />
          {[5, 10, 15, 20].map((dx) => (
            <rect key={dx} x={x + dx - 1} y="48" width="1.5" height="152" fill="#252a38" />
          ))}
        </g>
      ))}

      {/* fleet number */}
      <text
        x="170"
        y="168"
        fill={blue}
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--font-sans)"
      >
        519A
      </text>
      {/* destination sign */}
      <text
        x="64"
        y="64.5"
        fill="var(--l-glow)"
        fontSize="10"
        fontWeight="700"
        fontFamily="var(--font-sans)"
      >
        RENT THE LOO
      </text>

      {/* low floor: bogies barely show under the skirt */}
      <g fill={seam}>
        {[170, 640, 1040, 1460].map((x) => (
          <rect key={x} x={x} y="204" width="70" height="7" rx="3" />
        ))}
      </g>
    </svg>
  );
}
