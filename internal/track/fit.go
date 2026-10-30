package track

import (
	"encoding/binary"
	"errors"
	"math"
	"time"
)

// Minimal decoder for Garmin FIT activity files: it reads record messages
// (GPS position, altitude, heart rate, cadence, distance, speed, power,
// temperature), the session summary and the sport. Compressed-timestamp
// headers, big-endian definitions, developer fields and chained files are
// supported; everything else is skipped.

const (
	fitEpoch   = 631065600 // 1989-12-31T00:00:00Z in unix seconds
	semicircle = 180.0 / 2147483648.0

	fitMsgFileID  = 0
	fitMsgSport   = 12
	fitMsgSession = 18
	fitMsgRecord  = 20
)

var errFITTruncated = errors.New("the FIT file is truncated")

type fitField struct {
	num, size, base byte
}

type fitDef struct {
	global  uint16
	order   binary.ByteOrder
	fields  []fitField
	devSize int
}

func fitTime(ts uint32) time.Time {
	return time.Unix(int64(ts)+fitEpoch, 0).UTC()
}

// parseFIT decodes a FIT file (or several chained ones).
func parseFIT(data []byte) ([]*Activity, error) {
	var out []*Activity
	var firstErr error
	pos := 0
	for pos+12 <= len(data) {
		hdr := int(data[pos])
		if hdr < 12 || pos+hdr > len(data) || string(data[pos+8:pos+12]) != ".FIT" {
			break
		}
		size := int(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
		start := pos + hdr
		end := start + size
		if end > len(data) || size < 0 {
			end = len(data) // truncated: read what is there
		}
		a, err := decodeFIT(data[start:end])
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if a != nil && (len(a.Points) > 0 || a.Totals.Distance > 0 || a.Totals.Elapsed > 0) {
			out = append(out, a)
		}
		pos = end + 2 // file CRC
	}
	if len(out) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, errors.New("no activity data in this FIT file")
	}
	return out, nil
}

// decodeFIT decodes the data records of one FIT file. On a decoding error the
// activity read so far is returned together with the error.
func decodeFIT(b []byte) (*Activity, error) {
	a := &Activity{Format: "fit"}
	var defs [16]*fitDef
	var vals [256]float64
	var have [256]bool
	var lastTS uint32
	sport, subSport := -1, -1
	sportName := ""
	var err error
	p := 0

records:
	for p < len(b) {
		h := b[p]
		p++
		local := int(h & 0x0F)
		compressed := h&0x80 != 0
		var tsOffset uint32
		if compressed {
			local = int(h>>5) & 0x03
			tsOffset = uint32(h & 0x1F)
		} else if h&0x40 != 0 {
			// Definition message.
			if p+5 > len(b) {
				err = errFITTruncated
				break records
			}
			var order binary.ByteOrder = binary.LittleEndian
			if b[p+1] == 1 {
				order = binary.BigEndian
			}
			d := &fitDef{order: order, global: order.Uint16(b[p+2 : p+4])}
			n := int(b[p+4])
			p += 5
			if p+3*n > len(b) {
				err = errFITTruncated
				break records
			}
			for i := 0; i < n; i++ {
				d.fields = append(d.fields, fitField{num: b[p], size: b[p+1], base: b[p+2]})
				p += 3
			}
			if h&0x20 != 0 { // developer fields
				if p >= len(b) {
					err = errFITTruncated
					break records
				}
				nd := int(b[p])
				p++
				if p+3*nd > len(b) {
					err = errFITTruncated
					break records
				}
				for i := 0; i < nd; i++ {
					d.devSize += int(b[p+1])
					p += 3
				}
			}
			defs[local] = d
			continue
		}

		// Data message.
		d := defs[local]
		if d == nil {
			err = errors.New("invalid FIT file (data without definition)")
			break records
		}
		have = [256]bool{} // values of earlier messages must not leak into this one
		for _, f := range d.fields {
			sz := int(f.size)
			if p+sz > len(b) {
				err = errFITTruncated
				break records
			}
			if v, ok := fitValue(b[p:p+sz], f.base, d.order); ok {
				vals[f.num], have[f.num] = v, true
			}
			if d.global == fitMsgSport && f.num == 3 {
				sportName = cString(b[p : p+sz])
			}
			p += sz
		}
		p += d.devSize
		if p > len(b) {
			err = errFITTruncated
			break records
		}

		var ts uint32
		if compressed {
			ts = lastTS + ((tsOffset - (lastTS & 0x1F)) & 0x1F)
			lastTS = ts
		} else if have[253] {
			ts = uint32(vals[253])
			lastTS = ts
		}

		switch d.global {
		case fitMsgRecord:
			var pt Point
			if ts != 0 {
				pt.Time = fitTime(ts)
			}
			if have[0] && have[1] {
				lat, lon := vals[0]*semicircle, vals[1]*semicircle
				if validLatLon(lat, lon) {
					pt.Lat, pt.Lon, pt.HasPos = lat, lon, true
				}
			}
			if have[78] {
				pt.Ele, pt.HasEle = vals[78]/5-500, true
			} else if have[2] {
				pt.Ele, pt.HasEle = vals[2]/5-500, true
			}
			if have[3] {
				pt.HR = vals[3]
			}
			if have[4] {
				pt.Cad = vals[4]
			}
			if have[5] {
				pt.Dist, pt.HasDist = vals[5]/100, true
			}
			if have[73] {
				pt.Speed, pt.HasSpeed = vals[73]/1000, true
			} else if have[6] {
				pt.Speed, pt.HasSpeed = vals[6]/1000, true
			}
			if have[7] {
				pt.Power = vals[7]
			}
			if have[13] {
				pt.Temp, pt.HasTemp = vals[13], true
			}
			a.Points = append(a.Points, pt)
		case fitMsgSession:
			if have[5] {
				sport = int(vals[5])
			}
			if have[6] {
				subSport = int(vals[6])
			}
			if have[2] && a.Start.IsZero() {
				a.Start = fitTime(uint32(vals[2]))
			}
			if have[7] {
				a.Totals.Elapsed += vals[7] / 1000
			}
			if have[9] {
				a.Totals.Distance += vals[9] / 100
			}
			if have[11] {
				a.Totals.Calories += vals[11]
			}
			if have[22] {
				a.Totals.Ascent += vals[22]
			}
			if have[23] {
				a.Totals.Descent += vals[23]
			}
			if have[16] && a.Totals.AvgHR == 0 {
				a.Totals.AvgHR = vals[16]
			}
			if have[17] && vals[17] > a.Totals.MaxHR {
				a.Totals.MaxHR = vals[17]
			}
			if have[125] && vals[125]/1000 > a.Totals.MaxSpeed {
				a.Totals.MaxSpeed = vals[125] / 1000
			} else if have[15] && vals[15]/1000 > a.Totals.MaxSpeed {
				a.Totals.MaxSpeed = vals[15] / 1000
			}
		case fitMsgSport:
			if have[0] && sport < 0 {
				sport = int(vals[0])
			}
			if have[1] && subSport < 0 {
				subSport = int(vals[1])
			}
		case fitMsgFileID:
			if have[4] && a.Start.IsZero() {
				a.Start = fitTime(uint32(vals[4]))
			}
		}
	}

	a.Sport = fitSportName(sport, subSport, sportName)
	for _, pt := range a.Points {
		if !pt.Time.IsZero() {
			a.Start = pt.Time
			break
		}
	}
	return a, err
}

