import { useState } from "react";
import { useNavigate } from "react-router-dom";

type DiscoveredEvent = {
  id: string;
  name: string;
  trackName?: string;
  trackConfig?: string;
  seriesId?: string;
  seasonId?: string;
  scheduledStartTime?: string;
  eventType: "special" | "hosted" | "league";
};

export default function EventsHome() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [specialOnly, setSpecialOnly] = useState(true);
  const [events, setEvents] = useState<DiscoveredEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (specialOnly) params.set("type", "special");
      if (query.trim()) params.set("q", query.trim());

      const r = await fetch(`/api/planner/events?${params.toString()}`, { credentials: "include" });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not load events.");
        setEvents([]);
        return;
      }

      setEvents(data.events ?? []);
    } catch {
      setError("Network error. Please try again.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectEvent(event: DiscoveredEvent) {
    setSelectingId(event.id);
    setError(null);
    try {
      const r = await fetch("/api/planner/events/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(event),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not select this event.");
        return;
      }

      navigate(`/race-planner/conditions/${encodeURIComponent(event.id)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div>
      <h2>Select an event</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Special &amp; endurance events — pick the exact scheduled running you're planning for.
      </p>

      <div className="rp-row" style={{ marginBottom: 8 }}>
        <input
          className="rp-input"
          placeholder="Search by name (e.g. Spa)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          style={{ minWidth: 220 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={specialOnly} onChange={(e) => setSpecialOnly(e.target.checked)} />
          Special events only
        </label>
        <button className="rp-btn rp-primary" onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="rp-error">{error}</p>}

      {events === null && !loading && (
        <div className="rp-card">Search to browse upcoming special/endurance events from iRacing.</div>
      )}

      {events !== null && events.length === 0 && !loading && (
        <div className="rp-card">No events found. Try broadening the search or unchecking "Special events only".</div>
      )}

      {events !== null && events.length > 0 && (
        <div className="rp-event-grid">
          {events.map((event) => (
            <div className="rp-event-card" key={event.id}>
              <h3 className="rp-event-track">{event.name}</h3>
              {(event.trackName || event.trackConfig) && (
                <div className="rp-event-meta">
                  <span>Track</span>
                  <span className="rp-mono">
                    {event.trackName}
                    {event.trackConfig ? ` — ${event.trackConfig}` : ""}
                  </span>
                </div>
              )}
              {event.scheduledStartTime && (
                <div className="rp-event-meta">
                  <span>Start</span>
                  <span className="rp-mono">{new Date(event.scheduledStartTime).toLocaleString()}</span>
                </div>
              )}
              <div className="rp-event-meta">
                <span>Type</span>
                <span className="rp-badge rp-dim">{event.eventType}</span>
              </div>
              <button
                className="rp-btn rp-primary"
                style={{ marginTop: 8, alignSelf: "flex-start" }}
                onClick={() => selectEvent(event)}
                disabled={selectingId === event.id}
              >
                {selectingId === event.id ? "Selecting…" : "Select"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
