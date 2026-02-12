export default function Privacy() {
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Privacy
            </h1>
            <div className="subtle">
              Short version: we use OAuth, we don’t see your password, and we store the minimum needed
              to prevent impersonation and spam.
            </div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Minimal data
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What we store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Identity (after verification)</div>
            <div className="subtle">Your iRacing member ID and display name.</div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Props activity</div>
            <div className="subtle">
              Session ID, recipient ID, selected reason, and timestamp.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Session display data (cached)</div>
            <div className="subtle">
              Minimal session/participant info needed to show pages and prevent duplicate Props.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What we do not store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Your password</div>
            <div className="subtle">
              OAuth means you authenticate with iRacing directly — GridRep never sees it.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Free-text comments</div>
            <div className="subtle">
              MVP is reason-only to keep things simple and reduce moderation risk.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Why we store it</h2>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          <div className="kv">
            <span>Prevent impersonation</span>
            <strong>OAuth verification</strong>
          </div>
          <div className="kv">
            <span>Stop spam / duplicates</span>
            <strong>One prop per driver per session</strong>
          </div>
          <div className="kv">
            <span>Keep stats meaningful</span>
            <strong>Only if you participated</strong>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Contact</h2>
        <p style={{ marginTop: 10 }}>
          For questions, removal requests, or anything privacy-related, contact:{" "}
          <strong>gridrepgg@gmail.com</strong>
        </p>
      </div>
    </div>
  );
}
