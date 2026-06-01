import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PATH = path.join(__dirname, '..', 'data', 'stories.json');
const REPORT_PATH  = path.join(__dirname, '..', 'data', 'latest-report.html');

// ── Config ────────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const EMAIL_FROM        = process.env.EMAIL_FROM;
const EMAIL_TO          = process.env.EMAIL_TO;
const EXTRA_KEYWORDS    = process.env.EXTRA_KEYWORDS || '';

if (!ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }
if (!RESEND_API_KEY)    { console.error('Missing RESEND_API_KEY');    process.exit(1); }
if (!EMAIL_FROM)        { console.error('Missing EMAIL_FROM');         process.exit(1); }
if (!EMAIL_TO)          { console.error('Missing EMAIL_TO');           process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadArchive() {
  try {
    if (fs.existsSync(ARCHIVE_PATH)) return JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
  } catch(e) { console.warn('Could not load archive:', e.message); }
  return [];
}

function saveArchive(stories) {
  fs.mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(stories, null, 2));
}

function sanitizeJson(raw) {
  raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const si = raw.indexOf('[');
  const ei = raw.lastIndexOf(']');
  if (si < 0 || ei < 0) return null;
  let s = raw.substring(si, ei + 1);
  // Neutralise control characters inside strings
  s = s.replace(/[\u0000-\u001F\u007F]/g, c => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    return '';
  });
  return s;
}

function extractObjectsFallback(raw) {
  const results = [];
  // Match top-level JSON objects (non-nested brace pairs)
  const re = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
  for (const m of raw.match(re) || []) {
    try {
      const obj = JSON.parse(m);
      if (obj.title && obj.sentiment) results.push(obj);
    } catch(_) {}
  }
  return results;
}

function robustParse(raw) {
  const cleaned = sanitizeJson(raw);
  if (cleaned) {
    try { return JSON.parse(cleaned); } catch(_) {}
    try {
      const fixed = cleaned
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([^\\])"([^"]*?)\n([^"]*?)"/g, '$1"$2 $3"');
      return JSON.parse(fixed);
    } catch(_) {}
  }
  return extractObjectsFallback(raw);
}

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch(_) { return d || ''; }
}

function dealStr(s) {
  return s.dealSize && s.dealSize !== 'undisclosed' ? s.dealSize : (s.dealSizeNum > 0 ? `$${s.dealSizeNum}M` : 'Undisclosed');
}

// ── Fetch stories ─────────────────────────────────────────────────────────────
async function fetchStories() {
  const client  = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const today   = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sectors = ['Defense','Technology','Energy','Healthcare','Infrastructure','Finance','Space','Manufacturing','Other'];

  const systemPrompt = `You are a financial intelligence analyst specializing in US government contracts, partnerships, and investment commitments that affect publicly traded companies.

CRITICAL: Your entire response must be a single valid JSON array. No markdown, no explanation, no text outside the array. All string values must use only plain ASCII — no curly quotes, no em-dashes, no special characters. Keep all string values concise (under 200 characters) to avoid JSON parsing issues.

Each object must have EXACTLY these fields:
- title: string, plain ASCII headline
- summary: string, 2 sentences max, plain ASCII
- detail: string, 3 sentences max, plain ASCII
- date: string, YYYY-MM-DD format
- sector: one of [${sectors.join(', ')}]
- sentiment: exactly one of: bullish, neutral, bearish
- tickers: array of ticker strings e.g. ["LMT","RTX"]
- companies: array of company name strings
- dealSizeNum: number in millions USD, use 0 if unknown
- dealSize: string e.g. "$2.5B", "~$400M", "undisclosed"
- source: string, publication name
- sourceUrl: string, URL or empty string
- keyThesis: string, 1 sentence, plain ASCII
- risks: string, 1 sentence, plain ASCII
- catalysts: array of 2-3 short strings
- timeHorizon: one of: short, medium, long

Find 8-10 significant recent stories. Focus on: executive orders with named commercial beneficiaries, DOD/DOE/NASA/HHS/DOT contracts, AI and semiconductor partnerships, reshoring incentives, energy policy deals, pharma commitments, infrastructure spending.${EXTRA_KEYWORDS ? ` Also cover: ${EXTRA_KEYWORDS}.` : ''}

Return ONLY the JSON array, nothing else.`;

  console.log('Calling Anthropic API with web search...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 6000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Today is ${today}. Search the web for the latest (past 7 days) US government partnership, contract, investment, and executive order news affecting publicly traded US companies. Include Trump administration actions, agency contracts, public-private AI/tech/defense/energy initiatives. Respond with ONLY a JSON array — no explanation, no markdown, just the raw JSON array starting with [ and ending with ].`
    }]
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }

  console.log(`Raw response length: ${raw.length} chars`);

  const parsed = robustParse(raw);
  if (!parsed || !parsed.length) {
    console.error('Raw response snippet:', raw.substring(0, 500));
    throw new Error('Failed to parse stories from API response');
  }

  console.log(`Parsed ${parsed.length} stories`);
  return parsed;
}

