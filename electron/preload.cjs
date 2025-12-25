const { contextBridge, ipcRenderer } = require('electron')

async function invoke(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload)
  if (!res || typeof res !== 'object') {
    throw { message: 'Invalid IPC response', status: 500, body: { error: 'Invalid IPC response' } }
  }

  const status = res.status
  const body = res.body
  if (typeof status === 'number' && status >= 200 && status < 300) return body

  const message = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'Request failed'
  throw { message, status: typeof status === 'number' ? status : 500, body }
}

contextBridge.exposeInMainWorld('dbconsole', {
  isDesktop: true,
  platform: process.platform,
  api: {
    app: {
      info: () => invoke('dbconsole:app:info'),
    },
    connections: {
      list: () => invoke('dbconsole:connections:list'),
      create: (draft) => invoke('dbconsole:connections:create', draft),
      update: (id, patch) => invoke('dbconsole:connections:update', { id, patch }),
      delete: (id) => invoke('dbconsole:connections:delete', { id }),
      test: (draft) => invoke('dbconsole:connections:test', draft),
      releasePools: (payload) => invoke('dbconsole:pools:release', payload),
    },
    namedQueries: {
      list: () => invoke('dbconsole:namedQueries:list'),
      get: (id) => invoke('dbconsole:namedQueries:get', { id }),
      save: (payload) => invoke('dbconsole:namedQueries:save', payload),
      update: (id, patch) => invoke('dbconsole:namedQueries:update', { id, patch }),
      delete: (id) => invoke('dbconsole:namedQueries:delete', { id }),
    },
    schema: {
      load: (connectionId) => invoke('dbconsole:schema:load', { connectionId }),
    },
    query: {
      run: (payload) => invoke('dbconsole:query:run', payload),
    },
    sqlFile: {
      openDialog: () => invoke('dbconsole:sqlFile:openDialog'),
    },
    shortcuts: {
      get: () => invoke('dbconsole:shortcuts:get'),
      set: (payload) => invoke('dbconsole:shortcuts:set', payload),
    },
    syncer: {
      settings: {
        get: () => invoke('dbconsole:syncer:settings:get'),
        set: (payload) => invoke('dbconsole:syncer:settings:set', payload),
      },
      namedQueries: {
        sync: (payload) => invoke('dbconsole:syncer:namedQueries:sync', payload ?? {}),
      },
      // Back-compat aliases (older renderers may not have nested groups)
      get: () => invoke('dbconsole:syncer:settings:get'),
      set: (payload) => invoke('dbconsole:syncer:settings:set', payload),
      sync: (payload) => invoke('dbconsole:syncer:namedQueries:sync', payload ?? {}),
    },
    updater: {
      check: () => invoke('dbconsole:updater:check'),
      install: (updateInfo) => invoke('dbconsole:updater:install', updateInfo),
      state: () => invoke('dbconsole:updater:state'),
      history: () => invoke('dbconsole:updater:history'),
      settings: {
        get: () => invoke('dbconsole:updater:settings:get'),
        set: (settings) => invoke('dbconsole:updater:settings:set', settings),
      },
      token: {
        exists: () => invoke('dbconsole:updater:token:exists'),
        validate: (token) => invoke('dbconsole:updater:token:validate', { token }),
        set: (token) => invoke('dbconsole:updater:token:set', { token }),
      },
    },
    uiPrefs: {
      get: (key) => invoke('dbconsole:uiPrefs:get', { key }),
      set: (payload) => invoke('dbconsole:uiPrefs:set', payload),
    },
  },
  events: {
    onSqlFileOpen: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = (_evt, payload) => {
        handler(payload)
      }
      ipcRenderer.on('dbconsole:sqlFile:open', listener)
      return () => ipcRenderer.removeListener('dbconsole:sqlFile:open', listener)
    },
    onMenuAbout: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = () => {
        handler()
      }
      ipcRenderer.on('dbconsole:menu:about', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:about', listener)
    },
    onMenuCheckUpdates: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = () => {
        handler()
      }
      ipcRenderer.on('dbconsole:menu:checkUpdates', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:checkUpdates', listener)
    },
    onMenuUpdateSettings: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = () => {
        handler()
      }
      ipcRenderer.on('dbconsole:menu:updateSettings', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:updateSettings', listener)
    },
    onMenuSyncNow: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = () => {
        handler()
      }
      ipcRenderer.on('dbconsole:menu:syncNow', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:syncNow', listener)
    },
    onMenuSyncSettings: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = () => {
        handler()
      }
      ipcRenderer.on('dbconsole:menu:syncSettings', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:syncSettings', listener)
    },
    onMenuSidebarActionsShowOnHover: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = (_evt, payload) => {
        handler(payload)
      }
      ipcRenderer.on('dbconsole:menu:sidebarActionsShowOnHover', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:sidebarActionsShowOnHover', listener)
    },
    onMenuTheme: (handler) => {
      if (typeof handler !== 'function') return () => { }
      const listener = (_evt, payload) => {
        handler(payload)
      }
      ipcRenderer.on('dbconsole:menu:theme', listener)
      return () => ipcRenderer.removeListener('dbconsole:menu:theme', listener)
    },
  },
})
