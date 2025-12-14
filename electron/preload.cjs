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
  },
})
