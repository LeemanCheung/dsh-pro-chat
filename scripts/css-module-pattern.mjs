import { createHash } from 'node:crypto'

export function cssModulePattern(packageId, packagePath) {
  // Lightning CSS's [hash] includes platform paths. Hash the package identity instead.
  const identity = `${packageId}/${packagePath.replaceAll('\\', '/')}`
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  return `_p${hash}_[local]`
}
