export type ForecastHourPoint = {
  timeOffsetMinutes: number; // race-start-relative; negative = before green flag
  isSunUp: boolean;
  airTempC: number | null;
  precipChancePct: number | null;
};

const WIDTH = 1000;
const HEIGHT = 260;
const TEMP_TOP = 16;
const TEMP_BOTTOM = 170;
const PRECIP_TOP = 190;
const PRECIP_BOTTOM = 236;
const AXIS_Y = 236;

function formatTick(minutes: number): string {
  if (minutes === 0) return "Start";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`;
}

/**
 * Visual forecast across the whole event (practice through race), not just the discrete
 * Day/Dusk/Night/Dawn cards below it - a temperature curve, rain-chance bars, and
 * day/night shading built from the raw hourly timeline (migration 0015). Pure SVG, no
 * charting library - the data's small (a day or two of hourly points) and the shapes are
 * simple enough that a dependency would cost more than it'd save.
 */
export default function ForecastChart({ hours }: { hours: ForecastHourPoint[] }) {
  if (hours.length < 2) return null;

  const sorted = [...hours].sort((a, b) => a.timeOffsetMinutes - b.timeOffsetMinutes);
  const minOffset = sorted[0].timeOffsetMinutes;
  const maxOffset = sorted[sorted.length - 1].timeOffsetMinutes;
  const offsetSpan = Math.max(1, maxOffset - minOffset);

  const temps = sorted.map((h) => h.airTempC).filter((t): t is number => t !== null);
  const minTemp = temps.length ? Math.min(...temps) - 2 : 0;
  const maxTemp = temps.length ? Math.max(...temps) + 2 : 30;
  const tempSpan = Math.max(1, maxTemp - minTemp);

  function x(offset: number): number {
    return ((offset - minOffset) / offsetSpan) * WIDTH;
  }
  function yTemp(temp: number): number {
    return TEMP_BOTTOM - ((temp - minTemp) / tempSpan) * (TEMP_BOTTOM - TEMP_TOP);
  }

  // Day/night background bands: group consecutive same-isSunUp hours into one rect each.
  const bands: { start: number; end: number; isSunUp: boolean }[] = [];
  for (const h of sorted) {
    const last = bands[bands.length - 1];
    if (last && last.isSunUp === h.isSunUp) last.end = h.timeOffsetMinutes;
    else bands.push({ start: h.timeOffsetMinutes, end: h.timeOffsetMinutes, isSunUp: h.isSunUp });
  }

  const tempPoints = sorted.filter((h) => h.airTempC !== null);
  const tempLine = tempPoints.map((h) => `${x(h.timeOffsetMinutes).toFixed(1)},${yTemp(h.airTempC as number).toFixed(1)}`).join(" ");
  const tempArea =
    tempPoints.length > 0
      ? `${x(tempPoints[0].timeOffsetMinutes).toFixed(1)},${TEMP_BOTTOM} ${tempLine} ${x(
          tempPoints[tempPoints.length - 1].timeOffsetMinutes
        ).toFixed(1)},${TEMP_BOTTOM}`
      : "";

  // ~6 evenly spaced axis ticks across the domain, plus race start (0) if it falls inside it.
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round(minOffset + (offsetSpan * i) / tickCount));
  const showStartLine = minOffset < 0 && maxOffset > 0;

  return (
    <div className="rp-forecast-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Forecast across the event">
        {bands.map((b, i) => (
          <rect
            key={i}
            x={x(b.start)}
            y={TEMP_TOP}
            width={Math.max(0, x(b.end) - x(b.start)) || 2}
            height={PRECIP_BOTTOM - TEMP_TOP}
            className={b.isSunUp ? "rp-fc-band-day" : "rp-fc-band-night"}
          />
        ))}

        {tempArea && <polygon points={tempArea} className="rp-fc-temp-area" />}
        {tempLine && <polyline points={tempLine} className="rp-fc-temp-line" />}

        {sorted.map((h, i) =>
          h.precipChancePct && h.precipChancePct > 0 ? (
            <rect
              key={i}
              x={x(h.timeOffsetMinutes) - WIDTH / sorted.length / 2.5}
              y={PRECIP_BOTTOM - (h.precipChancePct / 100) * (PRECIP_BOTTOM - PRECIP_TOP)}
              width={Math.max(2, WIDTH / sorted.length / 1.3)}
              height={(h.precipChancePct / 100) * (PRECIP_BOTTOM - PRECIP_TOP)}
              className="rp-fc-precip-bar"
            />
          ) : null
        )}

        {showStartLine && (
          <>
            <line x1={x(0)} x2={x(0)} y1={TEMP_TOP} y2={AXIS_Y} className="rp-fc-start-line" />
            <text x={x(0)} y={TEMP_TOP - 4} className="rp-fc-start-label" textAnchor="middle">
              Race start
            </text>
          </>
        )}

        <line x1={0} x2={WIDTH} y1={AXIS_Y} y2={AXIS_Y} className="rp-fc-axis" />
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_Y} y2={AXIS_Y + 4} className="rp-fc-axis" />
            <text x={x(t)} y={AXIS_Y + 16} className="rp-fc-tick" textAnchor="middle">
              {formatTick(t)}
            </text>
          </g>
        ))}
      </svg>
      <div className="rp-fc-legend">
        <span>
          <i className="rp-fc-swatch rp-fc-swatch-temp" /> Air temp
        </span>
        <span>
          <i className="rp-fc-swatch rp-fc-swatch-precip" /> Rain chance
        </span>
        <span>
          <i className="rp-fc-swatch rp-fc-swatch-night" /> Night
        </span>
      </div>
    </div>
  );
}
