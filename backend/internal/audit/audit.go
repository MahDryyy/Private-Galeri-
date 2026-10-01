package audit

import (
	"log"
	"strings"
)

func Log(action, username, detail string) {
	detail = strings.ReplaceAll(detail, "\n", " ")
	log.Printf("AUDIT action=%s user=%s detail=%s", action, username, detail)
}
