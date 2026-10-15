# Build static web app
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Point the SPA at the public API (override at build time).
ARG VITE_API_BASE=https://lony-api.fly.dev/api/v1
ARG VITE_ADMIN_URL=https://lony-admin.fly.dev
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_ADMIN_URL=$VITE_ADMIN_URL
RUN npm run build

# Serve with nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
