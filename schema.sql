-- Claim form: one claim header per submission
CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  company_name VARCHAR(500) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claim items: table rows (style no, description, colour, etc.)
CREATE TABLE IF NOT EXISTS claim_items (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  style_no VARCHAR(255),
  description VARCHAR(500),
  colour VARCHAR(255),
  size VARCHAR(100),
  reason VARCHAR(500),
  quantity VARCHAR(50),
  order_number VARCHAR(255),
  batch_number VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_items_claim_id ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at);
