package track

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"math"
	"testing"
	"time"
)

const sampleGPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>2024-05-01T06:00:00Z</time></metadata>
 <trk><name>Morning Run</name><type>running</type><trkseg>
  <trkpt lat="52.0" lon="13.0"><ele>30</ele><time>2024-05-01T06:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="52.0" lon="13.01"><ele>35</ele><time>2024-05-01T06:01:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="52.0" lon="13.02"><ele>31</ele><time>2024-05-01T06:02:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
 </trkseg></trk>
</gpx>`

func near(got, want, tol float64) bool { return math.Abs(got-want) <= tol }

func TestGPX(t *testing.T) {
	acts, _, err := Parse("run.gpx", []byte(sampleGPX))
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 {
		t.Fatalf("got %d activities", len(acts))
	}
	a := acts[0]
	if a.Name != "Morning Run" || a.Sport != "Run" || a.Format != "gpx" || len(a.Points) != 3 {
		t.Fatalf("unexpected activity %+v", a)
	}
	s, d := Compute(a)
	if !near(s.DistanceM, 1369, 10) {
		t.Fatalf("distance = %v", s.DistanceM)
	}
	if s.ElapsedS != 120 || s.MovingS != 120 {
		t.Fatalf("elapsed = %v moving = %v", s.ElapsedS, s.MovingS)
	}
	if s.AscentM != 5 || s.DescentM != 4 || s.MinEle != 30 || s.MaxEle != 35 {
		t.Fatalf("elevation = %+v", s)
	}
	if s.AvgHR != 130 || s.MaxHR != 140 {
		t.Fatalf("hr = %v / %v", s.AvgHR, s.MaxHR)
	}
	if s.Start == nil || s.End == nil || s.Start.Lon != 13 || s.End.Lon != 13.02 || !s.HasTrack {
		t.Fatalf("start/end = %+v %+v", s.Start, s.End)
	}
	if s.StartTime != "2024-05-01T06:00:00Z" {
		t.Fatalf("start time = %s", s.StartTime)
	}
	if len(d.SplitsKm) != 2 || d.SplitsKm[0].DistanceM != 1000 || !near(d.SplitsKm[1].DistanceM, 369, 10) {
		t.Fatalf("splits = %+v", d.SplitsKm)
	}
	if !near(d.SplitsKm[0].TimeS, 87.6, 1) {
		t.Fatalf("first split time = %v", d.SplitsKm[0].TimeS)
	}
}

const sampleTCX = `
<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities><Activity Sport="Biking"><Id>2024-06-01T08:00:00Z</Id>
  <Lap StartTime="2024-06-01T08:00:00Z"><DistanceMeters>2000</DistanceMeters><Calories>50</Calories><Track>
   <Trackpoint><Time>2024-06-01T08:00:00Z</Time><Position><LatitudeDegrees>48.0</LatitudeDegrees><LongitudeDegrees>11.0</LongitudeDegrees></Position><AltitudeMeters>500</AltitudeMeters><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>100</Value></HeartRateBpm></Trackpoint>
   <Trackpoint><Time>2024-06-01T08:02:00Z</Time><Position><LatitudeDegrees>48.0</LatitudeDegrees><LongitudeDegrees>11.0135</LongitudeDegrees></Position><AltitudeMeters>510</AltitudeMeters><DistanceMeters>1000</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm><Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Watts>200</Watts></TPX></Extensions></Trackpoint>
   <Trackpoint><Time>2024-06-01T08:04:00Z</Time><Position><LatitudeDegrees>48.0</LatitudeDegrees><LongitudeDegrees>11.027</LongitudeDegrees></Position><AltitudeMeters>505</AltitudeMeters><DistanceMeters>2000</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
  </Track></Lap>
 </Activity></Activities>
