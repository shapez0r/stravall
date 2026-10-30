# syntax=docker/dockerfile:1
# ---- build: produces one static, CGO-free binary (web UI embedded) ----
FROM golang:1.23-alpine AS build
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY . .
ARG VERSION=dev
RUN go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/eurofish ./cmd/eurofish \
 && mkdir -p /out/data

# ---- runtime: FROM scratch, nothing but the binary and CA certificates ----
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/eurofish /eurofish
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV EUROFISH_ADDR=:8080 \
    EUROFISH_DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/eurofish", "healthcheck"]
ENTRYPOINT ["/eurofish"]
CMD ["serve"]
