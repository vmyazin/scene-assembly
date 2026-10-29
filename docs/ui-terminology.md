# UI terminology

| Term | Meaning |
| --- | --- |
| Provider | Service handling generation, credentials and billing. |
| Model | AI selected to create or edit an output; the same model can be offered by several providers with different limits and prices. |
| Mode | Operation and input choice, such as Image to video or Edit video. |
| Connection | Saved access to a provider; its API key or token is the credential. |

Use Provider in selectors, Mode for the video input selector, Model for model
choices, and Connections for credential management. Keep API key/token precise
on credential fields. Use provider names from PROVIDER_LABELS in
lib/engines/registry.ts; never append a model to a provider label, because the
two choices determine different parts of the request. Free status describes
the applicable generation or offering, not every service a provider sells.

Engine is internal generation terminology and remains valid for timeline
rendering. Do not rename EngineId, ProviderId, persisted store fields, API
fields, analytics fields, or model IDs during copy changes: ProviderId currently
means only the aggregator subset, and saved requests depend on those contracts.
