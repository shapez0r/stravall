package finance

import (
	"testing"
	"time"
)

func d(s string) time.Time {
	t, err := ParseDate(s)
	if err != nil {
		panic(err)
	}
	return t
}

func dates(ts []time.Time) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.Format(DateLayout)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestMonthlyClampsToMonthEnd(t *testing.T) {
	got := dates(Occurrences(d("2026-01-31"), time.Time{}, Monthly, d("2026-01-01"), d("2026-04-30")))
	want := []string{"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestWeeklyWindowAndUntil(t *testing.T) {
	got := dates(Occurrences(d("2026-01-01"), d("2026-02-05"), Weekly, d("2026-01-20"), d("2026-03-01")))
	want := []string{"2026-01-22", "2026-01-29", "2026-02-05"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestOneOffOutsideRange(t *testing.T) {
	if got := Occurrences(d("2026-05-01"), time.Time{}, None, d("2026-06-01"), d("2026-06-30")); len(got) != 0 {
		t.Fatalf("expected no occurrences, got %v", got)
	}
}

func TestLedgerRunningBalance(t *testing.T) {
	series := []Series{
		{ID: "salary", Title: "Salary", Amount: 300000, Start: d("2026-01-25"), Recurrence: Monthly},
		{ID: "rent", Title: "Rent", Amount: -120000, Start: d("2026-01-01"), Recurrence: Monthly,
			Skips: map[string]bool{"2026-03-01": true}},
	}
	l := BuildLedger(d("2026-01-01"), 10000, series, d("2026-03-01"), d("2026-03-31"))
	// Opening: 100.00 + Jan(-1200 +3000) + Feb(-1200 +3000) = 3700.00
	if l.Opening != 370000 {
		t.Fatalf("opening = %d", l.Opening)
	}
	// March rent skipped, salary on the 25th.
	if l.Closing != 670000 {
		t.Fatalf("closing = %d", l.Closing)
	}
	if len(l.Days) != 31 || l.Days[24].Balance != 670000 || l.Days[23].Balance != 370000 {
		t.Fatalf("unexpected day balances")
	}
}

func TestMonthlyExactDaySkipsShortMonths(t *testing.T) {
	got := dates(Occurrences(d("2026-01-31"), time.Time{}, MonthlyDay, d("2026-01-01"), d("2026-05-31")))
	want := []string{"2026-01-31", "2026-03-31", "2026-05-31"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	got = dates(Occurrences(d("2026-01-15"), d("2026-04-15"), MonthlyDay, d("2026-02-01"), d("2026-12-31")))
	want = []string{"2026-02-15", "2026-03-15", "2026-04-15"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestMonthlyFirstMonday(t *testing.T) {
	// 2026-01-05 is the first Monday of January 2026.
	got := dates(Occurrences(d("2026-01-05"), time.Time{}, MonthlyNth, d("2026-01-01"), d("2026-06-30")))
	want := []string{"2026-01-05", "2026-02-02", "2026-03-02", "2026-04-06", "2026-05-04", "2026-06-01"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	// Window starting later in the series.
	got = dates(Occurrences(d("2026-01-05"), time.Time{}, MonthlyNth, d("2026-05-10"), d("2026-07-31")))
	want = []string{"2026-06-01", "2026-07-06"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestMonthlyLastWeekday(t *testing.T) {
	// 2026-01-30 is the last (fifth) Friday of January 2026.
	got := dates(Occurrences(d("2026-01-30"), time.Time{}, MonthlyNth, d("2026-01-01"), d("2026-04-30")))
	want := []string{"2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestLedgerBalanceOverride(t *testing.T) {
	series := []Series{
		{ID: "coffee", Title: "Coffee", Amount: -500, Start: d("2026-01-01"), Recurrence: Daily},
	}
	overrides := map[string]int64{"2026-01-10": 100000}
	// Window containing the override.
	l := BuildLedgerWithOverrides(d("2026-01-01"), 50000, series, d("2026-01-01"), d("2026-01-15"), overrides)
	if l.Days[8].Balance != 50000-9*500 {
		t.Fatalf("day 9 balance = %d", l.Days[8].Balance)
	}
	if l.Days[9].Balance != 100000 || l.Days[9].Override == nil || *l.Days[9].Override != 100000 {
		t.Fatalf("override day balance = %d", l.Days[9].Balance)
	}
	if l.Days[9].Adjustment != 100000-(50000-10*500) {
		t.Fatalf("adjustment = %d", l.Days[9].Adjustment)
	}
	if l.Closing != 100000-5*500 {
		t.Fatalf("closing = %d", l.Closing)
	}
	// Window after the override: opening continues from the override.
	l = BuildLedgerWithOverrides(d("2026-01-01"), 50000, series, d("2026-01-12"), d("2026-01-15"), overrides)
	if l.Opening != 100000-500 {
		t.Fatalf("opening = %d", l.Opening)
	}
}

func TestLedgerOverrideBeforeCalendarStart(t *testing.T) {
	series := []Series{
		{ID: "coffee", Title: "Coffee", Amount: -500, Start: d("2026-01-01"), Recurrence: Daily},
	}
	overrides := map[string]int64{"2026-01-02": 20000}
	// Calendar starts on the 5th with 500.00; a balance was set on the 2nd.
	l := BuildLedgerWithOverrides(d("2026-01-05"), 50000, series, d("2026-01-01"), d("2026-01-06"), overrides)
	// Before the first known balance the day shows the opening of the 2nd.
	if l.Opening != 20500 || l.Days[0].Balance != 20500 {
		t.Fatalf("opening = %d, day 1 = %d", l.Opening, l.Days[0].Balance)
	}
	if l.Days[1].Balance != 20000 || l.Days[1].Override == nil || l.Days[1].Adjustment != 0 {
		t.Fatalf("override day = %+v", l.Days[1])
	}
	if l.Days[3].Balance != 20000-2*500 {
		t.Fatalf("day 4 balance = %d", l.Days[3].Balance)
	}
	// The starting balance applies again on the balance date.
	if l.Days[4].Balance != 50000-500 || l.Days[4].StartAdjustment != 50000-(20000-2*500) {
		t.Fatalf("start day = %+v", l.Days[4])
	}
	if l.Closing != 50000-2*500 {
		t.Fatalf("closing = %d", l.Closing)
	}
	// Windows starting between the override and the balance date.
	l = BuildLedgerWithOverrides(d("2026-01-05"), 50000, series, d("2026-01-04"), d("2026-01-05"), overrides)
	if l.Opening != 20000-500 || l.Days[0].Balance != 20000-1000 || l.Days[1].Balance != 49500 {
		t.Fatalf("opening = %d, days = %d %d", l.Opening, l.Days[0].Balance, l.Days[1].Balance)
	}
	// Windows after the balance date are unaffected by earlier overrides.
	l = BuildLedgerWithOverrides(d("2026-01-05"), 50000, series, d("2026-01-07"), d("2026-01-07"), overrides)
	if l.Opening != 50000-2*500 || l.Closing != 50000-3*500 {
		t.Fatalf("opening = %d closing = %d", l.Opening, l.Closing)
	}
}

func TestEveryNWeeks(t *testing.T) {
	got := dates(OccurrencesEvery(d("2026-01-01"), time.Time{}, EveryNWeeks, 3, d("2026-01-01"), d("2026-03-31")))
	want := []string{"2026-01-01", "2026-01-22", "2026-02-12", "2026-03-05", "2026-03-26"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	// Window starting later in the series, with an end date.
	got = dates(OccurrencesEvery(d("2026-01-01"), d("2026-03-05"), EveryNWeeks, 3, d("2026-02-01"), d("2026-12-31")))
	want = []string{"2026-02-12", "2026-03-05"}
	if !equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	// Ledger uses the series interval.
	series := []Series{{ID: "x", Title: "X", Amount: -100, Start: d("2026-01-01"), Recurrence: EveryNWeeks, Interval: 4}}
	l := BuildLedger(d("2026-01-01"), 1000, series, d("2026-01-01"), d("2026-02-28"))
	if l.Closing != 1000-3*100 {
		t.Fatalf("closing = %d", l.Closing)
	}
}
