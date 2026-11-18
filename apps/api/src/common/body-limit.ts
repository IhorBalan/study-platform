/**
 * Largest JSON body the API reads. The default of 100 kB is below what the
 * schemas allow: a review reply may be 90,000 characters, and escaping or
 * non-Latin text (two bytes or more per character) takes it well past 100 kB.
 */
export const JSON_BODY_LIMIT = '1mb';
