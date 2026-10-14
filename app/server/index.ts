import { createHash } from 'node:crypto'
import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import * as cheerio from 'cheerio'
import { PDFParse } from 'pdf-parse'

const app = express()
const port = Number(process.env.API_PORT ?? 4175)
const libraryBase = 'https://library.cdcrepository.info'
const supportedLanguages = new Map([
  ['bem', { name: 'Bemba', googleCode: 'bem' }],
  ['nya', { name: 'Nyanja / Chichewa', googleCode: 'ny' }],
])
const supportedLevels = new Set(['ece', 'primary', 'secondary', 'syllabi', 'special_ed', 'teacher_ed', 'yale'])
const maximumPageTextLength = 12_000
const ministryPageUrl = 'https://www.edu.gov.zm/'
const ministryApiUrl = 'https://www.edu.gov.zm/?rest_route=%2Fwp%2Fv2%2Fpages%2F1142'

type MinistryResource = {
  id: string
  title: string
  description: string
  tags: string[]
  resourceUrl: string
  downloadUrl: string
  source: 'Ministry of Education'
}

type MinistryPageData = { summary: string; resources: MinistryResource[] }

let ministryPageCache: { expiresAt: number; data: MinistryPageData } | null = null
const ministryPdfUrls = new Map<string, string>()

