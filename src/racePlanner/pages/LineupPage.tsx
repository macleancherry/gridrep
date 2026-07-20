import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";
import { useDriverSearch } from "../useDriverSearch";

type ConditionProfile = { id: string; label: string };

type DriverProfile = {
  custId: string;
  driverName: string;
  ok: boolean;
  reason?: string;
  paceMs: number | null;
  lapsUsed: number;
  sampleSize: number;
  widenedBand: boolean;
  fuelPerLap: number | null;
  fuelSource: string | null;
  pitTimeSeconds: number | null;
  pitTimeSource: string | null;
};

type TeamRosterMember = { custId: string; driverName: string | null };

type SearchStatus = { status: "searching" | "found" | "not_found" | "error" | "none"; message?: string | null };

function fuelSourceBadge(source: string): { label: string; className: string; title?: string } {
  switch (source) {
    case "garage61":
      return { label: "Garage 61", className: "rp-green", title: "Real fuel-per-lap from this driver's own connected Garage 61 account" };
    case "garage61_matched":
      return {
        label: "Garage 61 (name-matched)",
        className: "rp-amber",
        title: "Real Garage 61 data matched to this driver by name, not a confirmed account link - verify it's really them",
      };
    case "manual":
      return { label: "Manual", className: "rp-dim" };
    default:
      return { label: source, className: "rp-dim" };
  }
}

