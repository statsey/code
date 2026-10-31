# Statsey API

This document describes the HTTP API implemented by the Statsey server.

## Server

The server listens on `PORT` when that environment variable is set, or on port
`8000` by default. The examples below use:

```text
http://localhost:8000
```

The server accepts JSON request bodies up to 64 KiB. Send JSON requests with:

```http
Content-Type: application/json
```

CORS is enabled for all origins by the server's default CORS configuration.

## SMTP configuration

The server loads `src/.env` automatically when the file exists and uses Google
SMTP by default:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SMTP_HOST` | No | `smtp.gmail.com` | Must remain `smtp.gmail.com`. |
| `SMTP_PORT` | No | `465` | Gmail SMTP port. Port `587` can be used with `SMTP_SECURE=false`. |
| `SMTP_SECURE` | No | `true` for port `465` | Use TLS-on-connect for port `465`. |
| `SMTP_USER` | Yes | — | Gmail address used to send mail. |
| `SMTP_PASS` | Yes | — | Google App Password, not the normal Google account password. |
| `SMTP_FROM` | No | `SMTP_USER` | Sender address. |

Gmail setup:

1. Enable 2-Step Verification on the Google account.
2. Create a Google App Password for this application.
3. Put the 16-character App Password in `SMTP_PASS`.
4. Never commit `src/.env` or expose the App Password.

Use `src/.env.example` as the configuration template. API keys are delivered
by email and are never included in HTTP responses.

## Authentication

Protected endpoints use the API key delivered by `POST /api/auth/register` or
`POST /api/auth/rotate-key`. Pass it in the `Authorization` header. The
recommended form is:

```http
Authorization: Bearer sk_live_statsey:<128 hexadecimal characters>
```

The server also accepts the API key without the `Bearer` prefix. API keys are
secrets: do not expose them in client-side source, logs, or URLs.

A request with a missing, malformed, or unknown key receives:

```json
{
  "message": "Invalid or missing token"
}
```

with status `401 Unauthorized`.

## Endpoints at a glance

| Method | Path | Authentication | Description |
| --- | --- | --- | --- |
| `GET` | `/` | No | Returns the server's root text response. |
| `POST` | `/api/auth/register` | No | Registers a user and emails an API key. |
| `GET` | `/api/auth/userinfo` | Yes | Returns the authenticated user's metadata. |
| `POST` | `/api/auth/rotate-key` | Yes | Replaces the current API key and invalidates the old one. |
| `POST` | `/api/projects/add` | Yes | Creates a project and associates it with the user. |
| `GET` | `/api/projects/:projectId/transactions` | Yes | Reads the project's write transaction history. |
| `POST` | `/api/projects/action` | Yes | Executes one permitted SQL statement against a project. |

There are currently no HTTP endpoints for deleting projects, listing project
metadata, or removing a project from a user.

## Rate limiting

All requests pass through a global fixed-window limiter:

- **120 requests per 60 seconds**.
- Valid `Bearer` API keys are limited independently by token; other requests
  are limited by client IP.

The project endpoints add their own per-credential/IP limits:

| Endpoint | Limit |
| --- | --- |
| `POST /api/auth/rotate-key` | 5 requests per 60 seconds |
| `POST /api/projects/add` | 10 requests per 60 seconds |
| `POST /api/projects/action` | 20 requests per 60 seconds |
| `GET /api/projects/:projectId/transactions` | 60 requests per 60 seconds |

The limiters are in-memory and reset when the server restarts. Responses that
pass through a limiter include:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Maximum requests in the current window. |
| `X-RateLimit-Remaining` | Requests remaining in the current window. |
| `X-RateLimit-Reset` | Unix timestamp, in seconds, when the window resets. |

When a limit is exceeded, the server returns `429 Too Many Requests`, also
including `Retry-After` in seconds:

```json
{
  "message": "Rate limit exceeded",
  "retryAfterSeconds": 42
}
```

## `GET /`

Returns the server's current root response. This is a plain-text response, not
JSON.

### Response

- Status: `200 OK`
- Content type: `text/html; charset=utf-8` (Express's `res.send` response)
- Body:

```text
homepade fucker
```

## `POST /api/auth/register`

Creates a user record and emails a new API key. A valid `email` is required so
the key has a delivery destination. `handle` is optional; if supplied, it is
stored only when it passes validation.

### Request body

```json
{
  "email": "ada@example.com",
  "handle": "ada_lovelace"
}
```

Fields:

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `email` | string | Yes | Must match the server's email pattern. The API key is sent here. |
| `handle` | string | No | 3–16 characters; letters, numbers, `_`, and `-` only. |

The registration identity is the valid handle when one is supplied; otherwise
it is the valid email. Registering the same identity again returns a conflict.

### Success response

Status: `200 OK`

```json
{
  "message": "User registered successfully. The API key was sent by email.",
  "statusCode": 200
}
```

The API key is never returned by this endpoint. It is sent to the supplied
email address instead.

### Errors

| Status | Condition | Response |
| --- | --- | --- |
| `400` | No fields are supplied, the email is missing, or the email is invalid. | `{ "message": "Twin, add your handle or email" }` when no fields are supplied; otherwise `{ "message": "A valid email is required to receive the API key", "statusCode": 400 }` |
| `409` | The registration identity already exists. | `{ "message": "This User already exists", "statusCode": 409 }` |
| `500` | API-key generation or user-file creation fails. | `{ "message": "Unable to generate an API key" }`, or `{ "message": "An error occurred while registering the user" }` depending on the failure. |
| `503` | SMTP is not configured or the key email could not be delivered. | `{ "message": "SMTP is not configured..." }` or `{ "message": "Unable to deliver the API key email" }` |

The `statusCode` property in the successful and validation/conflict responses
is part of the current response body, in addition to the HTTP status.

### Example

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","handle":"ada_lovelace"}'
```

