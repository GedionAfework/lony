# Build static admin app
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Admin paths already include /api/v1, so this is the API origin only.
ARG VITE_API_BASE=https://lony-api.fly.dev
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# Serve with nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
