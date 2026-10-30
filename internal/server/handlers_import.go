package server

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/gofiber/fiber/v2"

	"eurofish/internal/auth"
	"eurofish/internal/store"
)

// Limits for a single import (protect the server from huge or hostile files).
const (
	maxImportEvents   = 10_000
	maxImportSkips    = 5_000 // per transaction
	maxImportBalances = 10_000
)

// importError prefixes a validation error with where in the file it occurred.
func importError(where string, err error) error {
	var fe *fiber.Error
	if errors.As(err, &fe) {
		return badRequest(where + ": " + fe.Message)
	}
	return err
}

// importCalendar creates a new calendar, owned by the current user, from a
// JSON file produced by exportCalendar (settings, all transactions with their
// repeats and removed days, and manually set balances).
func (s *Server) importCalendar(c *fiber.Ctx) error {
	var in calendarExport
	if err := c.BodyParser(&in); err != nil {
		return badRequest("the file is not a valid eurofish calendar export (invalid JSON)")
	}
	if in.Format != exportFormat {
		return badRequest("the file is not a eurofish calendar export")
	}
	if in.Version < 1 || in.Version > exportVersion {
		return badRequest(fmt.Sprintf("unsupported export version %d", in.Version))
	}
	if in.AmountUnit != "" && in.AmountUnit != "cents" {
		return badRequest(fmt.Sprintf("unsupported amount unit %q", in.AmountUnit))
	}
	if len(in.Events) > maxImportEvents {
		return badRequest(fmt.Sprintf("too many transactions (max %d)", maxImportEvents))
	}
	if len(in.Balances) > maxImportBalances {
		return badRequest(fmt.Sprintf("too many set balances (max %d)", maxImportBalances))
	}

	user := currentUser(c)
	now := time.Now().Unix()

	cal := &store.Calendar{
		ID:        auth.NewID(),
		OwnerID:   user.ID,
		OwnerName: user.DisplayName,
		CreatedAt: now,
	}
	info := in.Calendar
	if err := (calendarInput{
		Name: &info.Name, Currency: &info.Currency, StartDate: &info.StartDate, StartBalance: &info.StartBalance,
	}).apply(cal); err != nil {
		return importError("calendar", err)
	}

	events := make([]store.Event, 0, len(in.Events))
	for i, e := range in.Events {
		where := fmt.Sprintf("transaction %d", i+1)
		ev := eventInput{
			Title: e.Title, Amount: e.Amount, Category: e.Category, Note: e.Note,
			StartDate: e.StartDate, Recurrence: e.Recurrence, Interval: e.Interval, UntilDate: e.UntilDate,
		}
		if err := ev.validate(); err != nil {
			return importError(where, err)
		}
		if len(e.Skips) > maxImportSkips {
			return badRequest(fmt.Sprintf("%s: too many removed days (max %d)", where, maxImportSkips))
		}
		seen := make(map[string]bool, len(e.Skips))
		skips := make([]string, 0, len(e.Skips))
		for _, d := range e.Skips {
			if err := validDate("removed day", d); err != nil {
				return importError(where, err)
			}
			if !seen[d] {
				seen[d] = true
				skips = append(skips, d)
			}
		}
		sort.Strings(skips)
		events = append(events, store.Event{
			ID: auth.NewID(), CalendarID: cal.ID, Title: ev.Title, Amount: ev.Amount, Category: ev.Category,
			Note: ev.Note, StartDate: ev.StartDate, Recurrence: ev.Recurrence, Interval: ev.Interval, UntilDate: ev.UntilDate,
			CreatedBy: user.ID, CreatedAt: now, UpdatedAt: now, Skips: skips,
		})
	}

	// One balance per day; if a file lists a day twice the last entry wins.
	byDate := make(map[string]int64, len(in.Balances))
	for i, b := range in.Balances {
		where := fmt.Sprintf("set balance %d", i+1)
		if err := validDate("date", b.Date); err != nil {
			return importError(where, err)
		}
		if err := validAmount("balance", b.Balance); err != nil {
			return importError(where, err)
		}
		byDate[b.Date] = b.Balance
	}
	balances := make([]store.BalanceOverride, 0, len(byDate))
	for d, v := range byDate {
		balances = append(balances, store.BalanceOverride{Date: d, Balance: v})
	}
	sort.Slice(balances, func(i, j int) bool { return balances[i].Date < balances[j].Date })

	if err := s.store.ImportCalendar(c.UserContext(), cal, events, balances); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"calendar": cal,
		"events":   len(events),
		"balances": len(balances),
	})
}
