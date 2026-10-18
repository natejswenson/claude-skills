const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

export async function readJsonBody(request, { limit = 100000 } = {}) {
  const length = request.headers?.['content-length'];
  if (length && Number(length) > limit) {
    request.resume?.();
    throw invalid('Request is too large.', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw invalid('Request is too large.', 413);
    chunks.push(bytes);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw invalid('Invalid JSON request.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Request must be a JSON object.');
  return value;
}
