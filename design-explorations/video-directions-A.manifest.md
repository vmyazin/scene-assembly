# Variant A implementation manifest

Approved reference: `video-directions-A.reference.html`, extracted from the user-selected exploration with delayed image previews and no persistent details row.

| Element | Source | Coverage | Decision |
| --- | --- | --- | --- |
| Direction labels | VideoWorkspace.MODES[].label | Real, 5/5 | Preserve |
| Icons | VideoWorkspace.MODES[].icon | Real, 5/5 | Use Lucide icons, replacing prototype symbols |
| Illustrations | VideoWorkspace.MODES[].thumbnail | Real, 5/5 | Preserve original artwork |
| Description | VideoWorkspace.MODES[].blurb | Real, 5/5 | Show only inside preview |
| Input requirement | VideoWorkspace.MODES[].requires | Real, 5/5 | Show only inside preview |
| Provider caveat | VideoWorkspace.MODES[].needsProviderSupport | Conditional, 3/5 | Preserve approved condition; text/image intentionally have no caveat |
| Selection | inputMode + supportsMode | Real | Existing selection and fallback remain authoritative |
| Available choices | existing provider capability filter | Real, 2–5 modes | Preserve filtering; no invented disabled choices |

There are no unresolved gaps. The conditional caveat and illustrations are already represented in the approved exploration.

## Deliberate differences
The scope is the direction selector and preview card. Existing production hero, provider selector, credentials gate, model controls, prompt and generation actions remain intact; the exploration's static surroundings are scale context. Production uses Geist, theme tokens and Lucide instead of the HTML system-font and symbol fallbacks. The selector uses accessible pressed buttons, as the original did. No record/API requests are needed.

## Parity cases
Loaded: Runware's five directions; first/last-frame preview includes the conditional caveat. Sparse: Kie's two directions; text preview intentionally has no provider caveat. Both draw from existing catalog-backed filtering and complete static copy.

## Verification
Implementation complete. All 106 targeted regression tests, production build/typecheck and changed-file lint passed on 2026-10-08. Browser tooling failed; the user elected manual localhost inspection. The user confirmed the visual/interaction smoke check passed on 2026-10-08. No automated screenshot comparison is claimed.
