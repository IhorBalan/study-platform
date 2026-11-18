// The product service. Product pages are cached after the first render, and each
// page links to related products from the same category.
import http from 'node:http';
import { describe, loadCatalogue } from './catalogue.mjs';

const catalogue = loadCatalogue();
const byId = new Map(catalogue.map((product) => [product.id, product]));

// Rendered product pages, so each one is only built once.
const pageCache = new Map();

function byRatingThenName(a, b) {
  return b.rating - a.rating || a.name.localeCompare(b.name) || a.id - b.id;
}

/** The five best-rated other products in the same category. */
function relatedProducts(product) {
  const ranked = catalogue.slice().sort(byRatingThenName);
  return ranked
    .filter((other) => other.category === product.category && other.id !== product.id)
    .slice(0, 5)
    .map(({ id, name, rating }) => ({ id, name, rating }));
}

function productPage(req, product) {
  let body = pageCache.get(req.url);
  if (body === undefined) {
    body = JSON.stringify({ ...product, description: describe(product) });
    pageCache.set(req.url, body);
  }
  return body;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

    const match = /^\/products\/(\d+)(\/related)?$/.exec(url.pathname);
    const product = match ? byId.get(Number(match[1])) : undefined;
    if (!product) return send(res, 404, { error: 'not found' });

    if (match[2]) return send(res, 200, { id: product.id, related: relatedProducts(product) });
    return send(res, 200, productPage(req, product));
  });
}
