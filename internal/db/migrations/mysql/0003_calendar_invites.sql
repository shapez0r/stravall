-- Pending calendar shares for e-mail addresses that have no account yet.
-- They turn into calendar_members rows when that person signs up.
CREATE TABLE calendar_invites (
    calendar_id VARCHAR(36)  NOT NULL,
    email       VARCHAR(255) NOT NULL,
    role        VARCHAR(16)  NOT NULL,
    invited_by  VARCHAR(36)  NOT NULL,
    created_at  BIGINT       NOT NULL,
    PRIMARY KEY (calendar_id, email),
    KEY idx_calendar_invites_email (email),
    CONSTRAINT fk_invites_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
