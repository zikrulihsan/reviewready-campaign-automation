# Skenario end-to-end ReviewReady

Terakhir diuji: 27 September 2026. Target uji aman: `https://reviewready-campaign.netlify.app`.

## Aturan uji

- Gunakan judul berawalan `TEST ONLY —`, cerita fiktif, dan berkas PDF/PNG/JPEG sintetis. Jangan memakai identitas, rekening, atau data medis asli.
- Untuk skenario yang mengirim email atau Slack, gunakan staging serta inbox dan kanal uji yang dikendalikan tim. Catat ID kampanye dan ID event; jangan menganggap tampilan UI sebagai bukti bahwa pesan benar-benar terkirim.
- Jangan mengubah kampanye contoh milik orang lain. Buat kampanye uji tersendiri untuk setiap jalur yang mengubah status.
- Tunggu proses asinkron sampai status akhir terlihat, lalu periksa status creator, reviewer, event n8n, dan `notification_deliveries`. Batas tunggu awal: 5 menit; setelah itu cek jalur retry.

## Matriks skenario

| ID | Skenario dan langkah inti | Hasil yang harus dibuktikan |
| --- | --- | --- |
| E2E-01 | Buat kampanye fiktif dari pilihan penerima, isi detail dan cerita, **Save draft**, muat ulang halaman. | ID kampanye terbentuk; judul, kategori, goal, penerima, dan cerita tetap tersimpan; status `draft`; belum ada entri antrean review atau notifikasi. |
| E2E-02 | Pada draft lengkap tanpa email creator, tekan **Submit campaign**. Ulangi dengan email berformat tidak valid. | Pengiriman ditolak dengan pesan validasi; status tetap `draft`; tidak ada event submission. |
| E2E-03 | Pada staging, isi email uji dan cerita lengkap; kirim kampanye standar. | Status bergerak `draft` → `initial_review` → `ready_for_review`/`ready_for_review_with_notes`; satu paket siap; reviewer melihat informasi sama; satu alert Slack dan satu email antrean untuk event tersebut. Bila AI meminta klarifikasi, lanjutkan E2E-04. |
| E2E-04 | Kirim cerita tipis/kontradiktif agar sistem meminta klarifikasi; perbaiki dan kirim ulang. Uji lagi dengan temuan berat yang masih ada pada submit kedua, dan dengan dokumen sintetis yang relevansinya rendah. Uji terpisah tombol **Submit as it is** untuk temuan ringan. | Temuan ringan pada submit kedua masuk antrean; temuan berat atau dokumen yang tidak relevan dikembalikan untuk kedua kalinya, file bisa dihapus, dan submit ketiga masuk antrean dengan catatan. Pilihan as-is untuk temuan ringan masuk antrean. Kegagalan AI tetap memungkinkan review tanpa skor kualitas palsu. |
| E2E-05 | Kirim kampanye fiktif dengan **Urgent?** aktif, alasan dan deadline; reviewer memilih **Confirm priority**, lalu pada kampanye lain **Standard queue**. | Permintaan hanya berstatus `requested` sebelum keputusan reviewer; riwayat keputusan tercatat; antrean memprioritaskan yang `confirmed` sesuai deadline. |
| E2E-06 | Dari kampanye siap review, reviewer memilih **Request changes** dengan catatan; creator mengubah cerita lalu **Resubmit for review**. | Creator melihat catatan yang sama; status `action_required` → `initial_review` → antrean; event baru dibuat; email perubahan dan notifikasi antrean baru tercatat satu kali per event. |
| E2E-07 | Unggah file sintetis; reviewer buka isi file, tolak dengan catatan, lalu creator unggah pengganti dan reviewer terima. Coba juga file salah MIME/signature, file >2 MB, dan batas 12 file pada kampanye uji terpisah. | File yang ditolak tetap berstatus rejected; hanya file terbaru yang accepted memenuhi syarat publikasi; file invalid ditolak dengan 422; berkas sensitif tidak dikirim sebagai teks untuk AI. |
| E2E-08 | Reviewer menyetujui konten; creator unggah berkas sintetis yang diwajibkan profil/kategori; reviewer terima dan centang lima pemeriksaan manual; publish. | Publish ditolak sebelum semua berkas dan cek lengkap; setelah lengkap status `live`, slug publik terbentuk, cerita tampil di halaman publik, dan email publikasi tercatat. |
| E2E-09 | Buka queue; uji filter Review, Verification, Changes, Processing, Priority serta pencarian judul. Buka detail dan halaman kampanye live. Coba slug yang belum live. | Baris yang tampil sesuai filter/pencarian; detail konsisten; halaman publik hanya berisi field publik, tanpa dokumen/catatan internal; slug belum live ditolak. |
| E2E-10 | Pada staging, jalankan ulang event n8n yang sama dan simulasi kegagalan delivery lalu retry. | Paket dan outbox tetap idempoten menurut event ID dan versi; tidak ada pengiriman ganda; delivery gagal berubah ke `sent` setelah pemulihan. Lihat [rencana notifikasi](notification-e2e-test-plan.md). |
| E2E-11 | Biarkan proses berhenti >5 menit di staging, lalu gunakan **Retry preparation** dua kali. | UI menunjukkan persiapan tertunda; retry pertama membuat event baru tanpa menaikkan jumlah submit creator; retry kedua ditolak; status akhir dapat dipantau. |

