# ClipPay: Review & Approve

Bagian review & approve dari ClipPay. Ada 3 endpoint + satu halaman `/review`.

Next.js 15 (App Router), TypeScript, Postgres. Query pakai `pg` langsung, SQL ditulis manual.
Alasannya ada di bawah.

## Menjalankan

```bash
docker compose up -d
docker compose exec -T db psql -U clippay -d clippay -v ON_ERROR_STOP=1 < schema.sql

cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Buka `http://localhost:3000/review`.

`npm test` untuk test, `npm run build` untuk cek build + tipe.

Dua catatan soal setup:

**Port saya ubah ke 5444.** Di mesin saya 5433 sudah dipakai Postgres project lain dan
saya tidak mau mematikannya. Kalau di sisi kalian 5433 kosong, tinggal
`CLIPPAY_DB_PORT=5433 docker compose up -d` dan sesuaikan `.env.local`. Sekalian saya
bind ke `127.0.0.1`, karena `"5444:5432"` di VPS publik itu membuka Postgres ke internet
dan ufw tidak bisa menutupnya (Docker nulis rule iptables sendiri yang jalan duluan).

**`npm run db:migrate` wajib**, bukan opsional. Isinya index yang dipakai endpoint list,
plus unique index di `earnings(submission_id)` yang jadi pengaman terakhir anti double-pay.

### Seed-nya ada bug

`schema.sql` tidak saya ubah, tapi waktu saya jalankan, semua 50.000 submission dapat
status yang sama:

```
 status  | count
---------+-------
 pending | 50000
```

Penyebabnya blok ini:

```sql
cross join lateral (
  select (array['pending','pending','pending','approved','rejected'])[1 + floor(random() * 5)::int] as s
) st
```

Subquery-nya tidak mereferensikan `g` sama sekali, jadi Postgres menganggapnya uncorrelated
dan `random()` cuma dievaluasi sekali untuk seluruh query. Bukan per baris. Mana yang
kepilih berubah tiap kali seed dijalankan, jadi mungkin di mesin kalian hasilnya beda.

Kode saya tidak bergantung ke distribusi status, jadi ini tidak mempengaruhi apa pun.
Cuma bikin data demo jadi tidak menarik. Untuk lokal saya bikin
`db/dev-mixed-statuses.sql` yang mengacak ulang status, dan cuma menyentuh baris yang
belum punya `earnings` supaya tidak ada submission terbayar yang balik jadi pending.

Kalau ternyata ini memang disengaja, berarti saya salah baca.

## API

`GET /api/submissions`

| Param | Default | |
|---|---|---|
| `page` | 1 | maksimal 1.000.000 |
| `per` | 25 | maksimal 100 |
| `status` | | `pending` / `approved` / `rejected` |
| `campaignId` | | |
| `search` | | substring username, case-insensitive |

```json
{
  "data": [{
    "id": 281, "creatorUsername": "creator_1734", "campaignId": 1,
    "campaignTitle": "Sepatu Lari Seri Baru", "platform": "youtube",
    "views": 11768, "status": "pending", "submittedAt": "2026-05-03T…",
    "estimatedGross": 17652, "estimatedNet": 14121
  }],
  "page": 1, "per": 25, "total": 30018, "totalPages": 1201
}
```

`estimatedNet` dihitung pakai fungsi yang sama persis dengan yang dipakai waktu approve,
supaya angka di tabel tidak pernah beda dengan yang benar-benar dibayar.

`POST /api/submissions/:id/approve` mengembalikan `grossAmount`, `feeAmount`, `netAmount`,
dan `remainingBudget` terbaru. Error-nya:

| | |
|---|---|
| 400 `BAD_REQUEST` | id atau param tidak valid |
| 404 `SUBMISSION_NOT_FOUND` | |
| 409 `SUBMISSION_NOT_PENDING` | sudah approved atau rejected |
| 409 `CAMPAIGN_NOT_ACTIVE` | campaign paused/closed |
| 409 `INSUFFICIENT_BUDGET` | sisa budget kurang |

`GET /api/campaigns/:id/summary` untuk B3.

## Keputusan teknis

### Uang tidak pernah menyentuh float

Semua `bigint`, dari kolom Postgres sampai `BigInt` di TypeScript.

```ts
const grossAmount = (views * cpm) / 1_000n;
const netAmount   = (grossAmount * 8_000n) / 10_000n;
const feeAmount   = grossAmount - netAmount;
```

