# Build
FROM golang:1.26-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

# Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 1000 lony
WORKDIR /app
COPY --from=build /out/api /app/api
RUN mkdir -p /data/media && chown -R lony:lony /data /app
USER lony
ENV HTTP_ADDR=:8080
ENV MEDIA_DIR=/data/media
EXPOSE 8080
CMD ["/app/api"]
