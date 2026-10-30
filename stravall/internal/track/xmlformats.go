package track

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// newXMLDecoder is lenient: it ignores the declared character set (activity
// files are practically always UTF-8) and tolerates a BOM or blank lines
// before the XML declaration, which some Strava TCX files have.
func newXMLDecoder(data []byte) *xml.Decoder {
	data = bytes.TrimLeft(trimBOM(data), " \t\r\n")
	d := xml.NewDecoder(bytes.NewReader(data))
	d.Strict = false
	d.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) { return input, nil }
	return d
}

// xmlRoot returns the lower-case local name of the document element.
func xmlRoot(data []byte) string {
	d := newXMLDecoder(data)
	for {
		tok, err := d.Token()
		if err != nil {
			return ""
		}
		if se, ok := tok.(xml.StartElement); ok {
			return strings.ToLower(se.Name.Local)
		}
	}
}

func parseXML(data []byte) ([]*Activity, error) {
	switch root := xmlRoot(data); root {
	case "gpx":
		return parseGPX(data)
	case "trainingcenterdatabase":
		return parseTCX(data)
	case "":
		return nil, fmt.Errorf("the file is not valid XML")
	default:
		return nil, fmt.Errorf("unsupported XML document <%s> (expected GPX or TCX)", root)
	}
}

// ---------- GPX ----------

type gpxDoc struct {
	Metadata struct {
		Name string `xml:"name"`
		Time string `xml:"time"`
	} `xml:"metadata"`
	Time   string     `xml:"time"` // GPX 1.0
	Tracks []gpxTrack `xml:"trk"`
	Routes []gpxRoute `xml:"rte"`
}

type gpxTrack struct {
	Name     string       `xml:"name"`
	Desc     string       `xml:"desc"`
	Type     string       `xml:"type"`
	Segments []gpxSegment `xml:"trkseg"`
}

type gpxSegment struct {
	Points []gpxPoint `xml:"trkpt"`
}

type gpxRoute struct {
	Name   string     `xml:"name"`
	Type   string     `xml:"type"`
	Points []gpxPoint `xml:"rtept"`
}

type gpxPoint struct {
	Lat  string `xml:"lat,attr"`
	Lon  string `xml:"lon,attr"`
	Ele  string `xml:"ele"`
	Time string `xml:"time"`
	Ext  gpxExt `xml:"extensions"`
}

// gpxExt covers the Garmin TrackPointExtension (used by Strava) and the
// plain <power>, <hr> and <cadence> elements some apps write.
type gpxExt struct {
	HR      string `xml:"TrackPointExtension>hr"`
	Cad     string `xml:"TrackPointExtension>cad"`
	Temp    string `xml:"TrackPointExtension>atemp"`
	Power   string `xml:"power"`
	HR2     string `xml:"hr"`
	Cad2    string `xml:"cadence"`
	Speed   string `xml:"TrackPointExtension>speed"`
	Watts   string `xml:"TrackPointExtension>power"`
	Heart   string `xml:"heartrate"`
	AirTemp string `xml:"temp"`
}

func (gp gpxPoint) point() Point {
	var p Point
	lat, ok1 := parseNum(gp.Lat)
	lon, ok2 := parseNum(gp.Lon)
	if ok1 && ok2 && validLatLon(lat, lon) {
		p.Lat, p.Lon, p.HasPos = lat, lon, true
	}
	if v, ok := parseNum(gp.Ele); ok {
		p.Ele, p.HasEle = v, true
	}
	if t, ok := parseTime(gp.Time); ok {
		p.Time = t
	}
	x := gp.Ext
	p.HR = firstNum(x.HR, x.HR2, x.Heart)
	p.Cad = firstNum(x.Cad, x.Cad2)
	p.Power = firstNum(x.Power, x.Watts)
	if v, ok := parseNum(x.Speed); ok {
		p.Speed, p.HasSpeed = v, true
	}
	for _, s := range []string{x.Temp, x.AirTemp} {
		if v, ok := parseNum(s); ok {
			p.Temp, p.HasTemp = v, true
			break
		}
	}
	return p
}

func firstNum(vals ...string) float64 {
	for _, s := range vals {
		if v, ok := parseNum(s); ok && v > 0 {
			return v
		}
	}
	return 0
}