## `GET /api/auth/userinfo`

Returns the metadata for the API key in the `Authorization` header. The API
key itself is intentionally omitted.

### Success response

Status: `200 OK`

```json
{
  "handle": "ada_lovelace",
  "email": "ada@example.com",
  "projectIds": [
    "0123456789abcdef0123456789abcdef"
  ]
}
```

`handle` and `email` are present when they were valid at registration time;
`projectIds` contains the projects associated with this user. The exact set of
identity fields therefore depends on the registration request.

### Errors

| Status | Response |
| --- | --- |
| `401` | `{ "message": "Invalid or missing token" }` |
| `500` | `{ "message": "Internal server error" }` |

### Example

```bash
curl http://localhost:8000/api/auth/userinfo \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>'
```

## `POST /api/auth/rotate-key`

Replaces the API key supplied in the `Authorization` header. The old key is
invalid immediately after a successful rotation. User metadata, including
`projectIds`, is preserved.

The endpoint does not require a request body.

### Success response

Status: `200 OK`

```json
{
  "message": "API key rotated and sent by email",
  "user": {
    "handle": "ada_lovelace",
    "email": "ada@example.com",
    "projectIds": [
      "0123456789abcdef0123456789abcdef"
    ]
  }
}
```

The replacement key is emailed to the user's registered email address. It is
not included in this response or `/api/auth/userinfo`, and the previous key
cannot be used again.

### Errors

| Status | Condition | Response |
| --- | --- | --- |
| `401` | The API key is missing, malformed, or no longer valid. | `{ "message": "Invalid or missing token" }` |
| `429` | More than five rotations are requested in 60 seconds. | `{ "message": "Rate limit exceeded", "retryAfterSeconds": 42 }` |
| `400` | The user has no valid email address for key delivery. | `{ "message": "A valid email address is required to deliver the API key" }` |
| `500` | A replacement key cannot be generated or the user metadata cannot be updated. | `{ "message": "Unable to rotate API key" }` |
| `503` | SMTP is not configured or the replacement key could not be delivered. | `{ "message": "SMTP is not configured..." }` or `{ "message": "Unable to deliver the API key email" }` |

### Example

```bash
curl -X POST http://localhost:8000/api/auth/rotate-key \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>'
```

## `POST /api/projects/add`

Creates a new SQLite-backed project and associates it with the authenticated
user. The project ID is generated by the server and is a 32-character
lowercase hexadecimal string.

### Request body

```json
{
  "projectName": "Ada's experiments"
}
```

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `projectName` | string | Yes | Leading/trailing whitespace is removed; the resulting name must be 1–100 characters. |

### Success response

Status: `201 Created`

```json
{
  "message": "Project created successfully",
  "project": {
    "projectId": "0123456789abcdef0123456789abcdef",
    "name": "Ada's experiments"
  }
}
```

The project is added to the authenticated user's `projectIds` as part of the
operation. If that association cannot be completed, the newly created project
is removed and the request fails.

### Errors

