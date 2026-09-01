"use client";

export default function ReviewError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>Review Submission</h1>
      <div className="panel">
        <p className="state">
          Gagal memuat halaman: {error.message}
          <br />
          Pastikan database berjalan (<code>docker compose up -d</code>) dan migrasi sudah dijalankan.
        </p>
        <div className="pagination">
          <button className="btn-primary" onClick={reset}>Coba lagi</button>
        </div>
      </div>
    </main>
  );
}
