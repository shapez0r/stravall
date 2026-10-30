// Package server wires the HTTP API (Fiber) and the embedded web UI.
// The server is stateless: sessions live in the database (with a cache in
// front), so any number of replicas can run behind a load balancer.
package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"eurofish/internal/cache"
	"eurofish/internal/config"
	"eurofish/internal/db"
	"eurofish/internal/store"
	"eurofish/web"
)

const sessionCookie = "eurofish_session"

type Server struct {
	cfg     *config.Config
	db      *db.DB
	store   *store.Store
	cache   cache.Cache
	log     *slog.Logger
	app     *fiber.App
	version string
}

func New(cfg *config.Config, database *db.DB, c cache.Cache, log *slog.Logger, version string) *Server {
	s := &Server{
		cfg:     cfg,
		db:      database,
		store:   store.New(database),
		cache:   c,
		log:     log,
		version: version,
	}

	app := fiber.New(fiber.Config{
		AppName:               "eurofish",
		DisableStartupMessage: true,
		ReadTimeout:           15 * time.Second,
		WriteTimeout:          30 * time.Second,
		IdleTimeout:           120 * time.Second,
		BodyLimit:             1024 * 1024, // calendar imports can be larger than other requests
		ProxyHeader:           cfg.ProxyHeader,
		EnableIPValidation:    true,
		ErrorHandler:          s.errorHandler,
	})
	s.app = app

	app.Use(recover.New())
	if cfg.LogRequests {
		app.Use(logger.New(logger.Config{
			Format: "${time} ${ip} ${status} ${method} ${path} ${latency}\n",
		}))
	}
	app.Use(compress.New())
	app.Use(securityHeaders)

	app.Get("/healthz", s.healthz)
	app.Get("/readyz", s.readyz)

	api := app.Group("/api", noStore)
	api.Get("/config", s.getConfig)

	authLimiter := limiter.New(limiter.Config{
		Max:        20,
		Expiration: time.Minute,
		LimitReached: func(c *fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTooManyRequests, "too many attempts, try again in a minute")
		},
	})
	api.Post("/auth/signup", authLimiter, requireJSON, s.signup)
	api.Post("/auth/login", authLimiter, requireJSON, s.login)
	api.Post("/auth/logout", s.logout)

	priv := api.Group("", s.requireAuth, requireJSON)
	priv.Get("/me", s.me)

	priv.Get("/calendars", s.listCalendars)
	priv.Post("/calendars", s.createCalendar)
	priv.Post("/calendars/import", s.importCalendar)
	priv.Get("/calendars/:id", s.getCalendar)
	priv.Patch("/calendars/:id", s.updateCalendar)
	priv.Delete("/calendars/:id", s.deleteCalendar)

	priv.Get("/calendars/:id/members", s.listMembers)
	priv.Post("/calendars/:id/members", s.addMember)
	priv.Patch("/calendars/:id/members/:userId", s.updateMember)
	priv.Delete("/calendars/:id/members/:userId", s.removeMember)
	priv.Get("/calendars/:id/invites", s.listInvites)
	priv.Delete("/calendars/:id/invites/:email", s.deleteInvite)

	priv.Get("/calendars/:id/events", s.listEvents)
	priv.Post("/calendars/:id/events", s.createEvent)
	priv.Put("/calendars/:id/events/:eventId", s.updateEvent)
	priv.Delete("/calendars/:id/events/:eventId", s.deleteEvent)
	priv.Post("/calendars/:id/events/:eventId/skip", s.skipOccurrence)
	priv.Post("/calendars/:id/events/:eventId/occurrence", s.updateOccurrence)

	priv.Get("/calendars/:id/balances", s.listBalances)
	priv.Put("/calendars/:id/balances/:date", s.setBalance)
	priv.Delete("/calendars/:id/balances/:date", s.deleteBalance)
	priv.Get("/calendars/:id/ledger", s.ledger)
	priv.Get("/calendars/:id/export", s.exportCalendar)

	api.Use(func(c *fiber.Ctx) error {
		return fiber.NewError(fiber.StatusNotFound, "unknown API endpoint")
	})

	// Embedded single-page web UI (no separate frontend deployment needed).
	// The UI must never run a stale app.js from the browser cache after an
	// update: index.html links its scripts and app.css with a content hash and
	// all UI files are revalidated on every load.
	ui := web.Static()
	index := versionedIndex(ui)
	serveIndex := func(c *fiber.Ctx) error {
		c.Set("Cache-Control", "no-cache")
		c.Type("html", "utf-8")
		return c.Send(index)
	}
	app.Get("/", serveIndex)
	app.Get("/index.html", serveIndex)
	app.Use("/", func(c *fiber.Ctx) error {
		c.Set("Cache-Control", "no-cache")
		return c.Next()
	}, filesystem.New(filesystem.Config{
		Root:         http.FS(ui),
		Index:        "index.html",
		NotFoundFile: "index.html",
	}))

	return s
}

