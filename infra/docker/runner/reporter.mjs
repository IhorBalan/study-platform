// node:test reporter used inside the sandbox. It writes one JSON line per
// top-level test, which is one acceptance criterion: {"id","name","passed","message"}.
// The bridge reads these lines from a file, so nothing a submission prints to
// stdout can be mistaken for a result.

function describeFailure(details) {
  const error = details?.error;
  if (!error) return 'failed';
  // node:test wraps the real error; the cause carries the assertion message.
  const cause = error.cause ?? error;
  const message = typeof cause === 'string' ? cause : (cause?.message ?? String(cause));
  return String(message).slice(0, 4000);
}

export default async function* criteriaReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name, nesting, details } = event.data;
    if (nesting !== 0 || details?.type === 'suite') continue;

    const colon = name.indexOf(':');
    const id = (colon === -1 ? name : name.slice(0, colon)).trim();
    const passed = event.type === 'test:pass' && !event.data.skip && !event.data.todo;
    yield `${JSON.stringify({
      id,
      name,
      passed,
      message: passed ? null : event.data.skip ? 'check was skipped' : describeFailure(details),
    })}\n`;
  }
}
