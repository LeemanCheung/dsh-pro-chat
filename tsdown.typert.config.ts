import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'neutral' as const,
  target: 'es2022',
  fixedExtension: false,
  dts: true,
  sourcemap: false,
  clean: false,
  deps: { neverBundle: ['zod'] },
}

export default defineConfig([
  { ...shared, entry: { 'typert.host': 'src/remote-contract.ts' } },
  { ...shared, entry: { 'typert.remote-client': 'src/remote-client.ts' } },
])
