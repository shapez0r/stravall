// Package track parses activity files exported from Strava (GPX, TCX, FIT,
// CSV, generic XML and whole export archives) and computes route statistics.
// It is pure (no I/O besides the bytes it is given) and unit-testable.
package track

import (
	"strings"
	"time"
	"unicode"
)

// Point is one recorded sample. Optional values carry a Has* flag (or are
// zero when absent, for heart rate, cadence and power).
type Point struct {
	Lat, Lon float64
	HasPos   bool
	Ele      float64
	HasEle   bool
	Time     time.Time // zero = unknown
	HR       float64   // bpm, 0 = none
	Cad      float64   // rpm / spm, 0 = none
	Power    float64   // watts, 0 = none
	Dist     float64   // cumulative distance from the device (metres)
	HasDist  bool
	Speed    float64 // device speed (m/s)
	HasSpeed bool
	Temp     float64 // °C
	HasTemp  bool
}

// Totals are summary values reported by the file itself (FIT session, TCX
// laps, Strava's activities.csv). A value > 0 wins over the computed one.
type Totals struct {
	Distance float64 // metres
	Elapsed  float64 // seconds
	Moving   float64 // seconds
	Ascent   float64 // metres
	Descent  float64 // metres
	Calories float64
	MaxSpeed float64 // m/s
	AvgHR    float64
	MaxHR    float64
}

// Activity is one parsed activity.
type Activity struct {
	Name        string
	Sport       string
	Description string
	Format      string // gpx, tcx, fit, csv, xml
	FileName    string
	Start       time.Time
	Points      []Point
	Totals      Totals
	// SourceKey identifies the activity for de-duplication: the SHA-256 of
	// the file bytes, or "csv:<activity id>" for a row of activities.csv.
	SourceKey string
	// linkedFile is the export-relative file name given in activities.csv.
	linkedFile string
}

// LatLon is a coordinate pair.
type LatLon struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Bounds is a bounding box.
type Bounds struct {
	MinLat float64 `json:"min_lat"`
	MinLon float64 `json:"min_lon"`
	MaxLat float64 `json:"max_lat"`
	MaxLon float64 `json:"max_lon"`
}

// Stats is the compact per-activity summary that is listed for every activity
// and aggregated by the UI into combined statistics.
type Stats struct {
	StartTime  string  `json:"start_time,omitempty"` // RFC 3339, UTC
	EndTime    string  `json:"end_time,omitempty"`
	DistanceM  float64 `json:"distance_m"`
	ElapsedS   float64 `json:"elapsed_s"`
	MovingS    float64 `json:"moving_s"`
	AvgSpeed   float64 `json:"avg_speed"` // m/s over moving time
	MaxSpeed   float64 `json:"max_speed"` // m/s
	AscentM    float64 `json:"ascent_m"`
	DescentM   float64 `json:"descent_m"`
	MinEle     float64 `json:"min_ele"`
	MaxEle     float64 `json:"max_ele"`
	HasEle     bool    `json:"has_ele"`
	AvgHR      float64 `json:"avg_hr"`
	MaxHR      float64 `json:"max_hr"`
	AvgCadence float64 `json:"avg_cadence"`
	MaxCadence float64 `json:"max_cadence"`
	AvgPower   float64 `json:"avg_power"`
	MaxPower   float64 `json:"max_power"`
	AvgTemp    float64 `json:"avg_temp"`
	HasTemp    bool    `json:"has_temp"`
	Calories   float64 `json:"calories"`
	Points     int     `json:"points"`
	HasTrack   bool    `json:"has_track"`
	Start      *LatLon `json:"start,omitempty"`
	End        *LatLon `json:"end,omitempty"`
	Bounds     *Bounds `json:"bounds,omitempty"`
}

// Split is one kilometre (or mile) of an activity.
type Split struct {
	Index     int     `json:"index"`
	DistanceM float64 `json:"distance_m"`
	TimeS     float64 `json:"time_s"`
	EleDiff   float64 `json:"ele_diff"`
	AvgHR     float64 `json:"avg_hr"`
}

