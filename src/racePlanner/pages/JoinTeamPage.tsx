import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/planner/join/${encodeURIComponent(token)}`, { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "This invite link isn't valid.");
          return;
        }
        setTeam(data.team);
        setAlreadyMember(Boolean(data.alreadyMember));
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  async function join() {
    if (!token) return;
    setJoining(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/join/${encodeURIComponent(token)}`, { method: "POST", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not join this team.");
        return;
      }
      navigate(`/race-planner/team/${data.team.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;
  if (error) return <p className="rp-error">{error}</p>;
  if (!team) return null;

  return (
    <div className="rp-center-page">
      <div className="rp-card rp-center-card">
        <div className="rp-mark" style={{ margin: "0 auto 18px" }}>
          RP
        </div>
        <h2 style={{ marginTop: 0 }}>You've been invited to join {team.name}</h2>
        {alreadyMember ? (
          <>
            <p className="rp-section-sub">You're already a member of this team.</p>
            <button className="rp-btn rp-primary" style={{ marginTop: 12 }} onClick={() => navigate(`/race-planner/team/${team.id}`)}>
              Go to team →
            </button>
          </>
        ) : (
          <>
            <p className="rp-section-sub">
              Joining connects you to {team.name}'s roster - you'll be able to set your availability and driving
              preferences for their upcoming race weekends.
            </p>
            <button className="rp-btn rp-primary" style={{ marginTop: 12 }} onClick={join} disabled={joining}>
              {joining ? "Joining…" : `Join ${team.name}`}
            </button>
          </>
        )}
        {error && <p className="rp-error">{error}</p>}
      </div>
    </div>
  );
}