| Status | Condition | Response |
| --- | --- | --- |
| `400` | `projectName` is not a string, is empty after trimming, or exceeds 100 characters. | `{ "message": "Project name must be a string" }` or `{ "message": "Project name must be between 1 and 100 characters" }` |
| `401` | The API key is missing or invalid. | `{ "message": "Invalid or missing token" }` |
| `500` | Project creation or user update fails. | `{ "message": "Unable to create project" }` |

### Example

```bash
curl -X POST http://localhost:8000/api/projects/add \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"projectName":"Ada's experiments"}'
```

## `GET /api/projects/:projectId/transactions`

Returns the audit history of successful write queries for a project. The
requesting user must have the project ID in their `projectIds` list.

### Path parameters

| Parameter | Type | Constraints |
| --- | --- | --- |
| `projectId` | string | Exactly 32 lowercase hexadecimal characters. |

### Success response

Status: `200 OK`

```json
{
  "projectId": "0123456789abcdef0123456789abcdef",
  "count": 1,
  "transactions": [
    {
      "id": "b3b1554a-1fe6-4bc0-b4a8-a7d7d7c1e8f2",
      "timestamp": "2026-10-31T12:00:00.000Z",
      "actor": {
        "handle": "ada_lovelace",
        "email": "ada@example.com"
      },
      "source": {
        "ip": "127.0.0.1",
        "country": "GB",
        "userAgent": "curl/8.0.0",
        "method": "POST",
        "path": "/api/projects/action"
      },
      "change": {
        "command": "INSERT INTO notes (body) VALUES (?)",
        "params": ["first note"]
      },
      "result": {
        "durationMs": 3.14,
        "affectedRows": 1,
        "affectedColumns": ["body"],
        "lastInsertRowid": 1
      }
    }
  ]
}
```

Details:

- `count` equals `transactions.length`.
- Only successful write queries are logged. Reads are not logged.
- At most the most recent 100 transactions are retained per project.
- `actor` contains only the user's handle and email; it never contains the
  API key.
- `source.country` is read from `CF-IPCountry`, `X-Vercel-IP-Country`, or
  `X-Country`, in that order, and is returned only when it is a valid two-letter
  country code. Other source fields may be `null`.
- If the SQL write succeeds but the audit record cannot be written, the action
  response has `transaction: null` and a `transactionLogError` field. Such a
  write is not recoverable through this endpoint's transaction history.

### Errors

| Status | Condition | Response |
| --- | --- | --- |
| `400` | A project ID reaches storage validation in an invalid format. | `{ "message": "Invalid project ID" }` |
| `401` | The API key is missing or invalid. | `{ "message": "Invalid or missing token" }` |
| `403` | The project ID is missing, malformed, or not associated with the user. | `{ "message": "You do not have access to this project" }` |
| `500` | Reading the transaction journal fails. | `{ "message": "Unable to read transaction history" }` |

A project that has no transaction file yet returns an empty `transactions`
array rather than an error.

### Example

```bash
curl http://localhost:8000/api/projects/0123456789abcdef0123456789abcdef/transactions \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>'
```

## `POST /api/projects/action`

Executes one permitted SQL statement against the selected project's SQLite
database. The user must own the project.

### Request body

```json
{
  "projectId": "0123456789abcdef0123456789abcdef",
  "command": "SELECT id, body FROM notes WHERE id > ?",
  "params": [0]
}
```

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `projectId` | string | Yes | Must be a project ID owned by the authenticated user and match `^[a-f0-9]{32}$`. |
| `command` | string | Yes | One trimmed SQL statement; see SQL restrictions below. Maximum 16 KiB in UTF-8. |
| `params` | array | No | Defaults to `[]`; see parameter restrictions below. |

### SQL restrictions

The first SQL keyword must be one of:

- Read statements: `SELECT`, `EXPLAIN`
- Write statements: `ALTER`, `CREATE`, `DELETE`, `DROP`, `INSERT`, `REPLACE`,
  `UPDATE`

The server rejects commands that:

- are empty or contain more than one statement;
- contain a semicolon;
- call `randomblob`, `zeroblob`, `readfile`, `writefile`, `printf`, or `format`;
- exceed 16 KiB after trimming.

SQLite syntax and execution errors are returned as a query error. The command
runs in a worker with a two-second execution limit.

### Parameter restrictions

`params` must be an array with no more than 100 values and a serialized size of
no more than 32 KiB. Each value must be one of:

- string;
- finite number whose absolute value is at most 10,000,000;
- boolean; or
- `null`.

