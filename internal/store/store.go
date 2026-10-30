// Package store is the data-access layer. All SQL lives here and is written
// to run unchanged on both SQLite and MariaDB/MySQL.
package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"eurofish/internal/db"
	"eurofish/internal/finance"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")

	// ErrNotOccurrence is returned when a date is not an occurrence of a
	// repeating transaction.
	ErrNotOccurrence = errors.New("not an occurrence of this repeating transaction")
)

const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
	RoleViewer = "viewer"
)

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	PasswordHash string `json:"-"`
	CreatedAt    int64  `json:"created_at"`
}

type Calendar struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Currency     string `json:"currency"`
	StartDate    string `json:"start_date"`
	StartBalance int64  `json:"start_balance"`
	OwnerID      string `json:"owner_id"`
	OwnerName    string `json:"owner_name"` // display name of the owner
	Version      int64  `json:"version"`
	CreatedAt    int64  `json:"created_at"`
	Role         string `json:"role"` // role of the requesting user
}

type Member struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type Event struct {
	ID         string   `json:"id"`
	CalendarID string   `json:"calendar_id"`
	Title      string   `json:"title"`
	Amount     int64    `json:"amount"` // cents; positive = income, negative = expense
	Category   string   `json:"category"`
	Note       string   `json:"note"`
	StartDate  string   `json:"start_date"`
	Recurrence string   `json:"recurrence"`
	Interval   int      `json:"interval"` // X for "repeat every X weeks" (1 otherwise)
	UntilDate  string   `json:"until_date,omitempty"`
	CreatedBy  string   `json:"created_by"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
	Skips      []string `json:"skips"`
}

type Store struct {
	db *db.DB
}

func New(d *db.DB) *Store { return &Store{db: d} }

func isDuplicate(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") || // SQLite
		strings.Contains(msg, "Duplicate entry") || // MariaDB / MySQL (1062)
		strings.Contains(msg, "constraint failed: PRIMARY KEY")
}

func nullable(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

// intervalOrOne stores 1 for transactions without an explicit interval.
func intervalOrOne(n int) int {
	if n < 1 {
		return 1
	}
	return n
}

// ---------- users ----------

func (s *Store) CreateUser(ctx context.Context, u *User) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		u.ID, u.Email, u.DisplayName, nullable(u.PasswordHash), u.CreatedAt)
	if isDuplicate(err) {
		return ErrConflict
	}
	return err
}

func (s *Store) scanUser(row *sql.Row) (*User, error) {
	var u User
	var pw sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &pw, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.PasswordHash = pw.String
	return &u, nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (*User, error) {
	return s.scanUser(s.db.QueryRowContext(ctx,
		`SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = ?`, email))
}

func (s *Store) UserByID(ctx context.Context, id string) (*User, error) {
	return s.scanUser(s.db.QueryRowContext(ctx,
		`SELECT id, email, display_name, password_hash, created_at FROM users WHERE id = ?`, id))
}

// ---------- sessions ----------

func (s *Store) CreateSession(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		tokenHash, userID, expires.Unix(), time.Now().Unix())
	return err
}

// SessionUser returns the user that owns a valid (non-expired) session and the expiry time.
func (s *Store) SessionUser(ctx context.Context, tokenHash string) (*User, time.Time, error) {
	var u User
	var pw sql.NullString
	var exp int64
	err := s.db.QueryRowContext(ctx,
		`SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at, s.expires_at
		   FROM sessions s JOIN users u ON u.id = s.user_id
		  WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, time.Now().Unix()).
		Scan(&u.ID, &u.Email, &u.DisplayName, &pw, &u.CreatedAt, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, ErrNotFound
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	u.PasswordHash = pw.String
	return &u, time.Unix(exp, 0), nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---------- calendars ----------

func (s *Store) CreateCalendar(ctx context.Context, c *Calendar) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO calendars (id, name, currency, start_date, start_balance, owner_id, version, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
		c.ID, c.Name, c.Currency, c.StartDate, c.StartBalance, c.OwnerID, c.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO calendar_members (calendar_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		c.ID, c.OwnerID, RoleOwner, c.CreatedAt); err != nil {
		return err
	}
	c.Version = 1
	c.Role = RoleOwner
	return tx.Commit()
}

// ImportCalendar creates a calendar owned by c.OwnerID together with its
// transactions (including removed days) and manually set balances, all in
// one transaction: either everything is imported or nothing.
func (s *Store) ImportCalendar(ctx context.Context, c *Calendar, events []Event, balances []BalanceOverride) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO calendars (id, name, currency, start_date, start_balance, owner_id, version, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
		c.ID, c.Name, c.Currency, c.StartDate, c.StartBalance, c.OwnerID, c.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO calendar_members (calendar_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		c.ID, c.OwnerID, RoleOwner, c.CreatedAt); err != nil {
		return err
	}
	for _, e := range events {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO events (id, calendar_id, title, amount, category, note, start_date, recurrence, repeat_interval, until_date, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			e.ID, c.ID, e.Title, e.Amount, e.Category, e.Note, e.StartDate, e.Recurrence, intervalOrOne(e.Interval),
			nullable(e.UntilDate), e.CreatedBy, e.CreatedAt, e.UpdatedAt); err != nil {
			return err
		}
		for _, d := range e.Skips {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO event_skips (event_id, skip_date) VALUES (?, ?)`, e.ID, d); err != nil {
				return err
			}
		}
	}
	for _, b := range balances {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO balance_overrides (calendar_id, balance_date, balance, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`,
			c.ID, b.Date, b.Balance, c.OwnerID, c.CreatedAt); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	c.Version = 1
	c.Role = RoleOwner
	return nil
}

const calendarCols = `c.id, c.name, c.currency, c.start_date, c.start_balance, c.owner_id, o.display_name, c.version, c.created_at, m.role`

// calendarFrom joins the requesting user's membership and the owner's account.
const calendarFrom = ` FROM calendars c JOIN calendar_members m ON m.calendar_id = c.id JOIN users o ON o.id = c.owner_id`

func scanCalendar(sc interface{ Scan(...any) error }) (*Calendar, error) {
	var c Calendar
	if err := sc.Scan(&c.ID, &c.Name, &c.Currency, &c.StartDate, &c.StartBalance, &c.OwnerID, &c.OwnerName, &c.Version, &c.CreatedAt, &c.Role); err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) ListCalendars(ctx context.Context, userID string) ([]Calendar, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+calendarCols+calendarFrom+`
		  WHERE m.user_id = ? ORDER BY c.created_at, c.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Calendar{}
	for rows.Next() {
		c, err := scanCalendar(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// CalendarForUser returns the calendar if the user is a member of it.
func (s *Store) CalendarForUser(ctx context.Context, calendarID, userID string) (*Calendar, error) {
	c, err := scanCalendar(s.db.QueryRowContext(ctx,
		`SELECT `+calendarCols+calendarFrom+`
		  WHERE c.id = ? AND m.user_id = ?`, calendarID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

func (s *Store) UpdateCalendar(ctx context.Context, c *Calendar) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE calendars SET name = ?, currency = ?, start_date = ?, start_balance = ?, version = version + 1 WHERE id = ?`,
		c.Name, c.Currency, c.StartDate, c.StartBalance, c.ID)
	return err
}

func (s *Store) DeleteCalendar(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM calendars WHERE id = ?`, id)
	return err
}

// ---------- members ----------

func (s *Store) ListMembers(ctx context.Context, calendarID string) ([]Member, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT u.id, u.email, u.display_name, m.role FROM calendar_members m JOIN users u ON u.id = m.user_id
		  WHERE m.calendar_id = ? ORDER BY m.created_at, u.email`, calendarID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) AddMember(ctx context.Context, calendarID, userID, role string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO calendar_members (calendar_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
		calendarID, userID, role, time.Now().Unix())
	if isDuplicate(err) {
		return ErrConflict
	}
	return err
}

func (s *Store) RemoveMember(ctx context.Context, calendarID, userID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM calendar_members WHERE calendar_id = ? AND user_id = ? AND role <> ?`,
		calendarID, userID, RoleOwner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateMemberRole changes the role of a (non-owner) member.
func (s *Store) UpdateMemberRole(ctx context.Context, calendarID, userID, role string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE calendar_members SET role = ? WHERE calendar_id = ? AND user_id = ? AND role <> ?`,
		role, calendarID, userID, RoleOwner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// MariaDB reports 0 affected rows when nothing changed; double-check existence.
		var c int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM calendar_members WHERE calendar_id = ? AND user_id = ? AND role <> ?`,
			calendarID, userID, RoleOwner).Scan(&c); err != nil {
			return err
		}
		if c == 0 {
			return ErrNotFound
		}
	}
	return nil
}

// ---------- invites (shares for people without an account yet) ----------

// Invite is a pending share for an e-mail address that has no account yet.
type Invite struct {
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) ListInvites(ctx context.Context, calendarID string) ([]Invite, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT email, role, created_at FROM calendar_invites WHERE calendar_id = ? ORDER BY created_at, email`, calendarID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invite{}
	for rows.Next() {
		var i Invite
		if err := rows.Scan(&i.Email, &i.Role, &i.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// SetInvite creates or replaces the pending share of an e-mail address.
func (s *Store) SetInvite(ctx context.Context, calendarID, email, role, invitedBy string) (*Invite, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM calendar_invites WHERE calendar_id = ? AND email = ?`, calendarID, email); err != nil {
		return nil, err
	}
	inv := &Invite{Email: email, Role: role, CreatedAt: time.Now().Unix()}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO calendar_invites (calendar_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)`,
		calendarID, email, role, invitedBy, inv.CreatedAt); err != nil {
		return nil, err
	}
	return inv, tx.Commit()
}

func (s *Store) DeleteInvite(ctx context.Context, calendarID, email string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM calendar_invites WHERE calendar_id = ? AND email = ?`, calendarID, email)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AcceptInvites turns all pending shares for the user's e-mail address into
// memberships. It is called when an account is created.
func (s *Store) AcceptInvites(ctx context.Context, userID, email string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx,
		`SELECT calendar_id, role FROM calendar_invites WHERE email = ?`, email)
	if err != nil {
		return err
	}
	type pending struct{ calendarID, role string }
	var list []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.calendarID, &p.role); err != nil {
			rows.Close()
			return err
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	now := time.Now().Unix()
	for _, p := range list {
		var n int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM calendar_members WHERE calendar_id = ? AND user_id = ?`, p.calendarID, userID).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO calendar_members (calendar_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
				p.calendarID, userID, p.role, now); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM calendar_invites WHERE email = ?`, email); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- events ----------

func (s *Store) ListEvents(ctx context.Context, calendarID string) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, calendar_id, title, amount, category, note, start_date, recurrence, repeat_interval, until_date, created_by, created_at, updated_at
		   FROM events WHERE calendar_id = ? ORDER BY start_date, created_at, id`, calendarID)
	if err != nil {
		return nil, err
	}
	out := []Event{}
	index := map[string]int{}
	for rows.Next() {
		var e Event
		var until sql.NullString
		if err := rows.Scan(&e.ID, &e.CalendarID, &e.Title, &e.Amount, &e.Category, &e.Note, &e.StartDate,
			&e.Recurrence, &e.Interval, &until, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		e.UntilDate = until.String
		e.Skips = []string{}
		index[e.ID] = len(out)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	skipRows, err := s.db.QueryContext(ctx,
		`SELECT k.event_id, k.skip_date FROM event_skips k JOIN events e ON e.id = k.event_id
		  WHERE e.calendar_id = ? ORDER BY k.skip_date`, calendarID)
	if err != nil {
		return nil, err
	}
	defer skipRows.Close()
	for skipRows.Next() {
		var id, d string
		if err := skipRows.Scan(&id, &d); err != nil {
			return nil, err
		}
		if i, ok := index[id]; ok {
			out[i].Skips = append(out[i].Skips, d)
		}
	}
	return out, skipRows.Err()
}

func bumpVersion(ctx context.Context, tx *sql.Tx, calendarID string) error {
	_, err := tx.ExecContext(ctx, `UPDATE calendars SET version = version + 1 WHERE id = ?`, calendarID)
	return err
}

func (s *Store) CreateEvent(ctx context.Context, e *Event) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO events (id, calendar_id, title, amount, category, note, start_date, recurrence, repeat_interval, until_date, created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.CalendarID, e.Title, e.Amount, e.Category, e.Note, e.StartDate, e.Recurrence, intervalOrOne(e.Interval),
		nullable(e.UntilDate), e.CreatedBy, e.CreatedAt, e.UpdatedAt); err != nil {
		return err
	}
	if err := bumpVersion(ctx, tx, e.CalendarID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateEvent(ctx context.Context, e *Event) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`UPDATE events SET title = ?, amount = ?, category = ?, note = ?, start_date = ?, recurrence = ?, repeat_interval = ?, until_date = ?, updated_at = ?
		  WHERE id = ? AND calendar_id = ?`,
		e.Title, e.Amount, e.Category, e.Note, e.StartDate, e.Recurrence, intervalOrOne(e.Interval), nullable(e.UntilDate), e.UpdatedAt,
		e.ID, e.CalendarID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// MariaDB reports 0 affected rows when nothing changed; double-check existence.
		var c int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE id = ? AND calendar_id = ?`, e.ID, e.CalendarID).Scan(&c); err != nil {
			return err
		}
		if c == 0 {
			return ErrNotFound
		}
	}
	if err := bumpVersion(ctx, tx, e.CalendarID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteEvent(ctx context.Context, calendarID, eventID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Explicit skip cleanup keeps behaviour identical even if FK enforcement is off.
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM event_skips WHERE event_id IN (SELECT id FROM events WHERE id = ? AND calendar_id = ?)`,
		eventID, calendarID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM events WHERE id = ? AND calendar_id = ?`, eventID, calendarID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if err := bumpVersion(ctx, tx, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- balance overrides ----------

// BalanceOverride is a manually set end-of-day balance for one date.
type BalanceOverride struct {
	Date    string `json:"date"`
	Balance int64  `json:"balance"` // cents
}

// ListBalanceOverrides returns all manually set balances of a calendar.
func (s *Store) ListBalanceOverrides(ctx context.Context, calendarID string) ([]BalanceOverride, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT balance_date, balance FROM balance_overrides WHERE calendar_id = ? ORDER BY balance_date`, calendarID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BalanceOverride{}
	for rows.Next() {
		var b BalanceOverride
		if err := rows.Scan(&b.Date, &b.Balance); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetBalanceOverride sets (or replaces) the end-of-day balance of a date.
func (s *Store) SetBalanceOverride(ctx context.Context, calendarID, date string, balance int64, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Delete + insert keeps the SQL portable between SQLite and MariaDB.
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM balance_overrides WHERE calendar_id = ? AND balance_date = ?`, calendarID, date); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO balance_overrides (calendar_id, balance_date, balance, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`,
		calendarID, date, balance, userID, time.Now().Unix()); err != nil {
		return err
	}
	if err := bumpVersion(ctx, tx, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteBalanceOverride removes a manually set balance.
func (s *Store) DeleteBalanceOverride(ctx context.Context, calendarID, date string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`DELETE FROM balance_overrides WHERE calendar_id = ? AND balance_date = ?`, calendarID, date)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if err := bumpVersion(ctx, tx, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}

// SkipOccurrence removes a single occurrence of a (recurring) event.
func (s *Store) SkipOccurrence(ctx context.Context, calendarID, eventID, date string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE id = ? AND calendar_id = ?`, eventID, calendarID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_skips WHERE event_id = ? AND skip_date = ?`, eventID, date).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO event_skips (event_id, skip_date) VALUES (?, ?)`, eventID, date); err != nil {
			return err
		}
	}
	if err := bumpVersion(ctx, tx, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}

// DetachOccurrence changes a single occurrence of a repeating event: the
// occurrence on date is removed from the series and e (a one-off event) is
// created in its place. Both happen in one transaction.
func (s *Store) DetachOccurrence(ctx context.Context, calendarID, eventID, date string, e *Event) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var startDate, recurrence string
	var interval int
	var until sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT start_date, recurrence, repeat_interval, until_date FROM events WHERE id = ? AND calendar_id = ?`,
		eventID, calendarID).Scan(&startDate, &recurrence, &interval, &until)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if recurrence == finance.None || recurrence == "" {
		return ErrNotOccurrence
	}
	start, err := finance.ParseDate(startDate)
	if err != nil {
		return err
	}
	day, err := finance.ParseDate(date)
	if err != nil {
		return ErrNotOccurrence
	}
	var untilDate time.Time
	if until.Valid && until.String != "" {
		if untilDate, err = finance.ParseDate(until.String); err != nil {
			return err
		}
	}
	if len(finance.OccurrencesEvery(start, untilDate, recurrence, interval, day, day)) == 0 {
		return ErrNotOccurrence
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_skips WHERE event_id = ? AND skip_date = ?`, eventID, date).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrNotOccurrence // already removed from the series
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO event_skips (event_id, skip_date) VALUES (?, ?)`, eventID, date); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO events (id, calendar_id, title, amount, category, note, start_date, recurrence, repeat_interval, until_date, created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, calendarID, e.Title, e.Amount, e.Category, e.Note, e.StartDate, e.Recurrence, intervalOrOne(e.Interval),
		nullable(e.UntilDate), e.CreatedBy, e.CreatedAt, e.UpdatedAt); err != nil {
		return err
	}
	if err := bumpVersion(ctx, tx, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}
