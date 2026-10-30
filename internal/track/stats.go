package track

import (
	"math"
	"time"
)

const (
	earthRadius = 6371008.8 // metres (mean radius)
	// minMovingSpeed is the speed (m/s) above which a sample counts as moving.
	minMovingSpeed = 0.5
	// maxPlausibleSpeed drops GPS jumps faster than this (m/s) from the distance.
	maxPlausibleSpeed = 120.0
	// eleThreshold is the hysteresis (m) used to count elevation gain and loss.
	eleThreshold = 2.5
	// maxProfilePoints limits the elevation profile sent to the UI.
	maxProfilePoints = 400
	maxSplits        = 2000
)

// Haversine returns the great-circle distance in metres.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const rad = math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}

// cumulative returns the cumulative distance (metres) at every point. The
// device's own distance is used when (almost) every point carries one;
// otherwise the distance is measured between consecutive GPS positions.
func cumulative(pts []Point) []float64 {
	cum := make([]float64, len(pts))
	devCount := 0
	for _, p := range pts {
		if p.HasDist {
			devCount++
		}
	}
	useDev := len(pts) > 0 && devCount*10 >= len(pts)*9
	lastPos, lastDev := -1, -1.0
	total := 0.0
	for i, p := range pts {
		inc := 0.0
		if useDev && p.HasDist {
			if lastDev >= 0 && p.Dist >= lastDev {
				inc = p.Dist - lastDev
			}
			lastDev = p.Dist
		} else if p.HasPos && lastPos >= 0 {
			q := pts[lastPos]
			inc = Haversine(q.Lat, q.Lon, p.Lat, p.Lon)
			if !p.Time.IsZero() && !q.Time.IsZero() {
				if dt := p.Time.Sub(q.Time).Seconds(); dt > 0 && inc/dt > maxPlausibleSpeed {
					inc = 0 // GPS jump
				}
			}
		}
		if p.HasPos {
			lastPos = i
		}
		total += inc
		cum[i] = total
	}
	return cum
}

