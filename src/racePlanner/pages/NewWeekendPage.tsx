import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

type TeamSummary = { id: string; name: string; isCreator: boolean };

/**
 * Step one of the top-down "create weekend -> add car -> pick that car's race" builder
 * (coordinator navigation rebuild, 2026-07-22) - a small blank-weekend form, replacing the
 * old "just search a session, weekend+car auto-created together" shortcut. Reached either
 * with a teamId already known (TeamPage.tsx's "Create a race weekend" button) or without
 * one (WeekendListPage.tsx's "+ Create a race weekend", HomePage.tsx's card) - in the
 * latter case a coordinator picks which of their teams this weekend belongs to, or leaves
 * it as a solo weekend of their own.
 */
export default function NewWeekendPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetTeamId = searchParams.get("teamId") ?? "";

  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamId, setTeamId] = useState(presetTeamId);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presetTeamId) return; // already known - no need to fetch the picker list
    fetch("/api/planner/teams", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setTeams(data.ok ? data.teams.filter((t: TeamSummary) => t.isCreator) : []))
      .catch(() => setTeams([]));
  }, [presetTeamId]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/planner/race-weekends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teamId: teamId || null, name: name.trim() || null }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not create this race weekend.");
        return;
      }
      navigate(`/race-planner/weekend/${data.weekend.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rp-center-page">
      <div className="rp-card rp-center-card">
        <h2 style={{ marginTop: 0 }}>Create a race weekend</h2>
        <p className="rp-section-sub" style={{ marginBottom: 16 }}>
          Start blank - you'll add cars and pick each one's race next.
        </p>

        {error && <p className="rp-error">{error}</p>}

        {!presetTeamId && teams !== null && teams.length > 0 && (
          <div className="rp-form-field" style={{ marginBottom: 12, textAlign: "left" }}>
            <label>Team</label>
            <select className="rp-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Solo (no team)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="rp-form-field" style={{ marginBottom: 16, textAlign: "left" }}>
          <label>Name this weekend (optional)</label>
          <input
            className="rp-input"
            placeholder="e.g. Spa 24h"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <button className="rp-btn rp-primary" onClick={create} disabled={creating}>
          {creating ? "Creating…" : "Create weekend →"}
        </button>
      </div>
    </div>
  );
}
