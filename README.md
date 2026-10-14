# Zedulearn

Zedulearn searches the Curriculum Development Centre's Digital Library and the Ministry of Education's Directorate of Curriculum page. It opens original PDFs from their publishers and can extract selectable text a page at a time for translation into seven Zambian languages.

## Run locally

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The curriculum catalog works without credentials.
Use Node.js 22.15 or newer so the Ministry API can validate the host's certificate using the system trust store.

## Enable Google Translate

Create a Google Cloud project, enable Cloud Translation, configure billing, and create an API key restricted to the Translation API. Copy `.env.example` to `.env` and set `GOOGLE_TRANSLATE_API_KEY`; the key is used only by the server. Restart the app after changing environment settings.

The `translate.google.com` webpage is not an API. Zedulearn uses the official Google Cloud Translation v2 API so translated text can appear in the study desk and downloadable notes. Google's current language list includes Bemba (`bem`) and Nyanja/Chichewa (`ny`) from the app's choices; Tonga, Lozi, Kaonde, Lunda, and Luvale are disabled because Google does not currently list them.

The Ministry page currently redirects in some browsers; Zedulearn reads its published WordPress REST content and only accepts PDF links hosted on `edu.gov.zm`. It does not copy or rehost source PDFs. Page text is extracted on demand; scanned pages remain available as original downloads.

Machine translations are draft study aids, not official curriculum editions. The app preserves curriculum context and passage structure, but translation quality has not been independently certified for all seven languages. Have a fluent speaker review important material before relying on it.
