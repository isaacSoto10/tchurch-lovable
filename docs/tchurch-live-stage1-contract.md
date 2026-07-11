# Tchurch Live Stage 1 mobile contract

The iOS/Capacitor client keeps the presentation contract isolated in
`src/lib/presentationWorkspace.ts`.

## Read

`GET /services/{serviceId}/presentation-config?view=editor|operator|stage`

Authentication uses the normal bearer token and `x-church-id` headers from
`apiFetch`. The server is authoritative for `viewer.roles`, `viewer.canEdit`,
and role-based annotation filtering.

```json
{
  "schemaVersion": 1,
  "serviceId": "service-id",
  "serviceVersion": "opaque-service-version",
  "viewer": {
    "view": "editor",
    "churchRole": "PLANNER",
    "roles": ["worship_leader", "operator"],
    "canEdit": true
  },
  "items": [
    {
      "serviceItemId": "service-item-id",
      "itemVersion": 7,
      "arrangementId": "arrangement-id",
      "availableArrangements": [
        { "id": "arrangement-id", "name": "Domingo", "key": "D" }
      ],
      "source": {
        "arrangementId": "arrangement-id",
        "lyricsFingerprint": "opaque-fingerprint",
        "sections": [
          {
            "anchorId": "stable-section-anchor",
            "semanticKey": "chorus",
            "label": "Coro",
            "type": "chorus",
            "ordinal": 1,
            "fingerprint": "opaque-section-fingerprint",
            "preview": "Santo, santo"
          }
        ]
      },
      "sequence": [
        {
          "id": "stable-step-id",
          "sectionAnchorId": "stable-section-anchor",
          "sourceFingerprint": "opaque-section-fingerprint",
          "label": "Coro · repetir",
          "position": 0
        }
      ],
      "annotations": [
        {
          "id": "annotation-id",
          "sectionAnchorId": "stable-section-anchor",
          "sourceFingerprint": "opaque-section-fingerprint",
          "category": "direction",
          "visibility": "stage",
          "roles": ["worship_leader"],
          "body": "Repite el coro"
        },
        {
          "id": "whole-item-cue",
          "sectionAnchorId": null,
          "sourceFingerprint": null,
          "category": "safety",
          "visibility": "stage",
          "roles": ["all"],
          "body": "No usar humo"
        }
      ],
      "reconciliation": {
        "status": "current",
        "unresolvedAnnotationIds": [],
        "unresolvedStepIds": []
      }
    }
  ],
  "legacyNotes": []
}
```

Allowed annotation categories are `note`, `direction`, `musical`, `technical`,
`transition`, and `safety`. Allowed target roles are `worship_leader`, `band`,
`vocals`, `av`, `speaker`, `operator`, `stage`, and `all`.

The client preserves unresolved sequence rows and annotations in editor
snapshots but excludes them from stage execution until they are reconciled.

## Write

`PUT /services/{serviceId}/presentation-config?view=editor`

One item snapshot is sent per request. `expectedVersion` provides optimistic
concurrency; a `409` causes the client to refetch the editor workspace.

```json
{
  "schemaVersion": 1,
  "itemId": "service-item-id",
  "expectedVersion": 7,
  "arrangementId": "arrangement-id",
  "sequence": [
    {
      "id": "existing-server-step-id",
      "sectionAnchorId": "stable-section-anchor",
      "sourceFingerprint": "opaque-section-fingerprint",
      "label": "Coro",
      "position": 0
    }
  ],
  "annotations": []
}
```

For an arrangement change, the client sends the current sequence and
annotations with the new `arrangementId`. The server remaps anchors atomically,
preserves unresolved data, and returns `needs_review` when human review is
required. At least one active sequence step is required.

## Compatibility behavior

If the endpoint is unavailable (`404` or `405`), the app derives a read-only
sequence from ChordPro section directives so existing services still present.
Writes never fall back to a broad service update, avoiding lost updates.
