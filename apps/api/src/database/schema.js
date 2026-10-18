export const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('draft', 'published')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  size TEXT NOT NULL,
  color TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand >= 0),
  stock_reserved INTEGER NOT NULL DEFAULT 0 CHECK(stock_reserved >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (0 <= stock_reserved AND stock_reserved <= stock_on_hand),
  UNIQUE (product_id, size, color)
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('customer', 'admin')),
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorized_admins (
  actor_id TEXT PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  status TEXT NOT NULL CHECK(status IN ('pending_payment', 'paid', 'expired', 'cancelled')),
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('web', 'whatsapp', 'demo')),
  delivery_zone_id TEXT NOT NULL DEFAULT 'pickup',
  reservation_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  conversation_id TEXT REFERENCES conversations(id),
  items_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
  delivery_method TEXT NOT NULL CHECK(delivery_method IN ('pickup', 'delivery')),
  delivery_zone TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  requested_date TEXT NOT NULL DEFAULT '',
  approved_date TEXT,
  shipping_cents INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  order_id TEXT REFERENCES orders(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  notification_sent_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES variants(id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES variants(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('active', 'consumed', 'released')),
  created_at TEXT NOT NULL,
  UNIQUE(order_id, variant_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'succeeded', 'failed', 'expired')),
  mode TEXT NOT NULL CHECK(mode IN ('simulated', 'sandbox', 'live')),
  amount_cents INTEGER NOT NULL,
  provider_reference TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_proposals (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  action_kind TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  proposal_id TEXT,
  request_id TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_drafts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  caption TEXT NOT NULL,
  image_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status = 'prepared'),
  mode TEXT NOT NULL CHECK(mode = 'simulated'),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  channel TEXT NOT NULL CHECK(channel IN ('web', 'whatsapp', 'demo')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('customer', 'admin', 'assistant', 'human')),
  text TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('web', 'whatsapp', 'demo')),
  proposal_id TEXT,
  order_id TEXT,
  handoff INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, route, key)
);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, mode, event_id)
);
`;
