package server

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"eurofish/internal/store"
)

// exportFormat identifies eurofish calendar export files.
const (
	exportFormat  = "eurofish-calendar"
	exportVersion = 1
)

type exportCalendarInfo struct {
	Name         string `json:"name"`
	Currency     string `json:"currency"`
	StartDate    string `json:"start_date"`
	StartBalance int64  `json:"start_balance"`
	Owner        string `json:"owner"`
}

type exportEvent struct {
	Title      string   `json:"title"`
	Amount     int64    `json:"amount"`
	Category   string   `json:"category"`
	Note       string   `json:"note"`
	StartDate  string   `json:"start_date"`
	Recurrence string   `json:"recurrence"`
	Interval   int      `json:"interval,omitempty"` // X for "repeat every X weeks"
	UntilDate  string   `json:"until_date,omitempty"`
	Skips      []string `json:"skips"`
}

type calendarExport struct {
	Format     string                  `json:"format"`
	Version    int                     `json:"version"`
	ExportedAt string                  `json:"exported_at"`
	AmountUnit string                  `json:"amount_unit"`
	Calendar   exportCalendarInfo      `json:"calendar"`
	Events     []exportEvent           `json:"events"`
	Balances   []store.BalanceOverride `json:"balances"`
}

// exportCalendar returns a self-contained JSON snapshot of a calendar (settings,
// all transactions with their repeats and removed days, and manually set
// balances). Any member may export. Member e-mail addresses are not included.
func (s *Server) exportCalendar(c *fiber.Ctx) error {
	cal, err := s.calendarFor(c)
	if err != nil {
		return err
	}
	ctx := c.UserContext()
	events, err := s.store.ListEvents(ctx, cal.ID)
	if err != nil {
		return err
	}
	balances, err := s.store.ListBalanceOverrides(ctx, cal.ID)
	if err != nil {
		return err
	}
	out := calendarExport{
		Format:     exportFormat,
		Version:    exportVersion,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		AmountUnit: "cents",
		Calendar: exportCalendarInfo{
			Name: cal.Name, Currency: cal.Currency, StartDate: cal.StartDate,
			StartBalance: cal.StartBalance, Owner: cal.OwnerName,
		},
		Events:   make([]exportEvent, 0, len(events)),
		Balances: balances,
	}
	for _, e := range events {
		skips := e.Skips
		if skips == nil {
			skips = []string{}
		}
		out.Events = append(out.Events, exportEvent{
			Title: e.Title, Amount: e.Amount, Category: e.Category, Note: e.Note,
			StartDate: e.StartDate, Recurrence: e.Recurrence, Interval: e.Interval, UntilDate: e.UntilDate, Skips: skips,
		})
	}
	return c.JSON(out)
}
