export default function Privacy() {
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Privacy
            </h1>
            <div className="subtle">
              Short version: we use OAuth, we don't see your password, and we don't show a
              driver's real name unless they've explicitly consented to it.
            </div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Minimal data
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Verification</h2>
        <div className="subtle" style={{ marginTop: 10 }}>
          When you verify, you're redirected to iRacing to sign in. GridRep receives an OAuth
          token so we can confirm your identity and pull the race/session data you ask for -
          that's it. We never see or store your iRacing password.
        </div>
      </div>

      <div className="card card-pad">
        <h2>Driver identity &amp; consent</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>A real name is shown only with consent</div>
            <div className="subtle">
              A driver's name is displayed anywhere on GridRep only where that driver has given
              explicit, off-platform consent (a signed form, or a recorded agreement) to be
              identified. Without that consent, a driver appears by car number and class instead.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Consent can be revoked</div>
            <div className="subtle">
              Revoking consent stops a driver's name being shown anywhere on GridRep, from the
              next request onward.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Retention</div>
            <div className="subtle">
              A non-consented driver's identity (name and iRacing member id) is deleted after 12
              months of inactivity. Lap times and results stay, keyed to an internal id that
              carries no name or iRacing member id.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What we store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Your own account</div>
            <div className="subtle">Your iRacing member id and display name, for your own signed-in account.</div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Auth session cookie</div>
            <div className="subtle">
              A short "signed in" session identifier stored in an HttpOnly cookie, so you don't
              need to re-verify on every page.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>OAuth tokens (server-side)</div>
            <div className="subtle">
              Access/refresh tokens are stored server-side only (never in your browser) so we can
              fetch iRacing data on your behalf when you use the planner, Pace, or What-If.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Race/session data</div>
            <div className="subtle">
              Lap times, race results, and the stint/fuel plans you build in the race planner.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What we do not store</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Your iRacing password</div>
            <div className="subtle">
              OAuth means you authenticate with iRacing directly - GridRep never sees your
              password.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Private iRacing account details</div>
            <div className="subtle">We don't pull or store email, billing info, or anything like that.</div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Account deletion</h2>
        <div className="subtle" style={{ marginTop: 10 }}>
          Deleting your account removes your identity and consent records along with your planner
          data. Contact us if you'd like this done on your behalf.
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
