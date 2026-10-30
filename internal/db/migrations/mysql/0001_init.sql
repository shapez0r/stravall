-- eurofish initial schema (MariaDB / MySQL)
-- Money is stored as signed integer cents. Dates are ISO "YYYY-MM-DD" strings.
-- Timestamps are unix seconds. IDs are application-generated UUIDs.

CREATE TABLE users (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NULL,
    created_at    BIGINT       NOT NULL,
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- External identities (Google, Apple, ...) linked to a user. Reserved for upcoming OAuth/OIDC sign-in.
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

CREATE TABLE calendars (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    currency      VARCHAR(3)   NOT NULL,
    start_date    VARCHAR(10)  NOT NULL,
    start_balance BIGINT       NOT NULL,
    owner_id      VARCHAR(36)  NOT NULL,
    version       BIGINT       NOT NULL DEFAULT 1,
    created_at    BIGINT       NOT NULL,
    CONSTRAINT fk_calendars_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE calendar_members (
    calendar_id VARCHAR(36) NOT NULL,
    user_id     VARCHAR(36) NOT NULL,
    role        VARCHAR(16) NOT NULL,
    created_at  BIGINT      NOT NULL,
    PRIMARY KEY (calendar_id, user_id),
    KEY idx_calendar_members_user (user_id),
    CONSTRAINT fk_members_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE events (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    calendar_id VARCHAR(36)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    amount      BIGINT       NOT NULL,
    category    VARCHAR(64)  NOT NULL DEFAULT '',
    note        TEXT         NOT NULL,
    start_date  VARCHAR(10)  NOT NULL,
    recurrence  VARCHAR(16)  NOT NULL,
    until_date  VARCHAR(10)  NULL,
    created_by  VARCHAR(36)  NOT NULL,
    created_at  BIGINT       NOT NULL,
    updated_at  BIGINT       NOT NULL,
    KEY idx_events_calendar (calendar_id),
    CONSTRAINT fk_events_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single occurrences of a recurring event that were removed ("skip this one").
CREATE TABLE event_skips (
    event_id  VARCHAR(36) NOT NULL,
    skip_date VARCHAR(10) NOT NULL,
    PRIMARY KEY (event_id, skip_date),
    CONSTRAINT fk_skips_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
