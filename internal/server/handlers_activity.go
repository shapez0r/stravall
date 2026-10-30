package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"

	"stravall/internal/auth"
	"stravall/internal/store"
	"stravall/internal/track"
)

const (
	// trackPoints is the route resolution kept for a single activity,
	// previewPoints the coarse version drawn for every activity at once.
	trackPoints   = 3000
	previewPoints = 250
	maxDeleteIDs  = 10_000
)

// cleanText makes text from uploaded files safe to store: valid UTF-8,
// trimmed and at most max characters.
func cleanText(s string, max int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' {
			return ' '
		}
		return r
	}, s)
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return strings.TrimSpace(s)
}

type uploadResult struct {
	File   string `json:"file"`
	Status string `json:"status"` // imported, updated, duplicate, error
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Error  string `json:"error,omitempty"`
}

// uploadActivity imports one uploaded file. The request body is the raw
// file (GPX, TCX, FIT, CSV, XML, .gz or a .zip such as the whole Strava
// export); its name is passed as ?filename=.
func (s *Server) uploadActivity(c *fiber.Ctx) error {
	name := cleanText(c.Query("filename"), 255)
	if name == "" {
		name = "upload"
	}
	body := c.Body()
	if len(body) == 0 {
		return badRequest("the file is empty")
	}
	acts, fileErrs, err := track.Parse(name, body)
	if err != nil {
		return badRequest(err.Error())
	}
	user := currentUser(c)
	now := time.Now().Unix()
	results := make([]uploadResult, 0, len(acts)+len(fileErrs))
	counts := map[string]int{}
	for _, a := range acts {
		row, err := buildActivity(a, user.ID, now)
		if err != nil {
			counts["error"]++
			results = append(results, uploadResult{File: a.FileName, Status: "error", Error: err.Error()})
			continue
		}
		status, id, err := s.store.InsertActivity(c.UserContext(), row)
		if err != nil {
			return err
		}
		counts[status]++
		results = append(results, uploadResult{File: row.FileName, Status: status, ID: id, Name: row.Name})
	}
	for _, fe := range fileErrs {
		counts["error"]++
		results = append(results, uploadResult{File: cleanText(fe.File, 255), Status: "error", Error: fe.Error})
	}
	return c.JSON(fiber.Map{
		"imported":   counts[store.Inserted],
		"updated":    counts[store.Upgraded],
		"duplicates": counts[store.Duplicate],
		"failed":     counts["error"],
		"results":    results,
	})
}

// buildActivity computes the statistics and simplified routes of a parsed
// activity and turns it into a row for the store.
func buildActivity(a *track.Activity, userID string, now int64) (*store.Activity, error) {
	st, det := track.Compute(a)
	stats, err := json.Marshal(st)
	if err != nil {
		return nil, err
	}
	detail, err := json.Marshal(det)
	if err != nil {
		return nil, err
	}
	route, err := json.Marshal(track.Simplify(a.Points, trackPoints))
	if err != nil {
		return nil, err
	}
	preview, err := json.Marshal(track.Simplify(a.Points, previewPoints))
	if err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte(a.SourceKey))
	row := &store.Activity{
		ID:           auth.NewID(),
		UserID:       userID,
		Name:         cleanText(a.Name, 200),
		Sport:        cleanText(a.Sport, 64),
		SourceFormat: a.Format,
		FileName:     cleanText(a.FileName, 255),
		ContentHash:  hex.EncodeToString(key[:]),
		HasTrack:     st.HasTrack,
		Stats:        stats,
		Detail:       detail,
		Track:        route,
		Preview:      preview,
		CreatedAt:    now,
	}
	if row.Name == "" {
		row.Name = "Activity"
	}
	if !a.Start.IsZero() {
		row.StartTime = a.Start.Unix()
	}
	return row, nil
}

// listActivities returns every activity with its statistics; ?preview=1
// adds the coarse routes for the overview map.
func (s *Server) listActivities(c *fiber.Ctx) error {
	list, err := s.store.ListActivities(c.UserContext(), currentUser(c).ID, c.Query("preview") == "1")
	if err != nil {
		return err
	}
	return c.JSON(list)
}

// getActivity returns one activity with splits, elevation profile and route.
func (s *Server) getActivity(c *fiber.Ctx) error {
	a, err := s.store.GetActivity(c.UserContext(), currentUser(c).ID, c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(a)
}

func (s *Server) updateActivity(c *fiber.Ctx) error {
	userID := currentUser(c).ID
	a, err := s.store.GetActivity(c.UserContext(), userID, c.Params("id"))
	if err != nil {
		return err
	}
	var in struct {
		Name  *string `json:"name"`
		Sport *string `json:"sport"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	name, sport := a.Name, a.Sport
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > 200 {
			return badRequest("name must be 1-200 characters")
		}
	}
	if in.Sport != nil {
		sport = strings.TrimSpace(*in.Sport)
		if utf8.RuneCountInString(sport) > 64 {
			return badRequest("sport must be at most 64 characters")
		}
	}
	if err := s.store.UpdateActivity(c.UserContext(), userID, a.ID, name, sport); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"id": a.ID, "name": name, "sport": sport})
}

func (s *Server) deleteActivity(c *fiber.Ctx) error {
	n, err := s.store.DeleteActivities(c.UserContext(), currentUser(c).ID, []string{c.Params("id")})
	if err != nil {
		return err
	}
	if n == 0 {
		return store.ErrNotFound
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// deleteActivities removes several activities ({"ids": [...]}) or all of
// them ({"all": true}).
func (s *Server) deleteActivities(c *fiber.Ctx) error {
	var in struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := c.BodyParser(&in); err != nil {
		return badRequest("invalid JSON body")
	}
	if !in.All && len(in.IDs) == 0 {
		return badRequest("nothing to delete")
	}
	if len(in.IDs) > maxDeleteIDs {
		return badRequest(fmt.Sprintf("too many activities (max %d)", maxDeleteIDs))
	}
	ids := in.IDs
	if in.All {
		ids = nil
	}
	n, err := s.store.DeleteActivities(c.UserContext(), currentUser(c).ID, ids)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"deleted": n})
}
