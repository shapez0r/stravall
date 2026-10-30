package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"

	"eurofish/internal/auth"
	"eurofish/internal/finance"
	"eurofish/internal/store"
)

const (
	maxAmount      = int64(1_000_000_000_000) // 10 billion in cents
	maxLedgerDays  = 400
	ledgerCacheTTL = 10 * time.Minute
)

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

// ---------- helpers ----------

func (s *Server) calendarFor(c *fiber.Ctx, roles ...string) (*store.Calendar, error) {
	cal, err := s.store.CalendarForUser(c.UserContext(), c.Params("id"), currentUser(c).ID)
	if err != nil {
		return nil, err
	}
	if len(roles) == 0 {
		return cal, nil
	}
	for _, r := range roles {
		if cal.Role == r {
			return cal, nil
		}
	}
	return nil, fiber.NewError(fiber.StatusForbidden, "you do not have permission for this action")
}

func validDate(field, v string) error {
	if _, err := finance.ParseDate(v); err != nil {
		return badRequest(field + " must be a date in YYYY-MM-DD format")
	}
	return nil
}

func validAmount(field string, v int64) error {
	if v > maxAmount || v < -maxAmount {
		return badRequest(field + " is out of range")
	}
	return nil
}

func validText(field, v string, min, max int) error {
	n := utf8.RuneCountInString(v)
	if n < min || n > max {
		if min > 0 {
			return badRequest(fmt.Sprintf("%s must be %d-%d characters", field, min, max))
		}
		return badRequest(fmt.Sprintf("%s must be at most %d characters", field, max))
	}
	return nil
}

// ---------- calendars ----------

type calendarInput struct {
	Name         *string `json:"name"`
	Currency     *string `json:"currency"`
	StartDate    *string `json:"start_date"`
	StartBalance *int64  `json:"start_balance"`
}

func (in calendarInput) apply(cal *store.Calendar) error {
	if in.Name != nil {
		cal.Name = strings.TrimSpace(*in.Name)
	}
	if in.Currency != nil {
		cal.Currency = strings.ToUpper(strings.TrimSpace(*in.Currency))
	}
	if in.StartDate != nil {
		cal.StartDate = strings.TrimSpace(*in.StartDate)
	}
	if in.StartBalance != nil {
		cal.StartBalance = *in.StartBalance
	}
	if err := validText("name", cal.Name, 1, 100); err != nil {
		return err
	}
	if !currencyRe.MatchString(cal.Currency) {
		return badRequest("currency must be a 3-letter ISO code such as EUR")
	}
	if err := validDate("start_date", cal.StartDate); err != nil {
		return err
	}
	return validAmount("start_balance", cal.StartBalance)
}

func (s *Server) listCalendars(c *fiber.Ctx) error {
	cals, err := s.store.ListCalendars(c.UserContext(), currentUser(c).ID)
	if err != nil {
		return err
	}
	return c.JSON(cals)
}

func (s *Server) createCalendar(c *fiber.Ctx) error {
	var in calendarInput
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	now := time.Now()
	cal := &store.Calendar{
		ID:        auth.NewID(),
		Currency:  "EUR",
		StartDate: now.UTC().Format(finance.DateLayout),
		OwnerID:   currentUser(c).ID,
		OwnerName: currentUser(c).DisplayName,
		CreatedAt: now.Unix(),
	}
	if err := in.apply(cal); err != nil {
		return err
	}
	if err := s.store.CreateCalendar(c.UserContext(), cal); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(cal)
}

func (s *Server) getCalendar(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	return c.JSON(cal)
}

func (s *Server) updateCalendar(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	var in calendarInput
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := in.apply(cal); err != nil {
		return err
	}
	if err := s.store.UpdateCalendar(c.UserContext(), cal); err != nil {
		return err
	}
	cal.Version++
	return c.JSON(cal)
}

