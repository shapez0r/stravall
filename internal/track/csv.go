package track

import (
	"bytes"
	"encoding/csv"
	"errors"
	"io"
	"strings"
)

// parseCSV understands two kinds of CSV files:
//   - Strava's activities.csv (one summary row per activity, no GPS track);
//   - track point tables with lat/lon columns (plus optional time, elevation,
//     heart rate, cadence, power), which become one activity.
func parseCSV(data []byte) ([]*Activity, error) {
	data = trimBOM(data)
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	first := data
	if i := bytes.IndexByte(data, '\n'); i >= 0 {
		first = data[:i]
	}
	switch c := bytes.Count(first, []byte(",")); {
	case bytes.Count(first, []byte(";")) > c:
		r.Comma = ';'
	case bytes.Count(first, []byte("\t")) > c:
		r.Comma = '\t'
	}
	header, err := r.Read()
	if err != nil {
		return nil, errors.New("the CSV file is empty")
	}
	cols := map[string][]int{}
	for i, h := range header {
		k := normHeader(h)
		cols[k] = append(cols[k], i)
	}
	t := csvTable{cols: cols}
	switch {
	case t.has("lat", "latitude", "position lat") && t.has("lon", "lng", "long", "longitude", "position long"):
		return parseTrackCSV(r, t)
	case t.has("activity id") && t.has("activity date"):
		return parseStravaCSV(r, t)
	}
	return nil, errors.New("unrecognised CSV (expected Strava's activities.csv or a table with lat/lon columns)")
}

func normHeader(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	h = strings.NewReplacer("_", " ", "-", " ", "(", " ", ")", " ").Replace(h)
	return strings.Join(strings.Fields(h), " ")
}

type csvTable struct {
	cols map[string][]int
}

func (t csvTable) has(names ...string) bool {
	for _, n := range names {
		if len(t.cols[n]) > 0 {
			return true
		}
	}
	return false
}

// get returns the value of the first matching column; with last set it uses
// the last column of that name (Strava repeats some headers with other units).
func (t csvTable) get(row []string, last bool, names ...string) string {
	for _, n := range names {
		idx := t.cols[n]
		if len(idx) == 0 {
			continue
		}
		i := idx[0]
		if last {
			i = idx[len(idx)-1]
		}
		if i < len(row) {
			return strings.TrimSpace(row[i])
		}
	}
	return ""
}

func (t csvTable) num(row []string, last bool, names ...string) float64 {
	v, _ := parseNum(strings.ReplaceAll(t.get(row, last, names...), ",", ""))
	return v
}

func parseTrackCSV(r *csv.Reader, t csvTable) ([]*Activity, error) {
	a := &Activity{Format: "csv"}
	positions := 0
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if a.Name == "" {
			a.Name = t.get(row, false, "name", "activity name", "activity", "title")
		}
		if a.Sport == "" {
			a.Sport = NormalizeSport(t.get(row, false, "sport", "type", "activity type"))
		}
		var p Point
		lat, ok1 := parseNum(t.get(row, false, "lat", "latitude", "position lat"))
		lon, ok2 := parseNum(t.get(row, false, "lon", "lng", "long", "longitude", "position long"))
		if ok1 && ok2 && validLatLon(lat, lon) {
			p.Lat, p.Lon, p.HasPos = lat, lon, true
			positions++
		}
		if v, ok := parseNum(t.get(row, false, "ele", "elevation", "altitude", "alt", "elevation m", "altitude m")); ok {
			p.Ele, p.HasEle = v, true
		}
		if tm, ok := parseTime(t.get(row, false, "time", "timestamp", "datetime", "date time", "date")); ok {
			p.Time = tm
		}
		p.HR, _ = parseNum(t.get(row, false, "hr", "heart rate", "heartrate", "heart rate bpm", "bpm"))
		p.Cad, _ = parseNum(t.get(row, false, "cad", "cadence"))
		p.Power, _ = parseNum(t.get(row, false, "power", "watts"))
		if v, ok := parseNum(t.get(row, false, "temp", "temperature", "atemp")); ok {
			p.Temp, p.HasTemp = v, true
		}
		a.Points = append(a.Points, p)
	}
	if positions == 0 {
		return nil, errors.New("the CSV file has no valid lat/lon positions")
	}
	return []*Activity{a}, nil
}

// parseStravaCSV reads activities.csv from the Strava bulk export. Strava
// repeats some columns: the first "Distance" is in km, the second in metres;
// the later "Elapsed Time" / "Max Heart Rate" columns are the detailed ones.
func parseStravaCSV(r *csv.Reader, t csvTable) ([]*Activity, error) {
	var out []*Activity
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		id := t.get(row, false, "activity id")
		if id == "" {
			continue
		}
		a := &Activity{
			Format:      "csv",
			Name:        t.get(row, false, "activity name"),
			Sport:       NormalizeSport(t.get(row, false, "activity type")),
			Description: t.get(row, false, "activity description"),
			SourceKey:   "csv:" + id,
			linkedFile:  t.get(row, false, "filename"),
		}
		if tm, ok := parseTime(t.get(row, false, "activity date")); ok {
			a.Start = tm
		}
		if idx := t.cols["distance"]; len(idx) >= 2 {
			a.Totals.Distance = t.num(row, true, "distance")
		} else {
			a.Totals.Distance = t.num(row, false, "distance") * 1000
		}
		a.Totals.Elapsed = t.num(row, true, "elapsed time")
		a.Totals.Moving = t.num(row, true, "moving time")
		a.Totals.MaxSpeed = t.num(row, true, "max speed")
		a.Totals.Ascent = t.num(row, true, "elevation gain")
		a.Totals.Descent = t.num(row, true, "elevation loss")
		a.Totals.Calories = t.num(row, true, "calories")
		a.Totals.MaxHR = t.num(row, true, "max heart rate")
		a.Totals.AvgHR = t.num(row, true, "average heart rate")
		out = append(out, a)
	}
	if len(out) == 0 {
		return nil, errors.New("the CSV file has no activities")
	}
	return out, nil
}
