package track

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	// MaxFileBytes limits a single (decompressed) activity file.
	MaxFileBytes = 256 << 20
	// maxArchiveEntries limits the number of files read from one archive.
	maxArchiveEntries = 100_000
)

// ErrUnsupported is returned for files that are not activity files.
var ErrUnsupported = errors.New("unsupported file format (use GPX, TCX, FIT, CSV, XML, or a .zip/.gz of them)")

// FileError reports a file inside an archive that could not be read.
type FileError struct {
	File  string `json:"file"`
	Error string `json:"error"`
}

// Parse reads an uploaded file: GPX, TCX, FIT, CSV or XML, optionally
// gzip-compressed (Strava exports contain *.fit.gz, *.gpx.gz, ...), or a .zip
// archive such as the complete Strava bulk export. For archives, rows of
// activities.csv are matched with their activity files (name, type and
// Strava's totals are taken from the CSV); rows without a file become
// summary-only activities. Problems with single files inside an archive are
// returned as fileErrs; err is set when the upload could not be read at all.
func Parse(name string, data []byte) (acts []*Activity, fileErrs []FileError, err error) {
	if isZip(data) {
		return parseZip(data)
	}
	acts, err = parseFile(name, data)
	return acts, nil, err
}

func isZip(b []byte) bool  { return bytes.HasPrefix(b, []byte("PK\x03\x04")) }
func isGzip(b []byte) bool { return len(b) >= 2 && b[0] == 0x1f && b[1] == 0x8b }
func isFIT(b []byte) bool {
	return len(b) >= 12 && (b[0] == 12 || b[0] == 14) && string(b[8:12]) == ".FIT"
}

func looksXML(b []byte) bool {
	t := bytes.TrimLeft(trimBOM(b), " \t\r\n")
	return len(t) > 0 && t[0] == '<'
}

func trimBOM(b []byte) []byte { return bytes.TrimPrefix(b, []byte("\xef\xbb\xbf")) }

func gunzip(data []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(out) > MaxFileBytes {
		return nil, fmt.Errorf("the file is larger than %d MB when decompressed", MaxFileBytes>>20)
	}
	return out, nil
}

// baseName returns the file name without directories and without ".gz".
func baseName(name string) string {
	b := path.Base(strings.ReplaceAll(name, "\\", "/"))
	if strings.EqualFold(path.Ext(b), ".gz") {
		b = b[:len(b)-3]
	}
	if b == "." || b == "/" {
		return ""
	}
	return b
}

// parseFile parses one (possibly gzip-compressed) activity file.
func parseFile(name string, data []byte) ([]*Activity, error) {
	if isGzip(data) {
		raw, err := gunzip(data)
		if err != nil {
			return nil, fmt.Errorf("cannot decompress: %w", err)
		}
		data = raw
	}
	base := baseName(name)
	ext := strings.ToLower(path.Ext(base))
	sum := sha256.Sum256(data)
	key := hex.EncodeToString(sum[:])

	var acts []*Activity
	var err error
	switch {
	case isFIT(data):
		acts, err = parseFIT(data)
	case looksXML(data):
		acts, err = parseXML(data)
	case ext == ".csv" || ext == ".txt":
		acts, err = parseCSV(data)
	default:
		return nil, ErrUnsupported
	}
	if err != nil {
		return nil, err
	}
	if len(acts) == 0 {
		return nil, errors.New("no activity found in this file")
	}
	for i, a := range acts {
		a.FileName = base
		if a.SourceKey == "" {
			a.SourceKey = key
			if len(acts) > 1 {
				a.SourceKey = key + ":" + strconv.Itoa(i)
			}
		}
		if a.Start.IsZero() {
			for _, p := range a.Points {
				if !p.Time.IsZero() {
					a.Start = p.Time
					break
				}
			}
		}
		a.Name = strings.TrimSpace(a.Name)
		if a.Name == "" {
			a.Name = defaultName(a, base)
		}
	}
	return acts, nil
}

func defaultName(a *Activity, base string) string {
	if a.Sport != "" && !a.Start.IsZero() {
		return a.Sport + " " + a.Start.UTC().Format("2006-01-02")
	}
	n := strings.TrimSuffix(base, path.Ext(base))
	if n == "" {
		n = "Activity"
	}
	return n
}

