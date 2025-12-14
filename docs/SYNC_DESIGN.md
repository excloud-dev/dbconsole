# E2E Named-Query Sync (Sync Phrase / Sync Chain)

This document describes how **named queries** sync across multiple devices using a shared **sync phrase**.

- **End-to-end encrypted (E2E):** the server stores *only ciphertext*.
- **Multi-device:** any device with the same sync phrase joins the same “sync chain”.
- **Conflict resolution:** names are unique; conflicts are resolved with a diff UI.

> Scope: named queries only. Connection passwords are *not* synced.

---

## Goals

1. **Sync named queries** between many devices and a server.
2. **E2E encryption** using a user-provided **sync phrase**.
3. **No server-side query visibility** (server cannot read SQL).
4. **Simple conflict model**:
   - Keep `name` unique.
   - On conflict, user chooses:
     - **Overwrite local** (keep remote)
     - **Overwrite remote** (keep local)
     - **Rename local** (keep both; creates a *new id* and new entry)

---

## Key concepts

### Sync phrase
A user-entered secret string. Devices that know the same phrase are in the same **sync chain**.

The phrase is stored locally **encrypted at rest** (see “Local secret storage”).

### Derived keys (KDF)
From the sync phrase, we derive deterministic keys so all devices can:

- Encrypt/decrypt payloads consistently
- Authenticate to the server without sending the phrase

We derive keys using:

- `keyMaterial = scrypt(syncPhrase, "dbconsole-sync-v1", 32)`
- `encKey = hkdf(keyMaterial, salt="dbconsole-sync-enc", info="named-queries", 32)`
- `authKey = hkdf(keyMaterial, salt="dbconsole-sync-auth", info="named-queries", 32)`

The device sends `authKey` (base64url) as a **bearer token**.

### Chain ID
The server partitions storage by `chainId`, derived from `authKey`:

- `chainId = base64url(sha256(authKey))`

The server never needs the phrase or `encKey`.

---

## Server storage model (ciphertext only)

The server stores a single record per `(chainId, resource)`:

- `resource = named-queries`
- Columns:
  - `chain_id` (PK)
  - `version` (monotonic integer)
  - `ciphertext_b64` (opaque)
  - `updated_at`

The server does not interpret the ciphertext. It only enforces **optimistic concurrency**.

---

## Snapshot payload format

The ciphertext decrypts to a JSON snapshot:

- `queries`: array of query records
- `tombstones`: array of deletions (to propagate deletes, optional; see “Deletion sync”)

Each query includes:

- `id` (uuid)
- `name` (unique)
- `description`
- `sqlTemplate`
- `paramsJson` (JSON string of typed parameter definitions)
- `defaultConnectionId`
- `updatedAt` (ISO string)

Deletions use tombstones:

- `id`
- `deletedAt` (ISO string)

> We use tombstones because hard deletes do not sync well across devices.

---

## Deletion sync

Deletion sync is intentionally **off by default** to avoid surprising data loss across devices/environments.

- When deletion sync is **off**:
  - Local tombstones are kept locally.
  - Remote tombstones are ignored/stripped when merging.
  - Local deletes do **not** delete remote.
- When deletion sync is **on**:
  - Tombstones are included in the snapshot and merged by `deletedAt` (latest wins).
  - Tombstoned ids are removed from the merged queries.

---

## API: pull / push

The device must know the **server base URL** and the **sync phrase**.

### Pull

- Request: `POST /api/sync/named-queries/pull`
- Headers:
  - `x-dbconsole-sync-token: <base64url(authKey)>`
- Response:
  - `version` (integer)
  - `ciphertextB64` (string | null)

If nothing exists yet, server returns `version=0` and `ciphertextB64=null`.

### Push

- Request: `POST /api/sync/named-queries/push`
- Headers:
  - `x-dbconsole-sync-token: <base64url(authKey)>`
- Body:
  - `baseVersion` (the version the client based its update on)
  - `ciphertextB64` (the new encrypted snapshot)

Server behavior:
- If `baseVersion !== currentVersion`: return `409` with `currentVersion` and current `ciphertextB64`.
- Else: store ciphertext and increment version.

---

## Running as a sync relay server only

DBConsole can run as a minimal **sync relay** (useful for serving multiple desktop DBConsole clients) by setting:

- `DBCONSOLE_SYNC_SERVER_ONLY=1`

In this mode, only the sync relay endpoints are exposed; the UI and other routes return `404`.

---

## Client sync algorithm (multi-device)

Each device maintains:

- local named queries table (SQLite)
- a stored **merge base snapshot** per chain (the last successfully synced merged snapshot)

### Normal sync
1. **Pull remote** snapshot `(version, ciphertext)`.
2. **Decrypt remote** with `encKey` derived from the sync phrase.
3. **Load local** snapshot from SQLite (including tombstones).
4. **Load merge base** snapshot from local encrypted settings (if missing, treat the current remote as the base).
5. **Compute merge** of (base, local, remote):
   - Prefer the side that changed since base when the other side did not.
   - Only flag a conflict when **both** local and remote changed since base and diverged.
5. If merged snapshot differs from remote:
   - **Push** merged snapshot with `baseVersion=remoteVersion`.
6. Persist the merged snapshot as the new **merge base**.

### Version conflicts (concurrent pushes)
If push returns `409`:
1. Decrypt server’s returned snapshot.
2. Re-run merge locally.
3. If conflicts exist, show the diff UI.
4. After user resolution, push again with the new baseVersion.

This allows many devices to sync safely:
- device A pushes version 5 → server becomes 6
- device B (still on 5) pushes → gets 409 and remote v6 → merges → pushes v6 → server becomes 7

---

## Conflict detection and policy (unique names)

Conflicts are detected client-side during merge.

### Conflict types

1. **Same id, different content**
   - Only a conflict if **both** local and remote changed since the stored merge base.
   - User chooses overwrite local or overwrite remote (or rename local, which preserves both).

2. **Different ids, same name** (name uniqueness conflict)
   - User chooses:
     - **Overwrite local:** discard the local query that collides with remote name.
     - **Overwrite remote:** apply local content to the *remote* query (keeping remote id), and discard the duplicate local id.
     - **Rename local:** create a **new id** and a new local query entry with a user-chosen name; then include it in the next push.

> “Rename local” always creates a new query id to preserve both versions cleanly.

---

## Local secret storage

### Sync phrase storage
The sync phrase is stored locally in the meta SQLite DB **encrypted at rest**.

- Desktop (Electron): encryption key is generated once and stored wrapped by OS keychain via `electron.safeStorage`.
- Web/Node server: encryption key comes from `DBCONSOLE_SECRET_KEY_B64`.

### Merge base storage (conflict reduction)
The device stores the **last successfully merged** named-query snapshot locally (encrypted at rest) and uses it as a merge base for 3-way merges.

This prevents “constant conflicts” when a device edits locally and the remote still has the previous version.

### Why store the phrase at all?
To enable background/one-click sync without prompting every time.

---

## Security notes

- The sync phrase/auth token should never be logged.
- Desktop UI should avoid keeping the phrase in long-lived renderer state.
- Use HTTPS for the remote server.
- The server is a dumb relay: confidentiality depends on the sync phrase.

---

## Non-goals (for now)

- Per-user accounts, OAuth, Cloudflare Access integration.
- Server-side search/indexing of queries.
- Partial merges of SQL text (we do overwrite or rename).
