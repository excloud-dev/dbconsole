/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('node:path')

async function rebuildNextNativeModules(context) {
  const { rebuild } = require('@electron/rebuild')

  const productFilename = context.packager.appInfo.productFilename
  const resourcesDir =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')

  const nextDir = path.join(resourcesDir, 'next')

  await rebuild({
    buildPath: nextDir,
    electronVersion: context.electronVersion,
    arch: context.arch,
    force: true,
    onlyModules: ['better-sqlite3', 'sharp'],
  })
}

module.exports = async function afterPack(context) {
  try {
    await rebuildNextNativeModules(context)
  } catch (err) {
    // Don't hard-fail packaging; native rebuilds can be environment-specific.
    console.warn('afterPack native rebuild failed:', err)
  }
}

