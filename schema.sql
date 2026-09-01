-- =============================================================================
-- ClipPay — skema + seed untuk take-home test
--
-- Jalankan:
--   docker compose up -d
--   psql "postgresql://clippay:clippay@localhost:5433/clippay" -f schema.sql
--
-- Seed: 8 campaign · 2.000 creator · 50.000 submission.
-- Sengaja banyak supaya pagination & query yang boros kelihatan bedanya.
-- =============================================================================

drop table if exists earnings      cascade;
drop table if exists submissions   cascade;
drop table if exists campaigns     cascade;
drop table if exists creators      cascade;

-- ── creators ────────────────────────────────────────────────────────────────
create table creators (
  id         bigserial primary key,
  username   text        not null unique,
  email      text        not null,
  created_at timestamptz not null default now()
);

-- ── campaigns ───────────────────────────────────────────────────────────────
create table campaigns (
  id               bigserial   primary key,
  title            text        not null,
  brand            text        not null,
  -- CPM = bayaran per 1.000 views, dalam rupiah
  cpm              integer     not null check (cpm > 0),
  total_budget     bigint      not null check (total_budget >= 0),
  -- sisa budget. TIDAK BOLEH negatif — ini dijaga di level DB juga.
  remaining_budget bigint      not null check (remaining_budget >= 0),
  status           text        not null default 'active'
                   check (status in ('active', 'paused', 'closed')),
  created_at       timestamptz not null default now()
);

-- ── submissions ─────────────────────────────────────────────────────────────
create table submissions (
  id           bigserial   primary key,
  creator_id   bigint      not null references creators(id),
  campaign_id  bigint      not null references campaigns(id),
  platform     text        not null check (platform in ('tiktok','instagram','youtube')),
  video_url    text        not null,
  views        integer     not null default 0 check (views >= 0),
  status       text        not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at  timestamptz
);

-- ── earnings ────────────────────────────────────────────────────────────────
-- Satu baris = satu pembayaran ke creator.
create table earnings (
  id            bigserial   primary key,
  submission_id bigint      not null references submissions(id),
  creator_id    bigint      not null references creators(id),
  campaign_id   bigint      not null references campaigns(id),
  gross_amount  bigint      not null,   -- sebelum potong fee
  fee_amount    bigint      not null,   -- fee platform
  net_amount    bigint      not null,   -- yang diterima creator
  views_at_approval integer not null,   -- snapshot views saat di-approve
  created_at    timestamptz not null default now()
);

-- Index dasar. Silakan tambah sendiri kalau perlu — kami memperhatikan
-- index apa yang kamu tambahkan dan kenapa.
create index on submissions (status);
create index on submissions (campaign_id);
create index on submissions (submitted_at desc);

-- =============================================================================
-- SEED
-- =============================================================================

insert into campaigns (title, brand, cpm, total_budget, remaining_budget, status)
values
  ('Sepatu Lari Seri Baru',      'Strive',     1500, 50000000, 50000000, 'active'),
  ('Kopi Susu Literan',          'Kopiku',     1200, 30000000, 12500000, 'active'),
  ('Skincare Glow Up',           'Lumina',     2000, 80000000, 78400000, 'active'),
  ('Promo Kartu Kredit',         'BankNusa',   2500, 40000000,   950000, 'active'),
  ('Game Mobile Season 4',       'PixelPlay',  1000, 25000000, 25000000, 'active'),
  ('Menu Baru Ayam Geprek',      'Geprekin',    900, 15000000,        0, 'active'),
  ('Liburan Hemat Bali',         'TripGo',     1800, 60000000, 44000000, 'paused'),
  ('Headphone Noise Cancelling', 'AudioMax',   2200, 35000000, 20100000, 'closed');
-- ⚠️ Perhatikan: ada campaign yang sisa budget-nya 0, ada yang tinggal sedikit
--    (Rp950.000), dan ada yang statusnya paused/closed. Ini disengaja.

insert into creators (username, email)
select
  'creator_' || g,
  'creator_' || g || '@example.com'
from generate_series(1, 2000) g;

insert into submissions (creator_id, campaign_id, platform, video_url, views, status, submitted_at, reviewed_at)
select
  1 + floor(random() * 2000)::int,
  1 + floor(random() * 8)::int,
  (array['tiktok','instagram','youtube'])[1 + floor(random() * 3)::int],
  'https://example.com/v/' || g,
  -- distribusi views timpang: mayoritas kecil, sedikit yang viral
  case
    when random() < 0.70 then floor(random() *   5000)::int
    when random() < 0.95 then floor(random() *  80000)::int
    else                      floor(random() * 900000)::int
  end,
  st.s,
  now() - (random() * interval '120 days'),
  case when st.s = 'pending' then null else now() - (random() * interval '60 days') end
from generate_series(1, 50000) g
cross join lateral (
  select (array['pending','pending','pending','approved','rejected'])[1 + floor(random() * 5)::int] as s
) st;

-- Catatan: seed ini SENGAJA tidak membuat baris `earnings` untuk submission yang
-- sudah 'approved', dan tidak mengurangi remaining_budget-nya. Anggap saja data
-- lama hasil migrasi. Yang kami nilai adalah alur approve yang KAMU buat.

analyze;

-- Cek cepat setelah seed:
--   select status, count(*) from submissions group by status;
--   select id, title, cpm, remaining_budget from campaigns order by id;
