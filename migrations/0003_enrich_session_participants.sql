-- Enrich cached participant rows with additional result fields used by Ignium
ALTER TABLE session_participants ADD COLUMN qualifying_pos INTEGER;
ALTER TABLE session_participants ADD COLUMN start_pos INTEGER;
ALTER TABLE session_participants ADD COLUMN class_pos INTEGER;
ALTER TABLE session_participants ADD COLUMN field_size INTEGER;
ALTER TABLE session_participants ADD COLUMN class_field_size INTEGER;
ALTER TABLE session_participants ADD COLUMN laps_completed INTEGER;
ALTER TABLE session_participants ADD COLUMN best_lap TEXT;
ALTER TABLE session_participants ADD COLUMN incidents INTEGER;
ALTER TABLE session_participants ADD COLUMN car_class TEXT;
