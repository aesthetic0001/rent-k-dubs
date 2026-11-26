// The landing hero's painting: a misty morning on Silver Lake in Waterloo Park. Uptown's towers sit
// faint on the far shore; a pine leans over a rocky bank with a red Muskoka chair under it, and
// Canada geese walk the shore. Shapes come from a seeded generator so server and client match.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 1000;
/** Where the far shore meets the water; the bank is drawn at 772 and lifted to it. */
const SHORE = 690;
const LIFT = 772 - SHORE;

/** Uptown and the student towers, low on the far shore. */
function farTowers() {
  const rand = seeded(11);
  const towers: { x: number; w: number; h: number }[] = [];
  for (let x = 380; x < 1120;) {
    const w = 14 + rand() * 26;
    const near = Math.exp(-(((x - 700) / 200) ** 2));
    towers.push({ x, w, h: 8 + rand() * 12 + near * (26 + rand() * 46) });
    x += w + 2 + rand() * 6;
  }
  return towers;
}

/** The pine's foliage pads: flat, layered clouds of needles, as in a woodblock print. */
const pads = [
  { x: 1190, y: 248, rx: 210, ry: 92 },
  { x: 1010, y: 330, rx: 160, ry: 70 },
  { x: 1370, y: 318, rx: 150, ry: 72 },
  { x: 880, y: 408, rx: 108, ry: 48 },
  { x: 1150, y: 404, rx: 140, ry: 56 },
  { x: 1500, y: 420, rx: 100, ry: 50 },
] as const;

function foliage() {
  const rand = seeded(2718);
  const dark: { cx: number; cy: number; rx: number; ry: number }[] = [];
  const mid: typeof dark = [];
  const light: typeof dark = [];
  for (const pad of pads) {
    const n = Math.round(pad.rx / 9);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand());
      const cx = pad.x + Math.cos(a) * d * pad.rx * 0.82;
      const cy = pad.y + Math.sin(a) * d * pad.ry * 0.7;
      const r = 18 + rand() * 26;
      dark.push({ cx, cy: cy + 12, rx: r * 1.4, ry: r * 0.8 });
      mid.push({ cx: cx - 4, cy: cy - 2, rx: r * 1.2, ry: r * 0.66 });
      if (cy < pad.y + pad.ry * 0.1 && rand() > 0.35)
        light.push({ cx: cx - 10, cy: cy - 12, rx: r * 0.8, ry: r * 0.38 });
    }
  }
  // Needle tufts scattered over the pads, so they read as brushwork rather than clouds.
  const tufts: { cx: number; cy: number; r: number; tone: 1 | 3 }[] = [];
  for (const pad of pads) {
    const n = Math.round(pad.rx / 2.2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand());
      const cy = pad.y + Math.sin(a) * d * pad.ry * 0.9;
      tufts.push({
        cx: pad.x + Math.cos(a) * d * pad.rx,
        cy,
        r: 2 + rand() * 4,
        tone: cy < pad.y - pad.ry * 0.15 ? 3 : 1,
      });
    }
  }
  return { dark, mid, light, tufts };
}

function Goose({
  x,
  y,
  s = 1,
  flip = false,
  swim = false,
}: {
  x: number;
  y: number;
  s?: number;
  flip?: boolean;
  swim?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      {!swim && <path d="M-4 0 V12 M6 0 V12" stroke="#2b2622" strokeWidth="2.5" />}
      <ellipse cx="0" cy="-8" rx="24" ry="12" fill="var(--lk-goose)" />
      <path d="M-22 -8 Q-30 -14 -26 -4 Z" fill="#2b2622" />
      <ellipse cx="2" cy="-4" rx="16" ry="6" fill="var(--lk-goose-belly)" />
      <path
        d="M14 -14 Q22 -26 20 -44"
        stroke="#22201e"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="24" cy="-46" rx="9" ry="6" fill="#22201e" />
      <path d="M31 -45 L40 -43 L31 -41 Z" fill="#22201e" />
      <path d="M18 -44 Q22 -38 27 -42" stroke="#f3efe6" strokeWidth="3" fill="none" />
    </g>
  );
}