func (s *Server) deleteCalendar(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner)
	if err != nil {
		return err
	}
	if err := s.store.DeleteCalendar(c.UserContext(), cal.ID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ---------- sharing ----------

func (s *Server) listMembers(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	members, err := s.store.ListMembers(c.UserContext(), cal.ID)
	if err != nil {
		return err
	}
	return c.JSON(members)
}

func validRole(role string) error {
	if role != store.RoleEditor && role != store.RoleViewer {
		return badRequest("role must be editor or viewer")
	}
	return nil
}

// addMember shares the calendar with someone by e-mail. If nobody has an
// account with that address yet, a pending invite is stored and the calendar
// appears for them as soon as they sign up with it.
func (s *Server) addMember(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner)
	if err != nil {
		return err
	}
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := validRole(in.Role); err != nil {
		return err
	}
	email, err := normalizeEmail(in.Email)
	if err != nil {
		return err
	}
	u, err := s.store.UserByEmail(c.UserContext(), email)
	if errors.Is(err, store.ErrNotFound) {
		inv, err := s.store.SetInvite(c.UserContext(), cal.ID, email, in.Role, currentUser(c).ID)
		if err != nil {
			return err
		}
		return c.Status(fiber.StatusAccepted).JSON(inv)
	}
	if err != nil {
		return err
	}
	if u.ID == currentUser(c).ID {
		return badRequest("you already own this calendar")
	}
	if err := s.store.AddMember(c.UserContext(), cal.ID, u.ID, in.Role); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return fiber.NewError(fiber.StatusConflict, "this person already has access")
		}
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(store.Member{UserID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Role: in.Role})
}

