-- Pace already fetches each subsession's official iRacing result payload
-- during ingest (to find sim-sessions/participants), and that payload
-- carries a per-driver "incidents" total straight from iRacing - the same
-- field Ignium's importer already uses. Store it so the incidents column
-- can show iRacing's real number instead of reconstructing an estimate
-- from lap flags.
CREATE TABLE IF NOT EXISTS pace_participants (
  subsession_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  simsession_number INTEGER NOT NULL,
  simsession_type TEXT NOT NULL,       -- normalized: 'qualifying' | 'race'
  incidents INTEGER,                   -- NULL when iRacing's payload didn't include one for this row
  created_at TEXT NOT NULL,
  PRIMARY KEY (subsession_id, cust_id, simsession_number),
  FOREIGN KEY (subsession_id) REFERENCES pace_subsessions(subsession_id)
);
