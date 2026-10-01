package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type envelope struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
}

func JSON(c *gin.Context, status int, data any) {
	c.JSON(status, envelope{Success: status >= 200 && status < 300, Data: data})
}

func OK(c *gin.Context, data any) {
	JSON(c, http.StatusOK, data)
}

func Fail(c *gin.Context, status int, message string) {
	c.JSON(status, envelope{Success: false, Message: message})
}
