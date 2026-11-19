# Pairing notes

## Questions before coding

1. May a cursor be reused with a different sort or status? Assumed no: a cursor belongs to the query that produced it. A cursor from a sort on the other field is rejected because its value has the wrong type. I do not detect a changed status.
2. Does the client need a total count? Assumed no. It costs a second pass over the data and is rarely shown with "load more".
3. What should a repeated parameter do, such as `status=open&status=closed`? Assumed the first one wins, which is what `URLSearchParams.get` does. Filtering on several statuses would be a new feature.
4. Should an unknown parameter be an error? The brief says to ignore it.

## Slices

- [x] Status filter with its validation and a test.
- [x] Sorting, with ties by id. Four expected orders written by hand in the test first.
- [x] Limit with validation, in the core and for the query string.
- [x] Cursor: walk test first, then the change-between-pages test.
- [x] HTTP: pass the parameters on, 400 for a ValidationError.

## Decisions

- "I'll start with the filter because it is the smallest thing that runs end to end, and it gives me a test file to extend."
- "The cursor stores the sort value and the id of the last ticket, not an offset. With an offset, a ticket created at the top pushes everything down by one and the next page repeats a ticket."
- "I won't look the cursor ticket up by id. If it was deleted in the meantime the lookup finds nothing, while a comparison with its stored position still works."
- "Ties need the id. Two tickets with the same createdAt have no fixed order otherwise, and a page boundary between them could drop one."
- "One comparator for sorting and for 'is after the cursor'. If they disagreed, pages would overlap."
- "I take limit + 1 rows to know whether another page exists. Without that, a list of exactly 20 would return a cursor to an empty page."
- "For limit I test the text with a regular expression. parseInt would read '10abc' as 10."

## Left to do

- Sorting the whole array for every request is fine for a list in memory. With a database this becomes `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT $3` on a matching index.
- The cursor is not signed, so a client can build one by hand. It only moves the starting point, so I left it.
- With ten more minutes: bind the cursor to the status and sort it was issued for, and reject a mismatch.

Time spent: about 40 minutes.
