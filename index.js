require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const { Resend } = require('resend');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

const app = express();
const PORT = process.env.PORT || 3000;

const resendApiKey = process.env.RESEND_API_KEY;
// Support multiple recipients: comma-separated in CLAIM_FORM_EMAIL
const claimFormEmails = (process.env.CLAIM_FORM_EMAIL || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const fromName = process.env.RESEND_FROM_NAME || 'Claim Form';

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Build pool config so password is always a string (avoids "client password must be a string" with SCRAM)
function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return new Pool({
      host: u.hostname,
      port: parseInt(u.port, 10) || 5432,
      database: u.pathname.slice(1).replace(/^\/+/, '') || undefined,
      user: u.username || undefined,
      password: u.password !== undefined && u.password !== null ? u.password : '',
    });
  } catch (_) {
    return new Pool({ connectionString: url });
  }
}
const pool = createPool();

// Form body is application/x-www-form-urlencoded (contact[date], contact[item_1_style_no], etc.)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const allowedOrigin = process.env.CLAIM_FORM_ORIGIN || '*';
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['POST', 'OPTIONS'],
  })
);

/**
 * Normalize multipart req.body for parseClaimBody.
 * Multer uses append-field which already nests bracket notation (contact[date] -> body.contact.date),
 * so if body.contact exists we leave it as-is. Otherwise build contact from flat keys.
 */
function normalizeMultipartBody(req) {
  const raw = req.body;
  if (!raw || typeof raw !== 'object') return;
  if (raw.contact && typeof raw.contact === 'object') {
    return; // already nested by multer/append-field
  }
  const contact = {};
  for (const key of Object.keys(raw)) {
    const m = key.match(/^contact\[(.+)\]$/);
    if (m) contact[m[1]] = raw[key];
  }
  req.body = { contact };
}

/**
 * Parse contact object from body into claim header + items.
 * Body shape: { contact: { date, company_name, customer_id, item_1_style_no, item_1_description, ... } }
 */
