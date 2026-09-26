import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'
import { cssModulePattern } from '../scripts/css-module-pattern.mjs'

describe('portable CSS module identity', () => {
  it('uses the same namespace for Windows and POSIX package paths', () => {
    expect(cssModulePattern('dsh-pro-chat', 'src\\client\\pro-chat.module.css'))
      .toBe(cssModulePattern('dsh-pro-chat', 'src/client/pro-chat.module.css'))
  })

  it('keeps different packages and module files in distinct namespaces', () => {
    const pattern = cssModulePattern('dsh-pro-chat', 'src/client/pro-chat.module.css')
    expect(pattern).not.toBe(cssModulePattern('another-plugin', 'src/client/pro-chat.module.css'))
    expect(pattern).not.toBe(cssModulePattern('dsh-pro-chat', 'src/client/another.module.css'))
  })

  it('emits identical styles and exports for different physical checkout paths', () => {
    const code = Buffer.from('.panel { color: red; animation: pulse 1s infinite; } @keyframes pulse { to { opacity: .5; } }')
    const pattern = cssModulePattern('dsh-pro-chat', 'src/client/pro-chat.module.css')
    const paths = [
      { filename: 'C:\\build\\dsh-pro-chat\\src\\client\\pro-chat.module.css', projectRoot: 'C:\\build' },
      { filename: '/build/dsh-pro-chat/src/client/pro-chat.module.css', projectRoot: '/build' },
      { filename: '/different/checkout/dsh-pro-chat/src/client/pro-chat.module.css', projectRoot: '/different/checkout' },
    ]
    const outputs = paths.map(path => {
      const result = transform({ ...path, code, cssModules: { pattern }, minify: true })
      return {
        css: result.code.toString(),
        exports: Object.fromEntries(Object.entries(result.exports ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
      }
    })
    expect(outputs[1]).toEqual(outputs[0])
    expect(outputs[2]).toEqual(outputs[0])
  })
})
