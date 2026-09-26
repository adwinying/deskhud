# Compiles on the build platform, cross-targeting the image's arch, so CI never emulates the build.
# Keep the tag in sync with mise.toml.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.0-alpine AS build
ARG TARGETARCH

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src src
RUN case "$TARGETARCH" in amd64) arch=x64 ;; *) arch=$TARGETARCH ;; esac \
  && bun build --compile --minify --target="bun-linux-$arch-musl" src/index.ts --outfile deskhud

FROM alpine:3
# Debug tools; cat and wget already come with busybox.
# openssh-client runs Tap actions on the Workstation.
RUN apk add --no-cache libstdc++ libgcc tzdata openssh-client bash curl vim less
COPY --from=build /app/deskhud /usr/local/bin/deskhud

ENV NODE_ENV=production TZ=Asia/Tokyo
EXPOSE 3000
USER nobody
CMD ["deskhud"]
