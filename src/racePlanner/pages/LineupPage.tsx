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
  paceSource: string | null;
  lapsUsed: number;
  sampleSize: number;
  widenedBand: boolean;
  fuelPerLap: number | null;
  fuelSource: string | null;
  pitTimeSeconds: number | null;
  pitTimeSource: string | null;
};

type TeamRosterMember = { custId: string; driverName: string | null };
type TeamSummary = { id: string; name: string; isCreator: boolean };

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

// Accepts either "m:ss.sss" (matching formatPace's own display format) or plain seconds
// ("92.456") - whatever's fastest for a coordinator to type in from a stopwatch or a
// results screen. Returns null for anything that doesn't parse to a positive lap time.
function parsePaceInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
    const ms = Math.round((minutes * 60 + seconds) * 1000);
    return ms > 0 ? ms : null;
  }
  const secondsOnly = Number(trimmed);
  if (Number.isFinite(secondsOnly) && secondsOnly > 0) return Math.round(secondsOnly * 1000);
  return null;
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
  const [teamSize, setTeamSize] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [lineup, setLineup] = useState<{ custId: string; name: string }[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterMember[]>([]);
  const [planTeamId, setPlanTeamId] = useState<string | null>(null);
  const [weekendId, setWeekendId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { results: searchResults, livePending: liveSearchPending } = useDriverSearch(query);
  const [conditionProfiles, setConditionProfiles] = useState<ConditionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profiles, setProfiles] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fuelDrafts, setFuelDrafts] = useState<Record<string, string>>({});
  const [savingFuelFor, setSavingFuelFor] = useState<string | null>(null);
  const [paceDrafts, setPaceDrafts] = useState<Record<string, string>>({});
  const [savingPaceFor, setSavingPaceFor] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<Record<string, SearchStatus>>({});

  // If this weekend isn't linked to a team yet, offer to link one instead of silently
  // falling back to the global iRacing search - the only place a weekend's team gets set
  // today is SeriesSessionsPage's picker at creation time, which is easy to miss or skip.
  const [myTeams, setMyTeams] = useState<TeamSummary[] | null>(null);
  const [linkTeamId, setLinkTeamId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  function loadPlan() {
    if (!planId) return;
    setLoading(true);
    return fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.message ?? "Could not load this plan.");
          return;
        }
        setEventId(data.eventId);
        setLineup((data.lineup ?? []).map((d: any) => ({ custId: d.custId, name: d.driverName ?? `Driver ${d.custId}` })));
        setTeamRoster(data.teamRoster ?? []);
        setPlanTeamId(data.teamId ?? null);
        setWeekendId(data.weekendId ?? null);
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }

  // Load the plan (for its event_id + already-saved lineup) once on mount.
  useEffect(() => {
    loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  useEffect(() => {
    fetch(`/api/planner/teams`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setMyTeams((data.teams ?? []).filter((t: TeamSummary) => t.isCreator));
      })
      .catch(() => {});
  }, []);

  async function linkTeam() {
    if (!weekendId || !linkTeamId) return;
    setLinking(true);
    setLinkError(null);
    try {
      const r = await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/team`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamId: linkTeamId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setLinkError(data.message ?? "Could not link this team.");
        return;
      }
      await loadPlan();
    } catch {
      setLinkError("Network error. Please try again.");
    } finally {
      setLinking(false);
    }
  }

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
        }
      })
      .catch(() => {});
  }, [eventId]);

  async function fetchProfiles(conditionProfileId: string): Promise<DriverProfile[]> {
    if (!eventId || lineup.length === 0) return [];
    const params = new URLSearchParams({ custIds: lineup.map((d) => d.custId).join(",") });
    if (conditionProfileId) params.set("conditionProfileId", conditionProfileId);
    const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles?${params.toString()}`, {
      credentials: "include",
    });
    const data = await r.json().catch(() => ({}));
    return data.profiles ?? [];
  }

  // Pace/fuel are computed automatically in the background the moment a driver's laps are
  // found (kicked off by lineup.ts's PUT) - no button to press, nothing to wait on here.
  // This polls both the lap-search status and the resulting profiles every 2.5s, only
  // while at least one driver's result is still unresolved, so an idle page never polls.
  const lineupKey = lineup.map((d) => d.custId).join(",");
  useEffect(() => {
    if (!eventId || lineup.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const [statusRes, freshProfiles] = await Promise.all([
          fetch(`/api/planner/events/${encodeURIComponent(eventId!)}/session-search-status?custIds=${encodeURIComponent(lineupKey)}`, {
            credentials: "include",
          }).then((r) => r.json().catch(() => ({}))),
          fetchProfiles(selectedProfileId),
        ]);
        if (cancelled) return;

        if (statusRes.ok) {
          const next: Record<string, SearchStatus> = {};
          for (const row of statusRes.results ?? []) next[row.custId] = { status: row.status, message: row.message };
          setSearchStatus(next);
        }
        setProfiles(freshProfiles);

        const stillSearching = (statusRes.results ?? []).some((row: any) => row.status === "searching");
        const everyoneResolved = lineup.every((d) => freshProfiles.some((p) => p.custId === d.custId));
        if (stillSearching || !everyoneResolved) {
          timer = setTimeout(poll, 2500);
        }
      } catch {
        // Silent - this is a best-effort background refresh, not core functionality.
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, lineupKey, selectedProfileId]);

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

  // Selecting a specific condition filter needs a real compute pass the first time (each
  // condition profile gets its own stored row) - fires right from the dropdown instead of
  // a separate button, same "just works" rule as everything else on this page.
  async function onProfileFilterChange(nextProfileId: string) {
    setSelectedProfileId(nextProfileId);
    if (!eventId || lineup.length === 0) return;
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: lineup.map((d) => d.custId),
          conditionProfileId: nextProfileId || undefined,
          teamId: planTeamId || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) setProfiles(data.profiles ?? []);
    } catch {
      // Polling will pick it up on the next tick regardless.
    }
  }

  // Manual pace entry - the same required fallback fuel already has (PRD §5.2/§5.4), for a
  // driver with no synced clean laps at this track. Without it, Stints' pace+fuel readiness
  // gate could never open for them no matter what fuel value was entered.
  async function savePaceOverride(custId: string) {
    if (!eventId) return;
    const raw = paceDrafts[custId];
    const ms = raw ? parsePaceInput(raw) : null;
    if (!raw || raw.trim() === "" || ms === null) return;

    setSavingPaceFor(custId);
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: [custId],
          conditionProfileId: selectedProfileId || undefined,
          paceOverrides: { [custId]: ms },
          teamId: planTeamId || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok && data.profiles?.length) {
        const updated = data.profiles[0];
        setProfiles((prev) => [...prev.filter((p) => p.custId !== custId), updated]);
        setPaceDrafts((prev) => {
          const next = { ...prev };
          delete next[custId];
          return next;
        });
      }
    } catch {
      setError("Could not save that pace value. Please try again.");
    } finally {
      setSavingPaceFor(null);
    }
  }

  async function saveFuelOverride(custId: string) {
    if (!eventId) return;
    const raw = fuelDrafts[custId];
    const n = Number(raw);
    if (!raw || raw.trim() === "" || !Number.isFinite(n)) return;

    setSavingFuelFor(custId);
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: [custId],
          conditionProfileId: selectedProfileId || undefined,
          fuelOverrides: { [custId]: n },
          teamId: planTeamId || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok && data.profiles?.length) {
        const updated = data.profiles[0];
        setProfiles((prev) => [...prev.filter((p) => p.custId !== custId), updated]);
        setFuelDrafts((prev) => {
          const next = { ...prev };
          delete next[custId];
          return next;
        });
      }
    } catch {
      setError("Could not save that fuel value. Please try again.");
    } finally {
      setSavingFuelFor(null);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <h2>Driver lineup {saving && <span className="rp-text-faint" style={{ fontSize: 12, fontWeight: 400, textTransform: "none" }}>(saving…)</span>}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Add drivers and their pace/fuel are found automatically in the background - no need to wait here, move on
        whenever you like.
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

      {teamRoster.length === 0 && weekendId && myTeams && myTeams.length > 0 && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
          <div className="rp-form-field" style={{ marginBottom: 8 }}>
            <label>This weekend isn't linked to a team yet</label>
          </div>
          <p className="rp-section-sub" style={{ marginBottom: 10 }}>
            Link it to one of your teams to add drivers straight from that roster instead of searching iRacing one
            by one.
          </p>
          <div className="rp-row">
            <select className="rp-input" value={linkTeamId} onChange={(e) => setLinkTeamId(e.target.value)}>
              <option value="">Choose a team…</option>
              {myTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className="rp-btn rp-primary" onClick={linkTeam} disabled={!linkTeamId || linking}>
              {linking ? "Linking…" : "Link team"}
            </button>
          </div>
          {linkError && <p className="rp-error">{linkError}</p>}
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

      {lineup.length > 0 && (
        <div className="rp-row" style={{ marginBottom: 16 }}>
          <select className="rp-input" value={selectedProfileId} onChange={(e) => onProfileFilterChange(e.target.value)}>
            <option value="">All conditions (unfiltered)</option>
            {conditionProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {lineup.length > 0 && (
        <div className="rp-profile-list">
          {lineup.map((d) => {
            const p = profiles.find((pr) => pr.custId === d.custId);
            if (!p) {
              return (
                <div className="rp-card" key={d.custId}>
                  <div className="rp-profile-label">{d.name}</div>
                  <div className="rp-text-faint" style={{ marginTop: 4, fontSize: 12 }}>
                    Finding pace and fuel data…
                  </div>
                </div>
              );
            }
            return (
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
                      <div
                        className="rp-text-faint"
                        style={{ fontSize: 11, marginTop: 2 }}
                        title="Derived from this driver's own pit laps vs. their clean pace - includes in/out-lap execution, not just stationary time"
                      >
                        ~{p.pitTimeSeconds}s in the pits ({p.pitTimeSource === "garage61_derived" ? "Garage 61" : "derived"})
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="rp-form-field">
                        <label>Pace (lap time)</label>
                        <input
                          className="rp-input"
                          style={{ width: 100 }}
                          type="text"
                          placeholder={p.paceMs !== null ? formatPace(p.paceMs) : "m:ss.sss"}
                          value={paceDrafts[p.custId] ?? ""}
                          onChange={(e) => setPaceDrafts({ ...paceDrafts, [p.custId]: e.target.value })}
                          onBlur={() => savePaceOverride(p.custId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          disabled={savingPaceFor === p.custId}
                          title="No recent laps synced at this track? Type a lap time here (e.g. 1:32.456) to unblock stint planning."
                        />
                      </div>
                      {p.paceSource === "manual" && <span className="rp-badge rp-dim">Manual</span>}
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
                          onBlur={() => saveFuelOverride(p.custId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          disabled={savingFuelFor === p.custId}
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
              </div>
            );
          })}
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
