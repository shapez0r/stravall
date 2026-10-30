-- "Repeat every X weeks": X is stored per transaction (1 for all other repeats).
ALTER TABLE events ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 1;
