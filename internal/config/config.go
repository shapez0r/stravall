// Package config loads eurofish runtime configuration from environment
// variables. Every setting has a sane default so the binary runs with zero
// configuration on a laptop or home-lab machine.
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// Addr is the listen address, e.g. ":8080" (all interfaces, reachable from the LAN).
	Addr string
	// DataDir holds the SQLite database when the sqlite driver is used.
	DataDir string
	// DBDriver is "sqlite" (default, single node) or "mysql"/"mariadb" (shared, multi-node).
	DBDriver string
	// DBDSN is the driver-specific data source name.
	DBDSN string
	// CacheURL is "memory" (in-process) or a redis:// / rediss:// URL pointing at Valkey or Redis.
	CacheURL string
	// SessionTTL is how long a login session stays valid.
	SessionTTL time.Duration
	// CookieSecure marks the session cookie Secure. Enable when serving over HTTPS.
	CookieSecure bool
	// AllowSignup enables self-service account creation.
	AllowSignup bool
	// SignupCIDRs optionally restricts sign-up to clients from these networks
	// (e.g. your home LAN). Empty means any address may sign up.
	SignupCIDRs []*net.IPNet
	// ProxyHeader is the header carrying the real client IP when running
	// behind a trusted reverse proxy (e.g. "X-Forwarded-For"). Empty = use the socket address.
	ProxyHeader string
	// LogRequests enables per-request access logging.
	LogRequests bool
}

func Load() (*Config, error) {
	c := &Config{
		Addr:        env("EUROFISH_ADDR", ":8080"),
		DataDir:     env("EUROFISH_DATA_DIR", "./data"),
		DBDriver:    strings.ToLower(env("EUROFISH_DB_DRIVER", "sqlite")),
		CacheURL:    env("EUROFISH_CACHE_URL", "memory"),
		ProxyHeader: env("EUROFISH_PROXY_HEADER", ""),
	}

	var err error
	if c.SessionTTL, err = time.ParseDuration(env("EUROFISH_SESSION_TTL", "720h")); err != nil {
		return nil, fmt.Errorf("EUROFISH_SESSION_TTL: %w", err)
	}
	if c.CookieSecure, err = envBool("EUROFISH_COOKIE_SECURE", false); err != nil {
		return nil, err
	}
	if c.AllowSignup, err = envBool("EUROFISH_ALLOW_SIGNUP", true); err != nil {
		return nil, err
	}
	if c.LogRequests, err = envBool("EUROFISH_LOG_REQUESTS", true); err != nil {
		return nil, err
	}

	for _, raw := range strings.Split(env("EUROFISH_SIGNUP_CIDRS", ""), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		_, n, err := net.ParseCIDR(raw)
		if err != nil {
			return nil, fmt.Errorf("EUROFISH_SIGNUP_CIDRS: %w", err)
		}
		c.SignupCIDRs = append(c.SignupCIDRs, n)
	}

	c.DBDSN = env("EUROFISH_DB_DSN", "")
	switch c.DBDriver {
	case "sqlite", "sqlite3":
		c.DBDriver = "sqlite"
		if c.DBDSN == "" {
			c.DBDSN = "file:" + filepath.Join(c.DataDir, "eurofish.db")
		}
	case "mysql", "mariadb":
		c.DBDriver = "mysql"
		if c.DBDSN == "" {
			return nil, fmt.Errorf("EUROFISH_DB_DSN is required for the %s driver", c.DBDriver)
		}
	default:
		return nil, fmt.Errorf("EUROFISH_DB_DRIVER: unsupported driver %q (use sqlite or mariadb)", c.DBDriver)
	}

	if c.SessionTTL < time.Hour {
		return nil, fmt.Errorf("EUROFISH_SESSION_TTL must be at least 1h")
	}
	return c, nil
}

// SignupAllowedFrom reports whether a client IP may create an account.
func (c *Config) SignupAllowedFrom(ip string) bool {
	if !c.AllowSignup {
		return false
	}
	if len(c.SignupCIDRs) == 0 {
		return true
	}
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return false
	}
	for _, n := range c.SignupCIDRs {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func envBool(key string, def bool) (bool, error) {
	v := env(key, "")
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return b, nil
}
