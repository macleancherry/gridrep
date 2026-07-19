export type ForecastHourPoint = {
  timeOffsetMinutes: number; // race-start-relative; negative = before green flag
  isSunUp: boolean;
  airTempC: number | null;
  precipChancePct: number | null;
};

export type ForecastPhase = {
  label: string; // "Practice" | "Qualifying" | "Warmup" | "Race"
  startMin: number;
  endMin: number;
};

const WIDTH = 1000;
// Short phases (an 8-minute Qualifying session against a 24h race) are true-to-scale
// slivers a few px wide - too narrow for an inline label. Those get a leader-line callout
// in the space above the ribbon instead of a label that would never fit.
const CALLOUT_ROW_FAR_Y = 8;
const CALLOUT_ROW_NEAR_Y = 20;
const RIBBON_TOP = 30;
const RIBBON_BOTTOM = 54;
const TEMP_TOP = 66;
const TEMP_BOTTOM = 210;
const PRECIP_TOP = 222;
const PRECIP_BOTTOM = 262;
const AXIS_Y = 262;
const HEIGHT = 298;
const MIN_LABEL_WIDTH = 46;

const PHASE_CLASS: Record<string, string> = {
  Practice: "rp-fc-phase-practice",
  Qualifying: "rp-fc-phase-qualifying",
  Warmup: "rp-fc-phase-warmup",
  Race: "rp-fc-phase-race",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Nice round tick spacing (minutes) for whatever span this event covers - always a
 * clean clock interval, never an arbitrary fraction, so ticks land on whole times. */
function pickIntervalMinutes(spanMinutes: number): number {
  const candidates = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440];
  for (const c of candidates) {
    if (spanMinutes / c <= 10) return c;
  }
  return 1440;
}

/** Ticks aligned to real wall-clock boundaries (e.g. 14:00, 16:00), not just evenly
 * spaced across the data - so the axis reads as an actual schedule, not a ruler. */
function buildClockTicks(raceStart: Date, minOffset: number, maxOffset: number) {
  const spanMinutes = maxOffset - minOffset;
  const intervalMin = pickIntervalMinutes(spanMinutes);

  const rangeStart = new Date(raceStart.getTime() + minOffset * 60_000);
  const rangeEnd = new Date(raceStart.getTime() + maxOffset * 60_000);

  const aligned = new Date(rangeStart);
  aligned.setSeconds(0, 0);
  const minutesSinceMidnight = aligned.getHours() * 60 + aligned.getMinutes();
  const remainder = minutesSinceMidnight % intervalMin;
  if (remainder !== 0) aligned.setMinutes(aligned.getMinutes() + (intervalMin - remainder));

  const ticks: { offsetMin: number; date: Date }[] = [];
  for (let t = new Date(aligned); t.getTime() <= rangeEnd.getTime(); t.setMinutes(t.getMinutes() + intervalMin)) {
    ticks.push({ offsetMin: (t.getTime() - raceStart.getTime()) / 60_000, date: new Date(t) });
  }
  return ticks;
}

function formatClockTick(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${pad2(m)}${ampm}`;
}

function formatOffsetTick(minutes: number): string {
  if (minutes === 0) return "Start";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`;
}

/**
 * Visual forecast across the whole event (practice through race) - temperature curve,
 * rain-chance bars, day/night shading, a Practice/Qualifying/Warmup/Race phase ribbon,
 * and a real wall-clock time axis (when the event's actual start time is known) instead
 * of just relative offsets. Pure SVG, no charting library - the data's small (a day or
 * two of hourly points) and the shapes are simple enough that a dependency would cost
 * more than it'd save.
 */
