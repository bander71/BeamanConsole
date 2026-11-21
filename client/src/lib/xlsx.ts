// Reads the first sheet of an .xlsx file in the browser, with no library:
// an .xlsx is a zip of XML files, and browsers can inflate zip entries themselves.

/** Every entry in a zip file, by path, as text. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, string>> {
  const v = new DataView(buf)
  // The central directory's end record is in the last 64 KB.
  let end = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error("This file isn't a valid .xlsx file.")
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const out = new Map<string, string>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const data = new Uint8Array(buf, start, size)
    if (method === 0) out.set(name, dec.decode(data))
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.set(name, await new Response(stream).text())
    }
  }
  return out
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
const texts = (s: string) => [...s.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join('')
const colIndex = (ref: string) => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** The first sheet as rows of cell text. */
export async function readXlsx(file: Blob): Promise<string[][]> {
  const files = await unzip(await file.arrayBuffer())
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!))
  // Find the first sheet's file through the workbook's relationships.
  const wb = files.get('xl/workbook.xml') ?? ''
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? ''
  const rid = /<sheet [^>]*r:id="([^"]+)"/.exec(wb)?.[1]
  const target = rid && new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)
  const path = target ? 'xl/' + (target[1] ?? target[2])!.replace(/^\/?xl\//, '') : 'xl/worksheets/sheet1.xml'
  const sheet = files.get(path)
  if (!sheet) throw new Error("Couldn't find a sheet in this .xlsx file.")
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = []
    for (const c of row[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+\d+)"/.exec(c[1]!)?.[1]
      if (!ref) continue
      const type = /t="([^"]*)"/.exec(c[1]!)?.[1]
      const inner = c[2] ?? ''
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      cells[colIndex(ref)] = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? texts(inner) : value === undefined ? '' : xmlText(value)
    }
    return Array.from(cells, (x) => x ?? '')
  })
}
