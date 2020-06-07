# base image
FROM node:latest

# set working directory
WORKDIR /app/authentication-api

# add `/app/node_modules/.bin` to $PATH
ENV PATH /app/authentication-api/node_modules/.bin:$PATH

# install and cache app dependencies
COPY package.json /app/authentication-api/package.json
RUN npm install

# wait for database then start app
CMD ["/app/wait-for-it.sh", "registration-api-cache:6379", "-t", "0", "--", "npm", "run", "dev"]
