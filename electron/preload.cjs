const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('dbconsoleDesktop', {
  isDesktop: true,
  platform: process.platform,
})

