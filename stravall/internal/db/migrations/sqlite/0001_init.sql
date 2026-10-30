-- stravall initial schema (SQLite)
-- Timestamps are unix seconds. IDs are application-generated UUIDs.
-- Distances are metres, durations seconds.

CREATE TABLE users (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255),
    created_at    BIGINT       NOT NULL
);

-- External identities (Google, Apple, Strava ...) linked to a user. Reserved for upcoming OAuth/OIDC sign-in.
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

-- One uploaded activity. stats is a small JSON summary (listed for every
-- activity), detail holds splits and the elevation profile, track the
-- simplified route and preview a coarse version of it for the overview map.
CREATE TABLE activities (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    user_id       VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(200) NOT NULL,
    sport         VARCHAR(64)  NOT NULL DEFAULT '',
    source_format VARCHAR(16)  NOT NULL,
    file_name     VARCHAR(255) NOT NULL DEFAULT '',
    content_hash  VARCHAR(64)  NOT NULL,
    start_time    BIGINT       NOT NULL DEFAULT 0,
    has_track     INTEGER      NOT NULL DEFAULT 0,
    stats         TEXT         NOT NULL,
    detail        TEXT         NOT NULL,
    track         TEXT         NOT NULL,
    preview       TEXT         NOT NULL,
    created_at    BIGINT       NOT NULL
);
CREATE UNIQUE INDEX uq_activities_hash ON activities(user_id, content_hash);
CREATE INDEX idx_activities_user_start ON activities(user_id, start_time);