// parseGPX returns one activity per file: all tracks and segments are joined
// (a Strava GPX has exactly one track). Routes are used if there is no track.
func parseGPX(data []byte) ([]*Activity, error) {
	var doc gpxDoc
	if err := newXMLDecoder(data).Decode(&doc); err != nil {
		return nil, fmt.Errorf("invalid GPX: %w", err)
	}
	a := &Activity{Format: "gpx", Name: strings.TrimSpace(doc.Metadata.Name)}
	for _, trk := range doc.Tracks {
		if a.Name == "" || len(a.Points) == 0 && strings.TrimSpace(trk.Name) != "" {
			if n := strings.TrimSpace(trk.Name); n != "" {
				a.Name = n
			}
		}
		if a.Sport == "" {
			a.Sport = NormalizeSport(trk.Type)
		}
		if a.Description == "" {
			a.Description = strings.TrimSpace(trk.Desc)
		}
		for _, seg := range trk.Segments {
			for _, gp := range seg.Points {
				a.Points = append(a.Points, gp.point())
			}
		}
	}
	if len(a.Points) == 0 {
		for _, rte := range doc.Routes {
			if a.Name == "" {
				a.Name = strings.TrimSpace(rte.Name)
			}
			if a.Sport == "" {
				a.Sport = NormalizeSport(rte.Type)
			}
			for _, gp := range rte.Points {
				a.Points = append(a.Points, gp.point())
			}
		}
	}
	if len(a.Points) == 0 {
		return nil, fmt.Errorf("the GPX file has no track points")
	}
	if t, ok := parseTime(doc.Metadata.Time); ok {
		a.Start = t
	} else if t, ok := parseTime(doc.Time); ok {
		a.Start = t
	}
	for _, p := range a.Points {
		if !p.Time.IsZero() {
			a.Start = p.Time
			break
		}
	}
	return []*Activity{a}, nil
}

// ---------- TCX ----------

type tcxDoc struct {
	Activities []tcxActivity `xml:"Activities>Activity"`
	Courses    []tcxCourse   `xml:"Courses>Course"`
}

type tcxActivity struct {
	Sport string   `xml:"Sport,attr"`
	ID    string   `xml:"Id"`
	Notes string   `xml:"Notes"`
	Laps  []tcxLap `xml:"Lap"`
}

type tcxLap struct {
	StartTime string     `xml:"StartTime,attr"`
	Distance  string     `xml:"DistanceMeters"`
	Calories  string     `xml:"Calories"`
	MaxSpeed  string     `xml:"MaximumSpeed"`
	Tracks    []tcxTrack `xml:"Track"`
}

type tcxTrack struct {
	Points []tcxPoint `xml:"Trackpoint"`
}

type tcxCourse struct {
	Name   string     `xml:"Name"`
	Tracks []tcxTrack `xml:"Track"`
}

type tcxPoint struct {
	Time   string `xml:"Time"`
	Lat    string `xml:"Position>LatitudeDegrees"`
	Lon    string `xml:"Position>LongitudeDegrees"`
	Alt    string `xml:"AltitudeMeters"`
	Dist   string `xml:"DistanceMeters"`
	HR     string `xml:"HeartRateBpm>Value"`
	Cad    string `xml:"Cadence"`
	Speed  string `xml:"Extensions>TPX>Speed"`
	Watts  string `xml:"Extensions>TPX>Watts"`
	RunCad string `xml:"Extensions>TPX>RunCadence"`
}

func (tp tcxPoint) point() Point {
	var p Point
	lat, ok1 := parseNum(tp.Lat)
	lon, ok2 := parseNum(tp.Lon)
	if ok1 && ok2 && validLatLon(lat, lon) {
		p.Lat, p.Lon, p.HasPos = lat, lon, true
	}
	if v, ok := parseNum(tp.Alt); ok {
		p.Ele, p.HasEle = v, true
	}
	if t, ok := parseTime(tp.Time); ok {
		p.Time = t
	}
	if v, ok := parseNum(tp.Dist); ok {
		p.Dist, p.HasDist = v, true
	}
	if v, ok := parseNum(tp.Speed); ok {
		p.Speed, p.HasSpeed = v, true
	}
	p.HR = firstNum(tp.HR)
	p.Cad = firstNum(tp.Cad, tp.RunCad)
	p.Power = firstNum(tp.Watts)
	return p
}

// parseTCX returns one activity per <Activity> (and per <Course>).
func parseTCX(data []byte) ([]*Activity, error) {
	var doc tcxDoc
	if err := newXMLDecoder(data).Decode(&doc); err != nil {
		return nil, fmt.Errorf("invalid TCX: %w", err)
	}
	var out []*Activity
	for _, act := range doc.Activities {
		a := &Activity{Format: "tcx", Sport: NormalizeSport(act.Sport), Description: strings.TrimSpace(act.Notes)}
		if t, ok := parseTime(act.ID); ok {
			a.Start = t
		}
		for _, lap := range act.Laps {
			if a.Start.IsZero() {
				if t, ok := parseTime(lap.StartTime); ok {
					a.Start = t
				}
			}
			if v, ok := parseNum(lap.Distance); ok && v > 0 {
				a.Totals.Distance += v
			}
			if v, ok := parseNum(lap.Calories); ok && v > 0 {
				a.Totals.Calories += v
			}
			if v, ok := parseNum(lap.MaxSpeed); ok && v > a.Totals.MaxSpeed {
				a.Totals.MaxSpeed = v
			}
			for _, trk := range lap.Tracks {
				for _, tp := range trk.Points {
					a.Points = append(a.Points, tp.point())
				}
			}
		}
		if len(a.Points) > 0 || a.Totals.Distance > 0 {
			out = append(out, a)
		}
	}
	for _, c := range doc.Courses {
		a := &Activity{Format: "tcx", Name: strings.TrimSpace(c.Name)}
		for _, trk := range c.Tracks {
			for _, tp := range trk.Points {
				a.Points = append(a.Points, tp.point())
			}
		}
		if len(a.Points) > 0 {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("the TCX file has no activities")
	}
	return out, nil
}
