// The product catalogue: 100,000 products, generated the same way on every start.
// In the real service this is loaded from the database once at boot.

const ADJECTIVES = ['Amber', 'Brisk', 'Cobalt', 'Dusty', 'Eager', 'Fabled', 'Gilded', 'Hollow', 'Ivory', 'Jade', 'Keen', 'Lunar', 'Misty', 'Noble', 'Opal', 'Plush', 'Quiet', 'Rustic', 'Sable', 'Tidal'];
const NOUNS = ['Lamp', 'Kettle', 'Chair', 'Rug', 'Mug', 'Vase', 'Clock', 'Shelf', 'Stool', 'Bowl', 'Basket', 'Mirror', 'Pillow', 'Throw', 'Tray', 'Planter'];
export const CATEGORIES = ['kitchen', 'living', 'bedroom', 'bath', 'garden', 'office', 'kids', 'outdoor', 'lighting', 'storage', 'decor', 'textiles'];
export const PRODUCT_COUNT = 100_000;

/** A small seeded PRNG (mulberry32), so the catalogue is identical on every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadCatalogue() {
  const next = random(20261118);
  const products = [];
  for (let id = 1; id <= PRODUCT_COUNT; id++) {
    const name = `${ADJECTIVES[Math.floor(next() * ADJECTIVES.length)]} ${NOUNS[Math.floor(next() * NOUNS.length)]} ${Math.floor(next() * 900 + 100)}`;
    products.push({
      id,
      name,
      category: CATEGORIES[Math.floor(next() * CATEGORIES.length)],
      price: Math.round((5 + next() * 495) * 100) / 100,
      rating: Math.round(next() * 40 + 10) / 10,
    });
  }
  return products;
}

/** The long description shown on a product page: about 30 kB of text. */
export function describe(product) {
  const lines = [];
  for (let i = 1; i <= 480; i++) {
    lines.push(`${product.name} (${product.category}) detail ${i}: rated ${product.rating}, priced at ${product.price}.`);
  }
  return lines.join(' ');
}