// parseZip reads every activity file of an archive (e.g. the Strava bulk export).
func parseZip(data []byte) ([]*Activity, []FileError, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, fmt.Errorf("cannot read the archive: %w", err)
	}
	if len(zr.File) > maxArchiveEntries {
		return nil, nil, fmt.Errorf("the archive has too many files (max %d)", maxArchiveEntries)
	}
	var acts, csvRows []*Activity
	var errs []FileError
	entry := map[*Activity]string{} // activity -> lower-case file name in the archive
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		low := strings.ToLower(f.Name)
		if strings.HasPrefix(low, "__macosx/") || strings.HasPrefix(path.Base(low), ".") {
			continue
		}
		ext := path.Ext(strings.TrimSuffix(low, ".gz"))
		switch ext {
		case ".gpx", ".tcx", ".fit", ".xml", ".csv":
		default:
			continue
		}
		if f.UncompressedSize64 > MaxFileBytes {
			errs = append(errs, FileError{File: f.Name, Error: "the file is too large"})
			continue
		}
		raw, err := readZipFile(f)
		if err != nil {
			errs = append(errs, FileError{File: f.Name, Error: err.Error()})
			continue
		}
		parsed, err := parseFile(f.Name, raw)
		if err != nil {
			// Strava exports contain many other CSV (and XML) files; only
			// complain about real activity files.
			if ext != ".csv" && ext != ".xml" {
				errs = append(errs, FileError{File: f.Name, Error: err.Error()})
			}
			continue
		}
		for _, a := range parsed {
			if a.Format == "csv" && len(a.Points) == 0 {
				csvRows = append(csvRows, a)
				continue
			}
			entry[a] = path.Base(low)
			acts = append(acts, a)
		}
	}

	// Match activities.csv rows with the activity files they describe.
	rows := map[string]*Activity{}
	for _, r := range csvRows {
		if r.linkedFile != "" {
			rows[strings.ToLower(path.Base(strings.ReplaceAll(r.linkedFile, "\\", "/")))] = r
		}
	}
	used := map[*Activity]bool{}
	for _, a := range acts {
		if r, ok := rows[entry[a]]; ok && !used[r] {
			mergeRow(a, r)
			used[r] = true
		}
	}
	for _, r := range csvRows {
		if !used[r] {
			acts = append(acts, r)
		}
	}
	if len(acts) == 0 && len(errs) == 0 {
		return nil, nil, errors.New("no activity files found in the archive")
	}
	return acts, errs, nil
}

func readZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(b) > MaxFileBytes {
		return nil, errors.New("the file is too large")
	}
	return b, nil
}

// mergeRow copies what Strava knows about an activity (name, type,
// description and its own totals) from an activities.csv row.
func mergeRow(a, r *Activity) {
	if r.Name != "" {
		a.Name = r.Name
	}
	if r.Sport != "" {
		a.Sport = r.Sport
	}
	if r.Description != "" {
		a.Description = r.Description
	}
	if a.Start.IsZero() {
		a.Start = r.Start
	}
	set := func(dst *float64, v float64) {
		if v > 0 {
			*dst = v
		}
	}
	set(&a.Totals.Distance, r.Totals.Distance)
	set(&a.Totals.Elapsed, r.Totals.Elapsed)
	set(&a.Totals.Moving, r.Totals.Moving)
	set(&a.Totals.Ascent, r.Totals.Ascent)
	set(&a.Totals.Descent, r.Totals.Descent)
	set(&a.Totals.Calories, r.Totals.Calories)
	set(&a.Totals.MaxSpeed, r.Totals.MaxSpeed)
	set(&a.Totals.AvgHR, r.Totals.AvgHR)
	set(&a.Totals.MaxHR, r.Totals.MaxHR)
}

// ---------- shared value helpers ----------

func parseNum(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func validLatLon(lat, lon float64) bool {
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat == 0 && lon == 0)
}

var timeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05Z07:00",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"Jan 2, 2006, 3:04:05 PM",
	"Jan 2, 2006, 15:04:05",
	"2 Jan 2006, 15:04:05",
	"2 Jan 2006, 3:04:05 PM",
	"01/02/2006 15:04:05",
	"02.01.2006 15:04:05",
	"2006-01-02",
}

// parseTime accepts ISO 8601 / RFC 3339 and the formats used in Strava's
// activities.csv; times without a zone are taken as UTC. Unix seconds or
// milliseconds are accepted too.
func parseTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(strings.NewReplacer("\u202f", " ", "\u00a0", " ").Replace(s))
	if s == "" {
		return time.Time{}, false
	}
	for _, l := range timeLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), true
		}
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		switch {
		case n > 100_000_000_000: // milliseconds
			return time.UnixMilli(n).UTC(), true
		case n > 100_000_000:
			return time.Unix(n, 0).UTC(), true
		}
	}
	return time.Time{}, false
}
