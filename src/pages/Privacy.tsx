export default function Privacy() {
  return (
    <div className="stack">
      {/* Header */}
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Privacy
            </h1>
            <div className="subtle">
              Short version: we use OAuth, we don’t see your password, and we store the minimum
              needed to prevent impersonation and duplicates.
            </div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Minimal data
          </span>
        </div>
      </div>

      {/* The big promise */}
      <div className="card card-pad">
        <h2>Big promises</h2>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          <div className="kv">
            <span>Password</span>
            <strong>We never see it</strong>
          </div>
          <div className="kv">
            <span>Verification</span>
            <strong>Done on iRacing’s site (OAuth)</strong>
          </div>
          <div className="kv">
            <span>Data</span>
            <strong>Only what’s needed for Props + pages</strong>
          </div>
        </div>

        <div className="subtle" style={{ marginTop: 10 }}>
          When you verify, you’re redirected to iRacing to log in. GridRep receives an OAuth token so
          we can confirm your identity and check session participation — that’s it.
        </div>
      </div>

      {/* What we store */}
      <div className="card card-pad">
        <h2>What we store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Identity (after verification)</div>
            <div className="subtle">Your iRacing member ID and display name.</div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Auth session cookie</div>
            <div className="subtle">
              A short “logged in” session identifier stored in an HttpOnly cookie.
              This helps keep you verified without repeatedly logging in.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>OAuth tokens (server-side)</div>
            <div className="subtle">
              Access/refresh tokens are stored server-side only (never in the browser) so we can
              fetch iRacing session data when needed.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Props activity</div>
            <div className="subtle">
              Session ID, recipient ID, selected reason, and timestamp. This is what powers the
              profile totals and prevents duplicate Props.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Cached session display data</div>
            <div className="subtle">
              Minimal session + participant info needed to render pages and enforce “only
              participants can send Props in that session”.
            </div>
          </div>
        </div>
      </div>

      {/* What we do not store */}
      <div className="card card-pad">
        <h2>What we do not store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Your iRacing password</div>
            <div className="subtle">
              OAuth means you authenticate with iRacing directly — GridRep never sees your password.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Private iRacing account details</div>
            <div className="subtle">
              We don’t pull or store email, billing info, or anything like that.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Free-text comments</div>
            <div className="subtle">
              This MVP is reason-only to keep moderation simple and reduce abuse risk.
            </div>
          </div>
        </div>
      </div>

      {/* Why we store it */}
      <div className="card card-pad">
        <h2>Why we store it</h2>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          <div className="kv">
            <span>Prevent impersonation</span>
            <strong>Verified identity via OAuth</strong>
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

      {/* Retention */}
      <div className="card card-pad">
        <h2>Data retention</h2>
        <div className="subtle" style={{ marginTop: 10 }}>
          We keep cached session/driver data so pages can load quickly and Props remain meaningful.
          If you want your data removed, contact us and we’ll sort it out.
        </div>
      </div>

      {/* Contact */}
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
