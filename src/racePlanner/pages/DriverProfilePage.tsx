import { useState } from "react";
import { useRacePlannerViewer } from "../useRacePlannerViewer";
import { ConditionPreferencesEditor, AvailabilityTemplateEditor, FavoriteCarsEditor } from "../ProfileFieldEditors";
import Garage61ConnectCard from "../Garage61ConnectCard";

/**
 * Consolidated driver profile (PRD driver onboarding: condition preferences, standard
 * weekly availability, favorite cars) - the "your profile" home for editing any of this
 * later. The same three fields are also offered once, up front, during onboarding
 * (WelcomePage.tsx) via the shared editors in ProfileFieldEditors.tsx.
 */
export default function DriverProfilePage() {
  const viewer = useRacePlannerViewer();
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const viewerName = viewer.verified ? viewer.user.name : null;
  const deleteConfirmed = viewerName !== null && deleteConfirmText === viewerName;

  async function deleteAccount() {
    if (!deleteConfirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch("/api/account", { method: "DELETE", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setDeleteError(data.message ?? "Could not delete your account. Please try again.");
        return;
      }
      // Full navigation, not a client-side route change - nothing stale (viewer state,
      // plan context, etc.) should linger after the account backing it no longer exists.
      window.location.href = "/";
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <h2>Your profile</h2>
      <p className="rp-section-sub" style={{ marginBottom: 20 }}>
        These carry across every team and race weekend you're on.
      </p>

      <div className="rp-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Stint preferences</h3>
        <p className="rp-section-sub">What you'd rather drive, not a hard restriction — just flags matching/clashing blocks for you.</p>
        <ConditionPreferencesEditor />
      </div>

      <div className="rp-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Standard availability</h3>
        <p className="rp-section-sub">
          Your usual weekly free time, in your own local time. Use "Prefill from my template" on any race weekend's
          Availability page instead of re-entering this every time.
        </p>
        <AvailabilityTemplateEditor />
      </div>

      <div className="rp-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Favorite cars</h3>
        <FavoriteCarsEditor />
      </div>

      <div className="rp-card">
        <h3 style={{ marginTop: 0 }}>Garage 61</h3>
        <p className="rp-section-sub">Links your real fuel-per-lap, pit stop timing, and team rosters into gridrep.</p>
        <Garage61ConnectCard returnTo="/race-planner/profile" />
      </div>

      <div className="rp-card" style={{ marginTop: 20, borderColor: "var(--rp-red)" }}>
        <h3 style={{ marginTop: 0, color: "var(--rp-red)" }}>Danger zone</h3>
        <p className="rp-section-sub">
          Permanently deletes your gridrep account and everything tied to it: your preferences, standard
          availability, condition preferences, every plan or race weekend you've created, and your membership on
          every team you're part of. <strong>If you created a team, it's deleted entirely — including for anyone
          else on it.</strong> This can't be undone.
        </p>
        {deleteError && <p className="rp-error">{deleteError}</p>}
        <div className="rp-form-field" style={{ marginBottom: 10, maxWidth: 320 }}>
          <label>
            Type your name (<strong>{viewerName ?? "…"}</strong>) to confirm
          </label>
          <input
            className="rp-input"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            disabled={!viewerName || deleting}
            placeholder={viewerName ?? ""}
          />
        </div>
        <button
          className="rp-btn"
          style={{ borderColor: "var(--rp-red)", color: "var(--rp-red)" }}
          onClick={deleteAccount}
          disabled={!deleteConfirmed || deleting}
        >
          {deleting ? "Deleting…" : "Delete my account permanently"}
        </button>
      </div>
    </div>
  );
}
