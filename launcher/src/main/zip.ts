import { createWriteStream } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

function open(path: string): Promise<ZipFile> {
  return new Promise((done, fail) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => (error ? fail(error) : done(zip)))
  })
}

/** Visits every file entry in order; yauzl itself rejects absolute and `..` names. */
async function eachFile(
  path: string,
  visit: (entry: Entry, zip: ZipFile) => Promise<void>
): Promise<void> {
  const zip = await open(path)
  try {
    await new Promise<void>((done, fail) => {
      zip.on('error', fail)
      zip.on('end', done)
      zip.on('entry', (entry: Entry) => {
        const isDirectory = entry.fileName.endsWith('/')
        const step = isDirectory ? Promise.resolve() : visit(entry, zip)
        step.then(() => zip.readEntry(), fail)
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}

/** File names in the archive, with forward slashes. */
export async function listZip(path: string): Promise<string[]> {
  const names: string[] = []
  await eachFile(path, async (entry) => void names.push(entry.fileName))
  return names
}

/**
 * Extracts the archive into `dest`. `map` renames each entry or returns null
 * to skip it. Returns the number of files written.
 */
export async function extractZip(
  path: string,
  dest: string,
  map: (name: string) => string | null = (name) => name
): Promise<number> {
  const root = resolve(dest)
  let count = 0
  await eachFile(path, async (entry, zip) => {
    const name = map(entry.fileName)
    if (!name) return
    const target = resolve(root, name)
    if (!target.startsWith(root + sep)) throw new Error(`Unsafe path in archive: ${entry.fileName}`)

    await mkdir(dirname(target), { recursive: true })
    const stream = await new Promise<NodeJS.ReadableStream>((done, fail) => {
      zip.openReadStream(entry, (error, opened) => (error ? fail(error) : done(opened)))
    })
    await pipeline(stream, createWriteStream(target))

    // Zips made on Unix carry the file mode; keep executables executable.
    const mode = (entry.externalFileAttributes >>> 16) & 0o777
    if (mode && process.platform !== 'win32') await chmod(target, mode)
    count++
  })
  return count
}
