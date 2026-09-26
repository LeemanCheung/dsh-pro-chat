import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'
import { cssModulePattern } from './scripts/css-module-pattern.mjs'

const PACKAGE_ID = 'dsh-pro-chat'
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url))
const cssFiles = new Map<string, string>()
const platformModules = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-renderer/client', '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-api-remotes/client', '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-settings/client', '@deepseek-ai/dsh-client-ui-theme/client',
] as const

function packagePath(file: string): string {
  const result = relative(PACKAGE_ROOT, file)
  if (result === '' || result === '..' || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new Error(`dsh-pro-chat CSS escaped package root: ${file}`)
  }
  return result.split(sep).join('/')
}

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...platformModules],
    alwaysBundle: ['zod'],
    onlyBundle: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-pro-chat-css-modules-inline',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css')) return null
      if (importer === undefined) throw new Error('dsh-pro-chat CSS importer is missing')
      const file = resolve(dirname(importer), source)
      const stableId = `\0${PACKAGE_ID}-css:${packagePath(file)}.mjs`
      cssFiles.set(stableId, file)
      return stableId
    },
    async load(this: { addWatchFile(path: string): void }, id: string) {
      const file = cssFiles.get(id)
      if (file === undefined) return null
      this.addWatchFile(file)
      const logicalRoot = dirname(PACKAGE_ROOT)
      const logicalFilename = resolve(logicalRoot, PACKAGE_ID, ...packagePath(file).split('/'))
      const result = transform({
        filename: logicalFilename,
        projectRoot: logicalRoot,
        code: await readFile(file),
        cssModules: { pattern: cssModulePattern(PACKAGE_ID, packagePath(file)) },
        minify: true,
      })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {})
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([local, value]) => [local, value.name]))
      return [
        `export const cssText=${JSON.stringify(result.code.toString())};`,
        `export const styleId=${JSON.stringify(`${PACKAGE_ID}/${basename(file)}`)};`,
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }, {
    name: 'dsh-pro-chat-client-declaration',
    async closeBundle() {
      const output = resolve(PACKAGE_ROOT, 'lib')
      const clientPath = resolve(output, 'client.js')
      const client = await readFile(clientPath, 'utf8')
      await writeFile(clientPath, client.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, ''))
      const sourceMapPath = resolve(output, 'client.js.map')
      const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8')) as { sources?: string[] }
      if (Array.isArray(sourceMap.sources)) {
        sourceMap.sources = sourceMap.sources.map((rawSource) => {
          const source = rawSource.replace(/\\/g, '/')
          if (!source.includes('/node_modules/.pnpm/')) return source
          const nestedModules = source.lastIndexOf('/node_modules/')
          if (nestedModules < 0) throw new Error(`Unable to normalize pnpm source-map path: ${source}`)
          return `../node_modules/${source.slice(nestedModules + '/node_modules/'.length)}`
        })
        await writeFile(sourceMapPath, JSON.stringify(sourceMap))
      }
      await writeFile(resolve(output, 'client.d.ts'), [
        "import type { Context } from '@deepseek-ai/cordis'",
        'export declare const inject: readonly string[]',
        'export declare function apply(ctx: Context): void | Promise<void | (() => void | Promise<void>)>',
        '',
      ].join('\n'))
      await rm(resolve(output, 'client.ts.map'), { force: true })
      await rm(resolve(output, 'tsconfig.tsbuildinfo'), { force: true })
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({id:${JSON.stringify(PACKAGE_ID)},factory:(require)=>{`,
    intro: 'var module={exports:{}};var exports=module.exports;',
    footer: 'return module.exports;}});',
  },
})
