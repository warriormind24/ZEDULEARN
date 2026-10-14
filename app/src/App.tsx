import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, FileText, Landmark, Languages, LoaderCircle, Search, Sparkles, X } from 'lucide-react'
import './workspace.css'

type Resource = { id: string; title: string; description: string; tags: string[]; resourceUrl: string; downloadUrl: string; source?: 'CDC Digital Library' | 'Ministry of Education' }
type CatalogResponse = { resources: Resource[]; total: number; nextPage: number | null }
type ExtractedPage = { resourceId: string; page: number; totalPages: number; text: string; truncated: boolean }

async function readApiJson<T>(response: Response): Promise<T> {
  const body = await response.text()
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error('The app server returned a web page instead of API data. Restart both servers with npm run dev and try again.')
  }
}

const levels = [
  { value: 'ece', label: 'Early childhood' },
  { value: 'primary', label: 'Primary school' },
  { value: 'secondary', label: 'Secondary school' },
  { value: 'syllabi', label: 'Syllabi' },
  { value: 'special_ed', label: 'Special education' },
  { value: 'teacher_ed', label: 'Teacher education' },
  { value: 'yale', label: 'Adult literacy' },
]

const gradesByLevel: Record<string, { value: string; label: string }[]> = {
  ece: [{ value: 'ece1', label: 'ECE level 1' }, { value: 'ece2', label: 'ECE level 2' }],
  primary: Array.from({ length: 6 }, (_, index) => ({ value: `g${index + 1}`, label: `Grade ${index + 1}` })),
  secondary: Array.from({ length: 6 }, (_, index) => ({ value: `f${index + 1}`, label: `Form ${index + 1}` })),
  syllabi: [{ value: 'syl_ece', label: 'ECE' }, { value: 'syl_primary', label: 'Primary' }, { value: 'syl_olevel', label: 'O-Level' }, { value: 'syl_alevel', label: 'A-Level' }, { value: 'syl_yale', label: 'YALE' }],
  special_ed: [{ value: 'sp_ece34', label: 'ECE ages 3-4' }, { value: 'sp_ece45', label: 'ECE ages 4-5' }, ...Array.from({ length: 6 }, (_, index) => ({ value: `sp_gr${index + 1}`, label: `Grade ${index + 1}` }))],
  teacher_ed: Array.from({ length: 3 }, (_, index) => ({ value: `te_yr${index + 1}`, label: `Year ${index + 1}` })),
  yale: [{ value: 'y1', label: 'Option 1' }, { value: 'y2', label: 'Option 2' }],
}

const languages = [
  { code: 'bem', label: 'Bemba', available: true },
  { code: 'nya', label: 'Nyanja / Chichewa', available: true },
  { code: 'toi', label: 'Tonga', available: false },
  { code: 'loz', label: 'Lozi', available: false },
  { code: 'kqn', label: 'Kaonde', available: false },
  { code: 'lun', label: 'Lunda', available: false },
  { code: 'lue', label: 'Luvale', available: false },
]

