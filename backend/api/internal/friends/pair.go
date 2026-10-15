package friends

import (
	"bytes"

	"github.com/google/uuid"
)

func CanonicalPair(a, b uuid.UUID) (low, high uuid.UUID) {
	if bytes.Compare(a[:], b[:]) <= 0 {
		return a, b
	}
	return b, a
}

func OtherParty(viewer uuid.UUID, requester, addressee uuid.UUID) uuid.UUID {
	if viewer == requester {
		return addressee
	}
	return requester
}