export default function ForecastChart({
  hours,
  raceStartTime,
  phases,
}: {
  hours: ForecastHourPoint[];
  raceStartTime?: string | null;
  phases?: ForecastPhase[];
}) {
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

  // Min/max temp call-outs - the two points worth reading at a glance without hovering.
  const maxTempPoint = temps.length ? tempPoints.find((h) => h.airTempC === Math.max(...temps)) : undefined;
  const minTempPoint = temps.length ? tempPoints.find((h) => h.airTempC === Math.min(...temps)) : undefined;

  const raceStartDate = raceStartTime ? new Date(raceStartTime) : null;
  const clockTicks = raceStartDate && !Number.isNaN(raceStartDate.getTime()) ? buildClockTicks(raceStartDate, minOffset, maxOffset) : null;

  // Fall back to relative-offset ticks when there's no real start time to anchor to.
  const intervalMin = pickIntervalMinutes(offsetSpan);
  const firstOffsetTick = Math.ceil(minOffset / intervalMin) * intervalMin;
  const fallbackTicks: number[] = [];
  for (let t = firstOffsetTick; t <= maxOffset; t += intervalMin) fallbackTicks.push(t);

  const visiblePhases = (phases ?? []).filter((p) => p.endMin > p.startMin && p.endMin > minOffset && p.startMin < maxOffset);
  const showStartLine = minOffset < 0 && maxOffset > 0;

  return (
    <div className="rp-forecast-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Forecast across the event">
        {(() => {
          let narrowIndex = 0;
          return visiblePhases.map((p, i) => {
            const startX = Math.max(0, x(p.startMin));
            const endX = Math.min(WIDTH, x(p.endMin));
            const w = Math.max(0, endX - startX);
            const cx = startX + w / 2;
            const wide = w >= MIN_LABEL_WIDTH;
            if (!wide) narrowIndex += 1;
            const calloutY = narrowIndex % 2 === 1 ? CALLOUT_ROW_NEAR_Y : CALLOUT_ROW_FAR_Y;

            return (
              <g key={i}>
                <rect x={startX} y={RIBBON_TOP} width={w || 2} height={RIBBON_BOTTOM - RIBBON_TOP} className={PHASE_CLASS[p.label] ?? "rp-fc-phase-race"} />
                {wide ? (
                  <text x={cx} y={(RIBBON_TOP + RIBBON_BOTTOM) / 2 + 4} textAnchor="middle" className="rp-fc-phase-label">
                    {p.label}
                  </text>
                ) : (
                  <>
                    <line x1={cx} x2={cx} y1={calloutY + 4} y2={RIBBON_TOP} className="rp-fc-phase-callout-line" />
                    <text x={cx} y={calloutY} textAnchor="middle" className="rp-fc-phase-callout-label">
                      {p.label}
                    </text>
                  </>
                )}
              </g>
            );
          });
        })()}

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

        {(clockTicks ?? fallbackTicks.map((t) => ({ offsetMin: t }))).map((tick, i) => (
          <line key={i} x1={x(tick.offsetMin)} x2={x(tick.offsetMin)} y1={TEMP_TOP} y2={PRECIP_BOTTOM} className="rp-fc-gridline" />
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
            >
              <title>{`${Math.round(h.precipChancePct)}% rain`}</title>
            </rect>
          ) : null
        )}

        {maxTempPoint?.airTempC != null && (
          <text x={x(maxTempPoint.timeOffsetMinutes)} y={yTemp(maxTempPoint.airTempC) - 8} textAnchor="middle" className="rp-fc-temp-callout">
            {Math.round(maxTempPoint.airTempC)}°
          </text>
        )}
        {minTempPoint?.airTempC != null && minTempPoint !== maxTempPoint && (
          <text x={x(minTempPoint.timeOffsetMinutes)} y={yTemp(minTempPoint.airTempC) + 16} textAnchor="middle" className="rp-fc-temp-callout">
            {Math.round(minTempPoint.airTempC)}°
          </text>
        )}

        {showStartLine && <line x1={x(0)} x2={x(0)} y1={RIBBON_TOP} y2={AXIS_Y} className="rp-fc-start-line" />}

        <line x1={0} x2={WIDTH} y1={AXIS_Y} y2={AXIS_Y} className="rp-fc-axis" />
        {clockTicks
          ? clockTicks.map((tick, i) => {
              const prev = clockTicks[i - 1];
              const dateChanged = prev && prev.date.getDate() !== tick.date.getDate();
              return (
                <g key={i}>
                  <line x1={x(tick.offsetMin)} x2={x(tick.offsetMin)} y1={AXIS_Y} y2={AXIS_Y + 4} className="rp-fc-axis" />
                  <text x={x(tick.offsetMin)} y={AXIS_Y + 16} className="rp-fc-tick" textAnchor="middle">
                    {formatClockTick(tick.date)}
                  </text>
                  {dateChanged && (
                    <text x={x(tick.offsetMin)} y={AXIS_Y + 28} className="rp-fc-tick-date" textAnchor="middle">
                      {tick.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                    </text>
                  )}
                </g>
              );
            })
          : fallbackTicks.map((t, i) => (
              <g key={i}>
                <line x1={x(t)} x2={x(t)} y1={AXIS_Y} y2={AXIS_Y + 4} className="rp-fc-axis" />
                <text x={x(t)} y={AXIS_Y + 16} className="rp-fc-tick" textAnchor="middle">
                  {formatOffsetTick(t)}
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
