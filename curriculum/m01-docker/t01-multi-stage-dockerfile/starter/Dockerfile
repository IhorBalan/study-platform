# The naive version: it works, and it does almost everything this module warns about.
# TODO: rewrite this file so that it meets the brief in the task description.

FROM node:latest

WORKDIR /app

# TODO: this copies everything, including whatever is lying around on your machine,
# and it runs before the install, so any source edit reinstalls the dependencies.
COPY . .

RUN npm install
RUN npm run build

# TODO: the process runs as root, starts through npm, and nothing checks that it is healthy.
CMD npm start
