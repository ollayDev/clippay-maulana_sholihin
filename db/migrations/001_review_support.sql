create extension if not exists pg_trgm;

drop index if exists submissions_status_idx;
drop index if exists submissions_campaign_id_idx;
drop index if exists submissions_submitted_at_idx;

create index if not exists submissions_status_submitted_at_idx
  on submissions (status, submitted_at desc, id desc);

create index if not exists submissions_campaign_status_submitted_at_idx
  on submissions (campaign_id, status, submitted_at desc, id desc);

create index if not exists submissions_submitted_at_id_idx
  on submissions (submitted_at desc, id desc);

create index if not exists submissions_creator_id_idx
  on submissions (creator_id);

create unique index if not exists earnings_submission_id_key
  on earnings (submission_id);

create index if not exists earnings_campaign_id_idx
  on earnings (campaign_id);

create index if not exists creators_username_trgm_idx
  on creators using gin (username gin_trgm_ops);

analyze;
