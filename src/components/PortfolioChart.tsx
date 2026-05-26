"use client";

import { useMemo, useState } from "react";

type Series = { timestamp: number[]; equity: (number | null)[] };

export default function PortfolioChart({ series, height = 220 }: { series: Series; height?: number }) {
  const points = useMemo(() => {
    const out: { t: number; v: number }[] = [];
    for (let i = 0; i < series.timestamp.length; i++) {
      const v = series.equity[i];
      if (typeof v === "number" && Number.isFinite(v)) out.push({ t: series.timestamp[i], v });
    }
    return out;
  }, [series]);

  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <div className="chart-empty" style={{ height }}>No history yet — open positions or wait for the next bar.</div>;
  }

  const width = 1000; // viewBox; svg scales to container
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const yFor = (v: number) => height - ((v - min) / span) * (height - 16) - 8;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(2)},${yFor(p.v).toFixed(2)}`).join(" ");
  const first = points[0].v;
  const last = points[points.length - 1].v;
  const up = last >= first;
  const stroke = up ? "var(--accent)" : "var(--red)";
  const areaFill = up ? "url(#gradUp)" : "url(#gradDown)";
  const area = `${path} L${(width).toFixed(2)},${height} L0,${height} Z`;

  const hoverPt = hover !== null ? points[hover] : null;

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
          setHover(idx);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="gradUp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gradDown" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={areaFill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hoverPt && (
          <>
            <line x1={hover! * stepX} x2={hover! * stepX} y1={0} y2={height} stroke="var(--border2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hover! * stepX} cy={yFor(hoverPt.v)} r={3} fill={stroke} />
          </>
        )}
      </svg>
      {hoverPt && (
        <div className="chart-tip">
          ${hoverPt.v.toLocaleString(undefined, { maximumFractionDigits: 2 })} · {new Date(hoverPt.t * 1000).toLocaleString()}
        </div>
      )}
    </div>
  );
}