func fitSportName(sport, subSport int, name string) string {
	s, known := fitSports[sport]
	if sub, ok := fitSubSports[subSport]; ok {
		switch {
		case sport == 1 && subSport == 58:
			s = "virtual run"
		case sport == 1 && (subSport == 1 || subSport == 3):
			s = sub
		case sport == 2 && subSport != 1 && subSport != 3:
			s = sub
		}
	}
	if (!known || s == "") && name != "" {
		return NormalizeSport(name)
	}
	return NormalizeSport(s)
}

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// fitValue decodes one scalar field; ok is false for invalid (unset) values
// and for arrays.
func fitValue(b []byte, base byte, order binary.ByteOrder) (float64, bool) {
	switch base & 0x1F {
	case 0, 2, 13: // enum, uint8, byte
		if len(b) != 1 || b[0] == 0xFF {
			return 0, false
		}
		return float64(b[0]), true
	case 10: // uint8z
		if len(b) != 1 || b[0] == 0 {
			return 0, false
		}
		return float64(b[0]), true
	case 1: // sint8
		if len(b) != 1 || b[0] == 0x7F {
			return 0, false
		}
		return float64(int8(b[0])), true
	case 3: // sint16
		if len(b) != 2 {
			return 0, false
		}
		v := int16(order.Uint16(b))
		if v == math.MaxInt16 {
			return 0, false
		}
		return float64(v), true
	case 4, 11: // uint16, uint16z
		if len(b) != 2 {
			return 0, false
		}
		v := order.Uint16(b)
		if (base&0x1F == 4 && v == math.MaxUint16) || (base&0x1F == 11 && v == 0) {
			return 0, false
		}
		return float64(v), true
	case 5: // sint32
		if len(b) != 4 {
			return 0, false
		}
		v := int32(order.Uint32(b))
		if v == math.MaxInt32 {
			return 0, false
		}
		return float64(v), true
	case 6, 12: // uint32, uint32z
		if len(b) != 4 {
			return 0, false
		}
		v := order.Uint32(b)
		if (base&0x1F == 6 && v == math.MaxUint32) || (base&0x1F == 12 && v == 0) {
			return 0, false
		}
		return float64(v), true
	case 8: // float32
		if len(b) != 4 {
			return 0, false
		}
		bits := order.Uint32(b)
		if bits == math.MaxUint32 {
			return 0, false
		}
		return float64(math.Float32frombits(bits)), true
	case 9: // float64
		if len(b) != 8 {
			return 0, false
		}
		bits := order.Uint64(b)
		if bits == math.MaxUint64 {
			return 0, false
		}
		return math.Float64frombits(bits), true
	case 14: // sint64
		if len(b) != 8 {
			return 0, false
		}
		v := int64(order.Uint64(b))
		if v == math.MaxInt64 {
			return 0, false
		}
		return float64(v), true
	case 15, 16: // uint64, uint64z
		if len(b) != 8 {
			return 0, false
		}
		v := order.Uint64(b)
		if (base&0x1F == 15 && v == math.MaxUint64) || (base&0x1F == 16 && v == 0) {
			return 0, false
		}
		return float64(v), true
	}
	return 0, false
}