Ini bukan kehati-hatian teoretis. `Math.floor(18 / 1000 * 1500)` hasilnya 26, padahal
jawabannya 27, karena `0.018` tidak bisa direpresentasikan persis di IEEE-754. Satu rupiah
hilang dari creator, tanpa error, tanpa jejak. Saya masukkan kasus ini ke test.

### Kenapa fee dihitung terakhir

Awalnya saya tulis `fee = floor(gross * 20%)`, lalu angkanya tidak cocok dengan contoh di soal.

12.345 views, CPM 1.500. Gross 18.517. 20% dari itu 3.703,4. Kalau fee yang dibulatkan ke
bawah jadi 3.703, net-nya 14.814. Soal minta 14.813. Jadi yang dibulatkan ke bawah itu
net-nya, dan fee ambil sisanya:

```
gross = floor(views/1000 * cpm)
net   = floor(gross * 80%)
fee   = gross - net
```

Efek sampingnya justru bagus: `fee + net` selalu sama persis dengan `gross`, tidak ada
rupiah yang tercipta atau hilang di pembukuan. Dan sisa pembulatan jatuh ke platform,
bukan ke creator. Ada test yang mengecek invarian ini di ratusan kombinasi views dan CPM.

### Approve: satu transaksi, tiga lapis

Urutan lock-nya selalu sama: submission dulu, campaign belakangan. Konsisten begitu di
semua jalur, jadi deadlock tidak mungkin.

Lapis pertama, claim submission-nya:

```sql
update submissions set status = 'approved', reviewed_at = now()
 where id = $1 and status = 'pending'
returning creator_id, campaign_id, views
```

Satu statement, jadi tidak ada jeda antara mengecek status dan mengubahnya. Ini juga yang
mengambil row lock. Request kedua akan blok di situ; begitu yang pertama commit, Postgres
mengevaluasi ulang `where`-nya terhadap baris yang sudah berubah, lihat statusnya sudah
bukan `pending`, dan balik 0 baris. Ini perilaku READ COMMITTED, dan ini yang sebenarnya
menyelamatkan, bukan pengecekan di aplikasi.

Kalau ditulis `SELECT` dulu baru `UPDATE`, ada celah di antaranya.

Lapis kedua, potong budget-nya juga bersyarat:

```sql
update campaigns set remaining_budget = remaining_budget - $2
 where id = $1 and remaining_budget >= $2
returning remaining_budget
```

0 baris berarti budget kurang, seluruh transaksi rollback, submission balik ke `pending`.
Tidak ada pembayaran sebagian. Sebelum ini ada `SELECT ... FOR UPDATE` ke campaign, gunanya
buat mengunci `cpm`. Tanpa itu CPM bisa berubah di tengah dan gross dihitung dari angka basi.

Lapis ketiga, `unique index earnings(submission_id)`. Ini tidak akan pernah kena selama
lapis pertama jalan. Memang itu gunanya: kalau nanti ada jalur kode lain yang lolos,
database yang menolak, bukan aplikasi. Schema juga sudah punya `check (remaining_budget >= 0)`.

Ongkosnya: approve di satu campaign jadi terserialisasi di row campaign itu. Saya ambil
trade-off ini dengan sadar. Serialisasinya per-campaign, campaign lain tetap jalan paralel.

Yang diuji di `approve.integration.test.ts`: 20 approve paralel ke submission yang sama
menghasilkan tepat 1 yang sukses dan 1 baris earnings. 10 approve rebutan budget yang cuma
cukup untuk 3 menghasilkan tepat 3, `remaining_budget` tidak pernah minus, dan
`sum(gross_amount)` sama persis dengan budget yang berkurang.

**Kenapa klik kedua dapat 409, bukan 200?** Tanpa idempotency key saya tidak bisa
membedakan double click dari admin lain yang sengaja approve lagi. Balikin 200 diam-diam
berarti UI bisa bilang sukses untuk sesuatu yang tidak terjadi. Kalau nanti endpoint ini
dipanggil mesin yang butuh retry aman, saya tambah header `Idempotency-Key`, bukan
melonggarkan pengecekannya.

### Campaign paused/closed saya tolak (ini asumsi)