</TrainingCenterDatabase>`

func TestTCX(t *testing.T) {
	acts, _, err := Parse("ride.tcx", []byte(sampleTCX))
	if err != nil {
		t.Fatal(err)
	}
	a := acts[0]
	if a.Sport != "Ride" || a.Format != "tcx" || len(a.Points) != 3 {
		t.Fatalf("unexpected activity %+v", a)
	}
	s, _ := Compute(a)
	if s.DistanceM != 2000 || s.ElapsedS != 240 || s.Calories != 50 || s.MaxPower != 200 {
		t.Fatalf("stats = %+v", s)
	}
	if a.Name != "Ride 2024-06-01" {
		t.Fatalf("name = %q", a.Name)
	}
}

func fitSample() []byte {
	le := binary.LittleEndian
	var body bytes.Buffer
	// Definition, local type 0: record (20) with timestamp, lat, lon, heart rate.
	body.Write([]byte{0x40, 0, 0, 20, 0, 4, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 0x02})
	ts := uint32(1_000_000_000)
	for i := 0; i < 3; i++ {
		body.WriteByte(0x00)
		_ = binary.Write(&body, le, ts+uint32(i*10))
		_ = binary.Write(&body, le, int32(math.Round(52.0/semicircle)))
		_ = binary.Write(&body, le, int32(math.Round((13.0+float64(i)*0.001)/semicircle)))
		body.WriteByte(byte(120 + i))
	}
	// Definition, local type 1: session (18) with sport; then the data: running.
	body.Write([]byte{0x41, 0, 0, 18, 0, 1, 5, 1, 0x00})
	body.Write([]byte{0x01, 1})
	hdr := make([]byte, 14)
	hdr[0], hdr[1] = 14, 0x20
	le.PutUint16(hdr[2:], 2132)
	le.PutUint32(hdr[4:], uint32(body.Len()))
	copy(hdr[8:], ".FIT")
	out := append(hdr, body.Bytes()...)
	return append(out, 0, 0) // CRC (not checked)
}

func TestFIT(t *testing.T) {
	acts, _, err := Parse("ride.fit", fitSample())
	if err != nil {
		t.Fatal(err)
	}
	a := acts[0]
	if a.Sport != "Run" || len(a.Points) != 3 || a.Format != "fit" {
		t.Fatalf("unexpected activity %+v", a)
	}
	if !a.Start.Equal(fitTime(1_000_000_000)) {
		t.Fatalf("start = %v", a.Start)
	}
	s, _ := Compute(a)
	if s.ElapsedS != 20 || !near(s.DistanceM, 137, 2) || s.AvgHR != 121 {
		t.Fatalf("stats = %+v", s)
	}
	if !near(s.Start.Lat, 52, 1e-6) || !near(s.End.Lon, 13.002, 1e-6) {
		t.Fatalf("start/end = %+v %+v", s.Start, s.End)
	}
}

func gz(b []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(b)
	_ = w.Close()
	return buf.Bytes()
}

func TestStravaExportZip(t *testing.T) {
	csvData := "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Filename,Elapsed Time,Distance,Moving Time,Elevation Gain\n" +
		"1,\"May 1, 2024, 6:00:00 AM\",Evening Run,Run,120,1.37,activities/1.gpx.gz,120,1369.0,118,5\n" +
		"2,\"May 2, 2024, 6:00:00 AM\",Commute,Ride,3600,5.00,,3600,5000.0,3500,40\n"
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string][]byte{
		"activities.csv":      []byte(csvData),
		"activities/1.gpx.gz": gz([]byte(sampleGPX)),
		"profile.csv":         []byte("Athlete ID,Email\n1,a@b.c\n"),
		"media/photo.jpg":     []byte("not an activity"),
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(content)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	acts, errs, err := Parse("export.zip", buf.Bytes())
	if err != nil || len(errs) != 0 {
		t.Fatalf("err = %v, file errors = %v", err, errs)
	}
	if len(acts) != 2 {
		t.Fatalf("got %d activities", len(acts))
	}
	byName := map[string]*Activity{}
	for _, a := range acts {
		byName[a.Name] = a
	}
	run, ride := byName["Evening Run"], byName["Commute"]
	if run == nil || ride == nil {
		t.Fatalf("activities = %v", byName)
	}
	if len(run.Points) != 3 || run.Totals.Moving != 118 || run.Format != "gpx" {
		t.Fatalf("run = %+v", run)
	}
	if len(ride.Points) != 0 || ride.Sport != "Ride" || ride.Totals.Distance != 5000 || ride.SourceKey != "csv:2" {
		t.Fatalf("ride = %+v", ride)
	}
	if !ride.Start.Equal(time.Date(2024, 5, 2, 6, 0, 0, 0, time.UTC)) {
		t.Fatalf("ride start = %v", ride.Start)
	}
	s, _ := Compute(ride)
	if s.DistanceM != 5000 || s.MovingS != 3500 || s.AscentM != 40 || s.HasTrack {
		t.Fatalf("ride stats = %+v", s)
	}
}

func TestTrackCSV(t *testing.T) {
	data := "time,lat,lon,ele\n2024-01-01T10:00:00Z,47.0,8.0,400\n2024-01-01T10:01:00Z,47.001,8.0,401\n"
	acts, _, err := Parse("points.csv", []byte(data))
	if err != nil {
		t.Fatal(err)
	}
	s, _ := Compute(acts[0])
	if !near(s.DistanceM, 111, 1) || s.ElapsedS != 60 {
		t.Fatalf("stats = %+v", s)
	}
}

func TestSimplify(t *testing.T) {
	var pts []Point
	for i := 0; i < 10000; i++ {
		pts = append(pts, Point{Lat: 50 + float64(i)*0.0001, Lon: 10 + math.Sin(float64(i)/300)*0.01, HasPos: true})
	}
	out := Simplify(pts, 200)
	if len(out) > 200 || len(out) < 10 {
		t.Fatalf("simplified to %d points", len(out))
	}
	if out[0][0] != 50 || out[len(out)-1][0] != round(50+9999*0.0001, 5) {
		t.Fatalf("end points not kept: %v %v", out[0], out[len(out)-1])
	}
}

func TestNormalizeSport(t *testing.T) {
	for in, want := range map[string]string{
		"running": "Run", "9": "Run", "Biking": "Ride", "cycling": "Ride", "Virtual Ride": "Virtual Ride",
		"E-Bike Ride": "E-Bike Ride", "hiking": "Hike", "": "", "ice skating": "Ice Skating", "Trail Run": "Trail Run",
	} {
		if got := NormalizeSport(in); got != want {
			t.Errorf("NormalizeSport(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUnsupported(t *testing.T) {
	if _, _, err := Parse("photo.jpg", []byte{0xff, 0xd8, 0xff}); err == nil {
		t.Fatal("expected an error")
	}
}
