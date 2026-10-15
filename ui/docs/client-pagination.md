# Client-side pagination

Our custom `pagination` service allows us to paginate LIST responses while maintaining good performance, particularly when the LIST response includes tens of thousands of keys in the data response. It does this by caching the entire response, and then filtering the full response into the datastore for the client. It was originally a custom method in our `store` service that extended the ember-data `store` but now is it's own `pagination` service.

## Using pagination

Rather than use `store.query`, use `pagination.lazyPaginatedQuery`. It generally uses the same inputs, but accepts additional keys in the query object `size`, `page`, `responsePath`, `pageFilter`

### Before

```js
export default class ExampleRoute extends Route {
  @service store;

  model(params) {
    const { secret } = params;
    const { backend } = this.paramsFor('vault.cluster.secrets.backend');
    return this.store.query('pki/role', { backend, id })
  }
```

### After

```js
export default class ExampleRoute extends Route {
  @service pagination;

  model(params) {
    const { page, pageFilter, secret } = params;
    const { backend } = this.paramsFor('vault.cluster.secrets.backend');
    return this.pagination.lazyPaginatedQuery('secret', {
      backend,
      id: secret,
      size,
      page,
      responsePath,
      pageFilter
    })
  }
```

The `size` param defaults to the default page size set in [the app config](../config/environment.js). `responsePath` and `page` are required, and typically `responsePath` is going to be `data.keys` since that is where the LIST responses typically return their array data.

### Serializing

In order to interrupt the regular serialization when using `lazyPaginatedData`, define `extractLazyPaginatedData` on the modelType's serializer. This will be called with the raw response before being cached on the store. `extractLazyPaginatedData` should return an array of objects.

## Gotchas

The data is cached from whenever the original API call is made, which means that if a user views a list and then creates or deletes an item, viewing the list page again will show outdated information unless the cache for the item is cleared first. For this reason, it is best practice to clear the dataset with `pagination.clearDataset(modelName)` after successfully deleting or creating an item.

## How it works

