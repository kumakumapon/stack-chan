import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { REQUIRED_FILES as requiredFiles, validatePagesPreview } from './validate-pages-preview.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stackchan-pages-preview-'))
  for (const file of requiredFiles) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'test')
  }
  return root
}

test('accepts a complete static preview', async () => {
  const root = await fixture()
  assert.deepEqual(await validatePagesPreview(root), {
    fileCount: requiredFiles.length,
  })
})

test('accepts additional nested static assets', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets/scripts'), { recursive: true })
  await writeFile(join(root, 'assets/scripts/index.js'), 'test')
  assert.deepEqual(await validatePagesPreview(root), {
    fileCount: requiredFiles.length + 1,
  })
})

for (const name of ['.assetsignore', '_headers', '_redirects', '_routes.json', '_worker.js']) {
  for (const parent of ['', 'assets']) {
    for (const kind of ['file', 'empty directory', 'directory with index.js']) {
      const relativePath = parent ? `${parent}/${name}` : name
      test(`rejects forbidden ${kind}: ${relativePath}`, async (t) => {
        const root = await fixture()
        t.after(() => rm(root, { recursive: true, force: true }))
        const path = join(root, relativePath)
        await mkdir(dirname(path), { recursive: true })
        if (kind === 'file') {
          await writeFile(path, 'test')
        } else {
          await mkdir(path)
          if (kind === 'directory with index.js') {
            await writeFile(join(path, 'index.js'), 'test')
          }
        }
        await assert.rejects(validatePagesPreview(root), {
          message: `Cloudflare runtime controls are not allowed in PR previews: ${relativePath}`,
        })
      })
    }
  }
}

test('rejects a missing generated artifact', async () => {
  const root = await fixture()
  await writeFile(join(root, 'simulator/mc.wasm'), '')
  await assert.rejects(validatePagesPreview(root), /empty or invalid: simulator\/mc\.wasm/)
})

test('rejects Cloudflare runtime code', async () => {
  const root = await fixture()
  await writeFile(join(root, '_worker.js'), 'export default {}')
  await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
})

test('rejects Cloudflare asset controls', async () => {
  const root = await fixture()
  await writeFile(join(root, '.assetsignore'), 'simulator/mc.wasm')
  await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
})

test('rejects Cloudflare header and redirect controls', async () => {
  for (const file of ['_headers', '_redirects']) {
    const root = await fixture()
    await writeFile(join(root, file), '/* https://example.com/:splat 302')
    await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
  }
})

test('rejects a top-level functions directory', async () => {
  const root = await fixture()
  await mkdir(join(root, 'functions'), { recursive: true })
  await writeFile(join(root, 'functions/index.js'), 'export default {}')
  await assert.rejects(validatePagesPreview(root), /Cloudflare Pages Functions are not allowed/)
})

test('rejects symbolic links', async () => {
  const root = await fixture()
  await symlink('index.html', join(root, 'linked-index.html'))
  await assert.rejects(validatePagesPreview(root), /Symbolic links are not allowed/)
})
