FROM node:18
# Create app directory
WORKDIR /usr/src/app

COPY package*.json .
RUN npm ci
COPY config/docker.json config/default.json
COPY dist/ dist/

EXPOSE 8080
#CMD [ "sleep", "infinity" ]
CMD [ "node", "dist/server/server.js" ]