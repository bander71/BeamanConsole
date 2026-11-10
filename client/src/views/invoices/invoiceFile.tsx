import { renderToStaticMarkup } from 'react-dom/server'
import { fh } from '../../lib/format.ts'
import type { Invoice, InvoiceSettings } from './data.ts'
import { BANNER_URL, toDoc, type DocState } from './doc.ts'
import { timeDetail } from './files.tsx'
import ivCss from './invoice.css?raw'
import bannerData from './invoice-banner.png?inline'
import { InvoicePaper } from './InvoicePaper.tsx'

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap'
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function save(filename: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
}

/** A standalone HTML invoice (with its time detail on a second page), ready to print or save as PDF. */
export function downloadInvoice(i: Invoice, settings: InvoiceSettings, doc: DocState = toDoc(i)) {
  // Embed the banner so the file shows it when opened on its own, and drop the preload hint React adds for it.
  const paper = renderToStaticMarkup(<InvoicePaper d={doc} settings={settings} paid={i.totals.paid} />)
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replaceAll(`src="${BANNER_URL}"`, `src="${bannerData}"`)
  const ent = timeDetail(i)
  const detail = ent.length
    ? `<article class="ivdoc detail" style="margin-top:24px;min-height:0"><div class="iv-detail"><h3>Time detail · ${esc(doc.number)}</h3><table class="iv-t"><thead><tr><th>Date</th><th>Line</th><th class="c">Hours</th><th>Note</th></tr></thead><tbody>${ent
        .map((e) => `<tr><td>${esc(new Date(e.workDate + 'T00:00').toLocaleDateString())}</td><td>${esc(e.line)}</td><td class="c">${fh(e.hours)}</td><td>${esc(e.note || '')}</td></tr>`)
        .join('')}</tbody></table></div></article>`
    : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(doc.number)}</title><link rel="stylesheet" href="${FONTS}"><style>
body{margin:0;background:#e9e7e2;padding:24px 0}${ivCss}
.ivdoc{margin:0 auto;box-shadow:none}.iv-detail h3{font:700 13.33px Arial,sans-serif;letter-spacing:.67px;text-transform:uppercase;color:#886733;margin:0 0 10px}
@page{size:letter;margin:0}@media print{body{background:none;padding:0}.ivdoc{min-height:11in;width:8.5in;max-width:none}.ivdoc.detail{page-break-before:always;min-height:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<article class="ivdoc">${paper}</article>
${detail}
</body></html>`
  save(`Invoice ${doc.number}.html`, html, 'text/html')
}