Use SQLite placeholders (`?`) and `params` for user-provided values instead of
interpolating values into `command`.

### Read success response

Status: `200 OK`

```json
{
  "message": "Query executed successfully",
  "projectId": "0123456789abcdef0123456789abcdef",
  "columns": ["id", "body"],
  "rows": [
    { "id": 1, "body": "first note" }
  ],
  "rowCount": 1,
  "truncated": false,
  "affectedRows": 0,
  "affectedColumns": [],
  "queryType": "read",
  "durationMs": 2.31,
  "transaction": null
}
```

Read results are limited to 1,000 rows and 1 MiB of cumulative serialized row
data. A single row may be at most 512 KiB. `truncated` is `true` when the
1,000-row limit is reached. Binary SQLite values are returned as base64 strings;
BigInt values that cannot safely be represented as JavaScript numbers are
returned as strings.

### Write success response

Status: `200 OK`

```json
{
  "message": "Query executed successfully",
  "projectId": "0123456789abcdef0123456789abcdef",
  "columns": [],
  "rows": [],
  "rowCount": 0,
  "truncated": false,
  "affectedRows": 1,
  "affectedColumns": ["body"],
  "lastInsertRowid": 1,
  "queryType": "write",
  "durationMs": 3.14,
  "transaction": {
    "id": "b3b1554a-1fe6-4bc0-b4a8-a7d7d7c1e8f2",
    "timestamp": "2026-10-31T12:00:00.000Z",
    "actor": {
      "handle": "ada_lovelace",
      "email": "ada@example.com"
    },
    "source": {
      "ip": "127.0.0.1",
      "country": null,
      "userAgent": "curl/8.0.0",
      "method": "POST",
      "path": "/api/projects/action"
    },
    "change": {
      "command": "INSERT INTO notes (body) VALUES (?)",
      "params": ["first note"]
    },
    "result": {
      "durationMs": 3.14,
      "affectedRows": 1,
      "affectedColumns": ["body"],
      "lastInsertRowid": 1
    }
  }
}
```

Write responses have `columns: []`, `rows: []`, `rowCount: 0`, and
`truncated: false`. `affectedColumns` is derived from the write command when
possible; it may be empty for statements where columns cannot be inferred.
`lastInsertRowid` is returned as a number when safe, otherwise as a string.

If the database write succeeds but transaction logging fails, the response
still has status `200` and includes:

```json
{
  "transaction": null,
  "transactionLogError": "The database change succeeded, but its transaction could not be logged"
}
```

### Errors

| Status | Condition | Response |
| --- | --- | --- |
| `400` | An invalid project ID reaches query validation, `params` is invalid, SQL is unsupported, or SQLite reports a query failure. | `{ "message": "..." }` |
| `401` | The API key is missing or invalid. | `{ "message": "Invalid or missing token" }` |
| `403` | `projectId` is missing, malformed for the request body, or not owned by the user. | `{ "message": "You do not have access to this project" }` |
| `408` | Query execution exceeds two seconds. | `{ "message": "Query exceeded the execution time limit" }` |
| `413` | The command, parameters, a row, or the complete result is too large. | `{ "message": "..." }` |
| `500` | The query worker or another server component fails unexpectedly. | `{ "message": "Unable to execute project action" }` |

The API returns only a `message` for query errors; internal query error codes
are not exposed in the HTTP response.

### Examples

Create a table:

```bash
curl -X POST http://localhost:8000/api/projects/action \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"0123456789abcdef0123456789abcdef",
    "command":"CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)"
  }'
```

Insert with a bound parameter:

```bash
curl -X POST http://localhost:8000/api/projects/action \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"0123456789abcdef0123456789abcdef",
    "command":"INSERT INTO notes (body) VALUES (?)",
    "params":["hello"]
  }'
```

Read rows:

```bash
curl -X POST http://localhost:8000/api/projects/action \
  -H 'Authorization: Bearer sk_live_statsey:<your-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"0123456789abcdef0123456789abcdef",
    "command":"SELECT id, body FROM notes WHERE id > ?",
    "params":[0]
  }'
```

## Common response conventions

- JSON responses use an object with a `message` field for endpoint errors.
- The API does not currently publish an OpenAPI document or version prefix.
- Project ownership is checked from the authenticated user's `projectIds`; a
  valid API key alone does not grant access to another user's project.
- Project and user data are stored locally by the server. Deployments should
  protect the `projects` and `user_meta` directories and use HTTPS when the API
  is exposed beyond localhost.
