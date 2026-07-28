# FAGENT · Ajan Laboratuvarı

Kural tabanlı (LLM'siz), anahtarsız portföy asistanının izole test ortamı. Gerçek zamanlı
piyasa verisi veya çoklu sekme içermez — sadece "Ajan" mantığını (niyet algılama, portföy
matematiği, grafik üretimi, hafıza, eğitilebilir bilgi tabanı) geliştirip gözlemlemek içindir.

**Temel ilke: API anahtarı gerektirmez.** Hiçbir özellik bir LLM'e bağlı değildir. Tüm veri
yalnızca tarayıcıda (`localStorage`) tutulur — sunucu yok, ağ çağrısı yok.

## Kurulum ve Geliştirme

```bash
npm install
npm run dev         # http://localhost:5173
npm run typecheck   # tsc --noEmit
npm run build        # dist/ üretir (tek dosya, vite-plugin-singlefile)
```

## Dosya Yapısı

```
src/
  App.tsx           — tüm UI (sohbet, grafik, karar denetleyici, portföy bağlamı, hafıza, eğitim paneli)
  store.ts          — portföy veri modeli + actions (localStorage: fagent.lab.portfolio.v1)
  agent.ts          — Ajan'ın YANIT MANTIĞI (saf fonksiyonlar, hiçbir I/O içermez)
  agentMemory.ts    — Ajan'ın UZUN SÜRELİ belleği (kullanım istatistiği, localStorage)
  agentTraining.ts  — Ajan'ın EĞİTİLEBİLİR bilgi tabanı (öğretilen soru-cevaplar, localStorage)
```

`agent.ts` bilinçli olarak **saf** tutulur: hiçbir I/O (localStorage, ağ) içermez, tüm veri
(portföy, geçmiş, hafıza, öğretilmiş bilgiler) parametre olarak geçirilir.

## Ajan — Yanıt Önceliği (`chatReply` / agent.ts)

```
1. Öğretilmiş bilgi (agentTraining.findBestMatch)   ← kullanıcının öğrettiği her şey en yüksek öncelikte
2. İşlem niyeti ("THYAO'dan 500 TL sat")            ← onay bekleyen alış/satış
3. Bellek sorgusu ("beni ne hatırlıyorsun")
4. Takip cümlesi ("devam et", "biraz daha anlat")   ← son konuşulan konuyu (intentId ile) genişletir
5. Grafik isteği (detectChartRequest)
6. En iyi/en kötü performans kıyaslaması
7. Genel niyet kuralları (CHAT_RULES — analiz, dağılım, risk, enflasyon, küçük sohbet…)
8. Varlık adıyla serbest arama (holdingLookupReply)
9. Fallback — "anlayamadım" + öneriler
```

## Bilinçli Sınırlar

- Gerçek zamanlı piyasa verisi yok — bu bir laboratuvar, canlı fiyat çekmez.
- LLM yok — bilerek tercih edildi: rakamlar her zaman gerçek portföy verisinden hesaplanır,
  hiçbir zaman bir modelden "uydurulmaz". Bkz. proje geçmişi: LLM fallback eklemek gizlilik
  taahhüdünü ("veri tarayıcından çıkmaz") bozacağı için bilinçli olarak ertelendi.
- "Ajanı Eğit" bir model eğitimi değildir; kelime örtüşmesine (Jaccard benzerliği) göre
  eşleşen sabit bir cevap kartı sistemidir.
