package auth

import (
	"github.com/alexedwards/argon2id"
)

var argonParams = &argon2id.Params{
	Memory:      19 * 1024,
	Iterations:  2,
	Parallelism: 1,
	SaltLength:  16,
	KeyLength:   32,
}

func HashPassword(password string) (string, error) {
	return argon2id.CreateHash(password, argonParams)
}

func VerifyPassword(hash, password string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, hash)
}
