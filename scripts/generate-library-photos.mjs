// Generates the photos in the mocked asset library with Workers AI (FLUX.1 schnell) and saves them
// to apps/web/public/library. The logos, chart, rate card and price tile are SVG artwork kept in
// the repo, since image models garble text. The brands are fictional, so the photos are too.
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/generate-library-photos.mjs [id …]
//
// The token needs Workers AI read access. With ids, only those photos are made again.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STYLE =
  "editorial stock photograph, natural light, shallow depth of field, no text, no logos, no lettering";

const PHOTOS = {
  "lt-img-congress-hero":
    "Wide shot of a large modern medical conference exhibition hall, cardiology congress, attendees in business attire, an elegant purple-toned exhibition booth in the foreground",
  "lt-img-cardivance-pack":
    "Product photograph of a plain white pharmaceutical medicine carton with a purple stripe and a blister pack of round white tablets on a clean white background, soft studio light",
  "lt-img-patient-walk":
    "An older man in his seventies walking outdoors in a park with a friendly clinician in a white coat, autumn morning",
  "lt-img-glucora-hero":
    "A clinician in a white coat reviewing a line chart of readings on a tablet with a patient in a bright clinic office",
  "hs-img-rate-hero":
    "A calm harbor at dawn with moored sailboats, soft blue and gold light over still water, wide landscape",
  "hs-img-advisor":
    "A financial advisor talking with a middle-aged client across a wooden desk in a bright modern office",
  "ck-img-chowder-hero":
    "A rustic bowl of creamy New England clam chowder with oyster crackers on a wooden table beside a rain-streaked window, cozy warm light, food photography",
  "ck-img-soup-counter":
    "A cozy coastal restaurant soup counter with three large steel soup kettles, warm wood and copper tones",
};

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}
const wanted = process.argv.slice(2);
const out = fileURLToPath(new URL("../apps/web/public/library/", import.meta.url));

const results = await Promise.all(
  Object.entries(PHOTOS)
    .filter(([id]) => wanted.length === 0 || wanted.includes(id))
    .map(async ([id, scene]) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ prompt: `${scene}, ${STYLE}`, steps: 8 }),
        },
      );
      const body = await response.json();
      const image = body?.result?.image;
      if (!response.ok || !image) {
        console.error(`✕ ${id}: ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`);
        return false;
      }
      await writeFile(`${out}${id}.jpg`, Buffer.from(image, "base64"));
      console.log(`✓ ${id}`);
      return true;
    }),
);
if (results.includes(false)) process.exit(1);