Soal tidak menyebut ini di aturan wajib, tapi menandai data paused/closed sebagai
disengaja. Saya pilih menolak, karena membayar dari campaign yang sudah ditutup itu
mengeluarkan uang di luar kendali brand. Kalau maksudnya beda, cek `approve.ts` di
`campaign.status !== "active"`, satu baris.

### Query

Pagination sepenuhnya di database. Tidak ada baris yang dibaca ke aplikasi lalu dibuang.

`where`-nya saya rakit dinamis, bukan pola `($1::text is null or status = $1)`. Pola itu
bikin planner tidak bisa mengandalkan index karena predikatnya baru ketahuan saat eksekusi.
Nilai-nilainya tetap lewat parameter (`SqlParams` yang menomori `$1`, `$2`, ...), yang
dirakit cuma bentuk query-nya, jadi tidak ada celah injection.

Count dan halaman itu dua query terpisah yang jalan bersamaan, bukan `count(*) over ()`.
Window function memaksa Postgres memmaterialisasi seluruh hasil filter sebelum kena `limit`,
yang justru membunuh fast path-nya. Dipisah, query halamannya begini:

```
Limit -> Nested Loop -> Index Scan using submissions_status_submitted_at_idx
Execution Time: 0.797 ms
```

Tanpa node `Sort` sama sekali. Count-nya jadi index only scan, sekitar 13 ms untuk 30.000
baris. Konsekuensinya keduanya di snapshot yang berbeda, jadi `total` bisa meleset beberapa
baris kalau ada approve barengan. Untuk list admin ini wajar. Untuk angka uang saya tidak
akan melakukannya.

Username creator dan judul campaign diambil lewat join di query yang sama, jadi tidak ada
N+1. Planner menyelesaikannya dengan index lookup plus `Memoize`.

Index yang saya tambah:

| Index | Untuk |
|---|---|
| `submissions (status, submitted_at desc, id desc)` | filter status + urutan sekaligus, menghilangkan node Sort |
| `submissions (campaign_id, status, submitted_at desc, id desc)` | filter campaign, sekalian melayani agregat di endpoint summary |
| `submissions (submitted_at desc, id desc)` | kasus tanpa filter |
| `submissions (creator_id)` | tidak ada di schema awal. tanpa ini search username jadi seq scan 50.000 baris, dengan ini 2 ms |
| `earnings (submission_id)` unique | anti double-pay |
| `earnings (campaign_id)` | agregat summary |
| `creators (username) gin_trgm_ops` | untuk `ilike '%...%'` |

`id desc` di tiap index itu perlu, bukan gaya-gayaan. `submitted_at` tidak unik, tanpa
tie-breaker baris bisa muncul dua kali atau hilang waktu pindah halaman.

Tiga index bawaan saya drop karena sudah jadi prefix dari yang di atas. Index redundan tetap
memperlambat setiap insert tanpa memberi apa-apa.

Soal trigram, jujur saja: di 2.000 creator planner malah milih seq scan, karena di ukuran
segitu memang lebih murah. Index-nya baru kepakai kalau tabelnya besar (saya cek pakai
`enable_seqscan=off`, index-nya valid dan dipakai). Yang benar-benar menyelamatkan search
sekarang itu index `creator_id`.

Batasnya: `OFFSET` yang dalam tetap linear. Halaman 1 sekitar 19 ms, halaman 1.000 sekitar
85 ms, dan terus naik. `COUNT(*)` eksak juga selalu menyentuh seluruh hasil filter. Saya
tetap pakai `page`/`per` karena itu yang diminta.

### Kenapa `pg` langsung, bukan ORM

Bagian paling berisiko di tugas ini satu transaksi dengan locking yang spesifik. Saya mau
`FOR UPDATE`, `UPDATE ... RETURNING` bersyarat, dan urutan lock-nya kelihatan apa adanya di
kode, bukan ketutup abstraksi yang harus saya percaya. Untuk sesuatu yang mindahin uang,
saya lebih suka bisa nunjuk baris SQL-nya.

Gantinya saya kehilangan type-safety otomatis dari skema, jadi tipe tiap baris query saya
deklarasikan manual. Untuk aplikasi CRUD yang besar saya akan pilih ORM.

### UI

Empat state: loading awal, kosong, error (ada tombol coba lagi), dan refreshing.
Yang terakhir itu penting. Waktu filter berubah, data lama tetap kelihatan sambil ada
indikator kecil, jadi tabelnya tidak berkedip kosong tiap ketikan.