function parseClaimBody(body) {
  const contact = body.contact || body;
  const date = contact.date || null;
  const company_name = (contact.company_name || '').trim() || null;
  const customer_id = (contact.customer_id || '').trim() || null;
  const rawEmail = contact.customer_email;
  const customer_email =
    rawEmail != null && String(rawEmail).trim() !== ''
      ? String(rawEmail).trim()
      : null;

  const items = [];
  const seen = new Set();
  for (const key of Object.keys(contact)) {
    const m = key.match(/^item_(\d+)_(.+)$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const field = m[2];
    if (!seen.has(idx)) {
      seen.add(idx);
      items.push({
        index: idx,
        style_no: '',
        description: '',
        colour: '',
        size: '',
        reason: '',
        quantity: '',
        order_number: '',
        batch_number: '',
      });
    }
    const item = items.find((i) => i.index === idx);
    if (item && field in item) item[field] = contact[key] || '';
  }
  items.sort((a, b) => a.index - b.index);

  return { date, company_name, customer_id, customer_email, items };
}

/**
 * Build HTML email body for a claim and send via Resend.
 * No-op if RESEND_API_KEY or CLAIM_FORM_EMAIL is missing.
 * @param {Buffer} [attachment] - Optional file buffer (e.g. claim photo)
 * @param {string} [attachmentFilename] - Filename for the attachment
 */
function isPlausibleEmail(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.length > 3 && t.includes('@') && !/\s/.test(t);
}

async function sendClaimEmail(
  claimId,
  date,
  company_name,
  customer_id,
  customer_email,
  items,
  attachment,
  attachmentFilename
) {
  if (!resend || claimFormEmails.length === 0) return;
  const rows = items
    .map(
      (r, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.style_no)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.colour)}</td>
          <td>${escapeHtml(r.size)}</td>
          <td>${escapeHtml(r.reason)}</td>
          <td>${escapeHtml(r.quantity)}</td>
          <td>${escapeHtml(r.order_number)}</td>
          <td>${escapeHtml(r.batch_number)}</td>
        </tr>`
    )
    .join('');
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}</style></head>
<body>
  <h2>New claim #${claimId}</h2>
  <p><strong>Date:</strong> ${escapeHtml(date)}<br>
  <strong>Company:</strong> ${escapeHtml(company_name)}<br>
  <strong>Customer ID:</strong> ${escapeHtml(customer_id)}<br>
  <strong>Customer email:</strong> ${customer_email ? escapeHtml(customer_email) : '<em>(not provided)</em>'}</p>
  <h3>Items</h3>
  <table>
    <thead><tr>
      <th>#</th><th>Style No</th><th>Description</th><th>Colour</th><th>Size</th><th>Reason</th><th>Qty</th><th>Order/Delivery/Invoice No</th><th>Batch No</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  const text = `New claim #${claimId}\nDate: ${date}\nCompany: ${company_name}\nCustomer ID: ${customer_id}\nCustomer email: ${customer_email || '(not provided)'}\n\nItems:\n${items
    .map(
      (r, i) =>
        `${i + 1}. ${r.style_no} | ${r.description} | ${r.colour} | ${r.size} | ${r.reason} | Qty: ${r.quantity} | Order: ${r.order_number} | Batch: ${r.batch_number}`
    )
    .join('\n')}`;
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const payload = { from, to: claimFormEmails, subject: `Claim #${claimId} – ${company_name}`, html, text };
  if (isPlausibleEmail(customer_email)) {
    payload.replyTo = customer_email.trim();
  }
  if (attachment && Buffer.isBuffer(attachment) && attachmentFilename) {
    payload.attachments = [{ filename: attachmentFilename, content: attachment }];
  }
  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error('Resend error:', error.message || error, error);
    } else {
      console.log(`Claim email sent for #${claimId} to ${claimFormEmails.join(', ')} (id: ${data?.id || 'n/a'})`);
    }
  } catch (err) {
    console.error('Resend error:', err.message, err);
  }
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.post('/api/claims', (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.indexOf('multipart/form-data') === 0) {
    return upload.single('contact[claim_photo]')(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'Invalid form or file. File must be under 10MB.' });
      normalizeMultipartBody(req);
      next();
    });
  }
  next();
}, async (req, res) => {
  const { date, company_name, customer_id, customer_email, items } = parseClaimBody(req.body);

  if (!date || !company_name || !customer_id) {
    return res.status(400).json({
      error: 'Missing required fields: date, company_name, customer_id',
    });
  }

  let claimId = `claim-${Date.now()}`;
  const attachment = req.file && req.file.buffer ? req.file.buffer : null;
  const attachmentFilename = req.file && req.file.originalname ? req.file.originalname : (attachment ? 'claim-photo.jpg' : null);

  if (pool) {
    let client;
    try {
      client = await pool.connect();
    } catch (connErr) {
      console.warn('Database unavailable, sending email only:', connErr.message || connErr);
    }
    if (client) {
      try {
        await client.query('BEGIN');
        const claimResult = await client.query(
          `INSERT INTO claims (date, company_name, customer_id) VALUES ($1::date, $2, $3) RETURNING id`,
          [date, company_name, customer_id]
        );
        claimId = claimResult.rows[0].id;

        for (const row of items) {
          await client.query(
            `INSERT INTO claim_items (claim_id, style_no, description, colour, size, reason, quantity, order_number, batch_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              claimId,
              row.style_no || null,
              row.description || null,
              row.colour || null,
              row.size || null,
              row.reason || null,
              row.quantity || null,
              row.order_number || null,
              row.batch_number || null,
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Claim insert error:', err);
      } finally {
        client.release();
      }
    }
  }

  // Send claim data to configured email via Resend (non-blocking for response), with optional photo attachment
  sendClaimEmail(claimId, date, company_name, customer_id, customer_email, items, attachment, attachmentFilename).catch((err) =>
    console.error('Claim email error:', err)
  );

  return res.status(201).json({ success: true, claim_id: claimId });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: !!pool });
});

app.listen(PORT, () => {
  console.log(`Claim form server listening on port ${PORT}`);
  if (!pool) console.warn('DATABASE_URL not set: claims will not be stored.');
  if (!resendApiKey || claimFormEmails.length === 0)
    console.warn('RESEND_API_KEY or CLAIM_FORM_EMAIL not set: claim emails will not be sent.');
});
