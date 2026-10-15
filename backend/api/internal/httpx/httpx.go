package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type APIError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
}

func (e *APIError) Error() string {
	return e.Code + ": " + e.Message
}

func E(status int, code, message string) *APIError {
	return &APIError{Status: status, Code: code, Message: message}
}

func Field(status int, code, message string, fields map[string]string) *APIError {
	return &APIError{Status: status, Code: code, Message: message, Fields: fields}
}

func JSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func Error(w http.ResponseWriter, err error) {
	var api *APIError
	if errors.As(err, &api) {
		JSON(w, api.Status, ErrorBody{Error: ErrorDetail{
			Code:    api.Code,
			Message: api.Message,
			Fields:  api.Fields,
		}})
		return
	}
	JSON(w, http.StatusInternalServerError, ErrorBody{Error: ErrorDetail{
		Code:    "INTERNAL",
		Message: "unexpected error",
	}})
}

func Decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return Field(http.StatusBadRequest, "MALFORMED_JSON", "request body is invalid JSON", nil)
	}
	return nil
}
