export default function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2>{title}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        {note}
      </p>
      <div className="rp-card">This page is scaffolded but not wired up yet.</div>
    </div>
  );
}