Search di-debounce 300 ms dan request lama di-abort. Tanpa abort, response yang datang tidak
berurutan bisa menimpa hasil baru dengan hasil lama.

Tombol approve disabled selama request jalan, plus ada guard di handler-nya. Tapi itu cuma
kenyamanan, bukan jaminan. Yang jadi jaminan tetap di server.

Habis approve, sukses atau gagal, halamannya refetch. Kalau gagal karena keburu diproses
admin lain, admin langsung lihat kondisi sebenarnya. Notifikasinya nampilin net, gross, dan
sisa budget campaign, jadi jelas apa yang barusan terjadi ke uangnya.

Filter tersimpan di URL, jadi halaman review bisa di-reload atau di-share apa adanya.

## Test

`npm test`. Ada 10, dua file.

`money.test.ts` murni, tanpa DB. Yang menurut saya paling penting:

- Contoh dari soal, persis. 12.345 @ 1.500 jadi 18.517 / 3.704 / 14.813. Kalau ini meleset,
  sisanya tidak relevan.
- Kasus anti-float tadi (18 views @ 1.500 harus 27, float ngasih 26). Ini yang menangkap
  regresi paling mahal sekaligus paling tidak kelihatan: seseorang menyederhanakan `bigint`
  jadi `number` dan tidak ada yang sadar.
- `fee + net == gross` di ratusan kombinasi.
- Arah pembulatan: sisa ke platform, bukan ke creator.
- Sub-rupiah dibulatkan ke bawah, bukan ke atas.
- Input tidak valid ditolak, bukan diam-diam menghasilkan pembayaran salah.

`approve.integration.test.ts` butuh DB, otomatis di-skip kalau tidak ada. Concurrency tidak
bisa dibuktikan pakai mock, yang diuji justru perilaku lock Postgres-nya. Fixture-nya bikin
campaign dan submission sendiri lalu dibersihkan, jadi tidak bergantung isi seed dan bisa
dijalankan berulang.

## Yang saya potong

- **Auth.** Tidak ada identitas admin, jadi `earnings` tidak mencatat siapa yang approve.
  Ini yang pertama saya tambahkan kalau lanjut, kolom `approved_by` di belakang session admin.
  Untuk audit trail uang, ini bolong yang cukup besar.
- Endpoint reject. Tidak diminta, dan bentuknya mirip approve tapi lebih sederhana.
- Halaman untuk campaign summary. API-nya ada, UI-nya belum.
- Test untuk route handler dan komponen React. Saya prioritaskan lapisan uang dan concurrency.
- Structured logging. Error 500 sekarang cuma `console.error`.
- Rate limiting di endpoint approve.
- CSS. Seadanya, memang.

Kalau ada waktu lagi, urutannya: keyset pagination (`where (submitted_at, id) < ($1, $2)`)
di samping page/per, karena selain konstan berapa pun dalamnya, dia juga stabil kalau ada
baris baru masuk di antara dua halaman. Lalu `COUNT` yang tidak eksak di atas ambang tertentu,
pakai `pg_class.reltuples` dan tampilkan "1.000+", karena nomor halaman presisi jarang benar-
benar dibutuhkan admin. Setelah itu idempotency key, dan load test buat tahu sejauh mana
serialisasi row lock tadi bertahan.

## B2: views turun setelah creator dibayar

Jawaban singkatnya: jangan pernah menarik uang yang sudah cair. Ganti masalahnya, tunda
*pelepasan* pembayarannya, dan bayar berdasarkan angka yang bertahan.

Saya bahas kenapa clawback itu jawaban yang salah dulu, karena secara akuntansi dia
kelihatan paling benar.

Bagi creator, clawback bikin pendapatan tidak bisa direncanakan. Uang yang sudah masuk
rekening bisa hilang gara-gara keputusan moderasi TikTok yang tidak bisa mereka lihat,
prediksi, atau banding. Risiko dari pihak ketiga dipindahkan ke pihak yang paling tidak
mampu menanggungnya. Praktiknya: saldo negatif, creator yang buru-buru narik dana begitu
cair, dan creator bagus pindah ke platform yang tidak begitu. Secara hukum juga rapuh,
menarik dana dari rekening orang setelah kerjaannya selesai itu tidak bisa disandarkan ke
satu klausa T&C.