// ── Build HTML email ──────────────────────────────────────────────────────────
function buildEmailHtml(newStories, allStories) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const bull  = newStories.filter(s => s.sentiment === 'bullish').length;
  const bear  = newStories.filter(s => s.sentiment === 'bearish').length;
  const total = newStories.reduce((a, s) => a + (s.dealSizeNum || 0), 0);
  const totalStr = total > 0 ? `$${total >= 1000 ? (total/1000).toFixed(1) + 'B' : total + 'M'}` : 'N/A';

  const sentColor = { bullish: '#1D9E75', bearish: '#E24B4A', neutral: '#888780' };
  const sentBg    = { bullish: '#EAF3DE', bearish: '#FCEBEB', neutral: '#f5f5f3' };
  const sentText  = { bullish: '#3B6D11', bearish: '#A32D2D', neutral: '#6b6b66' };

  const storyCards = newStories.map(s => `
    <div style="background:#ffffff;border:1px solid #e5e5e0;border-radius:10px;padding:18px 20px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:11px;background:${sentBg[s.sentiment]||'#f5f5f3'};color:${sentText[s.sentiment]||'#6b6b66'};padding:2px 9px;border-radius:20px;font-weight:600">${s.sentiment}</span>
        <span style="font-size:11px;background:#EEEDFE;color:#3C3489;padding:2px 9px;border-radius:20px;font-weight:600">${s.sector}</span>
        <span style="font-size:11px;background:#f5f5f3;color:#6b6b66;padding:2px 9px;border-radius:20px">${dealStr(s)}</span>
        <span style="font-size:11px;color:#9b9b96">${fmtDate(s.date)} · ${s.source || 'News'}</span>
      </div>
      <div style="font-size:15px;font-weight:600;color:#1a1a18;line-height:1.4;margin-bottom:8px">${s.title}</div>
      <div style="font-size:13px;color:#6b6b66;line-height:1.65;margin-bottom:10px">${s.summary}</div>
      ${(s.tickers||[]).length ? `<div style="margin-bottom:10px">${(s.tickers||[]).map(t=>`<span style="font-family:monospace;font-size:11px;font-weight:700;padding:2px 8px;border:1px solid #e5e5e0;border-radius:4px;background:#f5f5f3;margin-right:5px">${t}</span>`).join('')}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <tr>
          <td style="width:50%;padding:8px 10px;background:#f0f9f4;border-radius:6px;font-size:12px;color:#3B6D11;vertical-align:top">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;color:#1D9E75">Investment thesis</div>
            ${s.keyThesis || '—'}
          </td>
          <td style="width:4px"></td>
          <td style="width:50%;padding:8px 10px;background:#fff5f5;border-radius:6px;font-size:12px;color:#A32D2D;vertical-align:top">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;color:#E24B4A">Key risk</div>
            ${s.risks || '—'}
          </td>
        </tr>
      </table>
      ${(s.catalysts||[]).length ? `<div style="font-size:11px;color:#6b6b66">${(s.catalysts||[]).map(c=>`<span style="display:inline-block;background:#EEEDFE;color:#3C3489;padding:2px 8px;border-radius:20px;margin:2px 4px 2px 0">${c}</span>`).join('')}</div>` : ''}
      ${s.sourceUrl ? `<div style="margin-top:8px"><a href="${s.sourceUrl}" style="font-size:11px;color:#185FA5;text-decoration:none">View source →</a></div>` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eeede8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px 40px">

    <!-- Header -->
    <div style="text-align:center;padding:28px 0 20px">
      <div style="font-size:22px;font-weight:700;color:#1a1a18;letter-spacing:-.5px">US Gov Deal Intelligence</div>
      <div style="font-size:13px;color:#6b6b66;margin-top:4px">${date}</div>
    </div>

    <!-- Stats row -->
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <div style="flex:1;background:#ffffff;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e5e0">
        <div style="font-size:10px;color:#9b9b96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">New stories</div>
        <div style="font-size:24px;font-weight:700;color:#1a1a18">${newStories.length}</div>
      </div>
      <div style="flex:1;background:#ffffff;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e5e0">
        <div style="font-size:10px;color:#9b9b96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Bullish</div>
        <div style="font-size:24px;font-weight:700;color:#1D9E75">${bull}</div>
      </div>
      <div style="flex:1;background:#ffffff;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e5e0">
        <div style="font-size:10px;color:#9b9b96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Bearish</div>
        <div style="font-size:24px;font-weight:700;color:#E24B4A">${bear}</div>
      </div>
      <div style="flex:1;background:#ffffff;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e5e0">
        <div style="font-size:10px;color:#9b9b96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Deal value</div>
        <div style="font-size:24px;font-weight:700;color:#185FA5">${totalStr}</div>
      </div>
    </div>

    <!-- Stories -->
    <div style="font-size:13px;font-weight:600;color:#6b6b66;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Today's intelligence (${newStories.length} stories)</div>
    ${storyCards}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0 0;border-top:1px solid #e5e5e0;margin-top:8px">
      <div style="font-size:11px;color:#9b9b96;line-height:1.6">
        Archive total: ${allStories.length} stories collected<br>
        This digest is generated automatically every day at 7:00 AM UTC<br><br>
        <strong style="color:#A32D2D">⚠ For research purposes only. Not financial advice.</strong><br>
        Always conduct your own due diligence before making investment decisions.
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ── Build plain-text email fallback ──────────────────────────────────────────
function buildEmailText(newStories) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const lines = [
    'US GOV DEAL INTELLIGENCE',
    date,
    '='.repeat(50),
    '',
    `${newStories.length} new stories today`,
    '',
  ];
  newStories.forEach((s, i) => {
    lines.push(`${i+1}. ${s.title}`);
    lines.push(`   ${s.sentiment.toUpperCase()} | ${s.sector} | ${dealStr(s)} | ${s.timeHorizon} horizon`);
    lines.push(`   Tickers: ${(s.tickers||[]).join(', ') || '—'}`);
    lines.push(`   ${s.summary}`);
    lines.push(`   Thesis: ${s.keyThesis || '—'}`);
    lines.push(`   Risk: ${s.risks || '—'}`);
    if (s.sourceUrl) lines.push(`   Source: ${s.sourceUrl}`);
    lines.push('');
  });
  lines.push('='.repeat(50));
  lines.push('For research purposes only. Not financial advice.');
  return lines.join('\n');
}

// ── Send email ────────────────────────────────────────────────────────────────
async function sendEmail(newStories, allStories) {
  const resend = new Resend(RESEND_API_KEY);

  const date    = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const bull    = newStories.filter(s => s.sentiment === 'bullish').length;
  const subject = `US Gov Deal Intel — ${date} — ${newStories.length} stories, ${bull} bullish`;

  const { data, error } = await resend.emails.send({
    from:    EMAIL_FROM,
    to:      EMAIL_TO,
    subject,
    text:    buildEmailText(newStories),
    html:    buildEmailHtml(newStories, allStories),
  });

  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  console.log(`Email sent to ${EMAIL_TO} — id: ${data.id}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== US Gov Deal Tracker — Daily Fetch ===');
  console.log('Time:', new Date().toISOString());

  // Load existing archive
  const archive = loadArchive();
  const existingTitles = new Set(archive.map(s => (s.title || '').toLowerCase()));
  console.log(`Archive has ${archive.length} existing stories`);

  // Fetch new stories
  const fetched = await fetchStories();

  // Deduplicate
  const newStories = fetched
    .filter(s => !existingTitles.has((s.title || '').toLowerCase()))
    .map((s, i) => ({ ...s, id: `s_${Date.now()}_${i}`, fetchedAt: new Date().toISOString() }));

  console.log(`New stories after dedup: ${newStories.length}`);

  // Merge and save archive (keep latest 500)
  const merged = [...newStories, ...archive].slice(0, 500);
  saveArchive(merged);
  console.log(`Archive saved: ${merged.length} total stories`);

  // Save latest HTML report (viewable as a static page)
  const reportHtml = buildEmailHtml(newStories.length ? newStories : fetched.slice(0, 8), merged);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, reportHtml);
  console.log('HTML report saved to data/latest-report.html');

  // Send email if there are new stories (or always send if archive was empty)
  const toEmail = newStories.length > 0 ? newStories : fetched.slice(0, 8);
  if (toEmail.length > 0) {
    await sendEmail(toEmail, merged);
  } else {
    console.log('No new stories found, skipping email');
  }

  console.log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