// Detail holds the larger per-activity data shown for a single activity.
type Detail struct {
	SplitsKm []Split      `json:"splits_km"`
	SplitsMi []Split      `json:"splits_mi"`
	Profile  [][2]float64 `json:"profile"` // [distance m, elevation m]
}

// NormalizeSport maps the sport names and codes used by the different file
// formats onto Strava-like names ("Run", "Ride", ...).
func NormalizeSport(s string) string {
	raw := strings.TrimSpace(s)
	k := strings.ToLower(raw)
	k = strings.NewReplacer("_", " ", "-", " ").Replace(k)
	switch k {
	case "", "generic", "0", "other", "unknown":
		return ""
	case "run", "running", "9", "trail run", "trail running", "treadmill", "street running", "track running", "virtual run", "virtual running":
		if strings.Contains(k, "trail") {
			return "Trail Run"
		}
		if strings.Contains(k, "virtual") || k == "treadmill" {
			return "Virtual Run"
		}
		return "Run"
	case "ride", "cycling", "biking", "bike", "1", "road biking", "road cycling", "mountain biking", "mountain bike ride", "gravel ride", "gravel cycling", "virtual ride", "indoor cycling", "e bike ride", "e biking", "ebikeride", "e bike":
		switch {
		case strings.Contains(k, "mountain"):
			return "Mountain Bike Ride"
		case strings.Contains(k, "gravel"):
			return "Gravel Ride"
		case strings.Contains(k, "virtual"), strings.Contains(k, "indoor"):
			return "Virtual Ride"
		case strings.HasPrefix(k, "e "), strings.HasPrefix(k, "ebike"):
			return "E-Bike Ride"
		}
		return "Ride"
	case "walk", "walking", "10":
		return "Walk"
	case "hike", "hiking", "4", "mountaineering":
		return "Hike"
	case "swim", "swimming", "16", "open water swimming", "lap swimming":
		return "Swim"
	case "rowing", "row", "15":
		return "Rowing"
	case "alpine skiing", "alpine ski", "downhill skiing", "13":
		return "Alpine Ski"
	case "cross country skiing", "nordic ski", "nordic skiing", "12":
		return "Nordic Ski"
	case "snowboarding", "snowboard", "14":
		return "Snowboard"
	case "inline skating", "inline skate", "30":
		return "Inline Skate"
	case "kayaking", "kayak", "41":
		return "Kayaking"
	case "paddling", "stand up paddleboarding", "stand up paddling", "37", "19":
		return "Stand Up Paddling"
	case "snowshoeing", "snowshoe", "35":
		return "Snowshoe"
	case "rock climbing", "31":
		return "Rock Climbing"
	case "training", "workout", "fitness equipment", "strength training", "weight training":
		return "Workout"
	}
	// Keep unknown names, nicely capitalised ("ice skating" -> "Ice Skating").
	words := strings.Fields(k)
	for i, w := range words {
		r := []rune(w)
		r[0] = unicode.ToUpper(r[0])
		words[i] = string(r)
	}
	out := []rune(strings.Join(words, " "))
	if len(out) > 64 {
		out = out[:64]
	}
	return string(out)
}

// fitSports maps the FIT "sport" enum onto names understood by NormalizeSport.
var fitSports = map[int]string{
	0: "", 1: "running", 2: "cycling", 4: "fitness equipment", 5: "swimming",
	10: "training", 11: "walking", 12: "cross country skiing", 13: "alpine skiing",
	14: "snowboarding", 15: "rowing", 16: "mountaineering", 17: "hiking", 18: "multisport",
	19: "paddling", 21: "e biking", 30: "inline skating", 31: "rock climbing",
	33: "ice skating", 35: "snowshoeing", 37: "stand up paddleboarding", 41: "kayaking",
}

// fitSubSports refines cycling/running with the FIT "sub_sport" enum.
var fitSubSports = map[int]string{
	1: "treadmill", 3: "trail running", 6: "indoor cycling", 7: "road cycling",
	8: "mountain biking", 46: "gravel cycling", 58: "virtual ride",
}
