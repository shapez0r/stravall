// Package store is the data-access layer. All SQL lives here and is written
// to run unchanged on both SQLite and MariaDB/MySQL.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"stravall/internal/db"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("already exists")
)

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	PasswordHash string `json:"-"`
	CreatedAt    int64  `json:"created_at"`
}

// Activity is one stored activity. Stats, Detail, Track and Preview are JSON
// documents produced by the track package; they are passed through verbatim.
type Activity struct {
	ID           string          `json:"id"`
	UserID       string          `json:"-"`
	Name         string          `json:"name"`
	Sport        string          `json:"sport"`
	SourceFormat string          `json:"format"`
	FileName     string          `json:"file_name"`
	ContentHash  string          `json:"-"`
	StartTime    int64           `json:"start_time"` // unix seconds, 0 = unknown
	HasTrack     bool            `json:"has_track"`
	Stats        json.RawMessage `json:"stats"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	Track        json.RawMessage `json:"track,omitempty"`
	Preview      json.RawMessage `json:"preview,omitempty"`
	CreatedAt    int64           `json:"created_at"`
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

// ---------- activities ----------

// Insert outcomes.
const (
	Inserted  = "imported"
	Duplicate = "duplicate"
	Upgraded  = "updated" // a summary-only activity (from activities.csv) got its GPS track
)

// duplicateWindow: activities of one user starting within this many seconds
// of each other are treated as the same activity (e.g. the same run uploaded
// as GPX and as FIT, or a row of activities.csv and its file).
const duplicateWindow = 60

// InsertActivity stores a new activity unless it is already there. It
// returns the outcome and the id of the stored (or existing) activity.
func (s *Store) InsertActivity(ctx context.Context, a *Activity) (string, string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()

	var id string
	err = tx.QueryRowContext(ctx,
		`SELECT id FROM activities WHERE user_id = ? AND content_hash = ?`, a.UserID, a.ContentHash).Scan(&id)
	if err == nil {
		return Duplicate, id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", "", err
	}

	if a.StartTime > 0 {
		var hasTrack int
		err = tx.QueryRowContext(ctx,
			`SELECT id, has_track FROM activities WHERE user_id = ? AND start_time BETWEEN ? AND ?
			  ORDER BY has_track DESC, created_at LIMIT 1`,
			a.UserID, a.StartTime-duplicateWindow, a.StartTime+duplicateWindow).Scan(&id, &hasTrack)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// a new activity
		case err != nil:
			return "", "", err
		case hasTrack == 0 && a.HasTrack:
			// The existing entry only has Strava's summary: add the route,
			// keeping the name and type given on Strava.
			if _, err := tx.ExecContext(ctx,
				`UPDATE activities SET source_format = ?, file_name = ?, content_hash = ?, has_track = 1,
				        stats = ?, detail = ?, track = ?, preview = ? WHERE id = ?`,
				a.SourceFormat, a.FileName, a.ContentHash, string(a.Stats), string(a.Detail),
				string(a.Track), string(a.Preview), id); err != nil {
				if isDuplicate(err) {
					return Duplicate, id, nil
				}
				return "", "", err
			}
			return Upgraded, id, tx.Commit()
		default:
			return Duplicate, id, nil
		}
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO activities (id, user_id, name, sport, source_format, file_name, content_hash, start_time,
		                         has_track, stats, detail, track, preview, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.UserID, a.Name, a.Sport, a.SourceFormat, a.FileName, a.ContentHash, a.StartTime,
		boolInt(a.HasTrack), string(a.Stats), string(a.Detail), string(a.Track), string(a.Preview), a.CreatedAt); err != nil {
		if isDuplicate(err) {
			return Duplicate, "", nil
		}
		return "", "", err
	}
	return Inserted, a.ID, tx.Commit()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ListActivities returns all activities of a user (summary columns only),
// newest first. withPreview adds the coarse route used by the overview map.
func (s *Store) ListActivities(ctx context.Context, userID string, withPreview bool) ([]Activity, error) {
	cols := `id, name, sport, source_format, file_name, start_time, has_track, stats, created_at`
	if withPreview {
		cols += `, preview`
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+cols+` FROM activities WHERE user_id = ? ORDER BY start_time DESC, created_at DESC, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		var hasTrack int
		var stats, preview string
		dest := []any{&a.ID, &a.Name, &a.Sport, &a.SourceFormat, &a.FileName, &a.StartTime, &hasTrack, &stats, &a.CreatedAt}
		if withPreview {
			dest = append(dest, &preview)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		a.HasTrack = hasTrack != 0
		a.Stats = json.RawMessage(stats)
		if withPreview {
			a.Preview = json.RawMessage(preview)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetActivity returns one activity of a user with all details and the route.
func (s *Store) GetActivity(ctx context.Context, userID, id string) (*Activity, error) {
	var a Activity
	var hasTrack int
	var stats, detail, track string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, sport, source_format, file_name, start_time, has_track, stats, detail, track, created_at
		   FROM activities WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&a.ID, &a.Name, &a.Sport, &a.SourceFormat, &a.FileName, &a.StartTime, &hasTrack, &stats, &detail, &track, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.HasTrack = hasTrack != 0
	a.Stats, a.Detail, a.Track = json.RawMessage(stats), json.RawMessage(detail), json.RawMessage(track)
	return &a, nil
}

// UpdateActivity renames an activity and/or changes its sport.
func (s *Store) UpdateActivity(ctx context.Context, userID, id, name, sport string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE activities SET name = ?, sport = ? WHERE id = ? AND user_id = ?`, name, sport, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// MariaDB reports 0 affected rows when nothing changed; double-check existence.
		var c int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM activities WHERE id = ? AND user_id = ?`, id, userID).Scan(&c); err != nil {
			return err
		}
		if c == 0 {
			return ErrNotFound
		}
	}
	return nil
}

// DeleteActivities removes the given activities of a user; with no ids it
// removes all of them. It returns how many were deleted.
func (s *Store) DeleteActivities(ctx context.Context, userID string, ids []string) (int64, error) {
	if len(ids) == 0 {
		res, err := s.db.ExecContext(ctx, `DELETE FROM activities WHERE user_id = ?`, userID)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var total int64
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, `DELETE FROM activities WHERE id = ? AND user_id = ?`, id, userID)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		total += n
	}
	return total, tx.Commit()
}