// Compute returns the summary statistics and the details of an activity.
func Compute(a *Activity) (Stats, Detail) {
	var s Stats
	d := Detail{SplitsKm: []Split{}, SplitsMi: []Split{}, Profile: [][2]float64{}}
	pts := a.Points
	s.Points = len(pts)
	cum := cumulative(pts)
	if n := len(cum); n > 0 {
		s.DistanceM = cum[n-1]
	}

	// Start, end and elapsed time.
	var first, last time.Time
	for _, p := range pts {
		if p.Time.IsZero() {
			continue
		}
		if first.IsZero() {
			first = p.Time
		}
		last = p.Time
	}
	if first.IsZero() {
		first = a.Start
	}
	if !last.IsZero() && last.After(first) {
		s.ElapsedS = last.Sub(first).Seconds()
	}

	// Moving time: samples faster than minMovingSpeed.
	// Max speed: device speed if recorded, otherwise over windows of >= 5 s.
	prev := -1
	var timed []int
	for i, p := range pts {
		if p.HasSpeed && p.Speed > s.MaxSpeed && p.Speed < maxPlausibleSpeed {
			s.MaxSpeed = p.Speed
		}
		if p.Time.IsZero() {
			continue
		}
		timed = append(timed, i)
		if prev >= 0 {
			dt := p.Time.Sub(pts[prev].Time).Seconds()
			if dt > 0 && (cum[i]-cum[prev])/dt >= minMovingSpeed {
				s.MovingS += dt
			}
		}
		prev = i
	}
	if s.MaxSpeed == 0 {
		j := 0
		for k := 1; k < len(timed); k++ {
			ti := pts[timed[k]].Time
			for j+1 < k && ti.Sub(pts[timed[j+1]].Time).Seconds() >= 5 {
				j++
			}
			dt := ti.Sub(pts[timed[j]].Time).Seconds()
			if dt >= 5 && dt <= 30 {
				if v := (cum[timed[k]] - cum[timed[j]]) / dt; v > s.MaxSpeed && v < maxPlausibleSpeed {
					s.MaxSpeed = v
				}
			}
		}
	}

	// Elevation, heart rate, cadence, power, temperature, position.
	var ref float64
	haveRef := false
	var hrSum, cadSum, powSum, tempSum float64
	var hrN, cadN, powN, tempN, posN int
	for _, p := range pts {
		if p.HasEle {
			if !s.HasEle {
				s.HasEle, s.MinEle, s.MaxEle = true, p.Ele, p.Ele
			}
			s.MinEle = math.Min(s.MinEle, p.Ele)
			s.MaxEle = math.Max(s.MaxEle, p.Ele)
			switch {
			case !haveRef:
				ref, haveRef = p.Ele, true
			case p.Ele-ref >= eleThreshold:
				s.AscentM += p.Ele - ref
				ref = p.Ele
			case ref-p.Ele >= eleThreshold:
				s.DescentM += ref - p.Ele
				ref = p.Ele
			}
		}
		if p.HR > 0 {
			hrSum += p.HR
			hrN++
			s.MaxHR = math.Max(s.MaxHR, p.HR)
		}
		if p.Cad > 0 {
			cadSum += p.Cad
			cadN++
			s.MaxCadence = math.Max(s.MaxCadence, p.Cad)
		}
		if p.Power > 0 {
			powSum += p.Power
			powN++
			s.MaxPower = math.Max(s.MaxPower, p.Power)
		}
		if p.HasTemp {
			tempSum += p.Temp
			tempN++
		}
		if p.HasPos {
			posN++
			ll := &LatLon{Lat: round(p.Lat, 6), Lon: round(p.Lon, 6)}
			if s.Start == nil {
				s.Start = ll
				s.Bounds = &Bounds{MinLat: p.Lat, MaxLat: p.Lat, MinLon: p.Lon, MaxLon: p.Lon}
			}
			s.End = ll
			s.Bounds.MinLat = math.Min(s.Bounds.MinLat, p.Lat)
			s.Bounds.MaxLat = math.Max(s.Bounds.MaxLat, p.Lat)
			s.Bounds.MinLon = math.Min(s.Bounds.MinLon, p.Lon)
			s.Bounds.MaxLon = math.Max(s.Bounds.MaxLon, p.Lon)
		}
	}
	if hrN > 0 {
		s.AvgHR = hrSum / float64(hrN)
	}
	if cadN > 0 {
		s.AvgCadence = cadSum / float64(cadN)
	}
	if powN > 0 {
		s.AvgPower = powSum / float64(powN)
	}
	if tempN > 0 {
		s.HasTemp = true
		s.AvgTemp = tempSum / float64(tempN)
	}
	s.HasTrack = posN >= 2

	// Totals reported by the file win over computed values.
	t := a.Totals
	if t.Distance > 0 {
		s.DistanceM = t.Distance
	}
	if t.Elapsed > 0 {
		s.ElapsedS = t.Elapsed
	}
	if t.Moving > 0 {
		s.MovingS = t.Moving
	}
	if t.Ascent > 0 {
		s.AscentM = t.Ascent
	}
	if t.Descent > 0 {
		s.DescentM = t.Descent
	}
	if t.Calories > 0 {
		s.Calories = t.Calories
	}
	if t.MaxSpeed > 0 {
		s.MaxSpeed = t.MaxSpeed
	}
	if t.AvgHR > 0 && s.AvgHR == 0 {
		s.AvgHR = t.AvgHR
	}
	if t.MaxHR > s.MaxHR {
		s.MaxHR = t.MaxHR
	}
	if s.MovingS == 0 || (s.ElapsedS > 0 && s.MovingS > s.ElapsedS) {
		s.MovingS = s.ElapsedS
	}
	if s.MovingS > 0 {
		s.AvgSpeed = s.DistanceM / s.MovingS
	}
	if !first.IsZero() {
		s.StartTime = first.UTC().Format(time.RFC3339)
		if s.ElapsedS > 0 {
			s.EndTime = first.Add(time.Duration(s.ElapsedS * float64(time.Second))).UTC().Format(time.RFC3339)
		}
	}

	d.SplitsKm = splits(pts, cum, 1000)
	d.SplitsMi = splits(pts, cum, 1609.344)
	d.Profile = profile(pts, cum)

	s.DistanceM = round(s.DistanceM, 1)
	s.ElapsedS = round(s.ElapsedS, 0)
	s.MovingS = round(s.MovingS, 0)
	s.AvgSpeed = round(s.AvgSpeed, 3)
	s.MaxSpeed = round(s.MaxSpeed, 3)
	s.AscentM = round(s.AscentM, 1)
	s.DescentM = round(s.DescentM, 1)
	s.MinEle = round(s.MinEle, 1)
	s.MaxEle = round(s.MaxEle, 1)
	s.AvgHR = round(s.AvgHR, 1)
	s.AvgCadence = round(s.AvgCadence, 1)
	s.AvgPower = round(s.AvgPower, 1)
	s.AvgTemp = round(s.AvgTemp, 1)
	s.Calories = round(s.Calories, 0)
	if s.Bounds != nil {
		s.Bounds.MinLat = round(s.Bounds.MinLat, 6)
		s.Bounds.MaxLat = round(s.Bounds.MaxLat, 6)
		s.Bounds.MinLon = round(s.Bounds.MinLon, 6)
		s.Bounds.MaxLon = round(s.Bounds.MaxLon, 6)
	}
	return s, d
}