Bagi brand, kelihatannya menang tapi tidak juga. Uangnya tidak akan benar-benar kembali,
creator-nya sudah narik. Yang mereka dapat malah pool creator yang lebih kecil.

Dan satu hal yang sering kelewat: views yang kemudian dibersihkan bukan berarti nol nilainya
waktu itu. Videonya beneran tayang, sebagian penontonnya nyata. Menagih balik 100% dari
selisihnya memperlakukan semua penurunan sebagai penipuan, padahal kebanyakan bukan.

Yang akan saya bangun:

**Approve me-reserve, bukan langsung membayar.** `remaining_budget` tetap dipotong (dana
brand terkunci, itu benar), tapi baris `earnings`-nya masuk dengan status
`pending_settlement`. Belum bisa ditarik creator.

**Settlement 7 sampai 14 hari kemudian.** Views di-poll ulang, lalu yang dibayar itu
`min(views_at_approval, views_at_settlement)`. Selalu ambil yang lebih rendah. Kalau turun,
selisih budget-nya balik ke campaign, jadi brand tidak kehilangan apa pun dan dananya bisa
dipakai buat creator lain.

Untuk contoh di soal, kalau turunnya terjadi di dalam window: creator dibayar atas 60.000
views, jadi Rp72.000 net, bukan Rp120.000. Rp60.000 balik ke budget brand. Dan tidak ada satu
rupiah pun yang diambil dari creator, karena belum pernah jadi milik mereka. Bedanya antara
"pembayaranmu ternyata lebih kecil" dan "kami ambil kembali uangmu" itu kecil di spreadsheet
tapi menentukan segalanya di kepercayaan.

**Setelah settle, final.** Turun dari 100.000 ke 60.000 di minggu ketiga? Creator tetap
menyimpannya. Itu ongkos yang ditanggung platform demi punya aturan yang bisa diprediksi.
Panjang window-nya di-tuning dari data, seberapa cepat pembersihan views biasanya terjadi.

**Fraud jalur terpisah, dan manual.** Turun lebih dari 40% dalam window, atau ada flag dari
platform, tidak otomatis memicu apa-apa. Masuk antrean review manusia. Kalau terbukti views
dibeli, itu pelanggaran T&C: tahan payout berikutnya, bukan ambil dari saldo yang sudah cair,
dan tetap ada jalur banding. Automasi boleh menandai, cuma manusia yang boleh menuduh.

**Baris uang tidak pernah di-UPDATE.** Koreksi ditulis sebagai baris baru di tabel adjustment
yang append-only, lengkap dengan alasan dan referensi ke earning asalnya. Riwayat uang harus
bisa direkonstruksi, dan `UPDATE` menghapus buktinya.

Ongkosnya buat creator: dibayar lebih lambat. Itu nyata, dan creator memang lebih suka cepat.
Saya tukar itu dengan pembayaran yang tidak pernah berbalik, dan menurut saya itu pertukaran
yang benar, ketidakpastian jauh lebih mahal daripada penundaan. Window-nya bisa dipersingkat
buat creator dengan riwayat bersih.

Skema yang ada sekarang sebenarnya sudah setengah jalan ke sana. `earnings.views_at_approval`
itu snapshot, artinya desainnya memang sudah memperlakukan nominal sebagai fakta tentang satu
titik waktu, bukan nilai turunan yang hidup. Tinggal nambah `status`, `views_at_settlement`,
`settled_at`, dan tabel adjustment tadi.

## Soal AI

Saya pakai untuk mempercepat boilerplate: setup Next.js, CSS, bentuk komponen tabel.

Bagian yang menentukan saya putuskan dan verifikasi sendiri. Urutan lock, `UPDATE` bersyarat
buat claim submission, arah pembulatan, pemilihan index. Tiap bentuk query saya cek pakai
`EXPLAIN ANALYZE`, dan approve paralelnya saya tes beneran pakai `xargs -P` dulu sebelum
saya jadikan test otomatis. Aturan pembulatan fee itu saya turunkan dari contoh angka di
soal, bukan diasumsikan.

Tidak ada bagian yang saya kirim tanpa paham.

Dua hal yang paling ingin saya diskusikan kalau ada sesi wawancara: keputusan menolak
campaign paused/closed (itu asumsi saya, bukan aturan dari soal), dan apakah serialisasi
per-campaign di row lock itu masih masuk akal di volume approve yang jauh lebih tinggi.