// updateMember changes what a member may do (owner only).
func (s *Server) updateMember(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner)
	if err != nil {
		return err
	}
	var in struct {
		Role string `json:"role"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := validRole(in.Role); err != nil {
		return err
	}
	if err := s.store.UpdateMemberRole(c.UserContext(), cal.ID, c.Params("userId"), in.Role); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return fiber.NewError(fiber.StatusBadRequest, "member not found (the owner's access cannot be changed)")
		}
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) listInvites(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	list, err := s.store.ListInvites(c.UserContext(), cal.ID)
	if err != nil {
		return err
	}
	return c.JSON(list)
}

func (s *Server) deleteInvite(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner)
	if err != nil {
		return err
	}
	email, err := url.PathUnescape(c.Params("email"))
	if err != nil {
		return badRequest("invalid e-mail address")
	}
	if err := s.store.DeleteInvite(c.UserContext(), cal.ID, strings.ToLower(strings.TrimSpace(email))); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) removeMember(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	target := c.Params("userId")
	// Owners may remove anyone else; members may remove themselves (leave).
	if cal.Role != store.RoleOwner && target != currentUser(c).ID {
		return fiber.NewError(fiber.StatusForbidden, "only the owner can remove other people")
	}
	if err := s.store.RemoveMember(c.UserContext(), cal.ID, target); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return fiber.NewError(fiber.StatusBadRequest, "member not found (the owner cannot be removed)")
		}
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ---------- events ----------

type eventInput struct {
	Title      string `json:"title"`
	Amount     int64  `json:"amount"`
	Category   string `json:"category"`
	Note       string `json:"note"`
	StartDate  string `json:"start_date"`
	Recurrence string `json:"recurrence"`
	// Interval is X for "repeat every X weeks" (recurrence "weeks").
	Interval   int    `json:"interval"`
	UntilDate  string `json:"until_date"`
}

func (in *eventInput) validate() error {
	in.Title = strings.TrimSpace(in.Title)
	in.Category = strings.TrimSpace(in.Category)
	in.Note = strings.TrimSpace(in.Note)
	in.StartDate = strings.TrimSpace(in.StartDate)
	in.UntilDate = strings.TrimSpace(in.UntilDate)
	if in.Recurrence == "" {
		in.Recurrence = finance.None
	}
	if err := validText("title", in.Title, 1, 200); err != nil {
		return err
	}
	if err := validText("category", in.Category, 0, 64); err != nil {
		return err
	}
	if err := validText("note", in.Note, 0, 2000); err != nil {
		return err
	}
	if in.Amount == 0 {
		return badRequest("amount must not be zero")
	}
	if err := validAmount("amount", in.Amount); err != nil {
		return err
	}
	if err := validDate("start_date", in.StartDate); err != nil {
		return err
	}
	if !finance.ValidRecurrence(in.Recurrence) {
		return badRequest("recurrence must be one of none, daily, weekly, biweekly, weeks, monthly, monthly_day, monthly_nth, quarterly, yearly")
	}
	if in.Recurrence == finance.EveryNWeeks {
		if in.Interval < 1 || in.Interval > finance.MaxWeeksInterval {
			return badRequest(fmt.Sprintf("interval (repeat every X weeks) must be a whole number from 1 to %d", finance.MaxWeeksInterval))
		}
	} else {
		in.Interval = 1
	}
	if in.Recurrence == finance.None {
		in.UntilDate = ""
	}
	if in.UntilDate != "" {
		if err := validDate("until_date", in.UntilDate); err != nil {
			return err
		}
		if in.UntilDate < in.StartDate {
			return badRequest("until_date must not be before start_date")
		}
	}
	return nil
}

func (s *Server) listEvents(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	events, err := s.store.ListEvents(c.UserContext(), cal.ID)
	if err != nil {
		return err
	}
	return c.JSON(events)
}

func (s *Server) createEvent(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	var in eventInput
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := in.validate(); err != nil {
		return err
	}
	now := time.Now().Unix()
	e := &store.Event{
		ID: auth.NewID(), CalendarID: cal.ID, Title: in.Title, Amount: in.Amount, Category: in.Category,
		Note: in.Note, StartDate: in.StartDate, Recurrence: in.Recurrence, Interval: in.Interval, UntilDate: in.UntilDate,
		CreatedBy: currentUser(c).ID, CreatedAt: now, UpdatedAt: now, Skips: []string{},
	}
	if err := s.store.CreateEvent(c.UserContext(), e); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(e)
}

func (s *Server) updateEvent(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	var in eventInput
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := in.validate(); err != nil {
		return err
	}
	e := &store.Event{
		ID: c.Params("eventId"), CalendarID: cal.ID, Title: in.Title, Amount: in.Amount, Category: in.Category,
		Note: in.Note, StartDate: in.StartDate, Recurrence: in.Recurrence, Interval: in.Interval, UntilDate: in.UntilDate,
		UpdatedAt: time.Now().Unix(),
	}
	if err := s.store.UpdateEvent(c.UserContext(), e); err != nil {
		return err
	}
	return c.JSON(e)
}

func (s *Server) deleteEvent(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	if err := s.store.DeleteEvent(c.UserContext(), cal.ID, c.Params("eventId")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Server) skipOccurrence(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	var in struct {
		Date string `json:"date"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := validDate("date", in.Date); err != nil {
		return err
	}
	if err := s.store.SkipOccurrence(c.UserContext(), cal.ID, c.Params("eventId"), in.Date); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// updateOccurrence changes only one occurrence of a repeating transaction:
// that day is removed from the series and a one-off transaction with the new
// values is created instead (on start_date, usually the same day). The rest
// of the series is left unchanged.
func (s *Server) updateOccurrence(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	var in struct {
		eventInput
		Date string `json:"date"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if err := validDate("date", in.Date); err != nil {
		return err
	}
	ev := in.eventInput
	if strings.TrimSpace(ev.StartDate) == "" {
		ev.StartDate = in.Date
	}
	// A single occurrence never repeats.
	ev.Recurrence = finance.None
	ev.UntilDate = ""
	if err := ev.validate(); err != nil {
		return err
	}
	now := time.Now().Unix()
	e := &store.Event{
		ID: auth.NewID(), CalendarID: cal.ID, Title: ev.Title, Amount: ev.Amount, Category: ev.Category,
		Note: ev.Note, StartDate: ev.StartDate, Recurrence: ev.Recurrence, Interval: ev.Interval,
		CreatedBy: currentUser(c).ID, CreatedAt: now, UpdatedAt: now, Skips: []string{},
	}
	if err := s.store.DetachOccurrence(c.UserContext(), cal.ID, c.Params("eventId"), in.Date, e); err != nil {
		if errors.Is(err, store.ErrNotOccurrence) {
			return badRequest("this day is not an occurrence of the repeating transaction")
		}
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(e)
}

// ---------- balance overrides ----------

func (s *Server) listBalances(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	list, err := s.store.ListBalanceOverrides(c.UserContext(), cal.ID)
	if err != nil {
		return err
	}
	return c.JSON(list)
}

// setBalance sets the end-of-day balance of one day; later days continue from it.
func (s *Server) setBalance(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	date := c.Params("date")
	if err := validDate("date", date); err != nil {
		return err
	}
	var in struct {
		Balance *int64 `json:"balance"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if in.Balance == nil {
		return badRequest("balance is required")
	}
	if err := validAmount("balance", *in.Balance); err != nil {
		return err
	}
	if err := s.store.SetBalanceOverride(c.UserContext(), cal.ID, date, *in.Balance, currentUser(c).ID); err != nil {
		return err
	}
	return c.JSON(store.BalanceOverride{Date: date, Balance: *in.Balance})
}

func (s *Server) deleteBalance(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c, store.RoleOwner, store.RoleEditor)
	if err != nil {
		return err
	}
	date := c.Params("date")
	if err := validDate("date", date); err != nil {
		return err
	}
	if err := s.store.DeleteBalanceOverride(c.UserContext(), cal.ID, date); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ---------- ledger (calendar view with running balance) ----------

func (s *Server) ledger(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	from, err := finance.ParseDate(c.Query("from"))
	if err != nil {
		return badRequest("from must be a date in YYYY-MM-DD format")
	}
	to, err := finance.ParseDate(c.Query("to"))
	if err != nil {
		return badRequest("to must be a date in YYYY-MM-DD format")
	}
	if to.Before(from) || to.Sub(from).Hours()/24 > maxLedgerDays {
		return badRequest(fmt.Sprintf("the range must be between 1 and %d days", maxLedgerDays))
	}

	// The calendar version changes on every write, so cached ledgers never go stale.
	key := fmt.Sprintf("ledger:%s:v%d:%s:%s:%s", cal.ID, cal.Version, cal.Role, c.Query("from"), c.Query("to"))
	ctx := c.UserContext()
	if raw, ok, err := s.cache.Get(ctx, key); err == nil && ok {
		c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
		c.Set("X-Cache", "hit")
		return c.Send(raw)
	}

	events, err := s.store.ListEvents(ctx, cal.ID)
	if err != nil {
		return err
	}
	calStart, err := finance.ParseDate(cal.StartDate)
	if err != nil {
		return err
	}
	series := make([]finance.Series, 0, len(events))
	for _, e := range events {
		start, err := finance.ParseDate(e.StartDate)
		if err != nil {
			continue
		}
		var until time.Time
		if e.UntilDate != "" {
			if until, err = finance.ParseDate(e.UntilDate); err != nil {
				continue
			}
		}
		skips := make(map[string]bool, len(e.Skips))
		for _, d := range e.Skips {
			skips[d] = true
		}
		series = append(series, finance.Series{
			ID: e.ID, Title: e.Title, Category: e.Category, Amount: e.Amount,
			Start: start, Until: until, Recurrence: e.Recurrence, Interval: e.Interval, Skips: skips,
		})
	}

	balances, err := s.store.ListBalanceOverrides(ctx, cal.ID)
	if err != nil {
		return err
	}
	overrides := make(map[string]int64, len(balances))
	for _, b := range balances {
		overrides[b.Date] = b.Balance
	}

	result := struct {
		Calendar *store.Calendar `json:"calendar"`
		finance.Ledger
	}{Calendar: cal, Ledger: finance.BuildLedgerWithOverrides(calStart, cal.StartBalance, series, from, to, overrides)}

	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_ = s.cache.Set(ctx, key, raw, ledgerCacheTTL)
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	c.Set("X-Cache", "miss")
	return c.Send(raw)
}
