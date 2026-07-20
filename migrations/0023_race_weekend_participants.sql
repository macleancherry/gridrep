-- 0023_race_weekend_participants.sql
--
-- The pool of team-roster drivers "in scope" for a race weekend (PRD phase 6: multi-car
-- distribution) - distinct from any one Car Entry's race_plan_lineup, since the whole
-- point is to pick the pool BEFORE splitting it across cars. A driver's weekend-level
-- availability (driver_availability, migration 0022) is what the distribution suggestion
-- (plannerDistribution.ts) reads to balance the split.
CREATE TABLE IF NOT EXISTS race_weekend_participants (
  race_weekend_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  PRIMARY KEY (race_weekend_id, cust_id),
  FOREIGN KEY (race_weekend_id) REFERENCES race_weekends(id)
);