When using the `lazyPaginatedQuery` method, the full response is cached in a [tracked Map](https://github.com/tracked-tools/tracked-built-ins/tree/master) within the service. `pagination.lazyCaches` is actually a Map of [Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map), keyed first on the normalized modelType and then on a stringified version of the base query (all keys except ones related to pagination). So, at the top level `pagination.lazyCaches` looks like this:

```
lazyCaches = new Map({
  "secret": <Map>,
  "kmip": <Map>,
  "namespace": <Map>,
})
```

Within each top-level modelType, we need to separate cached responses based on the details of the query. Typically (but not always) this includes the backend name. In list items that can be nested (see KV V2 secrets or namespaces for example) `id` is also provided, so that the keys nested under the given ID is returned. The pagination.lazyCaches may look something like the following after a user navigates to a couple different KV v2 lists, and clicks into the `app/` item:

```
lazyCaches = new Map({
  "secret": {
    "{ backend: 'secret', id: '' }: <CachedData>,
    "{ backend: 'secret', id: 'app/' }: <CachedData>,
    "{ backend: 'kv2', id: '' }: <CachedData>,
  },
  ...
})
```

The cached data at the given key is an object with `response` and `dataset` keys. The response is the full response from the original API call, with the `responsePath` nulled out (it is repopulated before "sending" the data back to the store). `dataset` is the full, original value at `responsePath`, usually an array of strings. An example of what the data might look like:

```
lazyCaches = new Map({
  "secret": {
    "{ backend: 'secret', id: 'app/' }: {
      dataset: ['some', 'nested', 'secrets'],
      response: {
        request_id: 'foobar',
        data: {},
        ...
      }
    },
  },
  ...
})
```

## List-with-capabilities request path

This section is a read-only evidence map of the list-plus-capabilities pattern adopted
by the ACL policy and PKI key list routes. No Go files, the generated client, or any
`http.Handler` code is modified by this documentation — the described path is already
shipped.

### Route → server call chain

| Layer | Symbol | Notes |
|---|---|---|
| Ember addon helper | `loadListPage` in `ui/lib/core/addon/utils/list-with-capabilities.ts` | Session-caches the full key array; slices to `pageSize` rows before fetching capabilities |
| ACL route | `PoliciesAclIndexRoute` (`ui/app/routes/vault/cluster/policies/acl/index.ts`) | Calls `loadListPage` with `pageSize=10` and `listType='acl'` |
| PKI keys route | `PkiKeysIndexRoute` (`ui/lib/pki/addon/routes/keys/index.js`) | Calls `loadListPage` with `pageSize=15` and `listType='pki-keys'` |
| Generated TypeScript client | `policiesListAclPolicies` on `@hashicorp/vault-client-typescript` / `SecretsApiPkiListKeysListEnum` for PKI | Thin wrapper around the HTTP call; no page or limit field |
| Go API helper | `api/sys_policy.go` `ListPoliciesWithContext` | Sends `GET /v1/sys/policies/acl` with `list=true`; decodes `secret.Data["keys"]` into a `[]string`; **has no page or limit parameter** |
| HTTP handler | `http/handler.go` | `CustomMaxJSONArrayElementCount` stays **10000**; `http/handler.go`, `api/sys_policy.go`, and `vault/policy_store.go` are **not edited** by this or any WO in the list-with-capabilities feature set |
| Logical backend | `vault/policy_store.go` `PolicyStore.ListPolicies` | Scans the barrier view with `logical.CollectKeys`; returns every ACL name as a flat slice with no cursor |

### Session cache contract

- **Storage**: in-memory `Map` keyed by `${namespace}::${listType}::${mount}` — never
  `localStorage`, never serialised to disk.
- **ACL rows**: name strings only. No policy body, no HCL, no secret material.
- **PKI rows**: `key_id`, `key_name`, `is_default`. No PEM, no `private_key`.
- **Page sizes**: `10` for ACL policies, `15` for PKI keys (unless the route already
  overrides `pageSize`).
- **Cache eviction**: `invalidateListCache(namespace, listType, mount)` is called after
  create, delete, or namespace change. The module-level Map is accessible via `_getCache()`
  in tests only.

### Capabilities fetch contract

- **One POST to `/sys/capabilities-self`** per page navigation, covering the visible page
  rows plus one create path (`pathFor('policiesAcl')` or `pathFor('policy', {policyType, id})`).
- **PKI adds two extra paths**: `pathFor('pkiKeysImport')` and `pathFor('pkiKeysGenerate')`.
- Capabilities for rows outside the current page are **never requested**; the prior full-scan
  pattern is replaced by this page-bounded fetch.
- A capabilities POST failure is **fail-open** inside `CapabilitiesService` — the server
  remains the authority; a missing capabilities response does not prevent the list from
  rendering, but the server will still deny any unauthorised action.

### HTTP status contract (`listOrEmpty`)

| HTTP status from LIST | Route behaviour |
|---|---|
| `200` | Normal; names cached and sliced to page |
| `404` | Empty list — renders `"No ACL policies yet"` / `"No keys yet"` empty state |
| `401` | **Re-thrown as error** — never mapped to empty |
| `403` | **Re-thrown as error** — never mapped to empty |
| `5xx` / other | **Re-thrown as error** — never mapped to empty |

This is the `listOrEmpty` contract. Only `404` is treated as an absence of data;
every denial (`401`, `403`) and server fault surfaces as an error so operators can
distinguish "nothing exists" from "you are not allowed to see it" (OWASP A10).

### EGP and RGP routes

EGP (`PoliciesEgpIndexRoute`) and RGP (`PoliciesRgpIndexRoute`) adopt `loadListPage`
conditionally when `egpRgpListShapeMatchesAcl = true` (recorded by WO-015). When the
flag is `false`, both routes keep their existing direct-call approach and are listed here
as **unchanged routes** — not as failed migrations.

### Out of scope

The following routes do **not** adopt `loadListPage` and are not described here:
- KV secrets (`ui/lib/kv`)
- LDAP (`ui/lib/ldap`)
- KMIP (`ui/lib/kmip`)
- Identity entity list (`ui/app/routes/vault/cluster/access/identity/entities/index.js`)
