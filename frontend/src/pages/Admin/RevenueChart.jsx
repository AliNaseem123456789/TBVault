import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '../../utils/money';

const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 56 };

// Clean axis maximum and ticks: 0, step, 2·step… with step from {1,2,2.5,5}×10^n.
const niceTicks = (max, count = 4) => {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
};

const shortDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Daily revenue as columns (one series, so no legend: the card title names it).
 * Hover a day for revenue + orders; "Table" shows every value as text.
 */
const RevenueChart = ({ series }) => {
  const [hover, setHover] = useState(null);
  const [width, setWidth] = useState(720);
  const [showTable, setShowTable] = useState(false);
  const plotRef = useRef(null);

  // Draw at the container's real width, and redraw when it resizes.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showTable]);

  const ticks = useMemo(() => niceTicks(Math.max(...series.map((d) => d.revenue), 0)), [series]);
  const max = ticks.at(-1) || 1;
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const band = innerW / Math.max(series.length, 1);
  const barW = Math.max(2, Math.min(24, band - 2));   // thin marks, ≥ 2px gap between neighbours
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(series.length / 8);

  // Column with a 4px rounded data end, square at the baseline.
  const columnPath = (x, top, w) => {
    const h = PAD.top + innerH - top;
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    const base = PAD.top + innerH;
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
  };

  return (
    <div className="admin-chart">
      <div className="admin-chart__head">
        <h3>Revenue by day</h3>
        <button type="button" className="admin-link" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Chart' : 'Table'}</button>
      </div>

      {showTable ? (
        <div className="admin-table-wrap admin-chart__table">
          <table className="admin-table">
            <thead><tr><th scope="col">Day</th><th scope="col" className="is-num">Orders</th><th scope="col" className="is-num">Revenue</th></tr></thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day}><td>{shortDate(d.day)}</td><td className="is-num">{d.orders}</td><td className="is-num">{formatMoney(d.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-chart__plot" ref={plotRef}>
          <svg width={width} height={HEIGHT} role="img" aria-label="Revenue by day" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="admin-chart__grid" />
                <text x={PAD.left - 8} y={y(t)} className="admin-chart__tick" textAnchor="end" dominantBaseline="middle">
                  {t >= 1000 ? `$${(t / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : `$${t}`}
                </text>
              </g>
            ))}
            {series.map((d, i) => {
              const x = PAD.left + i * band + (band - barW) / 2;
              return (
                <g key={d.day}>
                  <path d={columnPath(x, y(d.revenue), barW)} className={`admin-chart__bar ${hover === i ? 'is-hover' : ''}`} />
                  {/* Hit target: the whole band, taller than the mark */}
                  <rect
                    x={PAD.left + i * band}
                    y={PAD.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    tabIndex={0}
                    aria-label={`${shortDate(d.day)}: ${formatMoney(d.revenue)}, ${d.orders} orders`}
                  />
                  {i % labelEvery === 0 && (
                    <text x={PAD.left + i * band + band / 2} y={HEIGHT - 8} className="admin-chart__tick" textAnchor="middle">
                      {shortDate(d.day)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="admin-chart__tooltip"
              style={{ left: Math.min(PAD.left + hover * band + band / 2, width - 90), top: Math.max(y(series[hover].revenue) - 12, 0) }}
            >
              <strong>{formatMoney(series[hover].revenue)}</strong>
              <span>{series[hover].orders} order{series[hover].orders === 1 ? '' : 's'} · {shortDate(series[hover].day)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RevenueChart;
