-- Manually set end-of-day balances ("my balance on this day is X").
CREATE TABLE balance_overrides (
    calendar_id  VARCHAR(36) NOT NULL,
    balance_date VARCHAR(10) NOT NULL,
    balance      BIGINT      NOT NULL,
    updated_by   VARCHAR(36) NOT NULL,
    updated_at   BIGINT      NOT NULL,
    PRIMARY KEY (calendar_id, balance_date),
    CONSTRAINT fk_balance_overrides_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
