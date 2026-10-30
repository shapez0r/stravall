-- stravall initial schema (MariaDB / MySQL)
-- Timestamps are unix seconds. IDs are application-generated UUIDs.
-- Distances are metres, durations seconds.

CREATE TABLE users (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NULL,
    created_at    BIGINT       NOT NULL,
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- External identities (Google, Apple, Strava ...) linked to a user. Reserved for upcoming OAuth/OIDC sign-in.
CREATE TABLE auth_identities (
    provider   VARCHAR(32)  NOT NULL,
    subject    VARCHAR(255) NOT NULL,
    user_id    VARCHAR(36)  NOT NULL,
    created_at BIGINT       NOT NULL,
    PRIMARY KEY (provider, subject),
    KEY idx_auth_identities_user (user_id),
    CONSTRAINT fk_auth_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
    token_hash VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id    VARCHAR(36) NOT NULL,
    expires_at BIGINT      NOT NULL,
    created_at BIGINT      NOT NULL,
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One uploaded activity. stats is a small JSON summary (listed for every
-- activity), detail holds splits and the elevation profile, track the
-- simplified route and preview a coarse version of it for the overview map.
CREATE TABLE activities (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    user_id       VARCHAR(36)  NOT NULL,
    name          VARCHAR(200) NOT NULL,
    sport         VARCHAR(64)  NOT NULL DEFAULT '',
    source_format VARCHAR(16)  NOT NULL,
    file_name     VARCHAR(255) NOT NULL DEFAULT '',
    content_hash  VARCHAR(64)  NOT NULL,
    start_time    BIGINT       NOT NULL DEFAULT 0,
    has_track     TINYINT      NOT NULL DEFAULT 0,
    stats         MEDIUMTEXT   NOT NULL,
    detail        MEDIUMTEXT   NOT NULL,
    track         MEDIUMTEXT   NOT NULL,
    preview       MEDIUMTEXT   NOT NULL,
    created_at    BIGINT       NOT NULL,
    UNIQUE KEY uq_activities_hash (user_id, content_hash),
    KEY idx_activities_user_start (user_id, start_time),
    CONSTRAINT fk_activities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