/** The bank, rocks, grass, chair and pine, drawn once and mirrored for the reflection. */
function Bank() {
  const { dark, mid, light, tufts } = foliage();
  return (
    <g>
      {/* spit of land running out into the lake */}
      <path d="M640 770 Q700 756 780 758 L900 750 L900 776 L640 776 Z" fill="var(--lk-rock-2)" />
      {/* rocks */}
      <path
        d="M860 776 L880 742 Q940 716 1010 722 L1060 690 Q1140 660 1230 668 L1300 640 Q1400 612 1480 630 L1600 600 V776 Z"
        fill="var(--lk-rock-2)"
      />
      <path
        d="M900 760 Q960 730 1030 736 L1090 712 Q1160 690 1240 700 L1320 676 Q1420 652 1600 650 V776 H900 Z"
        fill="var(--lk-rock-1)"
      />
      <g fill="var(--lk-rock-3)">
        <path d="M940 752 Q980 734 1020 744 L1010 760 Z" />
        <path d="M1110 724 Q1160 704 1210 716 L1190 740 Q1150 746 1110 724 Z" />
        <path d="M1260 706 Q1320 684 1370 700 L1352 722 Q1300 728 1260 706 Z" />
        <path d="M1420 688 Q1480 668 1540 682 L1520 706 Q1460 710 1420 688 Z" />
        <path d="M1020 770 Q1080 752 1130 764 L1120 776 H1030 Z" />
        <path d="M1240 760 Q1300 744 1350 756 L1344 776 H1250 Z" />
      </g>
      {/* trunk and boughs, leaning out over the water */}
      <g stroke="var(--lk-trunk)" strokeLinecap="round" fill="none">
        <path d="M1330 650 C1300 560 1250 520 1230 430 S1200 300 1190 250" strokeWidth="30" />
        <path d="M1352 660 C1320 600 1300 570 1280 540" strokeWidth="44" />
        <path d="M1236 450 C1170 430 1100 400 1010 340" strokeWidth="14" />
        <path d="M1226 410 C1290 380 1330 350 1370 320" strokeWidth="13" />
        <path d="M1160 412 C1060 410 960 420 880 410" strokeWidth="9" />
        <path d="M1300 560 C1360 500 1430 460 1500 424" strokeWidth="12" />

        <path d="M1220 470 C1180 440 1160 420 1150 404" strokeWidth="8" />
      </g>
      <g filter="url(#lake-rough)">
        <g fill="var(--lk-leaf-1)">
          {dark.map((e, i) => (
            <ellipse key={i} {...e} />
          ))}
        </g>
        <g fill="var(--lk-leaf-2)">
          {mid.map((e, i) => (
            <ellipse key={i} {...e} />
          ))}
        </g>
        <g fill="var(--lk-leaf-3)" opacity="0.8">
          {light.map((e, i) => (
            <ellipse key={i} {...e} />
          ))}
        </g>
      </g>
      <g filter="url(#lake-needles)">
        {tufts.map((d, i) => (
          <circle
            key={i}
            cx={d.cx}
            cy={d.cy}
            r={d.r}
            fill={d.tone === 3 ? "var(--lk-leaf-3)" : "var(--lk-leaf-1)"}
            opacity="0.7"
          />
        ))}
      </g>
      {/* grass along the top of the bank */}
      <g filter="url(#lake-rough)" fill="var(--lk-leaf-2)">
        <path d="M1050 700 Q1100 664 1170 676 Q1220 650 1290 664 Q1350 636 1420 646 Q1500 616 1600 620 V660 Q1500 650 1420 670 Q1340 676 1280 690 Q1200 692 1140 704 Q1090 712 1050 700 Z" />
      </g>
      {/* red Muskoka chair under the pine, facing the lake */}
      <g fill="var(--lk-red)" transform="translate(1150 702)">
        <path d="M0 -62 L10 -64 L24 -4 L14 -2 Z" />
        <path d="M14 -18 L-36 -12 L-36 -4 L16 -10 Z" />
        <path d="M6 -36 L-34 -32 L-34 -26 L8 -30 Z" />
        <path d="M-32 -30 L-28 -30 L-28 14 L-32 14 Z" />
        <path d="M-6 -10 L-2 -10 L2 14 L-2 14 Z" />
        <path d="M18 -8 L22 -8 L24 14 L20 14 Z" />
      </g>
      <Goose x={792} y={752} s={0.9} />
      <Goose x={846} y={748} s={0.8} flip />
    </g>
  );
}

export function LakeScene({ className }: { className?: string }) {
  const towers = farTowers();
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMaxYMax slice"
      className={className}
      aria-hidden
    >
      <defs>
        <filter id="lake-rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="16" />
        </filter>
        <filter id="lake-needles" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="9" />
        </filter>
        <filter id="lake-ripple" x="0" y="-5%" width="100%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.09" numOctaves="2" seed="9" />
          <feDisplacementMap in="SourceGraphic" scale="22" />
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <linearGradient id="lake-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--lk-water-1)" />
          <stop offset="0.45" stopColor="var(--lk-water-2)" />
          <stop offset="1" stopColor="var(--lk-water-3)" />
        </linearGradient>
        <linearGradient id="lake-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--lk-mist)" stopOpacity="0" />
          <stop offset="0.75" stopColor="var(--lk-mist)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--lk-mist)" stopOpacity="0.4" />
        </linearGradient>
        <clipPath id="lake-below">
          <rect x="0" y={SHORE} width={W} height={H - SHORE} />
        </clipPath>
      </defs>

      {/* the far shore, half lost in the mist */}
      <g fill="var(--lk-far)">
        {towers.map((t, i) => (
          <rect key={i} x={t.x} y={SHORE - t.h} width={t.w} height={t.h + 2} />
        ))}
        <path
          d={`M0 ${SHORE} Q300 ${SHORE - 16} 600 ${SHORE - 8} T1600 ${SHORE - 10} V${SHORE + 2} H0 Z`}
        />
      </g>
      <rect x="0" y={SHORE - 110} width={W} height="118" fill="url(#lake-mist)" />

      <rect x="0" y={SHORE} width={W} height={H - SHORE} fill="url(#lake-water)" />
      {/* reflection of the bank and the pine */}
      <g clipPath="url(#lake-below)" opacity="0.38">
        <g filter="url(#lake-ripple)" transform={`translate(0 ${SHORE * 2}) scale(1 -1)`}>
          <g transform={`translate(0 ${-LIFT})`}>
            <Bank />
          </g>
        </g>
      </g>
      {/* light on the water */}
      <g stroke="var(--lk-glint)" strokeLinecap="round" opacity="0.32">
        <path d="M120 730 H340 M420 756 H520 M180 790 H260 M600 724 H720" strokeWidth="2" />
        <path d="M40 840 H220 M520 820 H640 M300 900 H420" strokeWidth="1.5" />
      </g>
      <Goose x={560} y={SHORE + 44} s={0.75} swim />

      <g transform={`translate(0 ${-LIFT})`}>
        <Bank />
      </g>
    </svg>
  );
}