function App() {
  const [catalogSource, setCatalogSource] = useState<'cdc' | 'ministry'>('cdc')
  const [level, setLevel] = useState('primary')
  const [grade, setGrade] = useState('g1')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [resources, setResources] = useState<Resource[]>([])
  const [total, setTotal] = useState(0)
  const [ministrySummary, setMinistrySummary] = useState('')
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [activeResource, setActiveResource] = useState<Resource | null>(null)
  const [language, setLanguage] = useState('bem')
  const [passage, setPassage] = useState('')
  const [translation, setTranslation] = useState('')
  const [sourcePage, setSourcePage] = useState(1)
  const [sourcePageCount, setSourcePageCount] = useState<number | null>(null)
  const [isLoadingSource, setIsLoadingSource] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [loadedRequest, setLoadedRequest] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [catalogFailure, setCatalogFailure] = useState<{ requestKey: string; message: string } | null>(null)
  const [translationError, setTranslationError] = useState('')
  const [translationReady, setTranslationReady] = useState(false)
  const [pdfConstructor, setPdfConstructor] = useState<typeof import('jspdf').jsPDF | null>(null)
  const sourceRequest = useRef(0)
  const requestKey = `${catalogSource}:${level}:${grade}:${search}:${page}`
  const isLoading = loadedRequest !== requestKey
  const catalogError = catalogFailure?.requestKey === requestKey ? catalogFailure.message : ''

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchDraft.trim()); setPage(1) }, 280)
    return () => window.clearTimeout(timer)
  }, [searchDraft])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ level, grade, page: String(page) })
    if (search) params.set('q', search)
    const endpoint = catalogSource === 'cdc' ? '/api/catalog' : '/api/ministry/resources'
    fetch(`${endpoint}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await readApiJson<CatalogResponse & { error?: string; summary?: string }>(response)
        if (!response.ok) throw new Error(data.error ?? 'Could not load curriculum resources.')
        setResources(data.resources)
        setTotal(data.total)
        setMinistrySummary(catalogSource === 'ministry' ? data.summary ?? '' : '')
        setNextPage(data.nextPage)
        setActiveResource((current) => current && data.resources.some((item) => item.id === current.id) ? current : data.resources[0] ?? null)
        setLoadedRequest(requestKey)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setCatalogFailure({ requestKey, message: error instanceof Error ? error.message : 'Could not load curriculum resources.' })
        setResources([])
        setLoadedRequest(requestKey)
      })
      .finally(() => setLoadedRequest(requestKey))
    return () => controller.abort()
  }, [catalogSource, level, grade, search, page, requestKey])

  useEffect(() => {
    fetch('/api/status').then((response) => readApiJson<{ translationReady?: boolean }>(response))
      .then((data: { translationReady?: boolean }) => setTranslationReady(Boolean(data.translationReady)))
      .catch(() => setTranslationReady(false))
  }, [])

  useEffect(() => {
    if (!translation || pdfConstructor) return
    let cancelled = false
    void import('jspdf')
      .then(({ jsPDF }) => { if (!cancelled) setPdfConstructor(() => jsPDF) })
      .catch(() => { if (!cancelled) setTranslationError('Could not load the PDF exporter. Please refresh the page.') })
    return () => { cancelled = true }
  }, [translation, pdfConstructor])

  const gradeOptions = gradesByLevel[level] ?? []
  const selectedLanguage = languages.find((item) => item.code === language) ?? languages[0]

  function changeLevel(value: string) {
    setLevel(value)
    setGrade(gradesByLevel[value]?.[0]?.value ?? '')
    setPage(1)
  }

  function changeCatalogSource(source: 'cdc' | 'ministry') {
    setCatalogSource(source)
    setPage(1)
    setResources([])
    setTotal(0)
    setNextPage(null)
    setActiveResource(null)
    setPassage('')
    setTranslation('')
    setSourcePage(1)
    setSourcePageCount(null)
    setSourceError('')
  }

  function selectResource(resource: Resource) {
    sourceRequest.current += 1
    setActiveResource(resource)
    setPassage('')
    setTranslation('')
    setSourcePage(1)
    setSourcePageCount(null)
    setIsLoadingSource(false)
    setSourceError('')
  }

  async function loadSourcePage() {
    if (!activeResource || isLoadingSource) return
    const requestId = ++sourceRequest.current
    setIsLoadingSource(true)
    setSourceError('')
    try {
      const response = await fetch(`/api/resources/${activeResource.id}/text?page=${sourcePage}`)
      const data = await readApiJson<ExtractedPage & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? 'Could not load this curriculum page.')
      if (requestId !== sourceRequest.current) return
      setPassage(data.text)
      setTranslation('')
      setSourcePageCount(data.totalPages)
    } catch (error) {
      if (requestId === sourceRequest.current) {
        setSourceError(error instanceof Error ? error.message : 'Could not load this curriculum page.')
      }
    } finally {
      if (requestId === sourceRequest.current) setIsLoadingSource(false)
    }
  }

  async function loadMore() {
    if (!nextPage || isLoadingMore) return
    setIsLoadingMore(true)
    const params = new URLSearchParams({ level, grade, page: String(nextPage) })
    if (search) params.set('q', search)
    const endpoint = catalogSource === 'cdc' ? '/api/catalog' : '/api/ministry/resources'
    try {
      const response = await fetch(`${endpoint}?${params}`)
      const data = await readApiJson<CatalogResponse & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? 'Could not load more resources.')
      setResources((current) => [...current, ...data.resources.filter((item) => !current.some((existing) => existing.id === item.id))])
      setNextPage(data.nextPage)
    } catch (error) {
      setCatalogFailure({ requestKey, message: error instanceof Error ? error.message : 'Could not load more resources.' })
    } finally {
      setIsLoadingMore(false)
    }
  }

  async function translatePassage() {
    if (!passage.trim()) return
    setIsTranslating(true)
    setTranslationError('')
    setTranslation('')
    try {
      const response = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage.trim(), language }),
      })
      const data = await readApiJson<{ translation?: string; error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? 'Translation failed. Please try again.')
      setTranslation(data.translation ?? '')
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : 'Translation failed. Please try again.')
    } finally {
      setIsTranslating(false)
    }
  }

  function downloadStudyNotes() {
    if (!translation || !pdfConstructor) return
    const pdf = new pdfConstructor()
    const left = 18
    const width = 174
    let y = 22
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(20)
    pdf.text('Zedulearn study notes', left, y)
    y += 11
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(`Google Translate draft - ${selectedLanguage.label} - ${new Date().toLocaleDateString()}`, left, y)
    y += 9
    if (activeResource) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      const titleLines = pdf.splitTextToSize(activeResource.title, width) as string[]
      pdf.text(titleLines, left, y)
      y += titleLines.length * 6 + 3
    }
    for (const [heading, content] of [['Original passage', passage], [`Translation - ${selectedLanguage.label}`, translation]]) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.text(heading, left, y)
      y += 7
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(11)
      const lines = pdf.splitTextToSize(content, width) as string[]
      for (const line of lines) {
        if (y > 276) { pdf.addPage(); y = 20 }
        pdf.text(line, left, y)
        y += 5.5
      }
      y += 8
    }
    if (y > 280) { pdf.addPage(); y = 20 }
    pdf.setFontSize(9)
    pdf.text('AI-generated translation. Ask a fluent speaker to verify meaning before relying on it.', left, y)
    pdf.save('zedulearn-study-notes.pdf')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Zedulearn home"><span className="brand-mark"><BookOpen size={21} /></span><span className="brand-name">zedu<span>learn</span></span></a>
        <nav className="top-nav" aria-label="Main navigation"><a className="nav-link active" href="#curriculum">Curriculum</a><a className="nav-link" href="#study-desk">Study desk</a></nav>
        <a className="source-link" href="https://library.cdcrepository.info/" target="_blank" rel="noreferrer">CDC Digital Library <ArrowUpRight size={15} /></a>
      </header>

      <main id="home">
        <section className="intro-band">
          <div><p className="eyebrow"><span className="eyebrow-dot" /> ZAMBIA | COMPETENCE-BASED CURRICULUM</p><h1>Learn in the language<br className="desktop-break" /> that feels like home.</h1><p className="intro-copy">Find an official lesson. Bring the words closer. Keep a copy for later.</p></div>
          <div className="intro-note"><span className="note-rule" /><p>Built around curriculum materials from the<br /> Curriculum Development Centre.</p></div>
        </section>

        <section id="curriculum" className="workspace-grid" aria-label="Curriculum and translation workspace">
          <aside className="filter-rail">
            <div className="section-heading"><span className="section-index">01</span><div><h2>Find a lesson</h2><p>Choose a level to begin.</p></div></div>
            <label className="field-label" htmlFor="level-select">School level</label>
            <div className="select-wrap"><select id="level-select" value={level} onChange={(event) => changeLevel(event.target.value)}>{levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={16} /></div>
            <label className="field-label" htmlFor="grade-select">Grade or form</label>
            <div className="select-wrap"><select id="grade-select" value={grade} onChange={(event) => { setGrade(event.target.value); setPage(1) }}>{gradeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={16} /></div>
            <div className="rail-divider" />
            <div className="source-status"><span className="status-pulse" /><span>{catalogSource === 'cdc' ? 'CDC Digital Library' : 'Ministry of Education'}</span></div>
            <p className="rail-caption">Original files remain hosted by the {catalogSource === 'cdc' ? 'CDC Digital Library' : 'Ministry of Education'}.</p>
            <a className="rail-source" href={catalogSource === 'cdc' ? 'https://library.cdcrepository.info/about.php' : 'https://www.edu.gov.zm/'} target="_blank" rel="noreferrer">{catalogSource === 'cdc' ? 'About the CDC library' : 'Ministry of Education'} <ArrowUpRight size={14} /></a>
          </aside>

          <section className="resource-column" aria-label="Curriculum resources">
            <div className="resource-head">
              <div className="section-heading"><span className="section-index">02</span><div><h2>Curriculum library</h2><p>{total ? `${total} matching resources` : 'Official learning materials'}</p></div></div>
              <label className="search-box" htmlFor="resource-search"><Search size={17} /><input id="resource-search" type="search" placeholder="Search lessons or subjects" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />{searchDraft && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearchDraft('')}><X size={15} /></button>}</label>
            </div>
            <div className="catalog-toolbar">
              <div className="source-tabs" role="tablist" aria-label="Curriculum source">
                <button type="button" role="tab" aria-selected={catalogSource === 'cdc'} className={catalogSource === 'cdc' ? 'source-tab active' : 'source-tab'} onClick={() => changeCatalogSource('cdc')}><BookOpen size={14} /> CDC Library</button>
                <button type="button" role="tab" aria-selected={catalogSource === 'ministry'} className={catalogSource === 'ministry' ? 'source-tab active' : 'source-tab'} onClick={() => changeCatalogSource('ministry')}><Landmark size={14} /> Ministry page</button>
              </div>
              {catalogSource === 'ministry' && ministrySummary && <p className="ministry-summary">{ministrySummary}</p>}
            </div>
            {catalogError && <div className="notice error-notice"><CircleAlert size={18} /><span>{catalogError} <a href={catalogSource === 'cdc' ? 'https://library.cdcrepository.info/' : 'https://www.edu.gov.zm/?page_id=1142'} target="_blank" rel="noreferrer">Open the {catalogSource === 'cdc' ? 'CDC library' : 'Ministry page'}</a></span></div>}
            <div className="resource-list" aria-live="polite" aria-busy={isLoading}>
              {isLoading && resources.length === 0 && <div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading official resources...</div>}
              {!isLoading && resources.length === 0 && !catalogError && <div className="empty-state"><BookOpen size={24} /><h3>No resources found</h3><p>Try another subject, level, or grade.</p></div>}
              {resources.map((resource, index) => <article className={`resource-row ${activeResource?.id === resource.id ? 'selected' : ''}`} key={resource.id}>
                <button className="resource-select" type="button" onClick={() => selectResource(resource)} aria-label={`Select ${resource.title}`}>
                  <span className="resource-number">{String(index + 1).padStart(2, '0')}</span><span className="resource-info"><span className="resource-title">{resource.title}</span>{resource.description && <span className="resource-description">{resource.description}</span>}<span className="tag-list">{resource.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</span></span>
                  {activeResource?.id === resource.id && <Check className="selected-check" size={17} />}
                </button>
                <a className="download-button" href={resource.downloadUrl} target="_blank" rel="noreferrer" aria-label={`Download ${resource.title}`} title="Download original PDF"><ArrowDownToLine size={17} /></a>
              </article>)}
            </div>
            {nextPage && <button type="button" className="load-more" onClick={loadMore} disabled={isLoadingMore}>{isLoadingMore && <LoaderCircle className="spin" size={16} />}{isLoadingMore ? 'Loading...' : 'Load more resources'}</button>}
            <p className="source-footnote"><FileText size={14} /> Original curriculum documents open from the {catalogSource === 'cdc' ? 'CDC Digital Library' : 'Ministry of Education'}.</p>
          </section>

          <section id="study-desk" className="study-desk" aria-label="Translation study desk">
            <div className="desk-topline"><div className="section-heading"><span className="section-index">03</span><div><h2>Study desk</h2><p>Make a passage your own.</p></div></div><span className="desk-icon"><Languages size={19} /></span></div>
            {activeResource && <div className="active-source"><span>{activeResource.source ?? 'CURRICULUM SOURCE'}</span><strong>{activeResource.title}</strong></div>}
            <label className="field-label" htmlFor="language-select">Translate into</label>
            <div className="select-wrap language-select"><select id="language-select" value={language} onChange={(event) => { setLanguage(event.target.value); setTranslation('') }}>{languages.map((item) => <option key={item.code} value={item.code} disabled={!item.available}>{item.available ? item.label : `${item.label} (not supported by Google Translate)`}</option>)}</select><ChevronDown size={16} /></div>
            <p className="provider-hint">Google Translate currently supports Bemba and Nyanja/Chichewa from these choices. Other languages are disabled until Google adds them.</p>
            {activeResource && <div className="page-loader">
              <div className="page-number-field"><label className="field-label" htmlFor="source-page">PDF page</label><input id="source-page" type="number" min="1" max={sourcePageCount ?? 500} value={sourcePage} disabled={isLoadingSource} onChange={(event) => setSourcePage(Math.max(1, Number(event.target.value) || 1))} /></div>
              <button type="button" className="load-page-button" onClick={loadSourcePage} disabled={isLoadingSource}>{isLoadingSource ? <LoaderCircle className="spin" size={15} /> : <BookOpen size={15} />}{isLoadingSource ? 'Loading page...' : 'Load page text'}</button>
              {sourcePageCount && <span className="page-count">Page {sourcePage} of {sourcePageCount}</span>}
            </div>}
            {sourceError && <div className="notice source-error"><CircleAlert size={16} /><span>{sourceError} <a href={activeResource?.downloadUrl} target="_blank" rel="noreferrer">Open original PDF</a></span></div>}
            <label className="field-label passage-label" htmlFor="passage-input">Passage in English</label>
            <textarea id="passage-input" value={passage} onChange={(event) => { setPassage(event.target.value); setTranslation('') }} maxLength={12000} placeholder={activeResource ? 'Load a CDC page or paste a passage here...' : 'Paste a short passage from your lesson here...'} />
            <div className="passage-meta"><span>{passage.length.toLocaleString()} / 12,000</span><span>Keep one idea at a time</span></div>
            <button type="button" className="translate-button" onClick={translatePassage} disabled={!passage.trim() || isTranslating}>{isTranslating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{isTranslating ? 'Translating...' : `Translate to ${selectedLanguage.label}`}</button>
            {!translationReady && <p className="provider-hint">Google Cloud Translation needs setup. Add <code>GOOGLE_TRANSLATE_API_KEY</code> in <code>app/.env</code>.</p>}
            {translationError && <div className="notice translation-error"><CircleAlert size={16} /><span>{translationError}</span></div>}
            {translation && <div className="translation-result"><div className="translation-result-head"><span><Sparkles size={14} /> GOOGLE TRANSLATE DRAFT</span><span>{selectedLanguage.label}</span></div><p>{translation}</p><div className="translation-actions"><span className="verify-note">Ask a fluent speaker to verify.</span><button type="button" className="icon-text-button" onClick={downloadStudyNotes} disabled={!pdfConstructor} title={pdfConstructor ? 'Download translated study notes' : 'Preparing PDF export'}><ArrowDownToLine size={15} /> {pdfConstructor ? 'Download notes' : 'Preparing PDF...'}</button></div></div>}
          </section>
        </section>

        <footer className="page-footer"><span>(c) Zedulearn</span><span>Curriculum source: <a href={catalogSource === 'cdc' ? 'https://library.cdcrepository.info/' : 'https://www.edu.gov.zm/'} target="_blank" rel="noreferrer">{catalogSource === 'cdc' ? 'CDC Digital Library' : 'Ministry of Education'}</a></span><span className="footer-disclaimer">Machine translations are study aids, not official curriculum editions.</span></footer>
      </main>
    </div>
  )
}

export default App
