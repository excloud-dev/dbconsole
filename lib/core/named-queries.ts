import { deleteNamedQuery, getNamedQuery, listNamedQueries, upsertNamedQuery, type QueryParamDef } from '@/lib/meta-db'
import { CoreError } from '@/lib/core/errors'

export type ClientNamedQuery = {
    id: string
    name: string
    description?: string
    sqlTemplate: string
    params: QueryParamDef[]
    defaultConnectionId?: string
}

function toClientNamedQuery(row: { id: string; name: string; description?: string; sqlTemplate: string; paramsJson: string; defaultConnectionId?: string }): ClientNamedQuery {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        sqlTemplate: row.sqlTemplate,
        params: JSON.parse(row.paramsJson) as QueryParamDef[],
        defaultConnectionId: row.defaultConnectionId,
    }
}

export function listAllNamedQueries(): ClientNamedQuery[] {
    return listNamedQueries().map(toClientNamedQuery)
}

export function getOneNamedQuery(id: string): ClientNamedQuery {
    const nq = getNamedQuery(id)
    if (!nq) {
        throw new CoreError(404, { error: 'Named query not found' })
    }
    return toClientNamedQuery(nq)
}

export type SaveNamedQueryInput = {
    id?: string
    name: string
    description?: string
    sqlTemplate: string
    params: QueryParamDef[]
    defaultConnectionId?: string
}

export function saveNamedQuery(input: SaveNamedQueryInput): ClientNamedQuery {
    const saved = upsertNamedQuery({
        id: input.id,
        name: input.name,
        description: input.description,
        sqlTemplate: input.sqlTemplate,
        params: input.params,
        defaultConnectionId: input.defaultConnectionId,
    })
    return toClientNamedQuery(saved)
}

export function removeNamedQuery(id: string): void {
    deleteNamedQuery(id)
}

