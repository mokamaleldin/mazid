# مساحة عمل مزيد

Browser-local Arabic thumbnail editor built from the supplied 1920 × 1080 Photoshop template and supplied FF Shamel fonts.

## Run

Serve `dist/` with any static HTTP server. No build, package installation, external API, or backend is required.

## Behavior

- Replace the photograph by file selection or drag and drop.
- Choose one or two Arabic title lines; banners and text fit automatically.
- Drag or use accessible range controls to reposition and zoom the photograph.
- Download 1920 × 1080 PNG or JPG from the same canvas used for preview.
- Drafts, including uploaded image blobs, stay in this browser's IndexedDB.
- Assets, original branding, torn paper textures, image mask, and FF Shamel font come from the supplied files.

## Rendering notes

The browser recreates the composition using original raster assets. Photographs receive a restrained warm-gray tone before being masked over a separate navy background. This avoids the strong cyan cast of the previous blue LUT pipeline and follows the supplied thumbnail reference. Branding and title papers are composited afterward so their original colors stay intact. Dragging temporarily uses a smaller background, followed by a full resolution render. Export always renders at full resolution. The Photoshop instruction overlay and its dark backing are excluded from the output. Text rasterization may differ slightly between browsers and Photoshop.

## Source file handling

The original PSD and ZIP are not included in the deployed web assets. Only the extracted template elements and supplied fonts necessary for the editor are included.
