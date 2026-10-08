// Retrieval-Augmented Generation: keyword TF-IDF retrieval over the local knowledge base,
// then an LLM call restricted to the retrieved context.
const fs = require('fs');
const path = require('path');
const KB_DIR = path.join(__dirname, 'knowledge-base');
const NO_INFO = "I couldn't find reliable information about that in the DrukExplore knowledge base. Please try asking a question related to Bhutan tourism.";
const STOP = new Set('a an the is are was were be of in on at to for and or what which who how can i you me my we do does did about there with from it its this that tell some any see visit go get know want like bhutan bhutanese place thing show give list recommend best top popular please should would could when where many much'.split(' '));

// 1. Load knowledge: every JSON file is an array; each entry becomes one chunk.
const chunks = [];
for (const file of fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.json'))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(KB_DIR, file), 'utf8'))) {
    const content = e.content || `${e.name}: ${e.tagline}. ${e.description} Location: ${e.location}. Best time to visit: ${e.bestTime}. Attractions: ${e.attractions.join(', ')}.`;
    chunks.push({ id: e.id, title: e.title || e.name, category: e.category || path.basename(file, '.json'), content });
  }
}
const tokenize = (t) => (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
chunks.forEach((c) => { c.terms = tokenize(c.title + ' ' + c.content); });
const df = {};
chunks.forEach((c) => new Set(c.terms).forEach((t) => (df[t] = (df[t] || 0) + 1)));
const idf = (t) => Math.log(1 + chunks.length / (df[t] || 0.5));

// 2. Retrieve: score chunks; refuse when too few question terms are found in the knowledge base.
function retrieve(question, k = 3) {
  const q = [...new Set(tokenize(question))];
  if (!q.length) return [];
  const scored = chunks.map((c) => {
    const matched = q.filter((t) => c.terms.includes(t));
    const score = matched.reduce((s, t) => s + idf(t) * (1 + Math.log(c.terms.filter((x) => x === t).length)), 0) / Math.sqrt(c.terms.length);
    return { chunk: c, score, coverage: matched.length / q.length };
  });
  const best = Math.max(...scored.map((s) => s.coverage));
  if (best <= 0.5) return []; // question is mostly about things the KB does not contain
  return scored.filter((s) => s.score > 0 && s.coverage > 0.5).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.chunk);
}

// 3. Generate: answer only from retrieved context.
async function answer(question) {
  const ctx = retrieve(question);
  if (!ctx.length) return { answer: NO_INFO, grounded: false, sources: [] };
  const sources = ctx.map((c) => c.title);
  if (!process.env.AI_API_KEY) // no key configured: return the retrieved text itself (still grounded)
    return { answer: ctx.map((c) => c.content).join('\n\n'), grounded: true, sources, note: 'AI_API_KEY not set - showing retrieved text.' };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.AI_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-sonnet-4-6',
      max_tokens: 500,
      system: `You are the DrukExplore travel assistant. Answer ONLY using the CONTEXT below. Never add outside facts (prices, hours, rules, history, transport). If the context does not answer the question, reply exactly: "${NO_INFO}" Keep answers friendly and concise.`,
      messages: [{ role: 'user', content: `CONTEXT:\n${ctx.map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`).join('\n\n')}\n\nQUESTION: ${question}` }]
    })
  });
  if (!r.ok) throw new Error('LLM error ' + r.status);
  const text = (await r.json()).content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const grounded = !text.includes("couldn't find reliable information");
  return { answer: text, grounded, sources: grounded ? sources : [] };
}
module.exports = { answer, retrieve };
