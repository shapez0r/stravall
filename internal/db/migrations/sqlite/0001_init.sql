-- eurofish initial schema (SQLite)
-- Money is stored as signed integer cents. Dates are ISO "YYYY-MM-DD" strings.
-- Timestamps are unix seconds. IDs are application-generated UUIDs.

CREATE TABLE users (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255),
    created_at    BIGINT       NOT NULL
);

-- External identities (Google, Apple, ...) linked to a user. Reserved for upcoming OAuth/OIDC sign-in.
CREATE TABLE auth_identities (
    provider   VARCHAR(32)  NOT NULL,
    subject    VARCHAR(255) NOT NULL,
    user_id    VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT       NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

CREATE TABLE sessions (
    token_hash VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT      NOT NULL,
    created_at BIGINT      NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE calendars (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    currency      VARCHAR(3)   NOT NULL,
    start_date    VARCHAR(10)  NOT NULL,
    start_balance BIGINT       NOT NULL,
    owner_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version       BIGINT       NOT NULL DEFAULT 1,
    created_at    BIGINT       NOT NULL
);

CREATE TABLE calendar_members (
    calendar_id VARCHAR(36) NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(16) NOT NULL,
    created_at  BIGINT      NOT NULL,
    PRIMARY KEY (calendar_id, user_id)
);
CREATE INDEX idx_calendar_members_user ON calendar_members(user_id);

CREATE TABLE events (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    calendar_id VARCHAR(36)  NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    amount      BIGINT       NOT NULL,
    category    VARCHAR(64)  NOT NULL DEFAULT '',
    note        TEXT         NOT NULL,
    start_date  VARCHAR(10)  NOT NULL,
    recurrence  VARCHAR(16)  NOT NULL,
    until_date  VARCHAR(10),
    created_by  VARCHAR(36)  NOT NULL,
    created_at  BIGINT       NOT NULL,
    updated_at  BIGINT       NOT NULL
);
CREATE INDEX idx_events_calendar ON events(calendar_id);

-- Single occurrences of a recurring event that were removed ("skip this one").
CREATE TABLE event_skips (
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    skip_date VARCHAR(10) NOT NULL,
    PRIMARY KEY (event_id, skip_date)
);
