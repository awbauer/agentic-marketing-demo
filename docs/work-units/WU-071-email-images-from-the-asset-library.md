# WU-071: Email images from the brand's asset library

Status: done

## Scope

- A mocked asset library per brand: Aprimo for Lumera and Harborstone, Marketing Cloud Content Builder for Coastline, with each image's library ID, alt text, approval, usage rights, and any claim it shows.
- The authoring service suggests images the way it inserts claims: the logo, a banner matched to the wave's theme, and an image beside the claims. It takes only images that are approved, in rights on the send date, and show no uncited claim, and it lists every image it passed over with the reason.
- Channel versions keep what their channel allows: a push keeps the banner, a text message none.
- The Journeys asset preview places the images in the email (and the banner on a push), opens each for its library ID, approval, rights and why it was chosen, and lists passed-over images under "kept out".

## Acceptance criteria

- For the Lumera congress email, the service picks the logo, the congress banner and the Cardivance pack shot, and passes over the pending superiority chart and the photo whose rights end before the send date.
- An image showing a claim the module doesn't cite is passed over with that reason.
- The agent does not choose images; the library is mocked and the preview says so by drawing placeholders with alt text.

## Evidence

- `packages/architecture/src/architecture.test.ts` (images from the asset library)
- `apps/web/src/architecture/asset.test.ts` (images and passed-over images in the preview)
- A Lumera journey in the browser on real Workers AI: three Aprimo images placed, two passed over with their reasons.
