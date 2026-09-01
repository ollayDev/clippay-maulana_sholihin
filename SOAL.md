# Take-Home Test - Fullstack Developer

Halo, terima kasih sudah tertarik bergabung. 👋
Estimasi pengerjaan: **4–6 jam**.

---

## Konteks

Kami membangun **ClipPay** - platform yang membayar creator berdasarkan jumlah
views video mereka. Alurnya:

1. **Brand** mengisi saldo campaign (budget)
2. **Creator** submit link video ke campaign
3. **Admin** me-review submission → approve / reject
4. Submission yang di-approve **menghasilkan earning** untuk creator, dan
   **memotong budget** campaign

Kamu akan membangun bagian **review & approve** dari sistem ini.

> ⚠️ Ini uang sungguhan di produk aslinya. Kami lebih menghargai kode yang
> **benar dan hati-hati** daripada kode yang banyak fiturnya.

---

## Yang kami sediakan

- `schema.sql` - skema database + seed **50.000 submission** (sengaja banyak)
- `docker-compose.yml` - Postgres siap pakai

Jalankan:

```bash
docker compose up -d
psql "postgresql://clippay:clippay@localhost:5433/clippay" -f schema.sql
```

## Stack

**Next.js (App Router) + TypeScript + PostgreSQL.**

Bebas pilih library query DB (`pg`, Drizzle, Prisma, Kysely - terserah).
Styling bebas, tidak dinilai keindahannya.

Kalau kamu jauh lebih kuat di stack lain (mis. NestJS + React), boleh -
tulis alasannya di README. Kami menilai cara berpikirnya, bukan hafalan framework.

---

# Tugas

## 1. API daftar submission

`GET /api/submissions`

Menampilkan submission untuk di-review. Harus mendukung:

- **Pagination** (`page`, `per`)
- **Filter** `status` (`pending` / `approved` / `rejected`)
- **Filter** `campaignId`
- **Search** by username creator
- Response menyertakan **total baris** (untuk kebutuhan UI pagination)

Setiap baris menampilkan: username creator, judul campaign, platform, views,
status, tanggal submit.

> 📌 Datanya 50.000 baris dan di produksi jauh lebih banyak. Endpoint ini harus
> tetap cepat.

## 2. API approve submission

`POST /api/submissions/:id/approve`

Saat sebuah submission di-approve, sistem harus:

1. Menghitung **earning** creator:

   ```
   earning_kotor = floor(views / 1000 × cpm)
   fee_platform  = 20%
   earning_net   = earning_kotor − fee_platform
   ```

   `cpm` diambil dari campaign-nya. Contoh: 12.345 views, CPM Rp1.500
   → kotor Rp18.517 → net Rp14.813.

2. **Mengurangi `campaigns.remaining_budget`** sebesar `earning_kotor`
3. Menyimpan baris di tabel `earnings`
4. Mengubah status submission menjadi `approved`

**Aturan yang wajib dipenuhi:**

- ❌ `remaining_budget` **tidak boleh menjadi negatif**. Kalau budget tidak
  cukup untuk membayar penuh, tolak approve-nya (jangan bayar sebagian).
- ❌ Submission yang sudah `approved` **tidak boleh** menghasilkan earning kedua.
- ✅ Endpoint ini akan dipanggil dari tombol di UI. Anggap tombolnya **bisa
  ter-klik dua kali**, dan **dua admin bisa approve submission yang sama
  bersamaan**.

## 3. Halaman review

`/review`

- Tabel submission (pakai API no. 1)
- Filter status + search
- Pagination
- Tombol **Approve** per baris
- Tangani state: **loading**, **kosong**, dan **error**

Tampilan sederhana tidak masalah. Yang dinilai: datanya benar, dan pengguna
selalu tahu apa yang sedang terjadi.

---

# Bonus (opsional)

Kerjakan kalau sempat. **Tidak mengerjakan bonus bukan nilai minus** - kami
lebih suka bagian wajib yang rapi daripada semuanya setengah jadi.

**B1.** Tulis test untuk fungsi perhitungan uangnya. Test apa saja yang menurutmu
paling penting?

**B2.** Jawab di README (tidak perlu diimplementasikan):

> Views video bisa **turun** - platform seperti TikTok/Instagram rutin
> membersihkan views palsu. Misalnya sebuah video di-approve saat 100.000 views
> (creator sudah dibayar), lalu minggu depan views-nya tinggal 60.000.
>
> Menurutmu apa yang harus dilakukan sistem? Jelaskan pilihanmu **beserta
> konsekuensinya bagi creator dan bagi brand.**

**B3.** `GET /api/campaigns/:id/summary` - ringkasan campaign: total submission,
jumlah approved, total earning terbayar, sisa budget. Buat seefisien mungkin.

---

# Yang dikumpulkan

1. **Link repo** (GitHub/GitLab). Boleh private - undang `@naufalahmdf`.
2. **README** berisi:
   - cara menjalankan
   - **keputusan teknis yang kamu ambil dan alasannya**
   - apa yang **kamu potong** karena keterbatasan waktu, dan apa yang akan kamu
     kerjakan kalau punya waktu lebih
   - jawaban B2 (kalau dikerjakan)
3. **Commit yang rapi.** Kami akan membaca riwayat commit-mu.

---

# Cara kami menilai

Diurutkan dari yang paling berat:

| Aspek | Yang kami cari |
|---|---|
| **Kebenaran uang** | Hitungan tepat, pembulatan konsisten, budget tidak pernah minus, tidak ada pembayaran dobel |
| **Ketahanan** | Aman terhadap klik ganda & request bersamaan |
| **Kualitas query** | Pagination di sisi database, tidak ada N+1 |
| **Penalaran** | README menjelaskan *kenapa*, bukan cuma *apa* |
| **Kebersihan kode** | TypeScript yang jujur, penamaan jelas, tanpa kode mati |
| **UX dasar** | Loading / kosong / error tertangani |

**Yang TIDAK dinilai:** keindahan CSS, jumlah fitur, coverage test 100%,
kelengkapan dokumentasi.

---

## Boleh pakai AI?

**Boleh, dan silakan.** Kami memakainya juga setiap hari.

Satu syarat: **kamu harus paham setiap baris yang kamu kirim.** Di sesi wawancara
kami akan menunjuk bagian acak dari kodemu dan meminta penjelasan - kenapa begitu,
apa yang terjadi kalau diubah, kenapa tidak pakai pendekatan lain.

Kalau ada bagian yang kamu salin dan belum sepenuhnya paham, **tulis saja di
README**. Jujur soal itu jauh lebih baik nilainya daripada ketahuan saat wawancara.

---

Ada yang kurang jelas dari soal ini? Silakan tanya - bertanya bukan nilai minus,
dan asumsi yang salah lebih mahal daripada satu pertanyaan.

Selamat mengerjakan 🙌
