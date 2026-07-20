import { useEffect, useState } from "react";

type ConnectionState =
  | { connected: false }
  | { connected: true; garage61Slug: string | null; connectionMethod: "oauth" | "personal_token" };

/**
 * Garage 61 connect/disconnect, offering both paths side by side: real OAuth (existing
 * auth/garage61/start.ts flow - a full-page redirect and back) and a pasted personal
 * access token (functions/api/planner/garage61/personal-token.ts - no redirect at all).
 * Both land in the same garage61_oauth_tokens row and are indistinguishable to every
 * downstream consumer (fuel/pit-time resolution, team import) - this component is purely
 * about letting the viewer connect however they can today.
 */
export default function Garage61ConnectCard({ returnTo }: { returnTo: string }) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/planner/garage61/connection", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setState(data);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function connectWithToken() {
    const trimmed = token.trim();
    if (!trimmed) return;
    setConnecting(true);
    setError(null);
    try {
      const r = await fetch("/api/planner/garage61/personal-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not connect. Please try again.");
        return;
      }
      setToken("");
      load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/planner/garage61/connection", { method: "DELETE", credentials: "include" });
      load();
    } finally {
      setDisconnecting(false);
    }
  }

  if (!state) return <p className="rp-section-sub">Loading…</p>;

  if (state.connected) {
    return (
      <div>
        <p className="rp-section-sub">
          Connected{state.garage61Slug ? (
            <>
              {" "}
              as <strong>{state.garage61Slug}</strong>
            </>
          ) : null}
          {state.connectionMethod === "personal_token" ? " · personal access token" : " · OAuth"}.
        </p>
        <button className="rp-btn" onClick={disconnect} disabled={disconnecting}>
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <a className="rp-btn rp-primary" href={`/api/auth/garage61/start?returnTo=${encodeURIComponent(returnTo)}`}>
        Connect with Garage 61 →
      </a>
      <p className="rp-section-sub" style={{ margin: "14px 0 6px" }}>
        Or paste a personal access token (create one at garage61.net → Account → API):
      </p>
      <div className="rp-row">
        <input
          className="rp-input"
          style={{ minWidth: 260 }}
          placeholder="Garage 61 personal access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connectWithToken()}
          type="password"
        />
        <button className="rp-btn" onClick={connectWithToken} disabled={connecting || !token.trim()}>
          {connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error && <p className="rp-error">{error}</p>}
    </div>
  );
}