// splits cuts the activity into pieces of unit metres (the last one may be
// shorter) and reports the time, elevation change and heart rate of each.
func splits(pts []Point, cum []float64, unit float64) []Split {
	out := []Split{}
	start := -1
	for i, p := range pts {
		if !p.Time.IsZero() {
			start = i
			break
		}
	}
	if start < 0 || len(cum) == 0 || cum[len(cum)-1]-cum[start] < unit*0.05 {
		return out
	}
	segT := pts[start].Time
	segD := cum[start]
	target := segD + unit
	lastEle, haveEle := 0.0, false
	for i := 0; i <= start; i++ {
		if pts[i].HasEle {
			lastEle, haveEle = pts[i].Ele, true
		}
	}
	segEle := lastEle
	var hrSum float64
	hrN := 0
	prev := start
	for i := start + 1; i < len(pts) && len(out) < maxSplits; i++ {
		p := pts[i]
		if p.HasEle {
			lastEle, haveEle = p.Ele, true
		}
		if p.HR > 0 {
			hrSum += p.HR
			hrN++
		}
		if p.Time.IsZero() {
			continue
		}
		for cum[i] >= target && cum[i] > cum[prev] && len(out) < maxSplits {
			frac := (target - cum[prev]) / (cum[i] - cum[prev])
			if frac < 0 {
				frac = 0
			}
			tt := pts[prev].Time.Add(time.Duration(frac * float64(p.Time.Sub(pts[prev].Time))))
			sp := Split{Index: len(out) + 1, DistanceM: unit, TimeS: round(tt.Sub(segT).Seconds(), 1)}
			if haveEle {
				sp.EleDiff = round(lastEle-segEle, 1)
			}
			if hrN > 0 {
				sp.AvgHR = round(hrSum/float64(hrN), 1)
			}
			out = append(out, sp)
			segT, segD, segEle = tt, target, lastEle
			target += unit
			hrSum, hrN = 0, 0
		}
		prev = i
	}
	// Remaining partial split.
	if rest := cum[prev] - segD; rest >= unit*0.05 && len(out) < maxSplits {
		sp := Split{Index: len(out) + 1, DistanceM: round(rest, 1), TimeS: round(pts[prev].Time.Sub(segT).Seconds(), 1)}
		if haveEle {
			sp.EleDiff = round(lastEle-segEle, 1)
		}
		if hrN > 0 {
			sp.AvgHR = round(hrSum/float64(hrN), 1)
		}
		out = append(out, sp)
	}
	return out
}

// profile returns up to maxProfilePoints [distance, elevation] pairs.
func profile(pts []Point, cum []float64) [][2]float64 {
	var idx []int
	for i, p := range pts {
		if p.HasEle {
			idx = append(idx, i)
		}
	}
	out := [][2]float64{}
	if len(idx) < 2 {
		return out
	}
	step := (len(idx) + maxProfilePoints - 1) / maxProfilePoints
	for k := 0; k < len(idx); k += step {
		i := idx[k]
		out = append(out, [2]float64{round(cum[i], 1), round(pts[i].Ele, 1)})
	}
	if lastI := idx[len(idx)-1]; (len(idx)-1)%step != 0 {
		out = append(out, [2]float64{round(cum[lastI], 1), round(pts[lastI].Ele, 1)})
	}
	return out
}

func round(v float64, places int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

// Simplify returns the route as [lat, lon] pairs with at most limit points
// (Douglas-Peucker with a growing tolerance), rounded to ~1 m.
func Simplify(pts []Point, limit int) [][2]float64 {
	ll := make([][2]float64, 0, len(pts))
	for _, p := range pts {
		if p.HasPos {
			ll = append(ll, [2]float64{p.Lat, p.Lon})
		}
	}
	if limit < 2 {
		limit = 2
	}
	eps := 0.000005
	for len(ll) > limit && eps < 1 {
		ll2 := douglasPeucker(ll, eps)
		if len(ll2) <= limit {
			ll = ll2
			break
		}
		eps *= 2
		if eps >= 1 {
			ll = ll2
		}
	}
	out := make([][2]float64, len(ll))
	for i, p := range ll {
		out[i] = [2]float64{round(p[0], 5), round(p[1], 5)}
	}
	return out
}

func douglasPeucker(ll [][2]float64, eps float64) [][2]float64 {
	n := len(ll)
	if n < 3 {
		return ll
	}
	keep := make([]bool, n)
	keep[0], keep[n-1] = true, true
	cosLat := math.Cos(ll[0][0] * math.Pi / 180)
	type span struct{ a, b int }
	stack := []span{{0, n - 1}}
	for len(stack) > 0 {
		sp := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		maxD, idx := 0.0, -1
		for i := sp.a + 1; i < sp.b; i++ {
			if dd := segDist(ll[i], ll[sp.a], ll[sp.b], cosLat); dd > maxD {
				maxD, idx = dd, i
			}
		}
		if idx >= 0 && maxD > eps {
			keep[idx] = true
			stack = append(stack, span{sp.a, idx}, span{idx, sp.b})
		}
	}
	out := make([][2]float64, 0, n/4+2)
	for i, k := range keep {
		if k {
			out = append(out, ll[i])
		}
	}
	return out
}

// segDist is the distance (in degrees, longitude scaled by cos(lat)) from p
// to the segment a-b.
func segDist(p, a, b [2]float64, cosLat float64) float64 {
	px, py := p[1]*cosLat, p[0]
	ax, ay := a[1]*cosLat, a[0]
	bx, by := b[1]*cosLat, b[0]
	dx, dy := bx-ax, by-ay
	if dx == 0 && dy == 0 {
		return math.Hypot(px-ax, py-ay)
	}
	t := ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}