function formatPace(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

function StatusBadge({ s }: { s: SearchStatus | undefined }) {
  if (!s || s.status === "none") return null;
  if (s.status === "searching") {
    return (
      <span className="rp-text-faint" style={{ fontSize: 10, marginLeft: 4 }} title="Looking for a recent session at this track…">
        🔎 searching…
      </span>
    );
  }
  if (s.status === "found") {
    return (
      <span style={{ fontSize: 10, marginLeft: 4, color: "var(--rp-green)" }} title={s.message ?? undefined}>
        ✓ laps found
      </span>
    );
  }
  if (s.status === "not_found") {
    return (
      <span className="rp-text-faint" style={{ fontSize: 10, marginLeft: 4 }} title={s.message ?? undefined}>
        · no recent session found
      </span>
    );
  }
  return (
    <span className="rp-text-faint" style={{ fontSize: 10, marginLeft: 4 }} title={s.message ?? undefined}>
      ⚠ search failed
    </span>
  );
}

export default function LineupPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventTrackName, setEventTrackName] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [lineup, setLineup] = useState<{ custId: string; name: string }[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterMember[]>([]);
  const [weekendId, setWeekendId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { results: searchResults, livePending: liveSearchPending } = useDriverSearch(query);
  const [conditionProfiles, setConditionProfiles] = useState<ConditionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profiles, setProfiles] = useState<DriverProfile[]>([]);
  const [computing, setComputing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fuelDrafts, setFuelDrafts] = useState<Record<string, string>>({});
  const [syncSubsessionId, setSyncSubsessionId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<Record<string, SearchStatus>>({});

  // Load the plan (for its event_id + already-saved lineup) once on mount.
  useEffect(() => {
    if (!planId) return;
    setLoading(true);
    fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.message ?? "Could not load this plan.");
          return;
        }
        setEventId(data.eventId);
        setLineup((data.lineup ?? []).map((d: any) => ({ custId: d.custId, name: d.driverName ?? `Driver ${d.custId}` })));
        setTeamRoster(data.teamRoster ?? []);
        setWeekendId(data.weekendId ?? null);
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [planId]);

  useEffect(() => {
    setContext({ planId: planId ?? null, eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, eventId]);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setConditionProfiles(data.profiles ?? []))
      .catch(() => setConditionProfiles([]));

    fetch(`/api/planner/events/${encodeURIComponent(eventId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.event) {
          setTeamSize({ min: data.event.min_team_drivers ?? null, max: data.event.max_team_drivers ?? null });
          setEventTrackName(data.event.track_name ?? null);
        }
      })
      .catch(() => {});
  }, [eventId]);

  // Polls for progress on the background "find a recent session at this track" search
  // race-plans/:planId/lineup.ts kicks off whenever a driver is newly added - keeps
  // polling every 2.5s only while at least one driver is still "searching", so an idle
  // Lineup page (nothing in progress) never polls at all.
  const lineupKey = lineup.map((d) => d.custId).join(",");
  useEffect(() => {
    if (!eventId || lineup.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const r = await fetch(
          `/api/planner/events/${encodeURIComponent(eventId!)}/session-search-status?custIds=${encodeURIComponent(lineupKey)}`,
          { credentials: "include" }
        );
        const data = await r.json().catch(() => ({}));
        if (cancelled || !data.ok) return;

        const next: Record<string, SearchStatus> = {};
        for (const row of data.results ?? []) next[row.custId] = { status: row.status, message: row.message };
        setSearchStatus(next);

        if ((data.results ?? []).some((row: any) => row.status === "searching")) {
          timer = setTimeout(poll, 2500);
        }
      } catch {
        // Silent - this is a best-effort background indicator, not core functionality.
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, lineupKey]);

  async function syncLaps() {
    const subsessionId = syncSubsessionId.trim();
    if (!subsessionId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const r = await fetch(`/api/planner/iracing/subsessions/${encodeURIComponent(subsessionId)}/sync`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setSyncMessage(data.message ?? "Could not sync this subsession.");
        return;
      }

      const trackNote =
        data.trackName && eventTrackName && data.trackName !== eventTrackName
          ? ` ⚠ This subsession was at "${data.trackName}", not this event's track ("${eventTrackName}") - those laps won't show up below.`
          : data.trackName
            ? ` (${data.trackName})`
            : "";

      if (data.alreadyComplete) {
        setSyncMessage(`Already fully synced — ${data.lapsIngested} laps across ${data.driversIngested} driver(s)${trackNote}.`);
      } else {
        const remaining = data.remainingJobs > 0 ? ` · ${data.remainingJobs} more to go, click Sync again to continue` : "";
        const failures =
          data.driverFailures?.length > 0 ? ` · ${data.driverFailures.length} driver(s) failed (${data.driverFailures[0].message})` : "";
        setSyncMessage(`Synced ${data.lapsIngested} laps across ${data.driversIngested} driver(s)${trackNote}${remaining}${failures}.`);
      }
    } catch {
      setSyncMessage("Network error. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function saveLineup(next: { custId: string; name: string }[]) {
    if (!planId) return;
    setSaving(true);
    try {
      const driverNames: Record<string, string> = {};
      for (const d of next) driverNames[d.custId] = d.name;
      await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/lineup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ custIds: next.map((d) => d.custId), driverNames }),
      });
    } catch {
      setError("Could not save the lineup - your changes may not persist.");
    } finally {
      setSaving(false);
    }
  }

  // Local+live driver search (useDriverSearch.ts) - extracted here originally, now shared
  // with the Team roster's "add a driver" flow (TeamPage.tsx).
  function addDriver(custId: string, name: string) {
    if (lineup.some((d) => d.custId === custId)) return;
    const next = [...lineup, { custId, name }];
    setLineup(next);
    setQuery("");
    saveLineup(next);
  }

  function removeDriver(custId: string) {
    const next = lineup.filter((d) => d.custId !== custId);
    setLineup(next);
    saveLineup(next);
  }

  async function computeProfiles() {
    if (!eventId || lineup.length === 0) return;
    setComputing(true);
    setError(null);
    try {
      const fuelOverrides: Record<string, number> = {};
      for (const [custId, raw] of Object.entries(fuelDrafts)) {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) fuelOverrides[custId] = n;
      }

      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: lineup.map((d) => d.custId),
          conditionProfileId: selectedProfileId || undefined,
          fuelOverrides,
        }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not compute driver profiles.");
        return;
      }

      setProfiles(data.profiles ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setComputing(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <h2>Driver lineup {saving && <span className="rp-text-faint" style={{ fontSize: 12, fontWeight: 400, textTransform: "none" }}>(saving…)</span>}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Pace and fuel profiles, filtered to laps run in conditions matching the selected segment.
      </p>

      {error && <p className="rp-error">{error}</p>}

      {teamRoster.length > 0 && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
          <div className="rp-form-field" style={{ marginBottom: 8 }}>
            <label>Add from team roster</label>
          </div>
          <div className="rp-profile-list">
            {teamRoster.map((m) => {
              const onLineup = lineup.some((d) => d.custId === m.custId);
              return (
                <div className="rp-row" key={m.custId} style={{ justifyContent: "space-between" }}>
                  <span>{m.driverName ?? `Driver ${m.custId}`}</span>
                  <button className="rp-btn" onClick={() => addDriver(m.custId, m.driverName ?? `Driver ${m.custId}`)} disabled={onLineup}>
                    {onLineup ? "On lineup" : "+ Add"}
                  </button>
                </div>
              );
            })}
          </div>
          {weekendId && (
            <p className="rp-text-faint" style={{ fontSize: 11, marginTop: 8 }}>
              Running more than one car this weekend?{" "}
              <Link to={`/race-planner/weekend/${weekendId}`}>Manage this race weekend →</Link>
            </p>
          )}
        </div>
      )}

      <div className="rp-card rp-card-narrow" style={{ marginBottom: 16, position: "relative" }}>
        <div className="rp-form-field" style={{ marginBottom: 8 }}>
          <label>{teamRoster.length > 0 ? "Or search for a guest driver" : "Search for a driver"}</label>
        </div>
        <div className="rp-row" style={{ marginBottom: 10 }}>
          <input
            className="rp-input"
            placeholder="Search by driver name or cust_id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
        {(searchResults.length > 0 || liveSearchPending) && (
          <div className="rp-profile-list" style={{ marginBottom: 10 }}>
            {searchResults.map((d) => (
              <div className="rp-row" key={d.id} style={{ justifyContent: "space-between" }}>
                <span>
                  {d.name} <span className="rp-text-faint rp-mono">#{d.id}</span>
                </span>
                <button className="rp-btn" onClick={() => addDriver(d.id, d.name)}>
                  + Add
                </button>
              </div>
            ))}
            {liveSearchPending && (
              <span className="rp-text-faint" style={{ fontSize: 11 }}>
                🔎 Checking iRacing for more matches…
              </span>
            )}
          </div>
        )}

        <div className="rp-row" style={{ flexWrap: "wrap" }}>
          {lineup.length === 0 && <span className="rp-text-faint">No drivers added yet.</span>}
          {lineup.map((d) => (
            <span className="rp-badge rp-dim" key={d.custId}>
              {d.name}
              <StatusBadge s={searchStatus[d.custId]} />
              <button
                onClick={() => removeDriver(d.custId)}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 4, padding: 0 }}
                aria-label={`Remove ${d.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {(teamSize.min !== null || teamSize.max !== null) &&
        (teamSize.min !== null && lineup.length < teamSize.min ? (
          <div className="rp-warn-banner">
            ⚠ This event requires at least {teamSize.min} drivers - {lineup.length} added so far.
          </div>
        ) : teamSize.max !== null && lineup.length > teamSize.max ? (
          <div className="rp-warn-banner">
            ⚠ This event allows at most {teamSize.max} drivers - {lineup.length} added.
          </div>
        ) : null)}

      <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
        <div className="rp-form-field">
          <label>Sync laps manually</label>
        </div>
        <div className="rp-row">
          <input
            className="rp-input"
            placeholder="Subsession ID, e.g. 123456789"
            value={syncSubsessionId}
            onChange={(e) => setSyncSubsessionId(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="rp-btn" onClick={syncLaps} disabled={syncing || !syncSubsessionId.trim()}>
            {syncing ? "Syncing…" : "Sync laps"}
          </button>
        </div>
        <p className="rp-section-sub" style={{ marginTop: 8 }}>
          Newly added drivers are automatically checked in the background for a recent session at this
          track{eventTrackName ? ` (${eventTrackName})` : ""} — watch for a status next to their name above. Use this
          box only if that search comes back empty, or to pull a specific session yourself. Large sessions may need a
          couple of clicks to finish.
        </p>
        {syncMessage && (
          <p className="rp-section-sub" style={{ marginTop: 8 }}>
            {syncMessage}
          </p>
        )}
      </div>

      <div className="rp-row" style={{ marginBottom: 16 }}>
        <select className="rp-input" value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
          <option value="">All conditions (unfiltered)</option>
          {conditionProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="rp-btn rp-primary" onClick={computeProfiles} disabled={computing || lineup.length === 0}>
          {computing ? "Computing…" : "Compute profiles"}
        </button>
      </div>

      {profiles.length > 0 && (
        <div className="rp-profile-list">
          {profiles.map((p) => (
            <div className="rp-card" key={p.custId}>
              <div className="rp-profile-row">
                <div>
                  <div className="rp-profile-label">{p.driverName}</div>
                  {p.ok ? (
                    <div className="rp-mono" style={{ marginTop: 4 }}>
                      {formatPace(p.paceMs)}
                      {p.widenedBand && (
                        <span className="rp-badge rp-amber" style={{ marginLeft: 8 }}>
                          Widened band
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="rp-text-faint" style={{ marginTop: 4 }}>
                      {p.reason === "no_laps_at_track" ? "No synced laps at this track yet" : "No clean laps found"}
                    </div>
                  )}
                  <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {p.lapsUsed} laps used · {p.sampleSize} in sample
                  </div>
                  {p.pitTimeSeconds !== null && (
                    <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }} title="Derived from this driver's own pit laps vs. their clean pace - includes in/out-lap execution, not just stationary time">
                      ~{p.pitTimeSeconds}s in the pits (derived)
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="rp-form-field">
                    <label>Fuel / lap (L)</label>
                    <input
                      className="rp-input"
                      style={{ width: 90 }}
                      type="number"
                      step="0.01"
                      placeholder={p.fuelPerLap !== null ? String(p.fuelPerLap) : "manual"}
                      value={fuelDrafts[p.custId] ?? ""}
                      onChange={(e) => setFuelDrafts({ ...fuelDrafts, [p.custId]: e.target.value })}
                    />
                  </div>
                  {p.fuelSource &&
                    (() => {
                      const badge = fuelSourceBadge(p.fuelSource);
                      return (
                        <span className={`rp-badge ${badge.className}`} title={badge.title}>
                          {badge.label}
                        </span>
                      );
                    })()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        {eventId && (
          <Link to={`/race-planner/conditions/${eventId}?planId=${planId}`} className="rp-btn">
            ← Back to conditions
          </Link>
        )}
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn rp-primary">
          Continue to stints →
        </Link>
      </div>
    </div>
  );
}
