# Workflow n8n: Campaign Submitted → Ops Review Packet

Impor [`workflow.json`](./workflow.json) ke n8n. Backend FastAPI yang cocok dengan workflow ini tersedia di root repository. Workflow menangani **event setelah campaigner menekan Submit**. Tidak ada tombol readiness terpisah. n8n mengorkestrasi initial AI review, routing ke campaigner atau reviewer, analisis lanjutan, dan pembuatan review packet. Keputusan akhir tetap dibuat manusia.

## Alur

```text
FastAPI: CAMPAIGN_SUBMITTED
  → Webhook n8n (Header Auth)
  → validasi payload
  → balas HTTP 202
  → FastAPI: muat campaign dan klaim pekerjaan
  → jika analisis dokumen perlu: analisis dokumen yang belum ada/kedaluwarsa
  → initial AI review
      → jika perlu klarifikasi: ACTION_REQUIRED dan kembali ke campaigner
      → jika jelas atau campaigner override: lanjut
  → analisis reviewer mendalam
  → bangun review packet
  → READY_FOR_REVIEW atau READY_FOR_REVIEW_WITH_NOTES
```

Balasan `202` berarti event diterima, **bukan** packet sudah siap. Untuk event dengan format salah, webhook membalas `400`. Kegagalan pemrosesan sesudah `202` tercatat sebagai eksekusi gagal di n8n; FastAPI perlu menyediakan retry melalui klaim pekerjaan yang dapat kedaluwarsa.

## Konfigurasi setelah impor

1. Di node **Validate Event**, ubah `api_base_url` bila FastAPI tidak bisa diakses dari container n8n melalui `http://fastapi:8000`. Pakai alamat yang dapat dijangkau dari n8n, bukan `localhost` milik browser.
2. Di node **Campaign Submitted Webhook**, buat/pilih credential **Header Auth**. Contoh: nama header `X-Workflow-Token`; nilainya rahasia bersama yang hanya diketahui FastAPI dan n8n.
3. Di keempat node **HTTP Request**, buat/pilih satu credential **Header Auth** untuk API internal FastAPI. Contoh: nama header `X-Internal-Token`. Semua node perlu credential yang sama; jangan menaruh token di JSON workflow.
4. Implementasikan kontrak API di bawah, lalu uji dengan **Test URL** webhook. Setelah berhasil, publish workflow dan arahkan FastAPI ke **Production URL**. n8n membedakan kedua URL tersebut.

## Event dari FastAPI

Kirim `POST` JSON ke webhook, dengan header autentikasi yang dipilih:

```json
{
  "type": "CAMPAIGN_SUBMITTED",
  "event_id": "evt_123",
  "campaign_id": "cmp_123",
  "campaign_version": 4
}
```

`event_id` harus stabil jika FastAPI mengirim ulang event yang sama. `campaign_version` adalah versi yang disubmit. Payload ini sengaja hanya berisi ID dan versi; story serta dokumen tetap disimpan di backend.

## Kontrak API internal yang perlu tersedia

| Endpoint | Tugas dan respons minimum |
| --- | --- |
| `POST /internal/campaigns/{id}/claim-processing` | Validasi campaign berstatus submitted dan versinya cocok. Klaim `event_id` secara atomik agar delivery ulang dan eksekusi bersamaan tidak memproses dua kali. Balas `{ "should_process": true, "needs_document_analysis": true }`; untuk event duplikat/versi usang balas `should_process: false`. Gunakan lease/kedaluwarsa klaim supaya kegagalan bisa dicoba lagi. |
| `POST /internal/campaigns/{id}/analyze-documents` | Analisis hanya dokumen yang belum memiliki hasil relevansi untuk versi/hash saat ini. Simpan evidence untuk Ops. Sebut temuan sebagai potensi ketidakcocokan, bukan fraud. Harus idempotent. |
| `POST /internal/campaigns/{id}/final-analysis` | Jalankan initial AI review. Jika perlu klarifikasi dan tidak ada override, ubah status ke `ACTION_REQUIRED`. Jika bisa dilanjutkan, jalankan analisis reviewer mendalam. Kegagalan model tidak menolak campaign. |
| `POST /internal/campaigns/{id}/build-review-packet` | Untuk `ACTION_REQUIRED`, akhiri pekerjaan dan tunggu campaigner. Untuk campaign yang dilanjutkan, bangun packet, simpan catatan override bila ada, lalu ubah status menjadi `READY_FOR_REVIEW` atau `READY_FOR_REVIEW_WITH_NOTES`. |

Keempat endpoint `POST` menerima JSON `{ "event_id": "evt_123", "campaign_version": 4 }`. Endpoint dapat mengembalikan JSON lain, tetapi dua flag dari `claim-processing` harus berupa boolean. Gunakan respons HTTP non-2xx untuk kegagalan yang perlu terlihat di n8n. Node HTTP mencoba ulang sampai tiga kali.

## Pengujian ringkas

1. Kirim event valid. Harapkan `202`, kemudian satu packet siap di Ops.
2. Kirim ulang `event_id` yang sama. Harapkan tetap `202`, tanpa packet atau analisis ganda.
3. Kirim payload tanpa `campaign_id`. Harapkan `400`.
4. Kirim event versi lama. Harapkan `202`; `claim-processing` membalas `should_process: false`.
5. Paksa layanan AI gagal. Harapkan submission tetap ada dan packet memuat penanda bahwa analisis AI tidak tersedia, sesuai kebijakan FastAPI.

Workflow sudah diimpor dan dipublikasikan di n8n lokal pada komputer ini. Credential webhook dan API internal sudah dikonfigurasi. Pengujian browser mencakup submission yang diproses menjadi Ops review packet. Material contoh yang ditambahkan setelah submit diperiksa langsung oleh FastAPI dan muncul di dashboard reviewer saat halaman diperbarui.