func (s *Server) Listen() error {
	s.log.Info("eurofish listening", "addr", s.cfg.Addr, "db", string(s.db.Dialect), "cache", s.cache.Name(), "version", s.version)
	return s.app.Listen(s.cfg.Addr)
}

func (s *Server) Shutdown(timeout time.Duration) error {
	return s.app.ShutdownWithTimeout(timeout)
}

// RunJanitor periodically purges expired sessions until ctx is cancelled.
func (s *Server) RunJanitor(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if n, err := s.store.DeleteExpiredSessions(ctx); err != nil && ctx.Err() == nil {
			s.log.Warn("session cleanup failed", "err", err)
		} else if n > 0 {
			s.log.Info("expired sessions removed", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// versionedIndex returns index.html with "?v=<content hash>" appended to the
// script (theme.js, i18n.js, app.js) and app.css links, so browsers load the
// new UI right after an update. i18n.js must be versioned too: a stale cached
// copy lacks newly added translations, and the UI would then show raw keys
// such as "auth.passwordConfirm" instead of the text.
func versionedIndex(ui fs.FS) []byte {
	page, err := fs.ReadFile(ui, "index.html")
	if err != nil {
		return nil
	}
	scripts := []string{"theme.js", "i18n.js", "app.js"}
	h := sha256.New()
	for _, name := range append(scripts, "app.css") {
		if b, err := fs.ReadFile(ui, name); err == nil {
			h.Write(b)
		}
	}
	v := hex.EncodeToString(h.Sum(nil))[:12]
	out := string(page)
	for _, name := range scripts {
		out = strings.Replace(out, `src="`+name+`"`, `src="`+name+`?v=`+v+`"`, 1)
	}
	out = strings.Replace(out, `href="app.css"`, `href="app.css?v=`+v+`"`, 1)
	return []byte(out)
}

// ---------- middleware & helpers ----------

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Referrer-Policy", "same-origin")
	c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
	return c.Next()
}

func noStore(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	return c.Next()
}

// requireJSON rejects state-changing requests that are not JSON. Together with
// the SameSite session cookie this blocks cross-site form (CSRF) submissions.
func requireJSON(c *fiber.Ctx) error {
	switch c.Method() {
	case fiber.MethodPost, fiber.MethodPut, fiber.MethodPatch:
		if !strings.HasPrefix(strings.ToLower(c.Get(fiber.HeaderContentType)), fiber.MIMEApplicationJSON) {
			return fiber.NewError(fiber.StatusUnsupportedMediaType, "content type must be application/json")
		}
	case fiber.MethodDelete:
		if c.Get("X-Requested-With") == "" && !strings.HasPrefix(strings.ToLower(c.Get(fiber.HeaderContentType)), fiber.MIMEApplicationJSON) {
			return fiber.NewError(fiber.StatusBadRequest, "missing X-Requested-With header")
		}
	}
	return c.Next()
}

func (s *Server) errorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	msg := "internal server error"
	var fe *fiber.Error
	switch {
	case errors.As(err, &fe):
		code, msg = fe.Code, fe.Message
	case errors.Is(err, store.ErrNotFound):
		code, msg = fiber.StatusNotFound, "not found"
	case errors.Is(err, store.ErrConflict):
		code, msg = fiber.StatusConflict, "already exists"
	default:
		s.log.Error("request failed", "method", c.Method(), "path", c.Path(), "err", err)
	}
	return c.Status(code).JSON(fiber.Map{"error": msg})
}

func badRequest(msg string) error { return fiber.NewError(fiber.StatusBadRequest, msg) }

func (s *Server) healthz(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok", "version": s.version})
}

func (s *Server) readyz(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "db unavailable"})
	}
	if err := s.cache.Ping(ctx); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "cache unavailable"})
	}
	return c.JSON(fiber.Map{"status": "ready"})
}

func (s *Server) getConfig(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"signup_enabled": s.cfg.SignupAllowedFrom(c.IP()),
		"version":        s.version,
	})
}
