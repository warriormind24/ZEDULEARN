import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import * as cheerio from 'cheerio'

const app = express()
const port = Number(process.env.API_PORT ?? 4175)
const libraryBase = 'https://library.cdcrepository.info'
const supportedLanguages = new Map([
  ['bem', 'Bemba'],
  ['nya', 'Nyanja / Chichewa'],
  ['toi', 'Tonga'],
  ['loz', 'Lozi'],
  ['kqn', 'Kaonde'],
  ['lun', 'Lunda'],
  ['lue', 'Luvale'],
])
const supportedLevels = new Set(['ece', 'primary', 'secondary', 'syllabi', 'special_ed', 'teacher_ed', 'yale'])

app.use(express.json({ limit: '32kb' }))

app.get('/api/status', (_request, response) => {
  response.json({ translationReady: Boolean(process.env.OPENAI_API_KEY) })
})

app.get('/api/catalog', async (request, response) => {
  const level = String(request.query.level ?? 'primary')
  const grade = String(request.query.grade ?? 'g1')
  const query = String(request.query.q ?? '').trim().slice(0, 120)
  const page = Math.max(1, Math.min(99, Number(request.query.page ?? 1) || 1))

  if (!supportedLevels.has(level) || !/^[a-z0-9_]{1,20}$/.test(grade)) {
    response.status(400).json({ error: 'Choose a valid school level and grade.' })
    return
  }

  const url = new URL(query ? '/search.php' : '/browse.php', libraryBase)
  if (query) {
    url.searchParams.set('q', query)
    url.searchParams.set('page', String(page))
    url.searchParams.set('level', level)
    url.searchParams.set('grade', grade)
  } else {
    url.searchParams.set('level', level)
    url.searchParams.set('grade', grade)
    if (page > 1) url.searchParams.set('page', String(page - 1))
  }

  try {
    const sourceResponse = await fetch(url, {
      headers: { 'User-Agent': 'Zedulearn/1.0 (curriculum resource browser)' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!sourceResponse.ok) throw new Error(`The CDC library responded with ${sourceResponse.status}.`)
    const markup = await sourceResponse.text()
    const $ = cheerio.load(markup)
    const resources = $('a.resource-card[href*="resource.php?id="]')
      .map((_index, element) => {
        const card = $(element)
        const resourceUrl = new URL(card.attr('href') ?? '', libraryBase)
        if (resourceUrl.origin !== libraryBase) return null
        const title = card.find('.resource-card-title').text().replace(/\s+/g, ' ').trim()
        if (!title) return null
        const downloadUrl = new URL(resourceUrl)
        downloadUrl.searchParams.set('download', '1')
        return {
          id: resourceUrl.searchParams.get('id') ?? resourceUrl.href,
          title,
          description: card.find('.resource-card-desc').text().replace(/\s+/g, ' ').trim(),
          tags: card.find('.rc-tag').map((_tagIndex, tag) => $(tag).text().trim()).get(),
          resourceUrl: resourceUrl.href,
          downloadUrl: downloadUrl.href,
        }
      })
      .get()

    const resultSummary = $('.results-count').text().replace(/\s+/g, ' ').trim()
    const total = Number(resultSummary.match(/of\s+(\d+)/i)?.[1] ?? resultSummary.match(/(\d+)\s+resources?\s+found/i)?.[1] ?? resources.length)
    const laterPages = $('a[href*="page="]')
      .map((_index, element) => Number(new URL($(element).attr('href') ?? '', libraryBase).searchParams.get('page')))
      .get()
      .filter((candidate) => Number.isFinite(candidate) && candidate > page)
    const nextPage = laterPages.length ? Math.min(...laterPages) : null

    response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    response.json({ resources, total, nextPage })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to contact the CDC library.'
    response.status(502).json({ error: `Could not fetch official curriculum resources. ${message}` })
  }
})

app.post('/api/translate', async (request, response) => {
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  const languageCode = typeof request.body?.language === 'string' ? request.body.language : ''
  const language = supportedLanguages.get(languageCode)
  const apiKey = process.env.OPENAI_API_KEY

  if (!text || text.length > 12_000 || !language) {
    response.status(400).json({ error: 'Provide a passage under 12,000 characters and choose a supported language.' })
    return
  }
  if (!apiKey) {
    response.status(503).json({ error: 'Translation is not configured yet. Add OPENAI_API_KEY to app/.env and restart the app.' })
    return
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  try {
    const translationResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `Translate the provided school learning passage into ${language}. Preserve the meaning and educational terminology. Do not add explanations or facts. If a technical term has no clear equivalent, retain it and add a short bracketed gloss. Return only the translation.` },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    const result = await translationResponse.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    if (!translationResponse.ok) {
      response.status(502).json({ error: result.error?.message ?? 'The translation provider could not complete the request.' })
      return
    }
    const translation = result.choices?.[0]?.message?.content?.trim()
    if (!translation) {
      response.status(502).json({ error: 'The translation provider returned an empty result.' })
      return
    }
    response.json({ translation, language, provider: 'machine' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation request failed.'
    response.status(502).json({ error: message })
  }
})

const buildDirectory = path.resolve('dist')
if (existsSync(buildDirectory)) {
  app.use(express.static(buildDirectory))
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(path.join(buildDirectory, 'index.html')))
}

app.listen(port, () => {
  console.log(`Zedulearn API listening on http://localhost:${port}`)
})