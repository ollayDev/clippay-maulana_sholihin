-- Opsional, hanya untuk data demo lokal. Lihat bagian "Catatan soal seed" di README.
update submissions s
   set status = v.status,
       reviewed_at = case when v.status = 'pending' then null else now() - (random() * interval '60 days') end
  from (
    select id,
           (array['pending','pending','pending','approved','rejected'])[1 + floor(random() * 5)::int] as status
      from submissions
  ) v
 where v.id = s.id
   and not exists (select 1 from earnings e where e.submission_id = s.id);

analyze submissions;