function normalizePdfText(text: string) {
  const withoutControls = Array.from(text).filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return code >= 32 && (code < 127 || code > 159) || code === 9 || code === 10 || code === 13
  }).join('')

  return withoutControls
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function getMinistryPageData(): Promise<MinistryPageData> {
  if (ministryPageCache && ministryPageCache.expiresAt > Date.now()) return ministryPageCache.data

  const pageResponse = await fetch(ministryApiUrl, {
    headers: { 'User-Agent': 'Zedulearn/1.0 (curriculum resource browser)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!pageResponse.ok) throw new Error(`The Ministry page responded with ${pageResponse.status}.`)
  const pageData = await pageResponse.json() as {
    content?: { rendered?: string }
  }
  if (!pageData.content?.rendered) throw new Error('The Ministry page did not contain published content.')

  const $ = cheerio.load(pageData.content.rendered)
  const summary = $('p').map((_index, element) => $(element).text().replace(/\s+/g, ' ').trim()).get()
    .find((text) => text.startsWith('The Directorate develop and review'))
    ?? 'The Directorate of Curriculum Development develops and reviews Zambia\'s national school and college curricula and syllabi.'
  const resources: MinistryResource[] = []
  const seenDownloadUrls = new Set<string>()

  $('details').each((_sectionIndex, section) => {
    const sectionTitle = $(section).find('summary').first().text().replace(/\s+/g, ' ').trim()
    $(section).find('a[href]').each((_linkIndex, link) => {
      const href = $(link).attr('href')
      if (!href) return
      try {
        const downloadUrl = new URL(href)
        if (!['www.edu.gov.zm', 'edu.gov.zm'].includes(downloadUrl.hostname.toLowerCase())) return
        if (!downloadUrl.pathname.toLowerCase().startsWith('/wp-content/uploads/') || !downloadUrl.pathname.toLowerCase().endsWith('.pdf')) return
        downloadUrl.protocol = 'https:'
        if (seenDownloadUrls.has(downloadUrl.href)) return
        seenDownloadUrls.add(downloadUrl.href)
        const stableId = `moe-${createHash('sha256').update(downloadUrl.href).digest('hex').slice(0, 16)}`
        const title = $(link).find('.elementor-icon-list-text').text().replace(/\s+/g, ' ').trim()
        if (!title) return
        ministryPdfUrls.set(stableId, downloadUrl.href)
        resources.push({
          id: stableId,
          title,
          description: sectionTitle,
          tags: [sectionTitle, 'PDF'],
          resourceUrl: ministryPageUrl,
          downloadUrl: downloadUrl.href,
          source: 'Ministry of Education',
        })
      } catch {
        return
      }
    })
  })

  if (resources.length === 0) throw new Error('No official curriculum PDF links were found on the Ministry page.')
  const data = { summary, resources }
  ministryPageCache = { expiresAt: Date.now() + 10 * 60_000, data }
  return data
}

app.use(express.json({ limit: '32kb' }))

app.get('/api/status', (_request, response) => {
  response.json({ translationReady: Boolean(process.env.GOOGLE_TRANSLATE_API_KEY) })
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
          source: 'CDC Digital Library',
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

app.get('/api/ministry/resources', async (request, response) => {
  const level = String(request.query.level ?? 'primary')
  const grade = String(request.query.grade ?? 'g1')
  const query = String(request.query.q ?? '').trim().slice(0, 120).toLowerCase()
  const page = Math.max(1, Math.min(99, Number(request.query.page ?? 1) || 1))
  if (!supportedLevels.has(level) || !/^[a-z0-9_]{1,20}$/.test(grade)) {
    response.status(400).json({ error: 'Choose a valid school level and grade.' })
    return
  }

  try {
    const ministryPage = await getMinistryPageData()
    const matchingResources = ministryPage.resources.filter((resource) => {
      const title = resource.title.toLowerCase()
      const section = resource.description.toLowerCase()
      const levelMatch = level === 'ece'
        ? section.includes('early childhood') && !title.includes('special education')
        : level === 'primary'
          ? section === 'primary education' && !title.includes('special education')
          : level === 'secondary'
            ? section.startsWith('form ')
            : level === 'special_ed'
              ? title.includes('special education')
              : level === 'syllabi' && /syllab/i.test(title)
      if (!levelMatch) return false

      const gradeNumber = grade.match(/(?:g|f)([1-6])/)?.[1]
      if (gradeNumber) {
        const number = Number(gradeNumber)
        const range = title.match(/(?:grade|form)\s*(\d+)\s*[-–]\s*(\d+)/)
        const explicitGrade = new RegExp(`(?:grade|form)\\s*${number}\\b`).test(title)
        if (!explicitGrade && !(range && number >= Number(range[1]) && number <= Number(range[2]))) return false
      }

      return !query || `${title} ${section}`.includes(query)
    })
    const pageSize = 12
    const start = (page - 1) * pageSize
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900')
    response.json({
      summary: ministryPage.summary,
      resources: matchingResources.slice(start, start + pageSize),
      total: matchingResources.length,
      nextPage: start + pageSize < matchingResources.length ? page + 1 : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to contact the Ministry curriculum page.'
    response.status(502).json({ error: `Could not fetch Ministry curriculum resources. ${message}` })
  }
})

app.get('/api/resources/:id/text', async (request, response) => {
  const resourceId = request.params.id
  const page = Math.max(1, Math.min(500, Number(request.query.page ?? 1) || 1))
  let sourceUrl: URL
  if (/^\d{1,10}$/.test(resourceId)) {
    sourceUrl = new URL('/resource.php', libraryBase)
    sourceUrl.searchParams.set('id', resourceId)
    sourceUrl.searchParams.set('download', '1')
  } else if (/^moe-[a-f0-9]{16}$/.test(resourceId)) {
    try {
      await getMinistryPageData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to contact the Ministry curriculum page.'
      response.status(502).json({ error: message })
      return
    }
    const ministryPdfUrl = ministryPdfUrls.get(resourceId)
    if (!ministryPdfUrl) {
      response.status(404).json({ error: 'This Ministry PDF is no longer listed on the official page.' })
      return
    }
    sourceUrl = new URL(ministryPdfUrl)
  } else {
    response.status(400).json({ error: 'Choose a valid curriculum resource.' })
    return
  }
  let parser: PDFParse | undefined

  try {
    parser = new PDFParse({ url: sourceUrl.href })
    const result = await parser.getText({ partial: [page] })
    if (page > result.total) {
      response.status(404).json({ error: `This resource has ${result.total} pages.` })
      return
    }

    const extracted = normalizePdfText(result.pages.find((item) => item.num === page)?.text ?? '')
    if (extracted.length < 20) {
      response.status(422).json({ error: 'This page has no selectable text. It may be scanned; use the original CDC PDF instead.' })
      return
    }

    response.setHeader('Cache-Control', 'private, max-age=300')
    response.json({
      resourceId,
      page,
      totalPages: result.total,
      text: extracted.slice(0, maximumPageTextLength),
      truncated: extracted.length > maximumPageTextLength,
      sourceUrl: /^moe-/.test(resourceId) ? ministryPageUrl : `${libraryBase}/resource.php?id=${resourceId}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to extract text from this CDC PDF.'
    response.status(502).json({ error: `Could not load this curriculum page. ${message}` })
  } finally {
    await parser?.destroy()
  }
})

app.post('/api/translate', async (request, response) => {
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  const languageCode = typeof request.body?.language === 'string' ? request.body.language : ''
  const language = supportedLanguages.get(languageCode)

  if (!text || text.length > 12_000 || !language) {
    response.status(400).json({ error: 'Provide a passage under 12,000 characters and choose Bemba or Nyanja/Chichewa.' })
    return
  }
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY
  if (!apiKey) {
    response.status(503).json({ error: 'Google Translate is not configured yet. Add GOOGLE_TRANSLATE_API_KEY to app/.env and restart the app.' })
    return
  }

  const url = new URL('https://translation.googleapis.com/language/translate/v2')
  url.searchParams.set('key', apiKey)

  try {
    const translationResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'en',
        target: language.googleCode,
        format: 'text',
      }),
      signal: AbortSignal.timeout(45_000),
    })
    const body = await translationResponse.text()
    let result: { data?: { translations?: { translatedText?: string }[] }; error?: { message?: string } }
    try {
      result = JSON.parse(body) as typeof result
    } catch {
      response.status(502).json({ error: 'Google Translate returned an invalid response. Please try again.' })
      return
    }
    if (!translationResponse.ok) {
      response.status(502).json({ error: result.error?.message ?? 'Google Translate could not complete the request.' })
      return
    }
    const translation = result.data?.translations?.[0]?.translatedText?.trim()
    if (!translation) {
      response.status(502).json({ error: 'Google Translate returned an empty result.' })
      return
    }
    response.json({ translation, language: language.name, provider: 'Google Translate' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Translate request failed.'
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