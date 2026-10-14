# Zedulearn

Zedulearn searches the Curriculum Development Centre's Digital Library, opens original resources for download, and translates learner-provided passages into seven Zambian languages.

## Run locally

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The curriculum catalog works without credentials.

## Enable translation

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. The key stays on the server. `OPENAI_BASE_URL` and `OPENAI_MODEL` can point to another OpenAI-compatible chat-completions service. Restart the app after changing environment settings.

Machine translations are study aids, not official curriculum editions. Ask a fluent speaker to verify important material. Original CDC PDFs are downloaded directly from the source library.
