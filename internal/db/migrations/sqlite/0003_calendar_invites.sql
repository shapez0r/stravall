-- Pending calendar shares for e-mail addresses that have no account yet.
-- They turn into calendar_members rows when that person signs up.
CREATE TABLE calendar_invites (
    calendar_id VARCHAR(36)  NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    role        VARCHAR(16)  NOT NULL,
    invited_by  VARCHAR(36)  NOT NULL,
    created_at  BIGINT       NOT NULL,
    PRIMARY KEY (calendar_id, email)
);
CREATE INDEX idx_calendar_invites_email ON calendar_invites(email);