## Data dan bukti minimum

Gunakan satu judul unik per skenario, misalnya `TEST ONLY — E2E-03 <tanggal>`. Untuk kategori pendidikan, siapkan dokumen sintetis organizer ID, rekening, dan salah satu student ID/acceptance letter. Simpan untuk tiap run: waktu, URL lingkungan, ID kampanye, ID event, status sebelum/sesudah, tangkapan layar creator/reviewer, hasil n8n, dan status delivery. Pada kegagalan, catat pesan galat persis dan jangan mengulang aksi yang dapat mengirim notifikasi tanpa mengecek apakah aksi pertama berhasil.

## Hasil uji pada situs terpasang (27 September 2026)

| Pemeriksaan | Hasil | Bukti ringkas |
| --- | --- | --- |
| Build dan typecheck lokal | **Lulus** | `npm --prefix web run build` selesai; Vite membangun 1594 modul. `pnpm exec tsc --noEmit` juga lulus setelah perbaikan lokal. |
| E2E-01, draft | **Lulus** | Draft `4118d8fc-c2de-4cb7-8690-9071c22edb69` tersimpan; goal $125, kategori Education, judul dan penerima tetap sama setelah reload. Cerita tersimpan saat pindah ke langkah submit. |
| E2E-02, email kosong dan salah format | **Fungsi validasi lulus; tampilan galat perlu diperbaiki** | Email kosong menampilkan `Add a valid creator email before submitting`. Email `invalid-email` ditolak, tetapi UI menampilkan JSON mentah dari Zod, bukan pesan sederhana. Kampanye tidak dikirim. |
| E2E-09, queue | **Lulus sebagian** | Filter Review menampilkan kampanye dalam antrean dan pencarian `textbook` menyisakan satu baris yang sesuai. Changes menampilkan satu kampanye `Update requested`; Verification dan Priority kosong sesuai data yang tersedia. Processing kosong meski All memuat kampanye `Preparation paused` (lihat temuan). |
| E2E-09, halaman publik | **Lulus** | Kampanye contoh live terbuka dan menampilkan cerita, penerima, penggunaan dana, jalur dana, dan goal. Slug kampanye yang belum live menampilkan `This campaign is not live`. |
| E2E-03 s.d. E2E-08, E2E-10, E2E-11 | **Belum dijalankan penuh** | Membutuhkan staging, inbox dan kanal notifikasi uji, serta file sintetis agar tidak mengirim pesan ke penerima produksi atau mengubah kampanye orang lain. |

### Temuan yang perlu ditindaklanjuti

1. Pada detail reviewer kampanye uji `79a548d3-8bd3-4447-8554-6546d95ae254`, situs terpasang menampilkan `100/100 · Strong` walau breakdown menunjukkan `Clarity —/50`, `Consistency —/20`, dan rekomendasi `analysis unavailable`. Ini memberi kesan kualitas sudah dipastikan saat AI tidak tersedia. `scoreReadiness()` pada kode lokal sudah menghasilkan `score: null` dan `level: unavailable`; periksa versi deploy dan data penilaian yang tersimpan sebelum mengubah logika lagi.
2. Antrean berisi setidaknya satu kampanye lama dengan status `Preparation paused`. Ini menunjukkan jalur otomasi perlu diuji dengan event baru dan pemeriksaan eksekusi n8n; dari UI saja penyebabnya belum bisa dipastikan.
3. Validasi email yang salah format menampilkan struktur JSON `invalid_string` kepada creator pada deploy yang diuji. API lokal sudah diperbaiki agar mengembalikan `Enter a valid email address`; perlu deploy dan uji ulang di situs.
4. Tab **Processing** pada deploy yang diuji hanya menerima status `initial_review`, sedangkan API mengubah proses yang lewat lima menit menjadi `automation_failed`. Filter lokal sudah memasukkan kedua status; perlu deploy dan uji ulang di situs.
