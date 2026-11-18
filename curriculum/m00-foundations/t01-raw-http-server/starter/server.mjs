import http from 'node:http';

export const BODY_LIMIT_BYTES = 1024;

/**
 * Returns a node:http server that is not listening yet.
 * Each call must create its own empty store of notes.
 */
export function createServer() {
  // TODO: create the in-memory store here, so every server has its own.

  return http.createServer((req, res) => {
    // TODO: route on the path first, then on the method.
    //   GET    /notes       -> 200, array of notes
    //   POST   /notes       -> 201, created note, Location header
    //   GET    /notes/:id   -> 200, one note
    //   DELETE /notes/:id   -> 204
    // TODO: read the JSON body with a size limit (BODY_LIMIT_BYTES).
    // TODO: send every error as application/problem+json.
    res.writeHead(501, { 'content-type': 'text/plain' });
    res.end('Not implemented');
  });
}
