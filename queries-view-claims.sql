-- View all claims with their item rows (form table data)
-- Run this in pgAdmin Query Tool (right-click claimform database -> Query Tool, then paste and F5)

-- 1) All claim headers
SELECT id, date, company_name, customer_id, created_at
FROM claims
ORDER BY created_at DESC;

-- 2) All form table rows (claim_items)
SELECT *
FROM claim_items
ORDER BY claim_id DESC, id;

-- 3) Claims with their items in one view (each claim followed by its table rows)
SELECT
  c.id AS claim_id,
  c.date,
  c.company_name,
  c.customer_id,
  c.created_at AS claim_created_at,
  i.id AS item_id,
  i.style_no,
  i.description,
  i.colour,
  i.size,
  i.reason,
  i.quantity,
  i.order_number,
  i.batch_number
FROM claims c
LEFT JOIN claim_items i ON i.claim_id = c.id
ORDER BY c.created_at DESC, i.id;
