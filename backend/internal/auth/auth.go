package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/alexedwards/argon2id"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrSessionNotFound    = errors.New("session not found")
	ErrRateLimited        = errors.New("too many login attempts")
)

type User struct {
	ID           int64
	Username     string
	PasswordHash string
}

type Session struct {
	ID        string
	UserID    int64
	ExpiresAt time.Time
}

type Service struct {
	db          *sql.DB
	ttl         time.Duration
	attempts    map[string][]time.Time
	attemptsMu  sync.Mutex
	maxAttempts int
	window      time.Duration
}

func New(db *sql.DB, ttl time.Duration) *Service {
	return &Service{
		db:          db,
		ttl:         ttl,
		attempts:    make(map[string][]time.Time),
		maxAttempts: 8,
		window:      10 * time.Minute,
	}
}

func (s *Service) EnsureAdmin(username, password string) error {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return fmt.Errorf("admin credentials required")
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE username = ?`, username).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := argon2id.CreateHash(password, argon2id.DefaultParams)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
		username, hash, time.Now().UTC(),
	)
	return err
}

func (s *Service) Login(username, password, ip string) (*User, *Session, error) {
	if !s.allow(ip) {
		return nil, nil, ErrRateLimited
	}
	user, err := s.findUser(username)
	if err != nil {
		s.recordFail(ip)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrInvalidCredentials
		}
		return nil, nil, err
	}
	ok, err := argon2id.ComparePasswordAndHash(password, user.PasswordHash)
	if err != nil || !ok {
		s.recordFail(ip)
		return nil, nil, ErrInvalidCredentials
	}
	sess, err := s.createSession(user.ID)
	if err != nil {
		return nil, nil, err
	}
	return user, sess, nil
}

func (s *Service) GetSession(id string) (*Session, *User, error) {
	if id == "" {
		return nil, nil, ErrSessionNotFound
	}
	row := s.db.QueryRow(`
		SELECT s.id, s.user_id, s.expires_at, u.id, u.username
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = ?`, id)
	var sess Session
	var user User
	var expires string
	if err := row.Scan(&sess.ID, &sess.UserID, &expires, &user.ID, &user.Username); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrSessionNotFound
		}
		return nil, nil, err
	}
	exp, err := parseTime(expires)
	if err != nil {
		return nil, nil, err
	}
	sess.ExpiresAt = exp
	if time.Now().UTC().After(sess.ExpiresAt) {
		_ = s.DeleteSession(id)
		return nil, nil, ErrSessionNotFound
	}
	return &sess, &user, nil
}

func (s *Service) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (s *Service) createSession(userID int64) (*Session, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(buf)
	exp := time.Now().UTC().Add(s.ttl)
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		id, userID, exp, time.Now().UTC(),
	)
	if err != nil {
		return nil, err
	}
	return &Session{ID: id, UserID: userID, ExpiresAt: exp}, nil
}

func (s *Service) findUser(username string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, username, password_hash FROM users WHERE username = ?`,
		strings.TrimSpace(username),
	).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Service) allow(ip string) bool {
	s.attemptsMu.Lock()
	defer s.attemptsMu.Unlock()
	s.pruneLocked(ip)
	return len(s.attempts[ip]) < s.maxAttempts
}

func (s *Service) recordFail(ip string) {
	s.attemptsMu.Lock()
	defer s.attemptsMu.Unlock()
	s.attempts[ip] = append(s.attempts[ip], time.Now())
}

func (s *Service) pruneLocked(ip string) {
	cutoff := time.Now().Add(-s.window)
	list := s.attempts[ip]
	n := 0
	for _, t := range list {
		if t.After(cutoff) {
			list[n] = t
			n++
		}
	}
	if n == 0 {
		delete(s.attempts, ip)
		return
	}
	s.attempts[ip] = list[:n]
}

func parseTime(v string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, v); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse time %q", v)
}

func (s *Service) Favorites(userID int64) (map[string]struct{}, error) {
	rows, err := s.db.Query(`SELECT rel_path FROM favorites WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]struct{})
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = struct{}{}
	}
	return out, rows.Err()
}

func (s *Service) SetFavorite(userID int64, relPath string, fav bool) error {
	if fav {
		_, err := s.db.Exec(
			`INSERT OR REPLACE INTO favorites (user_id, rel_path, created_at) VALUES (?, ?, ?)`,
			userID, relPath, time.Now().UTC(),
		)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM favorites WHERE user_id = ? AND rel_path = ?`, userID, relPath)
	return err
}

func (s *Service) RenameFavorite(userID int64, from, to string) error {
	_, err := s.db.Exec(`UPDATE favorites SET rel_path = ? WHERE user_id = ? AND rel_path = ?`, to, userID, from)
	return err
}
