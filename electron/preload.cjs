const { contextBridge, ipcRenderer } = require('electron')

async function invoke(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload)
  if (!res || typeof res !== 'object') {
    const err = new Error('Invalid IPC response')
    err.status = 500
    err.body = { error: 'Invalid IPC response' }
    throw err
  }

  const status = res.status
  const body = res.body
  if (typeof status === 'number' && status >= 200 && status < 300) return body

  const message = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'Request failed'
  const err = new Error(message)
  err.status = typeof status === 'number' ? status : 500
  err.body = body
  throw err
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
  },
})
